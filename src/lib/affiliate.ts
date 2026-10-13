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
 * KOMİSYON PENCERESİ — bir müşteri için komisyon EN FAZLA kaç aylık ödeme
 * üzerinden yazılır.
 *
 * KURAL (ürün kararı): affiliate, getirdiği müşteri ÜCRETLİ KALDIĞI SÜRECE aylık
 * %30 komisyon kazanır — ama en fazla 12 ay. Müşteri 4. ayda bırakırsa komisyon
 * yalnız 4 ay için ödenmiş olur; 12 ay sonrasında yeni komisyon doğmaz.
 *
 * NEDEN SINIR: süresiz yinelenen komisyon, tek bir müşteri için sınırsız ve
 * öngörülemeyen bir yükümlülük yaratır. 12 ay, geri kazanım (CAC) mantığıyla
 * uyumludur ve affiliate'e önceden açıklanabilir bir taahhüttür.
 *
 * TEK KAYNAK: SQL tarafı AYNI sayıyı taşır — `affiliate_commission_cap`
 * migration'ı (`enforce_affiliate_commission_cap()` içinde `_max_months`).
 * İkisinin ayrışması `supabase-migrations.test.ts` ile engellenir; sayı
 * değişirse iki dosya BİRLİKTE güncellenir.
 */
export const COMMISSION_MAX_MONTHS = 12;

/**
 * Bir müşteri için komisyon penceresi hâlâ açık mı?
 *
 * `priorMonths` = o müşteri için DAHA ÖNCE yazılmış komisyon ayı sayısı.
 * Mahsup edilmiş (iade/chargeback) satırlar SAYILMAZ: o ay gelir üretmemiştir,
 * dolayısıyla affiliate'in 12 ayını tüketmemelidir.
 */
export function isWithinCommissionWindow(
  priorMonths: number,
  maxMonths: number = COMMISSION_MAX_MONTHS,
): boolean {
  return commissionMonthsRemaining(priorMonths, maxMonths) > 0;
}

/**
 * Komisyon penceresinde kalan ay sayısı (0 = pencere doldu, yeni komisyon yok).
 * Geçersiz/negatif girdiler güvenli tarafa yuvarlanır: eksik bilgi affiliate'e
 * ek ay kazandırmaz.
 */
export function commissionMonthsRemaining(
  priorMonths: number,
  maxMonths: number = COMMISSION_MAX_MONTHS,
): number {
  const written = Number.isFinite(priorMonths) ? Math.max(0, Math.floor(priorMonths)) : 0;
  const cap =
    Number.isFinite(maxMonths) && maxMonths > 0 ? Math.floor(maxMonths) : COMMISSION_MAX_MONTHS;
  return Math.max(0, cap - written);
}

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
 * PADDLE ÖDEME EKRANINA ÖN-DOLDURULACAK KOD (saf karar).
 *
 * NEDEN VAR: kullanıcı kayıt olurken (ya da `?promo=` linkiyle) bir kod
 * bağladıysa, ödeme ekranında aynı kodu yeniden yazması gerekmez — kod
 * checkout'a ön-doldurulur. Bu, "kodu kullanan kişi"nin indirimi gerçekten
 * görmesini sağlar; kod yalnız komisyon atfı için saklanıyor olsaydı müşteri
 * indirimi hiç görmezdi.
 *
 * TEK KAYNAK KURALI KORUNUR: uygulama indirimi KENDİ hesaplamaz. Yalnız
 * `promo_codes` tablosunda GERÇEKTEN indirim taşıyan (`discount_pct > 0`) ve
 * geçerli bir kodu Paddle'a "önerir"; indirimin ne olacağına Paddle karar verir.
 *
 * AFFILIATE KODU ASLA GÖNDERİLMEZ: affiliate kodları indirim taşımaz
 * (`AFFILIATE_CODE_DISCOUNT_PCT = 0`) ve Paddle tarafında indirim kaydı
 * olmayabilir. Böyle bir kodu ön-doldurmak, müşterinin ödeme ekranında
 * "geçersiz kod" hatası görmesine yol açardı — yani komisyon için verilen kod,
 * satın almayı engelleyen bir hataya dönüşürdü.
 */
export function paddlePrefillDiscountCode(opts: {
  /** Kullanıcının profilindeki kod (`profiles.promo_code`). */
  code?: string | null;
  /** Kodun uygulamada tanımlı indirimi (0 = indirim yok). */
  discountPct?: number | null;
}): string | null {
  const code = String(opts.code ?? "")
    .trim()
    .toUpperCase();
  if (!isValidAffiliateCode(code)) return null;
  const pct = opts.discountPct;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) return null;
  return code;
}

/**
 * KENDİ KENDİNİ REFERANS KORUMASI (saf karar).
 *
 * RİSK: bir affiliate, kendi affiliate koduyla İKİNCİ bir hesap açıp o
 * hesaptan abonelik alırsa, %30 komisyonu kendine ödemiş olur — yani
 * abonelik fiilen %30 indirimli hâle gelir ve program bütçesi boşa akar.
 *
 * ÖLÇÜLEBİLİR SİNYAL: kayıt anında cihaz parmak izi (`visitor_id`) zaten bir
 * hesapta kayıtlıdır. Yeni kaydın parmak izi affiliate'in KENDİ hesabına
 * çıkıyorsa bu bir self-referral'dır ve atıf yapılmaz.
 *
 * Neden yalnız parmak izi (IP değil): aynı ofis/ev NAT'ı arkasındaki masum
 * kullanıcılar aynı IP'yi paylaşır; IP ile engellemek gerçek referansları da
 * keserdi. Parmak izi aynı CİHAZI işaret eder — yanlış pozitif oranı düşük.
 *
 * KAPSAM SINIRI (dürüstçe): parmak izi kaydı yalnız e-posta doğrulamasından
 * geçen kayıtlarda tutulur; farklı tarayıcı/cihaz kullanan bir kötüye kullanım
 * bu kontrolü atlar. Bu bir caydırıcı katmandır, tam bir çözüm değildir.
 */
export function isSelfReferralDevice(opts: {
  affiliateUserId?: string | null;
  /** Yeni kaydın parmak izini taşıyan hesap(lar)ın kimlikleri. */
  deviceUserIds?: readonly (string | null | undefined)[];
}): boolean {
  const affiliate = opts.affiliateUserId ?? null;
  if (!affiliate) return false;
  return (opts.deviceUserIds ?? []).some((id) => !!id && id === affiliate);
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
