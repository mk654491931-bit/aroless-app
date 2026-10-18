/**
 * AI JETON TAHSİLATI — sunucu tarafı tek kapı.
 *
 * NEDEN BÖYLE: Veritabanındaki jeton fonksiyonları (`deduct_credit`,
 * `deduct_product_finder_credit`) `SECURITY DEFINER` ve `auth.uid()` ile
 * çalışır; yani **kullanıcının kendi JWT'si** ile çağrılmalıdır. Servis anahtarı
 * ile çağrılsa `auth.uid()` null olur ve düşme hiç gerçekleşmez — sessizce
 * bedava kullanım demektir. Bu yüzden istekteki Bearer jetonu ile
 * kullanıcı-kapsamlı bir istemci kurulur.
 *
 * KURALLAR:
 *  1. Jeton YALNIZCA gerçek AI isteği yapılacaksa düşülür; önbellekten dönen
 *     yanıt bedavadır (kullanıcı arayüzde "kredi harcanmadı" görür).
 *  2. Tahsilat yapılamazsa AI ÇALIŞTIRILMAZ (fail-closed): kota bizim en pahalı
 *     kaynağımız, "veritabanı yavaştı" diye bedava açık bırakılamaz.
 *  3. İş tahsilattan sonra çökerse jeton İADE edilir (`refundCredit`).
 *  4. Düşme, uygulamanın geri kalanıyla AYNI havuz kuralını kullanır:
 *     `deduct_product_finder_credit` önce `finder_credits`'i, bitince `credits`'i
 *     harcar ve admin günlük kotasını (250) kendisi tazeler. Böylece
 *     `deduct_credit` ile ikinci bir kural icat edilmez.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { refundCredit } from "./credit-guard.server";
import { featureCreditCost, type AiCreditFeature } from "./credit-costs";
import { planLimitMessage, type UsageKind } from "./plan-usage";

export type ChargeOutcome =
  | { ok: true; charged: number; remaining: number | null; admin: boolean }
  | {
      ok: false;
      reason: "NO_CREDITS" | "UNAVAILABLE" | "PLAN_LIMIT";
      charged: number;
      /** PLAN_LIMIT için: hangi aylık hak ve kaç adet. */
      kind?: "credits" | "toolRuns" | "councilRuns" | "radarScans";
      limit?: number;
      tier?: string;
    };

/**
 * Tahsil edilen jetonu iade eder (iş çöktüğünde). Hata fırlatmaz.
 *
 * `refKey` verildiğinde iade TEK SEFER uygulanır: aynı iş için iki ayrı hata
 * yolu çalışsa (kayıt açılamadı + kuyruğa alınamadı) kredi iki kez artmaz.
 */
export async function refundFeatureCredits(
  userId: string,
  amount: number,
  reason = "ai_failed",
  refKey?: string | null,
): Promise<void> {
  if (amount > 0) await refundCredit(userId, amount, reason, refKey);
}

/** Kullanıcı-kapsamlı (RLS/JWT) istemci — `auth.uid()` bu jetonla dolar. */
function userClient(token: string) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Kullanıcının harcayabilir toplam jetonu (finder + genel) ve paketi.
 * RLS: yalnız kullanıcının kendi satırı okunur.
 */
async function profileSpend(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<{ total: number; tier: string } | null> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("credits, finder_credits, subscription_tier")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const finder = Number(data.finder_credits ?? 0);
    const general = Number(data.credits ?? 0);
    const total = (Number.isFinite(finder) ? finder : 0) + (Number.isFinite(general) ? general : 0);
    return {
      total: Math.max(0, Math.floor(total)),
      tier: String(
        (data as { subscription_tier?: string | null }).subscription_tier ?? "Free",
      ),
    };
  } catch {
    return null;
  }
}

/**
 * İşin jetonunu düşer.
 *
 * @param token Kullanıcının Supabase erişim jetonu (`deduct_*` bunu ister).
 * @param feature Fiyatı `credit-costs.ts`ten gelen iş kimliği.
 */
