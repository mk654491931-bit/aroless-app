import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_COMMISSION_GROSS_CENTS,
  clampCommissionRate,
  computeCommissionCents,
  isEligibleAffiliate,
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
    expect(shouldEarnCommission({ ...base, eventType: "transaction.completed", amountCents: 0 })).toBe(
      false,
    );
    expect(
      shouldEarnCommission({ ...base, eventType: "transaction.completed", amountCents: -2900 }),
    ).toBe(false);
    // Only the completed-payment event triggers a commission.
    expect(shouldEarnCommission({ ...base, eventType: "subscription.canceled" })).toBe(false);
    // Pending/revoked affiliates never earn even with a paid event.
    expect(shouldEarnCommission({ ...base, eventType: "transaction.completed", status: "pending" })).toBe(
      false,
    );
  });
});