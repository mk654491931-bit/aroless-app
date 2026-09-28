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
  ProductDiscoveryInputSchema,
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
  /**
   * Satırın son yazılma anı (ms) — `null` ise okunamadı.
   *
   * NEDEN GEREKLİ: yarıda öldürülen bir adımın (ör. istek platform tarafından
   * kesildi) durumu "çalışıyor" işaretinde kalır. Sürücünün bunu geri alıp
   * adımı yeniden koşabilmesi için yaşını bilmesi gerekir; taze bir satırı geri
   * almak, aktif olarak çalışan başka bir sürücünün işini ikiye katlardı.
   */
  updatedAt: number | null;
};

/**
 * Zincirin ara noktası (checkpoint).
 *
 * NEDEN GEREKLİ: hat 4 adımdan oluşur ve bir istek hepsine yetmeyebilir
 * (sunucusuz süre tavanı). Hangi adımların BİTTİĞİ bilgisi kaybolursa sürücü
 * yanlış adımı çalıştırır: ör. isteği kesilen `deep` adımından sonra `final`
 * elinde hiç aday yokken koşar ve kullanıcıya boş sonuç gösterirdi.
 *
 * NEREDE SAKLANIR: `searches.result` (migration'dan ÖNCE de var olan kolon).
 * Terminal durumda `finishDiscoveryJob` bu alanı nihai sonuçla EZER, yani ara
 * veri kullanıcıya hiçbir zaman sonuç olarak görünmez (istemci `result` alanını
 * yalnız `discovery_status = 'completed'` iken okur).
 */
export type DiscoveryCheckpoint = {
  v: 1;
  /** Tamamlanmış adımların adları (sırayla). */
  done: string[];
  /**
   * `gemini` adımının ürettiği kısa liste.
   *
   * DİKKAT — ALAN ADLARI BİLEREK `products`/`consensus` DEĞİL: aynı JSONB
   * kolonu (`searches.result`) terminal sonuç için de kullanılır ve istemci
   * doğrulayıcısı (`parseDiscoveryResult`) `products`/`consensus` anahtarlarını
   * arar. Ara nokta bu adları taşısaydı, terminal olmayan bir satır okunduğunda
   * "hazır" sanılan kısa liste kullanıcıya kazanan ürün olarak gösterilebilirdi.
   */
  shortlist: unknown[];
  /** `deep` adımının ürettiği oy satırları. */
  votes: unknown[];
};

/** Ara nokta gövdesini klasik kısmi sonuçlardan ayıran işaret. */
const CHECKPOINT_MARKER = "__product_discovery_checkpoint";

/**
 * `searches` tablosundaki keşif kolonları (migration sonrası).
 *
 * NEDEN AYRI: hat, `20260927000000_product_discovery_pipeline.sql`
 * uygulanmadan da ÇALIŞMAYA DEVAM ETMELİDİR. Migration yoksa bu kolonlar ve
 * üç RPC yoktur; eski kod bu durumda istisna fırlatıyordu, hattın TAMAMI
 * düşüyordu ve kullanıcı sessizce klasik yola iniyordu — canlıda görülen
 * "14 ajan çalışmıyor" belirtisinin en olası nedeni budur. Artık eksik
 * kolon/RPC yalnızca ilgili yeteneği kapatır (ör. atomiklik), akışı düşürmez.
 */
const FULL_COLUMNS =
  "id,user_id,status,discovery_status,discovery_progress,discovery_step,charged_credits,discovery_stats,error,updated_at";
/** Migration öncesi şemada var olan kolonlar (klasik hat bunları kullanır). */
const LEGACY_COLUMNS = "id,user_id,status,charged_credits,error,updated_at";

/** Kolon eksikliği mi? (undefined_column / PostgREST şema önbelleği hatası) */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return Boolean(
    error.code === "42703" ||
      error.code === "PGRST204" ||
      /column .* does not exist|could not find the .* column|schema cache/i.test(
        error.message ?? "",
      ),
  );
}

