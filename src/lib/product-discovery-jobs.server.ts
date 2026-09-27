// ============================================================================
// PRODUCT DISCOVERY — KALICI İŞ DEPOZİTOSU.
//
// Bu modül, hat boyunca taşınan tek gerçek doğruluk kaynağıdır. Bellek
// (`Map`) tabanlı sahiplik daha önce `/start` ucunda yazılıyordu; bu
// sunucusuz (Vercel Hobby) ortamda ÇALIŞMIYORDU: her QStash adımı ayrı ve
// soğuk bir fonksiyon örneğinde koştuğu için bellek boş bulunuyor,
// `recallOwnership()` `null` dönüyor ve hattın tamamı 403 ile ölüyordu.
// Artık sahiplik `searches.user_id` satırından okunur ve her adımda
// YENİDEN doğrulanır.
//
// İKİ SÜTUN, İKİ FARKLI SÖZLÜK (kritik ayrım):
//   • `status`             → 'processing' | 'completed' | 'failed'
//                            MEVCUT istemci yoklaması, Realtime aboneliği ve
//                            `complete_search_job` RPC'si bu üçlüyü tanır.
//                            Değiştirilirse mevcut arama akışı bozulur.
//   • `discovery_status`   → yeni 7'li durum makinesi
//                            ('queued'…'failed'). Panel ve SSE bunu okur.
//
// Bu yüzden ara adımlarda `status` 'processing' KALIR; yalnız terminal
// durumda ilerler. `advance_discovery_status` RPC'si bunu atomik yapar ve
// `WHERE discovery_status = _from` koşulu sayesinde iki eşzamanlı QStash
// teslimatından yalnız biri durumu ilerletebilir.
//
// BAĞIMLILIK YOK: Bu dosya saf veri erişimidir; pipeline mantığına, AI'a
// veya QStash'e dokunmaz. Böylece test edilebilir ve diğer modüller
// tarafından güvenle içe aktarılabilir.
// ============================================================================

import { JOB_TABLE, jobStore } from "./discovery-jobs.server";
import {
  canTransition,
  type Consensus,
  type FilterStats,
  type ProductDiscoveryInput,
  type ProductDiscoveryStatus,
} from "./product-discovery.types";

/** DB'den okunan kalıcı iş kaydının yalnız bu hatta ait alanları. */
export type DiscoveryJobRecord = {
  id: string;
  userId: string;
  /** 'processing' | 'completed' | 'failed' — mevcut istemci sözleşmesi. */
  status: string;
  /** Yeni 7'li durum makinesi. */
  discoveryStatus: ProductDiscoveryStatus;
  discoveryProgress: number;
  discoveryStep: string;
  chargedCredits: number;
  stats: FilterStats | null;
  error: string | null;
};

/** `searches` satırındaki ham kolonları bu kayda indirger. */
function toRecord(row: Record<string, unknown>): DiscoveryJobRecord {
  return {
    id: String(row["id"] ?? ""),
    userId: String(row["user_id"] ?? ""),
    status: String(row["status"] ?? "processing"),
    discoveryStatus: String(row["discovery_status"] ?? "queued") as ProductDiscoveryStatus,
    discoveryProgress: Number(row["discovery_progress"] ?? 0),
    discoveryStep: String(row["discovery_step"] ?? ""),
    chargedCredits: Number(row["charged_credits"] ?? 0),
    stats: (row["discovery_stats"] as FilterStats | null) ?? null,
    error: (row["error"] as string | null) ?? null,
  };
}

/* ------------------------------------------------------------------ Oluştur */

