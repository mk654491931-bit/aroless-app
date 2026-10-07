import { describe, expect, it } from "vitest";
import {
  AFFILIATE_CODE_PATTERN,
  DEFAULT_AFFILIATE_DISCOUNT_PCT,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_COMMISSION_GROSS_CENTS,
  MIN_PAYOUT_CENTS,
  affiliatePromoCode,
  clampCommissionRate,
  computeCommissionCents,
  isCommissionStatus,
  isDuplicateCodeError,
  isEligibleAffiliate,
  isPayoutMethod,
  payoutEligibility,
  randomCodeSuffix,
  shouldEarnCommission,
} from "./affiliate";

describe("affiliate commission math", () => {
  it("computes 30% recurring commission on a Pro payment", () => {
    // Pro = $29/mo → 2900 cents → 870 cents commission.
    expect(computeCommissionCents(2900, DEFAULT_COMMISSION_RATE_PCT)).toBe(870);
  });

  it("computes 30% on a Business payment with rounding", () => {
    // Business = $79/mo → 7900 → 2370.
    expect(computeCommissionCents(7900, 30)).toBe(2370);
  });

  it("rounds to the nearest minor unit", () => {
    // 1000 * 33.333% = 333.33 → 333.
    expect(computeCommissionCents(1000, 33.333)).toBe(333);
    // 1000 * 66.667% = 666.67 → 667.
    expect(computeCommissionCents(1000, 66.667)).toBe(667);
  });

  it("never returns dust below 1 minor unit for a valid payment", () => {
    // 100 * 0.5% → 0.5 → floors to 1 (minimum meaningful commission).
    expect(computeCommissionCents(100, 0.5)).toBe(1);
  });

  it("returns 0 for payments below the anti-dust threshold", () => {
    expect(computeCommissionCents(99, 30)).toBe(0);
    expect(computeCommissionCents(MIN_COMMISSION_GROSS_CENTS - 1, 30)).toBe(0);
  });

  it("returns 0 for zero / negative / NaN gross amounts", () => {
    expect(computeCommissionCents(0, 30)).toBe(0);
    expect(computeCommissionCents(-500, 30)).toBe(0);
    expect(computeCommissionCents(Number.NaN, 30)).toBe(0);
  });

  it("returns 0 for a 0% rate (revoked-but-paid-out guard)", () => {
    expect(computeCommissionCents(2900, 0)).toBe(0);
  });

  it("clamps out-of-band rates into the legal 0-100 band", () => {
    expect(clampCommissionRate(150)).toBe(100);
    expect(clampCommissionRate(-10)).toBe(0);
    expect(clampCommissionRate(Number.NaN)).toBe(DEFAULT_COMMISSION_RATE_PCT);
    expect(clampCommissionRate(29.4)).toBe(29.4);
  });
});

describe("affiliate eligibility", () => {
  it("only verified affiliates earn", () => {
    expect(isEligibleAffiliate("verified")).toBe(true);
    expect(isEligibleAffiliate("pending")).toBe(false);
    expect(isEligibleAffiliate("revoked")).toBe(false);
    expect(isEligibleAffiliate(null)).toBe(false);
    expect(isEligibleAffiliate(undefined)).toBe(false);
  });

  it("requires a positive gross amount and a completed transaction", () => {
    const base = { status: "verified", amountCents: 2900 };
    expect(shouldEarnCommission({ ...base, eventType: "transaction.completed" })).toBe(true);
    // Refunds/chargebacks carry no positive amount → no commission event.
    expect(
      shouldEarnCommission({ ...base, eventType: "transaction.completed", amountCents: 0 }),
    ).toBe(false);
    expect(
      shouldEarnCommission({ ...base, eventType: "transaction.completed", amountCents: -2900 }),
    ).toBe(false);
    // Only the completed-payment event triggers a commission.
    expect(shouldEarnCommission({ ...base, eventType: "subscription.canceled" })).toBe(false);
    // Pending/revoked affiliates never earn even with a paid event.
    expect(
      shouldEarnCommission({ ...base, eventType: "transaction.completed", status: "pending" }),
    ).toBe(false);
  });
});

describe("affiliate payout rules", () => {
  it("pays out only when the pending balance reaches the $75 threshold", () => {
    expect(MIN_PAYOUT_CENTS).toBe(7500);
    expect(payoutEligibility(7499).eligible).toBe(false);
    expect(payoutEligibility(7500).eligible).toBe(true);
    expect(payoutEligibility(9000).eligible).toBe(true);
  });

  it("reports how much is left before the next payout", () => {
    expect(payoutEligibility(0).remainingCents).toBe(7500);
    expect(payoutEligibility(5000).remainingCents).toBe(2500);
    expect(payoutEligibility(7500).remainingCents).toBe(0);
    // Above the threshold the remaining amount never goes negative.
    expect(payoutEligibility(12000).remainingCents).toBe(0);
  });

  it("treats invalid pending values as zero", () => {
    expect(payoutEligibility(Number.NaN).eligible).toBe(false);
    expect(payoutEligibility(-100).remainingCents).toBe(7500);
  });

  it("validates payout methods and commission statuses", () => {
    expect(isPayoutMethod("wise")).toBe(true);
    expect(isPayoutMethod("iban")).toBe(true);
    expect(isPayoutMethod("other")).toBe(true);
    expect(isPayoutMethod("paypal")).toBe(false);
    expect(isPayoutMethod(null)).toBe(false);

    expect(isCommissionStatus("pending")).toBe(true);
    expect(isCommissionStatus("paid")).toBe(true);
    expect(isCommissionStatus("reversed")).toBe(true);
    expect(isCommissionStatus("unknown")).toBe(false);
  });
});

