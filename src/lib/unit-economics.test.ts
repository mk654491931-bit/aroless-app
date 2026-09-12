import { describe, it, expect } from "vitest";
import {
  parseMoney,
  computeUnitEconomics,
  marginBadge,
  MIN_NET_MARGIN_PCT,
} from "./unit-economics";

describe("parseMoney", () => {
  it("parses plain numbers", () => {
    expect(parseMoney(29.99)).toBe(29.99);
  });

  it("parses dollar strings", () => {
    expect(parseMoney("$12.50")).toBe(12.5);
  });

  it("parses strings with commas", () => {
    expect(parseMoney("$1,299.00")).toBe(1299);
  });

  it("returns 0 for null/undefined", () => {
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney("")).toBe(0);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(parseMoney("abc")).toBe(0);
  });

  it("handles negative values", () => {
    expect(parseMoney("-$5.00")).toBe(-5);
  });

  it("returns 0 for Infinity", () => {
    expect(parseMoney(Infinity)).toBe(0);
    expect(parseMoney(NaN)).toBe(0);
  });
});

describe("computeUnitEconomics", () => {
  it("computes basic economics with all inputs", () => {
    const result = computeUnitEconomics({
      retail_price: "$49.99",
      supplier_cost: "$8.00",
      shipping: "$3.50",
      ad_spend: "$12.00",
      platform_fee: "$5.00",
      marketplace: "Shopify",
      competition: "Medium",
    });

    expect(result.retail).toBe(49.99);
    expect(result.cogs).toBe(8);
    expect(result.shipping).toBe(3.5);
    expect(result.platform_fee).toBe(5);
    expect(result.ad_spend).toBe(12);
    expect(result.net_profit).toBeCloseTo(21.49, 0);
    expect(result.net_margin_pct).toBeCloseTo(43, 0);
    expect(result.unprofitable).toBe(false);
    expect(result.disqualified).toBe(false);
  });

  it("marks unprofitable products", () => {
    const result = computeUnitEconomics({
      retail_price: "$10",
      supplier_cost: "$8",
      shipping: "$5",
      ad_spend: "$6",
      platform_fee: "$2",
    });

    expect(result.net_profit).toBeLessThan(0);
    expect(result.unprofitable).toBe(true);
    expect(result.disqualified).toBe(true);
  });

  it("marks low-margin products as disqualified", () => {
    const result = computeUnitEconomics({
      retail_price: "$20",
      supplier_cost: "$10",
      shipping: "$3",
      ad_spend: "$5",
      platform_fee: "$3",
    });

    expect(result.net_margin_pct).toBeLessThan(MIN_NET_MARGIN_PCT);
    expect(result.disqualified).toBe(true);
  });

  it("estimates shipping when not provided", () => {
    const result = computeUnitEconomics({
      retail_price: "$30",
      supplier_cost: "$5",
    });

    expect(result.shipping).toBeGreaterThan(0);
  });

  it("applies correct Amazon commission rate", () => {
    const result = computeUnitEconomics({
      retail_price: "$100",
      supplier_cost: "$15",
      marketplace: "Amazon",
      competition: "Medium",
    });

    expect(result.platform_fee).toBeCloseTo(15, 0);
  });

  it("applies correct TikTok Shop commission rate", () => {
    const result = computeUnitEconomics({
      retail_price: "$100",
      supplier_cost: "$15",
      marketplace: "TikTok Shop",
      competition: "Medium",
    });

    expect(result.platform_fee).toBeCloseTo(8, 0);
  });

  it("scales CAC with competition level", () => {
    const base = { retail_price: "$50", supplier_cost: "$10", shipping: "$3" };

    const low = computeUnitEconomics({ ...base, competition: "Low" });
    const high = computeUnitEconomics({ ...base, competition: "High" });

    expect(high.ad_spend).toBeGreaterThan(low.ad_spend);
  });

  it("handles zero retail price", () => {
    const result = computeUnitEconomics({
      retail_price: 0,
      supplier_cost: "$5",
    });

    expect(result.retail).toBe(0);
    expect(result.net_margin_pct).toBe(0);
  });
});

describe("marginBadge", () => {
  it("returns profitable badge for good margins", () => {
    const e = computeUnitEconomics({
      retail_price: "$50",
      supplier_cost: "$10",
      shipping: "$3",
      ad_spend: "$5",
      platform_fee: "$5",
    });

    if (!e.unprofitable && e.net_margin_pct >= MIN_NET_MARGIN_PCT) {
      const badge = marginBadge(e);
      expect(badge.unprofitable).toBe(false);
      expect(badge.text).toContain("NET");
    }
  });

  it("returns unprofitable badge when net profit is zero or negative", () => {
    const badge = marginBadge({
      retail: 10,
      cogs: 8,
      shipping: 5,
      platform_fee: 2,
      ad_spend: 6,
      net_profit: -11,
      net_margin_pct: -110,
      unprofitable: true,
      disqualified: true,
    });

    expect(badge.unprofitable).toBe(true);
    expect(badge.text).toContain("UNPROFITABLE");
  });

  it("returns below-threshold badge for low margins", () => {
    const badge = marginBadge({
      retail: 20,
      cogs: 10,
      shipping: 3,
      platform_fee: 2,
      ad_spend: 4,
      net_profit: 1,
      net_margin_pct: 5,
      unprofitable: false,
      disqualified: true,
    });

    expect(badge.unprofitable).toBe(true);
    expect(badge.text).toContain("BELOW");
  });
});
