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

export type ChargeOutcome =
  | { ok: true; charged: number; remaining: number | null; admin: boolean }
  | { ok: false; reason: "NO_CREDITS" | "UNAVAILABLE"; charged: number };

/** Tahsil edilen jetonu iade eder (iş çöktüğünde). Hata fırlatmaz. */
export async function refundFeatureCredits(
  userId: string,
  amount: number,
  reason = "ai_failed",
): Promise<void> {
  if (amount > 0) await refundCredit(userId, amount, reason);
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

/** Kullanıcının harcayabilir toplam jetonu (finder + genel) — RLS: kendi satırı. */
async function spendableCredits(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("credits, finder_credits")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const finder = Number(data.finder_credits ?? 0);
    const general = Number(data.credits ?? 0);
    const total = (Number.isFinite(finder) ? finder : 0) + (Number.isFinite(general) ? general : 0);
    return Math.max(0, Math.floor(total));
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
  const available = await spendableCredits(client, opts.userId);
  if (available !== null && available < amount) return { ok: false, reason: "NO_CREDITS", charged: 0 };

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
  return { ok: true, charged, remaining, admin: false };
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
}): Promise<{ ok: true; outcome: Extract<ChargeOutcome, { ok: true }> } | { ok: false; response: Response }> {
  const outcome = await chargeAiCredits(opts);
  if (outcome.ok) return { ok: true, outcome };
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
