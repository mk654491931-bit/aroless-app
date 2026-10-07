/**
 * Affiliate / recurring-commission domain rules (pure logic, no I/O).
 *
 * Aroless' micro-influencer program: users who are EXPLICITLY verified by an
 * admin earn a recurring commission (default 30%) on every successful Paddle
 * subscription payment made by users they referred (profiles.referred_by).
 *
 * Keeping these rules side-effect free lets them be unit-tested without a
 * database and shared by server functions + the SQL migration contract.
 */

/** Default recurring commission rate for verified affiliates (percent). */
export const DEFAULT_COMMISSION_RATE_PCT = 30;

/** Minimum gross payment (minor units) that earns a commission (anti-dust). */
export const MIN_COMMISSION_GROSS_CENTS = 100; // $1.00

/**
 * ÖDEME EŞİĞİ: bir affiliate'e manuel ödeme (Wise/IBAN) yapılabilmesi için
 * birikmiş (pending) komisyonun ulaşması gereken alt sınır (minor units).
 *
 * NEDEN VAR: her transfer (Wise komisyonu / banka havalesi masrafı) sabit bir
 * maliyet taşır. $75 altındaki bakiyeler için ödeme yapmak, masrafı kazançtan
 * büyük hâle getirir. Bakiye devreder; eşiğe ulaşınca ödenir.
 */
export const MIN_PAYOUT_CENTS = 7500; // $75.00

/** Ödeme yöntemi — nakit çıkışı manuel yapılır (Wise / IBAN / diğer). */
export type PayoutMethod = "wise" | "iban" | "other";

export const PAYOUT_METHODS: readonly PayoutMethod[] = ["wise", "iban", "other"];

export function isPayoutMethod(value: unknown): value is PayoutMethod {
  return value === "wise" || value === "iban" || value === "other";
}

/** Komisyon satırının ödeme durumu. */
export type CommissionStatus = "pending" | "paid" | "reversed";

export function isCommissionStatus(value: unknown): value is CommissionStatus {
  return value === "pending" || value === "paid" || value === "reversed";
}

/**
 * Bir affiliate'in bekleyen bakiyesi ödenebilir mi? Eşiğin altındaysa kalan
 * tutarı da döner (panel "$23 daha birikince ödenir" diyebilsin diye).
 */
export function payoutEligibility(pendingCents: number): {
  eligible: boolean;
  remainingCents: number;
} {
  const pending = Number.isFinite(pendingCents) ? Math.max(0, Math.floor(pendingCents)) : 0;
  return {
    eligible: pending >= MIN_PAYOUT_CENTS,
    remainingCents: Math.max(0, MIN_PAYOUT_CENTS - pending),
  };
}

export type AffiliateStatus = "pending" | "verified" | "revoked";

export const AFFILIATE_STATUSES: readonly AffiliateStatus[] = ["pending", "verified", "revoked"];

export function isAffiliateStatus(value: unknown): value is AffiliateStatus {
  return value === "pending" || value === "verified" || value === "revoked";
}

/** Clamp a commission rate into the legal [0, 100] band (keeps fractions). */
export function clampCommissionRate(ratePct: number): number {
  if (!Number.isFinite(ratePct)) return DEFAULT_COMMISSION_RATE_PCT;
  return Math.max(0, Math.min(100, ratePct));
}

/**
 * Commission amount in minor units for a gross payment.
 * Rounds to the nearest minor unit and never produces dust below 1 unit
 * (a 1-unit commission on a 0-cost line item is meaningless, so 0 stays 0).
 */
export function computeCommissionCents(
  grossCents: number,
  ratePct: number,
  minGrossCents: number = MIN_COMMISSION_GROSS_CENTS,
): number {
  if (!Number.isFinite(grossCents) || grossCents < minGrossCents) return 0;
  const rate = clampCommissionRate(ratePct);
  if (rate <= 0) return 0;
  // Round the final product (not the rate) to the nearest minor unit.
  return Math.max(1, Math.round((grossCents * rate) / 100));
}

/** Only "verified" affiliates earn commissions — pending/revoked never do. */
export function isEligibleAffiliate(status: unknown): boolean {
  return status === "verified";
}

/**
 * Sunucu tarafı kuralı (`createPromoCode` zod şeması: 3-32 karakter,
 * `^[A-Za-z0-9_-]+$`) ile birebir aynı. Admin kodu elle yazdığı için geçerlilik
 * istemcide de kontrol edilir; kural tek kaynak olarak burada tutulur.
 */
export const AFFILIATE_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Affiliate kodunun uygulama içi indirimi YOKTUR.
 *
 * NEDEN: indirimler tek kaynaktan (Paddle paneli) yönetilir. Kod, komisyonun
 * kime gideceğini belirler ve kullanımı sayar; checkout'a indirim kodu
 * gönderilmez. Bu sabit, koda yanlışlıkla indirim yazan yolları engeller.
 */
export const AFFILIATE_CODE_DISCOUNT_PCT = 0;

/**
 * Kodun geçerliliği — admin kodu ELLE yazar, sunucu aynı kuralı (`createPromoCode`
 * zod şeması) uygular. Boşluklar kırpılır; harf/rakam/`-`/`_` dışına izin verilmez.
 */
export function isValidAffiliateCode(code: string): boolean {
  return AFFILIATE_CODE_PATTERN.test(code.trim());
}

/**
 * Whether a payment event should produce a commission record.
 * Refunds / failed payments carry no gross amount, so they map to false and
 * the ledger simply never sees a negative commission.
 */
export function shouldEarnCommission(opts: {
  status: unknown;
  amountCents: number | null | undefined;
  eventType?: string;
}): boolean {
  if (!isEligibleAffiliate(opts.status)) return false;
  if (typeof opts.amountCents !== "number" || !Number.isFinite(opts.amountCents)) return false;
  if (opts.amountCents <= 0) return false;
  if (opts.eventType && opts.eventType !== "transaction.completed") return false;
  return true;
}
