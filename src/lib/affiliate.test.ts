import { describe, expect, it } from "vitest";
import {
  AFFILIATE_CODE_DISCOUNT_PCT,
  AFFILIATE_CODE_PATTERN,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_COMMISSION_GROSS_CENTS,
  MIN_PAYOUT_CENTS,
  clampCommissionRate,
  computeCommissionCents,
  isCommissionStatus,
  isEligibleAffiliate,
  isPayoutMethod,
  isValidAffiliateCode,
  payoutEligibility,
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

describe("affiliate kodu — admin yazar, indirim taşımaz", () => {
  it("affiliate kodu indirim TAŞIMAZ (indirimler Paddle'da tanımlanır)", () => {
    // Çift kaynak olmaması için koda yazılan indirim her zaman 0'dır.
    expect(AFFILIATE_CODE_DISCOUNT_PCT).toBe(0);
  });

  it("sunucunun kabul ettiği kodları geçerli sayar", () => {
    for (const code of ["AYSE20", "ayse-20", "MEHMET_Y", "abc", "A".repeat(32)]) {
      expect(isValidAffiliateCode(code), code).toBe(true);
      // İstemci kuralı ile sunucunun zod şeması aynı olmalı.
      expect(AFFILIATE_CODE_PATTERN.test(code.trim())).toBe(true);
    }
  });

  it("boşluğu kırpar ama geçersiz karakteri/uzunluğu reddeder", () => {
    expect(isValidAffiliateCode("  AYSE20  ")).toBe(true);
    expect(isValidAffiliateCode("")).toBe(false);
    expect(isValidAffiliateCode("ab")).toBe(false); // 3 karakterden kısa
    expect(isValidAffiliateCode("A".repeat(33))).toBe(false); // 32'den uzun
    expect(isValidAffiliateCode("AYSE 20")).toBe(false); // iç boşluk
    expect(isValidAffiliateCode("AYŞE20")).toBe(false); // ş kod şemasında yok
    expect(isValidAffiliateCode("AYSE%20")).toBe(false);
  });
});
