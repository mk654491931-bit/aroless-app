import { describe, it, expect } from "vitest";
import {
  parseMoneyNum,
  checkConsistency,
  buyersPer1000,
  conversionTone,
} from "./consistency";
import type { WinningProduct } from "./gemini.functions";

describe("parseMoneyNum", () => {
  it("parses dollar strings", () => {
    expect(parseMoneyNum("$12.50")).toBe(12.5);
  });

  it("parses plain numbers as strings", () => {
    expect(parseMoneyNum("42")).toBe(42);
  });

  it("handles commas", () => {
    expect(parseMoneyNum("$1,299")).toBe(1299);
  });

  it("returns 0 for undefined/null", () => {
    expect(parseMoneyNum(undefined)).toBe(0);
    expect(parseMoneyNum(null)).toBe(0);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(parseMoneyNum("abc")).toBe(0);
  });
});

function makeProduct(overrides: Partial<WinningProduct> = {}): WinningProduct {
  return {
    name: "Test Product",
    description: "A test product for consistency checks",
    why_winning: "Trending",
    target_audience: "Everyone",
    ad_angles: ["Angle 1"],
    supplier_price_usd: "$5.00",
    selling_price_usd: "$29.99",
    profit_margin_pct: 45,
    startup_cost_usd: "$200",
    platform_fit: ["Shopify"],
    platform_strategy: "Sell on Shopify",
    competitor_examples: ["Competitor A"],
    supplier_links: ["https://aliexpress.com/example"],
    alibaba_links: ["https://alibaba.com/example"],
    cost_breakdown: {
      supplier_cost: "$5.00",
      shipping_cost: "$2.50",
      platform_fee: "$3.00",
      ad_spend: "$6.00",
      net_profit: "$13.49",
      net_margin_pct: 45,
    },
    competition_level: "Low",
    trend_score: 75,
    emoji: "📦",
    ...overrides,
  };
}

describe("checkConsistency", () => {
  it("returns high score for consistent product", () => {
    const product = makeProduct();
    const report = checkConsistency(product);

    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.checked).toBeGreaterThan(0);
  });

  it("flags selling price below supplier cost", () => {
    const product = makeProduct({
      supplier_price_usd: "$50.00",
      selling_price_usd: "$29.99",
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "price")).toBe(true);
  });

  it("flags out-of-range margin percentage", () => {
    const product = makeProduct({
      profit_margin_pct: 150,
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "profit_margin_pct")).toBe(true);
  });

  it("flags negative margin percentage", () => {
    const product = makeProduct({
      profit_margin_pct: -10,
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "profit_margin_pct")).toBe(true);
  });

  it("flags out-of-range scores", () => {
    const product = makeProduct({
      trend_score: 120,
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "trend_score")).toBe(true);
  });

  it("flags invalid supplier links", () => {
    const product = makeProduct({
      supplier_links: ["not-a-url"],
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "links")).toBe(true);
  });

  it("flags missing data sources", () => {
    const product = makeProduct({
      data_sources: [],
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "data_sources")).toBe(true);
  });

  it("reduces score for each issue found", () => {
    const perfect = checkConsistency(makeProduct());
    const flawed = checkConsistency(
      makeProduct({
        supplier_price_usd: "$50",
        selling_price_usd: "$29",
        profit_margin_pct: -5,
        trend_score: 150,
        data_sources: [],
      }),
    );

    expect(flawed.score).toBeLessThan(perfect.score);
  });

  it("validates conversion funnel coherence", () => {
    const product = makeProduct({
      conversion: {
        buyers_per_1000_views: 25,
        cvr_pct: 2.5,
        benchmark: "Shopify avg",
        reasoning: "Good",
        funnel: {
          product_page_views: 1000,
          add_to_cart: 200,
          checkout_started: 100,
          purchases: 25,
        },
      },
    });

    const report = checkConsistency(product);
    // Should not flag funnel issues for valid data
    expect(report.issues.filter((i) => i.field === "conversion.funnel").length).toBe(0);
  });

  it("flags funnel where purchases exceed stated buyers per 1000", () => {
    const product = makeProduct({
      conversion: {
        buyers_per_1000_views: 5,
        cvr_pct: 0.5,
        benchmark: "Shopify avg",
        reasoning: "Good",
        funnel: {
          product_page_views: 1000,
          add_to_cart: 200,
          checkout_started: 100,
          purchases: 50, // way more than stated 5 buyers per 1000
        },
      },
    });

    const report = checkConsistency(product);
    expect(report.issues.some((i) => i.field === "conversion.funnel")).toBe(true);
  });
});

describe("buyersPer1000", () => {
  it("returns explicit conversion when valid", () => {
    const product = makeProduct({
      conversion: {
        buyers_per_1000_views: 30,
        cvr_pct: 3.0,
        benchmark: "Test",
        reasoning: "Test",
      },
    });

    const result = buyersPer1000(product);
    expect(result.value).toBe(30);
    expect(result.estimated).toBe(false);
  });

  it("estimates when no explicit conversion", () => {
    const product = makeProduct({
      selling_price_usd: "$25",
      trend_score: 70,
      competition_level: "Low",
    });

    const result = buyersPer1000(product);
    expect(result.value).toBeGreaterThan(0);
    expect(result.estimated).toBe(true);
  });

  it("returns higher estimates for low-price products", () => {
    const cheap = buyersPer1000(
      makeProduct({ selling_price_usd: "$15", trend_score: 70, competition_level: "Low" }),
    );
    const expensive = buyersPer1000(
      makeProduct({ selling_price_usd: "$200", trend_score: 70, competition_level: "Low" }),
    );

    expect(cheap.value).toBeGreaterThanOrEqual(expensive.value);
  });
});

describe("conversionTone", () => {
  it("returns Excellent for high conversion", () => {
    const tone = conversionTone(35);
    expect(tone.label).toBe("Excellent");
    expect(tone.cls).toContain("emerald");
  });

  it("returns Strong for medium conversion", () => {
    const tone = conversionTone(20);
    expect(tone.label).toBe("Strong");
    expect(tone.cls).toContain("teal");
  });

  it("returns lower label for low conversion", () => {
    const tone = conversionTone(5);
    expect(tone.label).not.toBe("Excellent");
    expect(tone.label).not.toBe("Strong");
  });
});