/**
 * Başlatma anında iş kaydını açar.
 *
 * KREDİ SIRA NUMARASI ÖNEMLİ: `chargeOnce` krediyi ÖNCE düşer, kayıt SONRA
 * açılır. Kayıt açılamazsa çağıran `refundFeatureCredits` ile jetonu geri
 * verir; kuyruğa alma başarısız olursa `failAndRefund` devreye girer. Yani
 * bu satır "para alındı ama hat yok" durumunu ÜRETMEZ, yalnızca kaydı açar.
 *
 * `credit_charged = true` ZORUNLUDUR: `mark_discovery_credit_refunded`
 * RPC'si `WHERE credit_charged = true AND credit_refunded = false` ile
 * çalışır. Bu bayrak yazılmazsa RPC `false` döner, `failAndRefund` iade
 * yapmadan döner ve kullanıcı hatalı bir iş için kredisini kaybeder.
 *
 * `id` = `runId`: QStash dedupe anahtarı, job kimliği ve istemcinin
 * gördüğü kimlik aynı değerdir; ayrı ikinci bir kimlik üretmek hat boyunca
 * iki farklı "hangi iş?" sorusuna yol açardı.
 */
export async function createDiscoveryJob(args: {
  runId: string;
  userId: string;
  input: ProductDiscoveryInput;
  chargedCredits: number;
}): Promise<DiscoveryJobRecord> {
  const { error } = await jobStore()
    .from(JOB_TABLE)
    .insert({
      id: args.runId,
      user_id: args.userId,
      query: args.input.niche,
      // Arama girdisi params içinde korunur: adım URL'leri yeniden kurulurken
      // (origin kaybolursa) hat kendi girdisini yeniden üretmez.
      params: args.input,
      status: "processing",
      discovery_status: "queued",
      discovery_progress: 5,
      discovery_step: "scrape_filter",
      charged_credits: args.chargedCredits,
      // `chargeOnce` bu iş için krediyi gerçekten düştü; bayrak yalnızca
      // "alındı" bilgisini satırda tutar ve tek seferlik iadeyi mümkün kılar.
      credit_charged: true,
    } as never);
  if (error) throw new Error(error.message);
  return {
    id: args.runId,
    userId: args.userId,
    status: "processing",
    discoveryStatus: "queued",
    discoveryProgress: 5,
    discoveryStep: "scrape_filter",
    chargedCredits: args.chargedCredits,
    stats: null,
    error: null,
  };
}

/* ---------------------------------------------------------------- Okuma */

