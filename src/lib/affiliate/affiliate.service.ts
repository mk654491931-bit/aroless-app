/**
 * Affiliate veri erişim katmanı (sunucu tarafı).
 *
 * Paddle webhook çekirdeği ve server fonksiyonları bu katmanı kullanır; Supabase
 * istemcisi yapısal (structural) bir arayüz üzerinden enjekte edilir, böylece
 * birim testleri bellek içi bir sahte ile çalışabilir.
 *
 * Güvenlik ilkeleri:
 *  - Tüm sorgular sunucuda çalışır (service role). Tablolarda RLS yok-sa bile
 *    istemciye DOĞRUDAN tablo erişimi verilmez — yalnızca bu fonksiyonlar.
 *  - Oran/süre yalnızca affiliates tablosundan okunur, asla istekten alınmaz.
 *  - İlk dokunuş (first-touch) sabittir: customer_id unique olduğu için müşteri
 *    başka bir affiliate'e devredilemez.
 *  - Commission kayıtları silinmez; refund/chargeback → "reversed".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  AFFILIATE_CODE_PATTERN,
  canTransitionCommission,
  computeCommission,
  isPeriodEligible,
  normalizeCode,
  parseUtcDate,
  toIsoDate,
} from "./affiliate-core";

/* --------------------------------------------------------------------------
 * Minimal structural Supabase benzeri arayüz (test edilebilirlik için).
 * -------------------------------------------------------------------------- */

export type AffError = { message: string } | null;
export type AffResult<T = any> = PromiseLike<{ data: T | null; error: AffError }>;

