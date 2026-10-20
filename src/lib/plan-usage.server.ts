/**
 * PAKET KULLANIMI — sunucu tarafı (kayıt + okuma).
 *
 * NEDEN BURADA: `credit_usage_log` tablosu (user_id, tool, credits, success,
 * created_at) zaten vardı ama ona HİÇBİR satır yazılmıyordu. Sonuç: kullanım
 * günlüğü boş, sol bardaki modül kullanımı hiç eksilmiyor, paket kotaları
 * (30/90/300 araç vb.) yalnız ekranda yazan bir sayıydı.
 *
 * Bu modül iki işi yapar:
 *   1. `recordAiUsage` — gerçekten jeton düşen her AI işini deftere yazar,
 *   2. `planUsageSnapshot` — bu ayın sayaçlarını paket limitleriyle birleştirir.
 *
 * FAIL-SOFT: defter yazılamazsa AI işi DÜŞMEZ (kullanıcı hizmet almaya devam
 * eder). Defter yalnız "ne kadar kullanıldı" sorusunu yanıtlar; cevapsız kalması
 * işi iptal etmek için sebep değildir. Limit kapısı bu yüzden sayacı
 * okuyamazsa ENGELLEMEZ (fail-open) — kota korumak için müşteriyi kapıda
 * bırakmak daha kötüdür.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { serviceReadDb, type ReadDb } from "./supabase-read.server";
import { ADMIN_QUOTA, adminTopUpAmount, tierLevel } from "./plans";
import {
  emptyUsageCounts,
  monthRange,
  planUsageRows,
  usageKindForFeature,
  type UsageCounts,
  type UsageRow,
} from "./plan-usage";

/** Tek ay için okunacak en fazla satır (kaba üst sınır; aşılırsa sayaç alt sınır olur). */
const MAX_ROWS = 5_000;

/**
 * Gün içi admin tabanının bu süreçte denendiği anahtarlar. DB'deki ref_key
 * zaten tekilleştirir; bu küme yalnız migration uygulanmamış kurulumlarda
 * (fallback `increment_profile_credits` koşulsuz artırır) tekrarlı eklemeyi
 * engeller. Süreç başına en fazla bir kez denenir.
 */
const adminFloorAttempts = new Set<string>();

/**
 * Admin bayrağının kısa ömürlü bellek önbelleği (60 sn).
 *
 * `planUsageSnapshot` her 30 sn'de çalışır; rol + e-posta fallback'i her
 * seferinde iki sorgu yapmasın. Rol değişikliği nadirdir ve 60 sn içinde
 * yansır; güvenlik kararı (admin uçları) bu önbelleği KULLANMAZ.
 */
const adminFlagCache = new Map<string, { value: boolean; at: number }>();
const ADMIN_FLAG_TTL_MS = 60_000;

export type UsageSnapshot = {
  tier: string;
  level: 0 | 1 | 2 | 3;
  isAdmin: boolean;
  /** "2026-10" */
  period: string;
  /** Sayaçların başladığı an (ay başı, ISO). */
  since: string;
  rows: UsageRow[];
  /** Sayaç okunabildi mi? `false` ise satırlar 0 gösterir — "kullanılmadı" değil "bilinmiyor". */
  measured: boolean;
};

/**
 * Bir AI işini deftere yazar.
 *
 * KURAL: yalnız GERÇEKTEN jeton düşen işler yazılır (`credits > 0`). Önbellekten
 * dönen yanıt jeton harcamadığı için kullanım da artırmaz — arayüzde
 * "önbellekten geldi, jeton harcanmadı" sözü böylece doğru kalır.
 */