/** Kalıcı kaydı okur. Bulunamazsa `null` döner (hata FIRLATMaz). */
export async function readDiscoveryJob(runId: string): Promise<DiscoveryJobRecord | null> {
  const { data, error } = await jobStore()
    .from(JOB_TABLE)
    .select(
      "id,user_id,status,discovery_status,discovery_progress,discovery_step,charged_credits,discovery_stats,error",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  return toRecord(data as Record<string, unknown>);
}

/* ------------------------------------------------------------ Durum geçişi */

/**
 * Durumu ilerletir ve geçişin meşru olduğunu KALICI OLARAK doğrular.
 *
 * İki katmanlı denetim:
 *   1. Uygulama katmanı `canTransition` — hızlı, geçersiz adımı hiç
 *      veritabanına göndermez.
 *   2. RPC `WHERE discovery_status = _from` — eşzamanlı ikinci bir teslimat
 *      aynı geçişi yapamaz; çağıran `false` görür ve adımı atlar.
 *
 * Terminal duruma (`completed`/`failed`) geçiş BURADA yapılmaz; o
 * `finishDiscoveryJob`'ın işidir (sonuç gövdesiyle birlikte yazılır).
 */
export async function advanceDiscoveryStatus(args: {
  runId: string;
  from: ProductDiscoveryStatus;
  to: ProductDiscoveryStatus;
  progress?: number;
  step?: string;
  stats?: FilterStats;
}): Promise<boolean> {
  if (!canTransition(args.from, args.to)) {
    console.warn(`[discovery] geçersiz geçiş reddedildi: ${args.from} → ${args.to}`);
    return false;
  }
  const patch: Record<string, unknown> = {
    discovery_status: args.to,
    discovery_step: args.step ?? args.to,
  };
  if (typeof args.progress === "number") patch["discovery_progress"] = args.progress;
  if (args.stats) patch["discovery_stats"] = args.stats;

  const { data, error } = await jobStore().rpc("advance_discovery_status", {
    _job_id: args.runId,
    _from: args.from,
    _to: args.to,
    _progress: args.progress ?? null,
  });
  if (error) throw new Error(error.message);

  // RPC yalnız durum/yüzdeyi yazar; adım adı ve istatistikler aynı hata
  // toleransıyla burada eklenir. `false` döndüyse bu satır zaten başka bir
  // teslimat tarafından güncellenmiştir → üzerine yazmak yanlış olur.
  if (data === true) {
    const { error: patchError } = await jobStore()
      .from(JOB_TABLE)
      .update(patch as never)
      .eq("id", args.runId);
    if (patchError) throw new Error(patchError.message);
  }
  return data === true;
}

/* -------------------------------------------------------------- Tamamlama */

/** Sonuç gövdesi. Saklanır ve `status`/`discovery_status` terminale gider. */
export type DiscoveryFinalResult = {
  runId: string;
  input: ProductDiscoveryInput;
  products: unknown[];
  consensus: Consensus[];
  stats: FilterStats | null;
  stepStats: Record<string, string[]>;
  sources: { name: string; ok: boolean; items: number; ms: number; error: string }[];
};

/**
 * İşi nihai sonuçla kapatır.
 *
 * İDEMPOTENT: RPC `WHERE status = 'processing'` koşulu taşır, yani QStash
 * aynı adımı iki kez teslim ederse ikinci çağrı `false` döner ve sonuç
 * üzerine yazılmaz. Kullanıcı iki farklı sonuç görmez.
 */
export async function finishDiscoveryJob(
  runId: string,
  result: DiscoveryFinalResult,
): Promise<boolean> {
  const { data, error } = await jobStore().rpc("finish_discovery_job", {
    _job_id: runId,
    _result: result as never,
    _failed: false,
    _error: null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** İşi başarısız olarak kapatır (arayüz hata metnini gösterir). */
export async function failDiscoveryJob(runId: string, message: string): Promise<boolean> {
  const { data, error } = await jobStore().rpc("finish_discovery_job", {
    _job_id: runId,
    _result: null,
    _failed: true,
    _error: message.slice(0, 2000),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/* ----------------------------------------------------------------- Kredi */

/**
 * Kredinin bu iş için daha önce iade edilmediğini bildirir.
 *
 * Neden ayrı fonksiyon: iade kararı iki koşulun AND'idır — (a) bu iş için
 * kredi ALINMIŞ olmalı, (b) daha önce iade EDİLMEMİŞ olmalı. Bu bayrak
 * veritabanında tutulduğu için iki paralel `failed` adımı kullanıcıya
 * çift iade yapamaz. Çağıran yalnız `true` aldığında gerçekten iade eder.
 */
export async function claimCreditRefund(runId: string): Promise<boolean> {
  const { data, error } = await jobStore().rpc("mark_discovery_credit_refunded", {
    _job_id: runId,
  });
  if (error) return false; // RPC yoksa çağıran zaten iade etmemiş olur
  return data === true;
}

/* ------------------------------------------------------- Serbest bırakma */

/**
 * Adım çöktüğünde çağrılır: iş `failed` yapılır ve kredi TEK SEFER iade edilir.
 *
 * `refund` verilmezse (ör. kuyruk hatası) çağıran krediyi kendisi iade eder.
 * Buradaki `claimCreditRefund` yalnız "bu işin kredisi zaten iade edilmemiş
 * mi?" sorusunu yanıtlar; gerçek iade çağırmada yapılır.
 */
export async function failAndRefund(
  runId: string,
  message: string,
  refund: (amount: number) => Promise<void>,
): Promise<void> {
  const alreadyFailed = await failDiscoveryJob(runId, message);
  // Yalnız BU çağrı işi `failed` yaptıysa iade hakkı vardır. Zaten başka bir
  // teslimat kapatmışsa kredi durumu o teslimatın sorumluluğundadır.
  if (!alreadyFailed) return;
  const job = await readDiscoveryJob(runId);
  if (!job || job.chargedCredits <= 0) return;
  if (!(await claimCreditRefund(runId))) return;
  await refund(job.chargedCredits);
}