/** Fonksiyon (RPC) eksikliği mi? */
function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return Boolean(
    error.code === "42883" ||
      error.code === "PGRST202" ||
      /could not find the function|function .* does not exist|undefined function|schema cache/i.test(
        error.message ?? "",
      ),
  );
}

/**
 * Keşif durumunu okur; kolon yoksa klasik `status`ten TÜRETİR.
 *
 * Böylece migration uygulanmamış bir veritabanında bile istemci doğru
 * "completed"/"failed" sinyalini alır ve sonucu gösterir.
 */
function normaliseStatus(stored: unknown, legacyStatus: string): ProductDiscoveryStatus {
  const value = typeof stored === "string" ? stored.trim() : "";
  if (value) return value as ProductDiscoveryStatus;
  if (legacyStatus === "completed") return "completed";
  if (legacyStatus === "failed") return "failed";
  return "queued";
}

/** `searches` satırındaki ham kolonları bu kayda indirger. */
function toRecord(row: Record<string, unknown>): DiscoveryJobRecord {
  const status = String(row["status"] ?? "processing");
  return {
    id: String(row["id"] ?? ""),
    userId: String(row["user_id"] ?? ""),
    status,
    discoveryStatus: normaliseStatus(row["discovery_status"], status),
    discoveryProgress: Number(row["discovery_progress"] ?? 0),
    discoveryStep: String(row["discovery_step"] ?? ""),
    chargedCredits: Number(row["charged_credits"] ?? 0),
    stats: (row["discovery_stats"] as FilterStats | null) ?? null,
    error: (row["error"] as string | null) ?? null,
    updatedAt: parseTimestamp(row["updated_at"]),
  };
}

/** ISO/timestamptz → ms; okunamazsa `null` (çağıran "bilinmiyor" davranır). */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Zincirin ara noktasını okur. Yoksa/başka bir şemaysa `null`. */
export async function readDiscoveryCheckpoint(runId: string): Promise<DiscoveryCheckpoint | null> {
  const raw = await readDiscoveryResult(runId);
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record[CHECKPOINT_MARKER] !== true) return null;
  return {
    v: 1,
    done: Array.isArray(record["done"]) ? (record["done"] as string[]) : [],
    shortlist: Array.isArray(record["shortlist"]) ? record["shortlist"] : [],
    votes: Array.isArray(record["votes"]) ? record["votes"] : [],
  };
}

/**
 * Zincirin ara noktasını yazar. HATA FIRLATIR (bilerek).
 *
 * İlerleme yazımından farkı: kontrol noktası yazılamazsa sonraki yoklama
 * yanlış adımı çalıştırır. Sessizce yutmak, kullanıcıya "boş ama başarılı"
 * sonuç göstermek demektir; hata fırlatmak ise işi dürüstçe durdurur.
 */
export async function saveDiscoveryCheckpoint(
  runId: string,
  checkpoint: DiscoveryCheckpoint,
): Promise<void> {
  const { error } = await jobStore()
    .from(JOB_TABLE)
    .update({ result: { [CHECKPOINT_MARKER]: true, ...checkpoint } } as never)
    .eq("id", runId)
    .eq("status", "processing");
  if (error) throw new Error(error.message);
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
  const store = jobStore();
  // Arama girdisi params içinde korunur: adım URL'leri yeniden kurulurken
  // (origin kaybolursa) hat kendi girdisini yeniden üretmez.
  const legacyRow: Record<string, unknown> = {
    id: args.runId,
    user_id: args.userId,
    query: args.input.niche,
    params: args.input,
    status: "processing",
  };
  const { error } = await store
    .from(JOB_TABLE)
    .insert({
      ...legacyRow,
      discovery_status: "queued",
      discovery_progress: 5,
      discovery_step: "scrape_filter",
      charged_credits: args.chargedCredits,
      // `chargeOnce` bu iş için krediyi gerçekten düştü; bayrak yalnızca
      // "alındı" bilgisini satırda tutar ve tek seferlik iadeyi mümkün kılar.
      credit_charged: true,
    } as never);

  if (error) {
    // Migration uygulanmamış olabilir (keşif kolonları yok). Hat bu yüzden
    // DÜŞMEZ: kayıt klasik kolonlarla açılır ve akış devam eder. Aksi hâlde tek
    // bir eksik kolon, kullanıcının parasını ödediği aramayı tamamen öldürürdü.
    if (!isMissingColumn(error) && !isMissingRpc(error)) throw new Error(error.message);
    const { error: fallbackError } = await store.from(JOB_TABLE).insert(legacyRow as never);
    if (fallbackError) throw new Error(fallbackError.message);
  }

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
    updatedAt: Date.now(),
  };
}

