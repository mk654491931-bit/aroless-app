/**
 * Aroless Affiliate/Partner Program — saf (pure) domain çekirdeği.
 *
 * Bu modül hiçbir veritabanı/HTTP bağımlılığı taşımaz; komisyon matematiği,
 * süre/uygunluk kuralları ve durum geçişleri burada yaşar ve birim testleriyle
 * doğrulanır. Tüm para işlemleri KURUŞ (minor unit) tamsayısı üzerinden yapılır;
 * kayan nokta aritmetiği hiçbir noktada komisyon tutarına dokunmaz.
 */

export const DEFAULT_COMMISSION_RATE_PCT = 30;
export const DEFAULT_COMMISSION_DURATION_MONTHS = 12;
export const MAX_COMMISSION_DURATION_MONTHS = 24;
export const MIN_REFERRAL_CODE_LENGTH = 4;
export const MAX_REFERRAL_CODE_LENGTH = 16;

export type AffiliateStatus = "active" | "inactive";
export type ReferralStatus = "referred" | "active" | "canceled";
export type CommissionStatus = "pending" | "paid" | "reversed";

/** Kayan nokta hatası olmadan "kuruş" cinsinden yüzde hesabı: round(amount * pct / 100). */
export function commissionAmountCents(amountCents: number, ratePct: number): number {
  if (!Number.isFinite(amountCents) || amountCents < 0) return 0;
  if (!Number.isFinite(ratePct) || ratePct <= 0) return 0;
  const pct = Math.min(100, Math.max(0, ratePct));
  // Ondalıklı oranlar (örn. 27.5) desteklenir. Tüm ara hesap kuruş tabanında
  // tamsayıdır; sonuç en yakın kuruşa yuvarlanır (float hiç kullanılmaz).
  return Math.round((amountCents * pct) / 100);
}

/** "2026-01-15" gibi tarih-dizesini yerel saat kayması olmadan date olarak al. */
export function parseUtcDate(value: string | Date): Date {
  if (value instanceof Date)
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Ay ekleme (UTC, takvim ayı kayması olmadan). */
export function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/**
 * İki tarih arasındaki tam ay sayısı (periodStart >= firstPaid için negatif değil).
 * Ay 1 = ilk ödeme ayı. Örn. firstPaid 2026-01-15, periodStart 2026-04-01 → 3.
 */
export function monthsBetween(firstPaid: Date, periodStart: Date): number {
  const a = parseUtcDate(firstPaid);
  const b = parseUtcDate(periodStart);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export type PeriodEligibilityInput = {
  /** İlk başarılı ödemenin tarihi (referral.first_paid_at). */
  firstPaidAt: Date | string;
  /** Faturalanan dönemin başlangıcı. */
  periodStart: Date | string;
  /** Komisyon süresi ay cinsinden (referral anında sabitlenir). */
  durationMonths: number;
  /** Halihazırda bu müşteri için üretilmiş komisyon sayısı. */
  existingCommissionCount?: number;
};

export type PeriodEligibilityResult =
  | { ok: true; reason: "within_window" }
  | { ok: false; reason: "no_first_payment" }
  | { ok: false; reason: "window_exceeded"; months: number }
  | { ok: false; reason: "invalid_duration" };

/**
 * Recurring komisyon uygunluk kuralı:
 *   - firstPaid yoksa (henüz ödeme yok) → false.
 *   - periodStart, firstPaid'ten önce olamaz.
 *   - periodStart'in ilk ödemeye göre ay farkı durationMonths'u aşamaz
 *     (örn. 12 aylık süre → 0..11. ay aralığındaki dönemler komisyon üretir).
 */
export function isPeriodEligible(input: PeriodEligibilityInput): PeriodEligibilityResult {
  const duration = Math.trunc(input.durationMonths);
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_COMMISSION_DURATION_MONTHS) {
    return { ok: false, reason: "invalid_duration" };
  }
  if (!input.firstPaidAt) return { ok: false, reason: "no_first_payment" };
  const first = parseUtcDate(input.firstPaidAt);
  const start = parseUtcDate(input.periodStart);
  if (start.getTime() < first.getTime())
    return { ok: false, reason: "window_exceeded", months: -1 };
  const months = monthsBetween(first, start);
  if (months >= duration) return { ok: false, reason: "window_exceeded", months };
  // Çift koruma: dönem sayısı da süreyi aşamaz (ör. düzensiz faturalama).
  const count = input.existingCommissionCount ?? 0;
  if (count >= duration) return { ok: false, reason: "window_exceeded", months };
  return { ok: true, reason: "within_window" };
}

export type CreateCommissionInput = {
  subscriptionAmountCents: number;
  ratePct: number;
  periodStart: Date | string;
  periodEnd: Date | string;
  firstPaidAt?: Date | string | null;
  durationMonths?: number;
  existingCommissionCount?: number;
  /** Test kolaylığı için enjekte edilebilir; gerçekte kullanılmaz. */
  now?: Date;
};

export type CreateCommissionResult =
  | {
      ok: true;
      commissionAmountCents: number;
      ratePct: number;
    }
  | { ok: false; reason: string };

/** Tek bir ödeme için komisyon hesabı: tutar, oran ve uygunluk tek yerde doğrulanır. */
export function computeCommission(input: CreateCommissionInput): CreateCommissionResult {
  if (!Number.isFinite(input.subscriptionAmountCents) || input.subscriptionAmountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const rate = Number(input.ratePct);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return { ok: false, reason: "invalid_rate" };
  }
  const start = parseUtcDate(input.periodStart);
  const end = parseUtcDate(input.periodEnd);
  if (end.getTime() < start.getTime()) return { ok: false, reason: "invalid_period" };

  const duration = input.durationMonths ?? DEFAULT_COMMISSION_DURATION_MONTHS;
  // eslint-disable-next-line eqeqeq -- `!= null` intentionally covers null & undefined
  if (input.firstPaidAt != null) {
    const eligible = isPeriodEligible({
      firstPaidAt: input.firstPaidAt,
      periodStart: start,
      durationMonths: duration,
      existingCommissionCount: input.existingCommissionCount ?? 0,
    });
    if (!eligible.ok) return { ok: false, reason: eligible.reason };
  }
  return {
    ok: true,
    commissionAmountCents: commissionAmountCents(input.subscriptionAmountCents, rate),
    ratePct: rate,
  };
}

/** Karmaşık olmayan, benzersiz referans kodu üretir (admin oluştururken). */
export function generateReferralCode(existing: Set<string> = new Set(), length = 7): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O/1/I yok
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) code += alphabet[bytes[i]! % alphabet.length];
    if (!existing.has(code)) return code;
  }
  return `P${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

export function normalizeCode(code: string): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Komisyon durumu geçişleri — sessiz/sonuçsuz güncellemeleri engellemek için merkezde. */
export function canTransitionCommission(
  current: CommissionStatus,
  next: CommissionStatus,
): boolean {
  switch (next) {
    case "paid":
      return current === "pending"; // yalnızca bekleyen ödenebilir
    case "reversed":
      return current === "pending" || current === "paid"; // iade her ikisinden de döner
    default:
      return false; // pending'e geri dönüş / yeniden ödeme yok
  }
}

export const AFFILIATE_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/** Partner müşteri e-postasını gizleyerek göster (admin tabloları için, partner panele asla ham email gitmez). */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "gizli";
  const at = email.indexOf("@");
  if (at <= 1) return email;
  const local = email.slice(0, at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - 2)))}@${email.slice(at + 1)}`;
}