export async function chargeAiCredits(opts: {
  userId: string;
  token: string;
  feature: AiCreditFeature;
  /** Fiyatı ezmek için (örn. testte); verilmezse `featureCreditCost` kullanılır. */
  amount?: number;
}): Promise<ChargeOutcome> {
  const amount = Math.max(0, Math.floor(opts.amount ?? featureCreditCost(opts.feature)));
  if (amount === 0) return { ok: true, charged: 0, remaining: null, admin: false };
  if (!opts.token) return { ok: false, reason: "UNAVAILABLE", charged: 0 };

  let client: ReturnType<typeof userClient>;
  try {
    client = userClient(opts.token);
  } catch {
    return { ok: false, reason: "UNAVAILABLE", charged: 0 };
  }

  // Ön kontrol: bakiye yetmiyorsa HİÇ düşmeden reddet (kısmi düşme olmasın).
  // Bakiye okunamazsa kararı aşağıdaki gerçek düşme denemesi verir.
  const state = await profileSpend(client, opts.userId);
  if (state !== null && state.total < amount)
    return { ok: false, reason: "NO_CREDITS", charged: 0 };

  // ---- AYLIK PAKET LİMİTİ (ölçülen boşluk) ---------------------------------
  // `plans.ts` dört aylık hak tanımlıyor ama bunlar hiçbir zaman tüketilmiyordu.
  // Artık her jeton düşmesinden ÖNCE bu ayın sayacı paket limitiyle
  // karşılaştırılır: bakiye olsa bile aylık hak dolduysa iş başlatılmaz.
  //
  // FAIL-OPEN: sayaç okunamazsa (tablo yok/ağ hatası) ENGELLENMEZ — kotayı
  // korumak için müşteriyi kapıda bırakmak daha kötüdür.
  const { usageKindForFeature, limitFor } = await import("./plan-usage");
  const { monthUsage, isAdminUser } = await import("./plan-usage.server");
  const { tierLevel } = await import("./plans");
  const kind = usageKindForFeature(opts.feature);
  const tier = state?.tier ?? "Free";
  const level = tierLevel(tier);
  const adminUser = level === 0 ? await isAdminUser(opts.userId) : false;
  const limit = limitFor(level, kind, adminUser);
  // ÜCRETSİZ PLANDA ASIL SINIR BAKİYEDİR (2 hoş geldin kredisi tek seferlik).
  // Davet/referral ile kazanılan jetonlar aylık 2'lik kalıba sıkışmasın diye
  // ücretsiz planda limit EN AZ bakiye kadar açılır; aksi hâlde kullanıcı
  // kazandığı jetonu kullanamazdı — bu, "ödeme yaptım ama kullanamıyorum"
  // şikâyetinin ters yönlü hâli olurdu.
  const effectiveLimit =
    level === 0 && !adminUser ? Math.max(limit, state?.total ?? 0) : limit;
  const used = await monthUsage(opts.userId);
  if (used !== null && used[kind] >= effectiveLimit) {
    return {
      ok: false,
      reason: "PLAN_LIMIT",
      charged: 0,
      kind,
      limit: effectiveLimit,
      tier,
    };
  }

  let charged = 0;
  let remaining: number | null = null;
  for (let i = 0; i < amount; i++) {
    const { data, error } = await client.rpc("deduct_product_finder_credit");
    if (error) {
      const message = error.message ?? "";
      if (/no_credits/i.test(message)) {
        // Kısmi düşme olduysa iade et ve dürüstçe reddet.
        if (charged > 0) await refundCredit(opts.userId, charged, "partial_no_credits");
        return { ok: false, reason: "NO_CREDITS", charged: 0 };
      }
      console.error(`[credits] deduct failed (${opts.feature}):`, message);
      if (charged > 0) await refundCredit(opts.userId, charged, "deduct_error");
      return { ok: false, reason: "UNAVAILABLE", charged: 0 };
    }
    if (typeof data === "number") remaining = data;
    charged++;
  }

  // KULLANIM DEFTERİ — sol bardaki "bu ay" sayaçları buradan okunur.
  // Yazılamazsa iş DÜŞMEZ (fail-soft): defter yalnız ölçüm içindir.
  await recordAiUsage({
    userId: opts.userId,
    feature: opts.feature,
    credits: charged,
    success: true,
  });

  return { ok: true, charged, remaining, admin: false };
}

/** İşin kullanımını deftere yazar (dinamik import: istemci paketine sunucu kodu girmesin). */
async function recordAiUsage(args: {
  userId: string;
  feature: string;
  credits: number;
  success?: boolean;
}): Promise<void> {
  try {
    const usage = await import("./plan-usage.server");
    await usage.recordAiUsage(args);
  } catch (e) {
    console.warn(`[usage] kayıt atlandı: ${(e as Error).message.slice(0, 80)}`);
  }
}

/**
 * Panelin göstereceği talebe bağlı kısa hata yanıtı (402).
 * `code: NO_CREDITS` arayüzde "paket yükselt" çağrısını tetikler.
 */