export interface AffSelect {
  eq(column: string, value: string | number | null): AffSelect;
  neq(column: string, value: string | number): AffSelect;
  in(column: string, values: string[]): AffSelect;
  gte(column: string, value: string | number): AffSelect;
  lte(column: string, value: string | number): AffSelect;
  is(column: string, value: null): AffSelect;
  order(column: string, opts?: { ascending?: boolean }): AffSelect;
  limit(count: number): AffSelect;
  maybeSingle(): AffResult<any>;
  single(): AffResult<any>;
  // Supabase query zincirleri thenable'dır: `await zincir` → { data, error }
  then<R1 = { data: any; error: AffError }, R2 = never>(
    onfulfilled?: ((value: { data: any; error: AffError }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2>;
}

export interface AffUpdate {
  eq(column: string, value: string | number | null): PromiseLike<{ error: AffError }>;
  in(column: string, values: string[]): PromiseLike<{ error: AffError }>;
}

export interface AffDb {
  from(table: string): {
    select(columns: string): AffSelect;
    insert(values: Record<string, unknown> | Record<string, unknown>[]): PromiseLike<{
      error: AffError;
    }>;
    upsert(
      values: Record<string, unknown>,
      opts?: { onConflict?: string; ignoreDuplicates?: boolean },
    ): PromiseLike<{ error: AffError }>;
    update(values: Record<string, unknown>): AffUpdate;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: AffError }>;
}

/* --------------------------------------------------------------------------
 * Satır tipleri
 * -------------------------------------------------------------------------- */

export type AffiliateRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  referral_code: string;
  commission_rate_pct: number;
  commission_duration_months: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ReferralRow = {
  id: string;
  affiliate_id: string;
  customer_id: string;
  referral_code: string;
  source: string;
  visitor_id: string | null;
  status: string;
  plan: string | null;
  subscription_id: string | null;
  first_paid_at: string | null;
  commission_rate_pct: number | null;
  commission_duration_months: number | null;
  created_at: string;
  updated_at: string;
};

export type CommissionRow = {
  id: string;
  affiliate_id: string;
  customer_id: string;
  subscription_id: string;
  payment_id: string;
  plan: string;
  subscription_amount_cents: number;
  commission_rate_pct: number;
  commission_amount_cents: number;
  currency: string;
  period_start: string;
  period_end: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  reversed_at: string | null;
  reversed_reason: string | null;
};

/* --------------------------------------------------------------------------
 * Kod çözümleme
 * -------------------------------------------------------------------------- */

export type CodeLookupResult =
  | { ok: true; affiliate: AffiliateRow }
  | { ok: false; reason: "invalid_code" | "not_found" | "inactive" };

/** Aktif affiliate kodunu çözümler (backend'den doğrulanır — frontend değerine güvenilmez). */
export async function resolveAffiliateByCode(
  db: AffDb,
  rawCode: string,
): Promise<CodeLookupResult> {
  const code = normalizeCode(rawCode);
  if (!AFFILIATE_CODE_PATTERN.test(code)) return { ok: false, reason: "invalid_code" };
  const { data, error } = await db
    .from("affiliates")
    .select("*")
    .eq("referral_code", code)
    .maybeSingle();
  if (error) return { ok: false, reason: "not_found" };
  if (!data) return { ok: false, reason: "not_found" };
  if (data.status !== "active") return { ok: false, reason: "inactive" };
  return { ok: true, affiliate: data as AffiliateRow };
}

export async function resolveAffiliateByUserId(
  db: AffDb,
  userId: string,
): Promise<AffiliateRow | null> {
  const { data } = await db.from("affiliates").select("*").eq("user_id", userId).maybeSingle();
  return (data as AffiliateRow | null) ?? null;
}

export async function resolveAffiliateById(
  db: AffDb,
  affiliateId: string,
): Promise<AffiliateRow | null> {
  const { data } = await db.from("affiliates").select("*").eq("id", affiliateId).maybeSingle();
  return (data as AffiliateRow | null) ?? null;
}

export async function resolveReferralByCustomer(
  db: AffDb,
  customerId: string,
): Promise<ReferralRow | null> {
  const { data } = await db
    .from("affiliate_referrals")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  return (data as ReferralRow | null) ?? null;
}

/* --------------------------------------------------------------------------
 * Click takibi
 * -------------------------------------------------------------------------- */

/** Partner link tıklamasını kaydeder (aynı affiliate+visitor tekrarı tek click). */
export async function recordAffiliateClick(
  db: AffDb,
  input: {
    code: string;
    affiliateId: string;
    visitorKey: string;
    landingPath?: string;
  },
): Promise<{ ok: boolean; duplicate?: boolean }> {
  if (!input.visitorKey || input.visitorKey.length > 128) return { ok: false };
  const { error } = await db.from("affiliate_clicks").upsert(
    {
      affiliate_id: input.affiliateId,
      visitor_key: input.visitorKey.slice(0, 128),
      referral_code: input.code,
      landing_path: input.landingPath ? String(input.landingPath).slice(0, 512) : null,
    },
    { onConflict: "affiliate_id,visitor_key", ignoreDuplicates: true },
  );
  return { ok: !error };
}

/* --------------------------------------------------------------------------
 * Signup anında ilk dokunuş ilişkilendirmesi
 * -------------------------------------------------------------------------- */

export type AttributionResult =
  | { ok: true; affiliate: { id: string; code: string }; newlyAttributed: boolean }
  | { ok: false; reason: "invalid_code" | "not_found" | "inactive" | "already_attributed" };

/**
 * Kayıt/signup sonrası kodu backend'de çözer ve müşteriyi affiliate'e bağlar.
 * customer_id benzersiz olduğundan ilk bağlanan affiliate kazanır; daha sonra
 * başka bir kodla değiştirilmesi imkânsızdır (referral manipulation koruması).
 */
export async function attributeSignupToAffiliate(
  db: AffDb,
  input: { code: string; customerId: string; source?: string; visitorId?: string | null },
): Promise<AttributionResult> {
  const looked = await resolveAffiliateByCode(db, input.code);
  if (!looked.ok) return { ok: false, reason: looked.reason };

  const existing = await resolveReferralByCustomer(db, input.customerId);
  if (existing) return { ok: false, reason: "already_attributed" };

  const { error } = await db.from("affiliate_referrals").insert({
    affiliate_id: looked.affiliate.id,
    customer_id: input.customerId,
    referral_code: looked.affiliate.referral_code,
    source:
      input.source === "checkout" ? "checkout" : input.source === "manual" ? "manual" : "link",
    visitor_id: input.visitorId ? String(input.visitorId).slice(0, 128) : null,
    status: "referred",
  });
  if (error) return { ok: false, reason: "already_attributed" };
  return {
    ok: true,
    affiliate: { id: looked.affiliate.id, code: looked.affiliate.referral_code },
    newlyAttributed: true,
  };
}

/* --------------------------------------------------------------------------
 * Komisyon üretimi (başarılı ödeme webhook'u)
 * -------------------------------------------------------------------------- */

export type CommissionCreateInput = {
  customerId: string;
  /** Ödeme/belge kimliği (Paddle transaction id, invoice id…) — idempotency anahtarı. */
  paymentId: string;
  subscriptionId: string;
  plan: string;
  subscriptionAmountCents: number;
  currency?: string;
  /** Faturalanan dönem (ISO tarih ya da datetime). */
  periodStart: string | Date;
  periodEnd: string | Date;
  paidAt?: string | Date;
};

export type CommissionCreateResult =
  | { ok: true; commissionId?: string; duplicate?: boolean; skipped?: string }
  | { ok: false; reason: string };

/**
 * Her başarılı (recurring) abonelik ödemesi için komisyon üretir. Kurallar:
 *   - Müşteri bir affiliate'e atfedilmiş olmalı (backend attribution).
 *   - Affiliate aktif olmalı.
 *   - İptal edilmiş abonelik (canceled statüsü) için komisyon üretilmez.
 *   - 12 aylık (veya affiliate'e tanımlı süre) pencere aşılınca üretilmez.
 *   - Aynı payment_id iki kez işlenemez (row-level idempotency).
 *   - Oran/süre, müşterinin İLK ödemesinde affiliate'ten anlık görüntü (snapshot)
 *     olarak alınır; sonradan yapılan oran değişiklikleri eski müşterileri bozmaz.
 */
export async function createCommissionForPayment(
  db: AffDb,
  input: CommissionCreateInput,
): Promise<CommissionCreateResult> {
  const referral = await resolveReferralByCustomer(db, input.customerId);
  if (!referral) return { ok: false, reason: "no_attribution" };

  // İptal edilmiş abonelik tekrar ödeme üretemez — gelecekteki komisyonlar durur.
  if (referral.status === "canceled" && referral.subscription_id === input.subscriptionId) {
    return { ok: false, reason: "subscription_canceled" };
  }
  if (!["referred", "active", "canceled"].includes(referral.status)) {
    return { ok: false, reason: "invalid_referral_status" };
  }

  const affiliate = await resolveAffiliateById(db, referral.affiliate_id);
  if (!affiliate) return { ok: false, reason: "affiliate_missing" };
  if (affiliate.status !== "active") return { ok: false, reason: "affiliate_inactive" };

  // İlk ödeme: oran/süre sabitlenir (snapshot) + first_paid_at yazılır.
  const firstPaidAt =
    referral.first_paid_at ?? parseUtcDate(input.paidAt ?? input.periodStart).toISOString();
  const ratePct = Number(referral.commission_rate_pct ?? affiliate.commission_rate_pct);
  const durationMonths =
    Number(referral.commission_duration_months ?? affiliate.commission_duration_months) || 12;

  // Tüketilen dönem sayısı (reversed dışındaki kayıtlar süreyi tüketir).
  const { data: existingRows } = await db
    .from("commissions")
    .select("id,status")
    .eq("affiliate_id", referral.affiliate_id)
    .eq("customer_id", input.customerId)
    .in("status", ["pending", "paid"]);
  const consumedPeriods = Array.isArray(existingRows) ? existingRows.length : 0;

  const eligibility = isPeriodEligible({
    firstPaidAt,
    periodStart: input.periodStart,
    durationMonths,
    existingCommissionCount: consumedPeriods,
  });
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  // Dönem benzersizliği (affiliate_id, customer_id, period_start) + payment_id
  // unique constraint'leri ikinci bir koruma katmanıdır. Webhook idempotency
  // için önce payment_id kontrol edilir.
  const existingPayment = await db
    .from("commissions")
    .select("id")
    .eq("payment_id", input.paymentId)
    .maybeSingle();
  if (existingPayment.data) return { ok: true, duplicate: true, skipped: "payment_exists" };
  const existingPeriod = await db
    .from("commissions")
    .select("id")
    .eq("affiliate_id", referral.affiliate_id)
    .eq("customer_id", input.customerId)
    .eq("period_start", toIsoDate(parseUtcDate(input.periodStart)))
    .maybeSingle();
  if (existingPeriod.data) return { ok: true, duplicate: true, skipped: "period_exists" };

  const computed = computeCommission({
    subscriptionAmountCents: input.subscriptionAmountCents,
    ratePct,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    firstPaidAt,
    durationMonths,
    existingCommissionCount: consumedPeriods,
  });
  if (!computed.ok) return { ok: false, reason: computed.reason };

  const periodStartIso = toIsoDate(parseUtcDate(input.periodStart));
  const periodEndIso = toIsoDate(parseUtcDate(input.periodEnd));

  // Referral'ı ilk ödemeyle birlikte aktifleştir (snapshot yaz).
  const wasReferred = referral.status === "referred";
  const wasCanceledForDifferentSub =
    referral.status === "canceled" && referral.subscription_id !== input.subscriptionId;
  if (wasReferred || wasCanceledForDifferentSub) {
    const upd: Record<string, unknown> = {
      status: "active",
      plan: input.plan,
      subscription_id: input.subscriptionId,
      first_paid_at: firstPaidAt,
      commission_rate_pct: ratePct,
      commission_duration_months: durationMonths,
      updated_at: new Date().toISOString(),
    };
    await db.from("affiliate_referrals").update(upd).eq("id", referral.id);
  }

  const { error } = await db.from("commissions").upsert(
    {
      affiliate_id: referral.affiliate_id,
      customer_id: input.customerId,
      subscription_id: input.subscriptionId,
      payment_id: input.paymentId,
      plan: input.plan,
      subscription_amount_cents: Math.round(input.subscriptionAmountCents),
      commission_rate_pct: ratePct,
      commission_amount_cents: computed.commissionAmountCents,
      currency: input.currency ?? "USD",
      period_start: periodStartIso,
      period_end: periodEndIso,
      status: "pending",
      created_at: new Date().toISOString(),
    },
    { onConflict: "payment_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, reason: `insert_failed` };

  return { ok: true, duplicate: false };
}

/* --------------------------------------------------------------------------
 * Refund / chargeback → otomatik reversal
 * -------------------------------------------------------------------------- */

/**
 * Ödeme geri iadesinde (refund/chargeback) ilgili komisyonu otomatik olarak
 * "reversed" yapar. Kayıt asla silinmez; denetim için reversed_at/reason tutulur.
 */
export async function reverseCommissionsForPayment(
  db: AffDb,
  input: { paymentId?: string; subscriptionId?: string; reason?: string },
): Promise<{ reversed: number }> {
  const reason = input.reason ?? "refund";
  let reversed = 0;
  if (input.paymentId) {
    const { data } = await db
      .from("commissions")
      .select("id,status")
      .eq("payment_id", input.paymentId);
    for (const row of data ?? []) {
      if (canTransitionCommission(row.status as never, "reversed")) {
        const { error } = await db
          .from("commissions")
          .update({
            status: "reversed",
            reversed_at: new Date().toISOString(),
            reversed_reason: reason,
          })
          .eq("id", row.id);
        if (!error) reversed++;
      }
    }
  }
  if (input.subscriptionId) {
    const { data } = await db
      .from("commissions")
      .select("id,status")
      .eq("subscription_id", input.subscriptionId);
    for (const row of data ?? []) {
      if (canTransitionCommission(row.status as never, "reversed")) {
        const { error } = await db
          .from("commissions")
          .update({
            status: "reversed",
            reversed_at: new Date().toISOString(),
            reversed_reason: reason,
          })
          .eq("id", row.id);
        if (!error) reversed++;
      }
    }
  }
  return { reversed };
}

/* --------------------------------------------------------------------------
 * Abonelik iptali → gelecekteki komisyonları durdur
 * -------------------------------------------------------------------------- */

/** Müşteri aboneliğini iptal ettiğinde atıf "canceled" olur; yeni ödeme komisyon üretmez. */
export async function cancelReferralSubscription(
  db: AffDb,
  input: { customerId: string; subscriptionId: string },
): Promise<{ canceled: boolean }> {
  const referral = await resolveReferralByCustomer(db, input.customerId);
  if (!referral) return { canceled: false };
  if (referral.subscription_id && referral.subscription_id !== input.subscriptionId) {
    return { canceled: false };
  }
  const { error } = await db
    .from("affiliate_referrals")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", referral.id);
  return { canceled: !error };
}

/* --------------------------------------------------------------------------
 * Admin işlemleri (küçük yardımcılar)
 * -------------------------------------------------------------------------- */

/** Bekleyen komisyonları ödenmiş (paid) olarak işaretler. Yalnızca pending → paid geçişine izin verir. */
export async function payCommissions(
  db: AffDb,
  input: { ids: string[]; paidAt?: Date },
): Promise<{ paid: number }> {
  if (!input.ids.length) return { paid: 0 };
  const { data } = await db.from("commissions").select("id,status").in("id", input.ids);
  let paid = 0;
  for (const row of data ?? []) {
    if (canTransitionCommission(row.status as never, "paid")) {
      const { error } = await db
        .from("commissions")
        .update({
          status: "paid",
          paid_at: (input.paidAt ?? new Date()).toISOString(),
          reversed_at: null,
          reversed_reason: null,
        })
        .eq("id", row.id);
      if (!error) paid++;
    }
  }
  return { paid };
}

/* --------------------------------------------------------------------------
 * Kapsam sorguları (partner veri izolasyonu — IDOR/BOLA koruması)
 * -------------------------------------------------------------------------- */

/** Yalnızca belirtilen affiliate'e ait müşteri atıfları. */
export async function listReferralsForAffiliate(
  db: AffDb,
  affiliateId: string,
  opts: { limit?: number } = {},
): Promise<ReferralRow[]> {
  const { data } = await db
    .from("affiliate_referrals")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  return (data ?? []) as ReferralRow[];
}

/** Yalnızca belirtilen affiliate'e ait komisyonlar. */
export async function listCommissionsForAffiliate(
  db: AffDb,
  affiliateId: string,
  opts: { limit?: number } = {},
): Promise<CommissionRow[]> {
  const { data } = await db
    .from("commissions")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 1000);
  return (data ?? []) as CommissionRow[];
}

/** Yalnızca belirtilen affiliate'e ait tıklama sayısı (benzersiz ziyaretçi). */
export async function countClicksForAffiliate(db: AffDb, affiliateId: string): Promise<number> {
  const { data } = await db.from("affiliate_clicks").select("id").eq("affiliate_id", affiliateId);
  return Array.isArray(data) ? data.length : 0;
}

/** Admin rolü zorunluluğu — sunucu fonksiyonlarının ortak guard'ı. */
export async function ensureAffiliateAdmin(db: AffDb, userId: string): Promise<void> {
  const { data, error } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden: admin role required");
}

/** Admin el ile ters çevirme (yanlış kayıt vb.). */
export async function reverseCommissionsByIds(
  db: AffDb,
  input: { ids: string[]; reason: string },
): Promise<{ reversed: number }> {
  if (!input.ids.length) return { reversed: 0 };
  const { data } = await db.from("commissions").select("id,status").in("id", input.ids);
  let reversed = 0;
  const reason = String(input.reason || "admin_reversal").slice(0, 200);
  for (const row of data ?? []) {
    if (canTransitionCommission(row.status as never, "reversed")) {
      const { error } = await db
        .from("commissions")
        .update({
          status: "reversed",
          reversed_at: new Date().toISOString(),
          reversed_reason: reason,
        })
        .eq("id", row.id);
      if (!error) reversed++;
    }
  }
  return { reversed };
}