/* ---------------------------------------------------------------- Okuma */

/** Kalıcı kaydı okur. Bulunamazsa `null` döner (hata FIRLATMaz). */
export async function readDiscoveryJob(runId: string): Promise<DiscoveryJobRecord | null> {
  const store = jobStore();
  const full = await store.from(JOB_TABLE).select(FULL_COLUMNS).eq("id", runId).maybeSingle();
  if (!full.error && full.data) return toRecord(full.data as Record<string, unknown>);
  // Migration uygulanmamış (keşif kolonları yok) → klasik kolonlarla oku ve
  // durumu `status`ten türet. `null` dönmek "iş yok" demek olurdu; oysa iş
  // VAR, yalnızca yeni kolonlar yok.
  if (full.error && !isMissingColumn(full.error)) return null;
  const legacy = await store.from(JOB_TABLE).select(LEGACY_COLUMNS).eq("id", runId).maybeSingle();
  if (legacy.error || !legacy.data) return null;
  return toRecord(legacy.data as Record<string, unknown>);
}

/**
 * Nihai sonucu (`result` sütunu) okur — YALNIZ terminal durumda.
 *
 * Neden ayrı okuma: `result` sütunu büyüktür (kazanan ürünler + uzlaşma +
 * kaynak raporu). Her yoklama turunda taşımak hem gereksiz bant hem gereksiz
 * bellek demek. Bu yüzden akış ucu önce durumu okur, iş bitince SADECE
 * sonucu çeker.
 */
/**
 * Koşunun GİRDİSİNİ (`searches.params`) okur ve doğrular.
 *
 * NEDEN DB'DEN: hat, girdisini (`niche`, `country`, `platform`, `topN`)
 * adımlar arasında taşımak zorundadır. Bunu istek gövdesinde taşımak, her
 * yoklamada istemciye güvenmek anlamına gelirdi; oysa `/start` girdiyi bir kez
 * kaydeder ve zincirin TAMAMI kendi deposundan okur.
 *
 * Bozuk/eski satırlarda `null` döner — çağıran "girdiyi bilmiyorum" diyip işi
 * dürüstçe durdurur (yanlış varsayılanlarla koşturmaz).
 */
export async function readDiscoveryInput(
  runId: string,
): Promise<ProductDiscoveryInput | null> {
  const { data, error } = await jobStore()
    .from(JOB_TABLE)
    .select("params")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = ProductDiscoveryInputSchema.safeParse(
    (data as { params?: unknown }).params ?? null,
  );
  return parsed.success ? parsed.data : null;
}

export async function readDiscoveryResult(runId: string): Promise<unknown | null> {
  const { data, error } = await jobStore()
    .from(JOB_TABLE)
    .select("result")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { result?: unknown }).result ?? null;
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

  if (error) {
    // Migration uygulanmamış: RPC yok. Adımı DÜŞÜRMEYİZ — atomiklik garantisini
    // kaybederiz ama hat çalışmaya devam eder (aksi hâlde tek eksik fonksiyon
    // tüm özelliği öldürüyordu). Düz güncellemeyi dener, kolon da yoksa yalnız
    // ilerleme bilgisini atlar.
    if (!isMissingRpc(error)) throw new Error(error.message);
    const { error: patchError } = await jobStore()
      .from(JOB_TABLE)
      .update(patch as never)
      .eq("id", args.runId);
    if (patchError && !isMissingColumn(patchError) && !isMissingRpc(patchError))
      throw new Error(patchError.message);
    return true;
  }

  // RPC yalnız durum/yüzdeyi yazar; adım adı ve istatistikler aynı hata
  // toleransıyla burada eklenir. `false` döndüyse bu satır zaten başka bir
  // teslimat tarafından güncellenmiştir → üzerine yazmak yanlış olur.
  if (data === true) {
    const { error: patchError } = await jobStore()
      .from(JOB_TABLE)
      .update(patch as never)
      .eq("id", args.runId);
    if (patchError && !isMissingColumn(patchError) && !isMissingRpc(patchError))
      throw new Error(patchError.message);
  }
  return data === true;
}