export function noCreditsResponse(amount: number, feature: AiCreditFeature): Response {
  const body = {
    error: `Bu işlem ${amount} jeton gerektirir ve bakiyeniz yetersiz. Ayarlar → Abonelik bölümünden paketinizi yükseltebilirsiniz.`,
    code: "NO_CREDITS",
    required: amount,
    feature,
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * AYLIK PAKET LİMİTİ doldu (402).
 *
 * NO_CREDITS'ten AYRI kod: burada bakiye vardır, tükenen şey paketin aylık
 * hakkıdır. Ayrım önemli — arayüz "bakiye yükle" yerine "paketi yükselt"
 * demeli ve hangi hakkın dolduğunu yazmalıdır.
 */
export function planLimitResponse(kind: UsageKind, limit: number, tier: string | null): Response {
  const body = {
    error: planLimitMessage(kind, limit, tier),
    code: "PLAN_LIMIT",
    kind,
    limit,
    tier,
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Kredi kontrolü yapılamadı (altyapı) — işi başlatmadan dürüstçe söyler. */
export function creditUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "Jeton bakiyesi şu anda doğrulanamadı; istek başlatılmadı ve jeton düşülmedi. Lütfen tekrar deneyin.",
      code: "CREDIT_UNAVAILABLE",
      retryable: true,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}

/** Kolaylık: tahsilatı yapıp hazır yanıtı/log'u döner. */
export async function chargeOrRespond(opts: {
  userId: string;
  token: string;
  feature: AiCreditFeature;
  amount?: number;
}): Promise<
  { ok: true; outcome: Extract<ChargeOutcome, { ok: true }> } | { ok: false; response: Response }
> {
  const outcome = await chargeAiCredits(opts);
  if (outcome.ok) return { ok: true, outcome };
  if (outcome.reason === "PLAN_LIMIT") {
    return {
      ok: false,
      response: planLimitResponse(
        outcome.kind ?? "toolRuns",
        outcome.limit ?? 0,
        outcome.tier ?? null,
      ),
    };
  }
  if (outcome.reason === "NO_CREDITS") {
    return {
      ok: false,
      response: noCreditsResponse(
        Math.max(0, Math.floor(opts.amount ?? featureCreditCost(opts.feature))),
        opts.feature,
      ),
    };
  }
  return { ok: false, response: creditUnavailableResponse() };
}

/* ------------------------------------------------------------ IDEMPOTENCY */

/**
 * QSTASH RETRY'LARINA KARŞI İDEMPOTENT TAHSİLAT.
 *
 * ÖLÇÜLEN SORUN: `chargeAiCredits` `amount` kez `deduct_product_finder_credit`
 * RPC'si çağırıyor ve HİÇBİR KİMLİK taşımıyor. QStash bir adımı 3 kez
 * yeniden dener veya istemci ağ hatasıyla isteği tekrarlarsa, aynı iş için
 * kredi 3 KEZ düşerdi. Kullanıcıya 3 katı ödeme yaptırmak kabul edilemez.
 *
 * ÇÖZÜM: Aynı süreç içinde `chargeKey` ile bir kez tahsil edilmişse ikinci
 * çağrı `alreadyCharged` döner ve HİÇ DÜŞMEZ. QStash retry'ları aynı
 * fonksiyon örneğini (aynı Node sürecini) çalıştırdığı için bellek içi kayıt
 * yeterlidir; kalıcılık için `searches.run_id` üzerindeki `charged` bayrağı
 * ayrıca DB'de tutulur (aşağıda `chargeDiscoveryRun`).
 *
 * NOT: Bu katman mevcut `chargeAiCredits` DAVRANIŞINI DEĞİŞTİRMEZ; sadece
 * üstüne bir kez-çalışma kilidi koyar. `chargeKey` verilmezse davranış
 * bire bir eskisi gibidir (geriye uyumlu).
 */
const settled = new Set<string>();

export type IdempotentChargeOutcome =
  | { ok: true; charged: number; remaining: number | null; alreadyCharged: boolean }
  | {
      ok: false;
      reason: "NO_CREDITS" | "UNAVAILABLE" | "PLAN_LIMIT";
      charged: number;
      kind?: UsageKind;
      limit?: number;
      tier?: string;
    };

export async function chargeOnce(opts: {
  userId: string;
  token: string;
  feature: AiCreditFeature;
  amount?: number;
  /**
   * İdempotency anahtarı (ör. `discovery:<runId>`). AYNI anahtar ikinci kez
   * gelirse düşme YAPILMAZ, `alreadyCharged:true` döner.
   */
  chargeKey?: string;
}): Promise<IdempotentChargeOutcome> {
  const key = opts.chargeKey ? `${opts.userId}:${opts.feature}:${opts.chargeKey}` : null;
  if (key && settled.has(key)) {
    // Zaten bu süreçte tahsil edildi — QStash retry'ı.
    return { ok: true, charged: 0, remaining: null, alreadyCharged: true };
  }
  const outcome = await chargeAiCredits(opts);
  if (outcome.ok) {
    // Anahtarı SADECE başarılı tahsilatta işaretle: başarısız deneme
    // (bakiye yetersiz) yeniden denenebilir olmalıdır.
    if (key) settled.add(key);
    return { ...outcome, alreadyCharged: false };
  }
  return {
    ok: false,
    reason: outcome.reason,
    charged: outcome.charged,
    kind: outcome.kind,
    limit: outcome.limit,
    tier: outcome.tier,
  };
}

/** Test/serbest bırakma için bellek kilidini temizler. */
export function resetChargeKeys(): void {
  settled.clear();
}