describe("affiliate'e özel promosyon kodu", () => {
  /** Kod sunucudan geçebilmeli: createPromoCode aynı kuralı uygular. */
  const serverAccepts = (code: string) => AFFILIATE_CODE_PATTERN.test(code);

  it("e-postanın baş kısmını kullanır, böylece kodun sahibi listede tanınır", () => {
    expect(affiliatePromoCode("ayse@ornek.com")).toMatch(/^AYSE-[A-Z0-9]{4}$/);
    expect(affiliatePromoCode("mehmet.yilmaz@gmail.com")).toMatch(/^MEHMETYI-[A-Z0-9]{4}$/);
  });

  it("baş kısımdaki ayraçları ve büyük/küçük harf farkını temizler", () => {
    // . + - _ gibi karakterler kod şemasında yok; temizlenmeleri gerekir.
    expect(affiliatePromoCode("john.doe+news@x.com")).toMatch(/^JOHNDOE-[A-Z0-9]{4}$/);
    expect(affiliatePromoCode("A.B_C-d@x.com")).toMatch(/^[A-Z0-9]{3,8}-[A-Z0-9]{4}$/);
  });

  it("kısa/boş/geçersiz baş kısımda jenerik VLR koduna düşer", () => {
    expect(affiliatePromoCode("a@x.com")).toMatch(/^VLR[A-Z0-9]{6}$/);
    expect(affiliatePromoCode("şğ@x.com")).toMatch(/^VLR[A-Z0-9]{6}$/);
    expect(affiliatePromoCode(null)).toMatch(/^VLR[A-Z0-9]{6}$/);
    expect(affiliatePromoCode(undefined)).toMatch(/^VLR[A-Z0-9]{6}$/);
    expect(affiliatePromoCode("")).toMatch(/^VLR[A-Z0-9]{6}$/);
  });

  it("kullanıcı adı uzunsa 8 karakterde keser (32 karakter sınırını aşmaz)", () => {
    const code = affiliatePromoCode("cokuzunbirkullaniciadi@x.com");
    expect(code).toMatch(/^COKUZUNB-[A-Z0-9]{4}$/);
    expect(code.length).toBeLessThanOrEqual(32);
  });

  it("üretilen her kod sunucunun kabul ettiği biçimde", () => {
    const emails = [
      "ayse@ornek.com",
      "a@x.com",
      null,
      "weird..name@@x.com",
      "kullanıcı.ş@x.com",
      "x-y_z1@a.b",
      "12345678901234567890@a.b",
    ];
    for (const email of emails) {
      const code = affiliatePromoCode(email);
      expect(serverAccepts(code), `${email} → ${code} sunucudan geçmeli`).toBe(true);
    }
  });

  it("her çağrıda farklı bir kod üretir (aynı kişiye ikinci kod verilebilir)", () => {
    const codes = new Set(Array.from({ length: 30 }, () => affiliatePromoCode("ayse@ornek.com")));
    // Rastgelelik pratikte tekil olmalı; 30 denemede en az 25 farklı kod beklenir.
    expect(codes.size).toBeGreaterThanOrEqual(25);
  });

  it("rng sabitlenebilir ve alfabeyi sınırlarında kullanır", () => {
    expect(randomCodeSuffix(4, () => 0)).toBe("AAAA");
    expect(randomCodeSuffix(6, () => 0.999999)).toBe("999999");
    expect(randomCodeSuffix(0)).toBe("");
    // Karışan karakterler alfabede yok (okunabilirlik kuralı).
    expect(randomCodeSuffix(200, () => Math.random())).not.toMatch(/[01IO]/);
  });

  it("varsayılan indirim %20 ve sunucunun 1-100 sınırı içinde", () => {
    expect(DEFAULT_AFFILIATE_DISCOUNT_PCT).toBe(20);
  });

  it("yalnızca kod çakışması yeniden denemeye yol açar", () => {
    // createPromoCode'un çakışma mesajı (panel bunu görünce yeni kod üretir).
    expect(isDuplicateCodeError("Bu kod zaten var.")).toBe(true);
    // Postgres/PostgREST varyantları da yakalanmalı (mesaj dile göre değişebilir).
    expect(isDuplicateCodeError("duplicate key value violates unique constraint")).toBe(true);
    expect(isDuplicateCodeError("Code already exists")).toBe(true);
    // Gerçek hatalar yutulmamalı; yoksa admin hatayı hiç görmez.
    expect(isDuplicateCodeError("Forbidden")).toBe(false);
    expect(isDuplicateCodeError("Kod oluşturulamadı")).toBe(false);
    expect(isDuplicateCodeError("network request failed")).toBe(false);
  });
});