/**
 * İLERLEME YAZIMI (en iyi çaba, ASLA fırlatmaz).
 *
 * İstek içinde (inline) koşan hat adım adım ilerleme yazmalıdır ki kullanıcı
 * "hangi aşamadayız" sorusunu canlı görebilsin. Ancak ilerleme bilgisi HİÇBİR
 * ZAMAN işin kendisinden önemli değildir: yazılamazsa (migration yok, ağ
 * hatası) hat devam eder. `advanceDiscoveryStatus`'tan farkı budur — o, durum
 * makinesinin sözleşmesidir; bu, yalnız kullanıcı deneyimidir.
 */
export async function writeDiscoveryProgress(
  runId: string,
  patch: { status?: ProductDiscoveryStatus; progress?: number; step?: string; stats?: FilterStats },
): Promise<void> {
  try {
    const row: Record<string, unknown> = {};
    if (patch.status) row["discovery_status"] = patch.status;
    if (typeof patch.progress === "number") row["discovery_progress"] = patch.progress;
    if (patch.step) row["discovery_step"] = patch.step;
    if (patch.stats) row["discovery_stats"] = patch.stats;
    if (Object.keys(row).length === 0) return;
    await jobStore()
      .from(JOB_TABLE)
      .update(row as never)
      .eq("id", runId);
  } catch {
    /* ilerleme yazılamadı — hattın işini etkilemez */
  }
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
  const store = jobStore();
  const { data, error } = await store.rpc("finish_discovery_job", {
    _job_id: runId,
    _result: result as never,
    _failed: false,
    _error: null,
  });
  if (!error) return data === true;
  // Migration yoksa düz güncellemeye düş. `status = 'processing'` filtresi
  // idempotency sağlar: iki teslimat çift sonuç üretemez (düz `result` kolonu
  // migration'dan ÖNCE de vardır — klasik hat onu kullanıyordu).
  if (!isMissingRpc(error)) throw new Error(error.message);
  const { data: rows, error: updateError } = await store
    .from(JOB_TABLE)
    .update({ status: "completed", result, error: null } as never)
    .eq("id", runId)
    .eq("status", "processing")
    .select("id");
  if (updateError) throw new Error(updateError.message);
  return (rows?.length ?? 0) > 0;
}

/** İşi başarısız olarak kapatır (arayüz hata metnini gösterir). */
export async function failDiscoveryJob(runId: string, message: string): Promise<boolean> {
  const store = jobStore();
  const { data, error } = await store.rpc("finish_discovery_job", {
    _job_id: runId,
    _result: null,
    _failed: true,
    _error: message.slice(0, 2000),
  });
  if (!error) return data === true;
  if (!isMissingRpc(error)) throw new Error(error.message);
  const { data: rows, error: updateError } = await store
    .from(JOB_TABLE)
    .update({ status: "failed", error: message.slice(0, 2000) } as never)
    .eq("id", runId)
    .eq("status", "processing")
    .select("id");
  if (updateError) throw new Error(updateError.message);
  return (rows?.length ?? 0) > 0;
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
  if (!error) return data === true;
  // Migration yoksa çift iade kilidi veritabanında kurulamaz. Bu durumda
  // iadeyi ENGELLEMEK (kullanıcı hata için öder) yerine izin veriyoruz: bu
  // yolun çift iade üretme riski, kullanıcının çalışmayan bir iş için
  // kredisini kaybetmesinden daha küçüktür.
  return true;
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