export async function recordAiUsage(
  opts: {
    userId: string;
    /** `tool:listing-seo` | `council` | `agent-pipeline` | `radar-scan` … */
    feature: string;
    credits: number;
    success?: boolean;
    model?: string | null;
    meta?: Record<string, unknown>;
  },
  /**
   * Kullanıcının JWT istemcisi. Servis anahtarı yokken kayıt bununla yazılır
   * (`log_ai_usage` RPC — yalnız pozitif, yalnız kendi satırı).
   */
  db?: ReadDb | null,
): Promise<void> {
  const credits = Math.max(0, Math.floor(Number(opts.credits) || 0));
  if (!opts.userId || credits === 0) return;
  const tool = String(opts.feature ?? "unknown").slice(0, 80);

  // 1) SERVİS ANAHTARI VARSA tam kayıt (meta/model dahil).
  const admin = serviceReadDb();
  if (admin) {
    try {
      const { error } = await admin.from("credit_usage_log").insert({
        user_id: opts.userId,
        tool,
        credits,
        success: opts.success ?? true,
        model: opts.model ? String(opts.model).slice(0, 80) : null,
        meta: { kind: usageKindForFeature(opts.feature), ...(opts.meta ?? {}) },
      } as never);
      if (!error) return;
      console.warn(`[usage] kayıt yazılamadı (${opts.feature}): ${error.message.slice(0, 80)}`);
    } catch (e) {
      console.warn(`[usage] kayıt hatası (${opts.feature}): ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // 2) SERVİS ANAHTARI YOK: kullanıcının kendi JWT'siyle güvenli yazma.
  //    RPC yalnız POZİTİF tüketim yazar (iade yolu service_role'de kalır).
  if (db) {
    try {
      const { error } = await db.rpc(
        "log_ai_usage" as never,
        { _tool: tool, _credits: credits } as never,
      );
      if (!error) return;
      console.warn(`[usage] RPC kaydı yazılamadı (${opts.feature}): ${error.message.slice(0, 80)}`);
    } catch (e) {
      console.warn(
        `[usage] RPC kayıt hatası (${opts.feature}): ${(e as Error).message.slice(0, 80)}`,
      );
    }
  }

  if (!admin && !db) {
    console.warn(`[usage] kayıt atlandı (${opts.feature}): okuma istemcisi yok`);
  }
}

/**
 * Bu ayın sayaçları. Hata durumunda `null` döner: "okunamadı" ile "hiç
 * kullanılmadı" AYNI ŞEY DEĞİLDİR ve limit kapısı ikisini ayırmak zorundadır.
 */
export async function monthUsage(
  userId: string,
  now: Date = new Date(),
  /**
   * Okuma istemcisi. Kullanıcı isteğinden geliyorsa O KULLANICININ JWT'si
   * verilir: `credit_usage_log` üzerinde "kendi satırlarını okur" politikası
   * vardır, servis anahtarı gerekmez. Verilmezse servis anahtarına düşülür.
   */
  db?: ReadDb | null,
): Promise<UsageCounts | null> {
  if (!userId) return null;
  const client = db ?? serviceReadDb();
  if (!client) {
    // Ne kullanıcı istemcisi ne servis anahtarı var → "okunamadı".
    console.warn("[usage] sayaç okunamadı: okuma istemcisi yok");
    return null;
  }
  const { startIso } = monthRange(now);
  try {
    const { data, error } = await client
      .from("credit_usage_log")
      .select("tool, credits")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .limit(MAX_ROWS);
    if (error) {
      console.warn(`[usage] sayaç okunamadı: ${error.message.slice(0, 80)}`);
      return null;
    }
    const counts = emptyUsageCounts();
    for (const row of (data ?? []) as { tool?: string | null; credits?: number | null }[]) {
      const kind = usageKindForFeature(String(row.tool ?? ""));
      // İŞARETLİ toplam: iade satırları NEGATİF yazılır ve aylık haktan
      // düşmelidir. Eskiden negatifler 0'a kırpılıyordu; bu yüzden başarısız
      // bir işin jetonu geri verilse bile "bu ay" sayacı dolu kalıyor ve
      // kullanıcı bakiyesi varken PLAN_LIMIT görüyordu.
      const credits = Number(row.credits ?? 0);
      counts[kind] += Number.isFinite(credits) ? Math.trunc(credits) : 0;
    }
    for (const key of Object.keys(counts) as (keyof UsageCounts)[]) {
      counts[key] = Math.max(0, counts[key]);
    }
    return counts;
  } catch (e) {
    console.warn(`[usage] sayaç hatası: ${(e as Error).message.slice(0, 80)}`);
    return null;
  }
}

/**
 * İADE EDİLEN kullanımı deftere NEGATİF satır olarak yazar.
 *
 * NEDEN: `recordAiUsage` tahsilat anında yazılır; iş çökerse jeton iade
 * edilir ama defterdeki satır kalırdı. Sonuç: kullanıcı bakiyesi olduğu hâlde
 * aylık hakkı "dolu" görüyordu. Negatif satır, iadenin sayaca da yansımasını
 * sağlar. Defter yazılamazsa iade yine geçerlidir (fail-soft).
 */
export async function recordUsageRefund(opts: {
  userId: string;
  feature: string;
  credits: number;
}): Promise<void> {
  const credits = Math.min(0, Math.trunc(Number(opts.credits) || 0));
  if (!opts.userId || credits === 0) return;
  try {
    const { error } = await supabaseAdmin.from("credit_usage_log").insert({
      user_id: opts.userId,
      tool: String(opts.feature ?? "unknown").slice(0, 80),
      credits,
      success: true,
      meta: { kind: usageKindForFeature(opts.feature), adjustment: "refund" },
    } as never);
    if (error) {
      console.warn(
        `[usage] iade satırı yazılamadı (${opts.feature}): ${error.message.slice(0, 80)}`,
      );
    }
  } catch (e) {
    console.warn(
      `[usage] iade satırı hatası (${opts.feature}): ${(e as Error).message.slice(0, 80)}`,
    );
  }
}

/**
 * Kullanıcı yönetici mi? Paket seviyesinden BAĞIMSIZ sorulur.
 *
 * Rol kaydı yoksa e-posta tabanlı designated admin tanımına düşer; böylece
 * eski bir admin hesabı "Free" görünüp 250 jetonunu kaybetmez.
 */
export async function isAdminUser(userId: string, db?: ReadDb | null): Promise<boolean> {
  const cached = adminFlagCache.get(userId);
  if (cached && Date.now() - cached.at < ADMIN_FLAG_TTL_MS) return cached.value;
  try {
    const { isAdminAccount } = await import("./admin-identity.server");
    const value = await isAdminAccount(userId, db);
    adminFlagCache.set(userId, { value, at: Date.now() });
    return value;
  } catch {
    return false;
  }
}

/**
 * Admin bakiyesini 250'ye getirir (günde bir kez).
 *
 * ÖLÇÜLEN HATA: admin kota tablosunda 250 görünüyordu ama `profiles.credits`
 * 0 olabiliyordu (hesap hoş geldin jetonu almadan açılmış, parmak izi
 * politikası sıfırlamış ya da gün içinde tükenmiş). Üstelik ücretli paketteki
 * admin için 250 hiç uygulanmıyordu. Sonuç: admin panelde 0 görüyor ve
 * tahsilat ön kontrolü (`total < amount`) onu `NO_CREDITS` ile reddediyordu —
 * oysa DB'deki günlük tazeleme tam da bu durumda 250 yazacaktı.
 *
 * SIRA:
 *   1. `refresh_admin_daily_credits()` — günün ilk çağrısıysa 250 yazar
 *      (ledger'da tekilleştirilmiş, tekrar çağrı bir şey yapmaz).
 *   2. Gün içinde bakiye 250'nin altına düştüyse (günlük tazeleme bugün zaten
 *      kullanılmışsa) GÜNDE BİR KEZ aradaki farkı tamamla. Ref anahtarı
 *      günü içerir; ikinci okuma aynı anahtarı kullandığı için jeton iki kez
 *      eklenmez, admin test harcamalarının bakiyeyi düşürdüğünü de görebilir.
 */
export async function ensureAdminBalance(
  userId: string,
  now: Date = new Date(),
  /**
   * Kullanıcının JWT istemcisi. Servis anahtarı yokken bakiye bu istemciyle
   * okunur ve günlük 250 `claim_admin_daily_credits()` ile talep edilir —
   * yani admin anahtar olmadan da 0'da kilitlenmez.
   */
  db?: ReadDb | null,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const client = db ?? serviceReadDb();
    if (!client) return false;
    if (!(await isAdminUser(userId, client))) return false;
    const admin = serviceReadDb();

    const readCredits = async (): Promise<number | null> => {
      const { data, error } = await client
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .maybeSingle();
      if (error) return null;
      const value = Number((data as { credits?: number | null } | null)?.credits ?? 0);
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    };

    let credits = await readCredits();
    if (credits === null || credits >= ADMIN_QUOTA.credits) return credits !== null;

    // 1) Günlük tazeleme (idempotent; gün içinde tekrar çalışmaz).
    // Servis anahtarı varsa tüm adminleri gezen sürüm; yoksa kullanıcının
    // kendi hesabı için güvenli talep (`auth.uid()` + günde bir kez).
    // RPC'ler henüz generated tiplerde yok; çağrı dar bir cast ile yapılır.
    const refresh = admin
      ? await admin.rpc("refresh_admin_daily_credits" as never)
      : await client.rpc("claim_admin_daily_credits" as never);
    if (!refresh.error) {
      const after = await readCredits();
      // Okunamadıysa tazelemenin uygulandığını varsay: ikinci kez eklemeyelim.
      if (after === null || after >= ADMIN_QUOTA.credits) return true;
      credits = after;
    }

    // 2) Gün içi taban: günde bir kez, aradaki farkı tek seferlik ekle.
    // İADE YOLU SERVİS ROLÜ İSTER (`refund_credit_once`); anahtar yoksa bu adım
    // atlanır — günlük talep zaten 250'yi yazmıştır.
    const amount = adminTopUpAmount(credits);
    if (amount <= 0) return true;
    // Servis anahtarı yoksa fark eklenemez (iade RPC'si service_role ister).
    if (!admin) return false;
    const day = now.toISOString().slice(0, 10);
    const floorKey = `admin-floor:${userId}:${day}`;
    if (adminFloorAttempts.has(floorKey)) return false;
    adminFloorAttempts.add(floorKey);
    const { refundCredit } = await import("./credit-guard.server");
    return await refundCredit(userId, amount, "admin_quota_floor", floorKey);
  } catch (e) {
    console.warn(`[usage] admin bakiye tazelemesi atlandı: ${(e as Error).message.slice(0, 80)}`);
    return false;
  }
}

/** Üst bar / sol bar / ayarlar: paket + bu ayın kullanımı tek yanıtta. */
export async function planUsageSnapshot(
  userId: string,
  now: Date = new Date(),
  /**
   * Kullanıcı isteğinden gelen JWT istemcisi. Verilirse paket adı, yönetici
   * bayrağı ve bu ayın sayaçları O istemciyle okunur — servis anahtarı yoksa
   * bile ekran kullanıcının ABONELİĞİNİ gösterir ("Free" / "bilinmiyor" değil).
   */
  db?: ReadDb | null,
): Promise<UsageSnapshot> {
  const { startIso, key } = monthRange(now);
  const client = db ?? serviceReadDb();
  let tier = "Free";
  try {
    if (client) {
      const { data } = await client
        .from("profiles")
        .select("subscription_tier")
        .eq("id", userId)
        .maybeSingle();
      tier = (data as { subscription_tier?: string | null } | null)?.subscription_tier ?? "Free";
    } else {
      console.warn("[usage] profil okunamadı: okuma istemcisi yok, Free varsayıldı");
    }
  } catch {
    // profil okunamazsa ücretsiz varsayılır; ekran yanlış limit gösterirse
    // kullanıcı paketini görmez — bu yüzden log bırakılır.
    console.warn("[usage] profil okunamadı, Free varsayıldı");
  }
  const level = tierLevel(tier);
  // ADMIN PAKETTEN BAĞIMSIZ: "admin = 250" kuralı, admin ücretli bir pakette
  // görünse bile geçerlidir. Eskiden yalnız `level === 0` iken soruluyordu ve
  // ücretli paketteki admin 50/90 gibi paket limitine düşüyordu.
  const admin = await isAdminUser(userId, client);
  const counts = await monthUsage(userId, now, client);
  return {
    tier,
    level,
    isAdmin: admin,
    period: key,
    since: startIso,
    measured: counts !== null,
    rows: planUsageRows(level, counts ?? emptyUsageCounts(), admin),
  };
}

/** Yönetici kotası — panelin "admin 250" satırı ile aynı kaynak. */
export const USAGE_ADMIN_QUOTA = ADMIN_QUOTA;
