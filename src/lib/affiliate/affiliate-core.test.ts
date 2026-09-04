import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  commissionAmountCents,
  computeCommission,
  generateReferralCode,
  isPeriodEligible,
  maskEmail,
  normalizeCode,
  parseUtcDate,
  toIsoDate,
} from "./affiliate-core";

const FIRST_PAID = new Date(Date.UTC(2026, 0, 15)); // 2026-01-15

describe("commission math (scenarios 3-5)", () => {
  it("Starter $39 at 30% → $11.70 (1170 cents)", () => {
    expect(commissionAmountCents(3900, 30)).toBe(1170);
  });

  it("Pro $59 at 30% → $17.70 (1770 cents)", () => {
    expect(commissionAmountCents(5900, 30)).toBe(1770);
  });

  it("Business $109 at 30% → $32.70 (3270 cents)", () => {
    expect(commissionAmountCents(10900, 30)).toBe(3270);
  });

  it("custom rate 27.5% rounds safely to the cent", () => {
    expect(commissionAmountCents(3999, 27.5)).toBe(1100); // 3999*27.5/100 = 1099.725 → 1100
    expect(commissionAmountCents(3999, 0)).toBe(0);
    expect(commissionAmountCents(-5, 30)).toBe(0);
  });
});

describe("12-month commission window (scenarios 6-8)", () => {
  it("allows the first 12 monthly billing periods", () => {
    for (let month = 0; month < 12; month++) {
      const start = addMonthsUtc(FIRST_PAID, month);
      const result = isPeriodEligible({
        firstPaidAt: FIRST_PAID,
        periodStart: start,
        durationMonths: 12,
        existingCommissionCount: month,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("stops when 12 months are exceeded", () => {
    const start = addMonthsUtc(FIRST_PAID, 12);
    const result = isPeriodEligible({
      firstPaidAt: FIRST_PAID,
      periodStart: start,
      durationMonths: 12,
      existingCommissionCount: 12,
    });
    expect(result).toEqual({ ok: false, reason: "window_exceeded", months: 12 });
  });

  it("rejects a period before the first payment", () => {
    const start = addMonthsUtc(FIRST_PAID, -1);
    const result = isPeriodEligible({
      firstPaidAt: FIRST_PAID,
      periodStart: start,
      durationMonths: 12,
    });
    expect(result.ok).toBe(false);
  });

  it("computeCommission respects durationMonths and amount validation", () => {
    const ok = computeCommission({
      subscriptionAmountCents: 5900,
      ratePct: 30,
      periodStart: addMonthsUtc(FIRST_PAID, 1),
      periodEnd: addMonthsUtc(FIRST_PAID, 2),
      firstPaidAt: FIRST_PAID,
      durationMonths: 12,
      existingCommissionCount: 1,
    });
    expect(ok).toEqual({ ok: true, commissionAmountCents: 1770, ratePct: 30 });

    expect(
      computeCommission({
        subscriptionAmountCents: 0,
        ratePct: 30,
        periodStart: FIRST_PAID,
        periodEnd: addMonthsUtc(FIRST_PAID, 1),
        firstPaidAt: FIRST_PAID,
        durationMonths: 12,
      }).ok,
    ).toBe(false);
  });
});

describe("utilities", () => {
  it("parses/serializes dates without local-timezone drift", () => {
    expect(toIsoDate(parseUtcDate("2026-01-15T23:59:59Z"))).toBe("2026-01-15");
    expect(toIsoDate(parseUtcDate(new Date(Date.UTC(2026, 2, 5))))).toBe("2026-03-05");
  });

  it("normalizes and validates codes", () => {
    expect(normalizeCode("  ab-c1  ")).toBe("ABC1");
    expect(generateReferralCode(new Set(["ABC1"]), 4).length).toBe(4);
    expect(generateReferralCode()).not.toContain("0");
  });

  it("masks emails for partner-facing lists", () => {
    expect(maskEmail("ali@example.com")).toContain("*");
    expect(maskEmail(null)).toBe("gizli");
    expect(maskEmail("a@b.co")).toBe("a@b.co");
  });
});
