import { describe, it, expect } from "vitest";
import {
  enrichProduct,
  recommendationStyle,
  reliabilityStyle,
  formatCurrency,
} from "./recommendation";
import type { WinningProduct } from "./gemini.functions";

function makeProduct(overrides: Partial<WinningProduct> = {}): WinningProduct {
  return {
    name: "Test Product",
    description: "Test",
    why_winning: "Trending",
    target_audience: "Everyone",
    ad_angles: ["Angle 1"],
    supplier_price_usd: "$5",
    selling_price_usd: "$29.99",
    profit_margin_pct: 45,
    startup_cost_usd: "$200",
    platform_fit: ["Shopify"],
    platform_strategy: "Sell on Shopify",
    competitor_examples: ["Competitor A"],
    supplier_links: ["https://aliexpress.com/example"],
    alibaba_links: [],
    cost_breakdown: {
      supplier_cost: "$5",
      shipping_cost: "$2.50",
      platform_fee: "$3",
      ad_spend: "$5",
      net_profit: "$14.49",
      net_margin_pct: 48,
    },
    competition_level: "Low",
    trend_score: 75,
    emoji: "📦",
    ...overrides,
  };
}

describe("enrichProduct", () => {
  it("returns enriched scores for a typical product", () => {
    const product = makeProduct();
    const enriched = enrichProduct(product);

    expect(enriched.ai_score).toBeGreaterThanOrEqual(0);
    expect(enriched.ai_score).toBeLessThanOrEqual(100);
    expect(enriched.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(enriched.trend_score).toBe(75);
    expect(enriched.confidence_score).toBeGreaterThan(0);
    expect(["Launch", "Watch", "Avoid"]).toContain(enriched.recommendation);
  });

  it("gives Launch recommendation for high-opportunity products", () => {
    const product = makeProduct({
      trend_score: 90,
      profit_margin_pct: 60,
      competition_level: "Low",
      cost_breakdown: {
        supplier_cost: "$5",
        shipping_cost: "$2",
        platform_fee: "$3",
        ad_spend: "$4",
        net_profit: "$15.99",
        net_margin_pct: 53,
      },
    });

    const enriched = enrichProduct(product);
    expect(enriched.recommendation).toBe("Launch");
  });

  it("gives Avoid recommendation for high competition + low margin", () => {
    const product = makeProduct({
      trend_score: 30,
      profit_margin_pct: 15,
      competition_level: "High",
    });

    const enriched = enrichProduct(product);
    expect(enriched.recommendation).toBe("Avoid");
  });

  it("calculates monthly estimates", () => {
    const product = makeProduct();
    const enriched = enrichProduct(product);

    expect(enriched.est_monthly_sales).toBeGreaterThan(0);
    expect(enriched.est_monthly_revenue_usd).toBeGreaterThan(0);
    expect(enriched.net_per_unit_usd).toBeDefined();
  });

  it("uses real_economics when provided", () => {
    const product = makeProduct({
      real_economics: {
        retail: 29.99,
        supplier: 5,
        shipping: 2.5,
        platform_fee: 3,
        payment_fee: 1.17,
        cac: 6,
        returns_cost: 0.8,
        misc: 0.45,
        net_per_unit: 11.07,
        net_margin_pct: 36.9,
        gross_per_unit: 17.07,
        gross_margin_pct: 56.9,
        cpc_usd: 0.9,
        cvr_pct: 2.1,
        breakeven_roas: 2.71,
        monthly: {
          ad_budget_usd: 600,
          paid_units: 85,
          organic_units: 12,
          units: 97,
          revenue_usd: 2909,
          overhead_usd: 120,
          net_profit_usd: 954,
          low_usd: 477,
          high_usd: 1622,
        },
        assumptions: [],
        benchmarks: [],
        context: { country: "US", country_label: "ABD", category: "Genel", platform: "Shopify" },
      },
    });

    const enriched = enrichProduct(product);
    expect(enriched.est_monthly_sales).toBe(97);
    expect(enriched.est_monthly_revenue_usd).toBe(2909);
  });
});

describe("recommendationStyle", () => {
  it("returns green for Launch", () => {
    const style = recommendationStyle("Launch");
    expect(style.emoji).toBe("🟢");
    expect(style.cls).toContain("emerald");
  });

  it("returns red for Avoid", () => {
    const style = recommendationStyle("Avoid");
    expect(style.emoji).toBe("🔴");
    expect(style.cls).toContain("rose");
  });

  it("returns yellow for Watch", () => {
    const style = recommendationStyle("Watch");
    expect(style.emoji).toBe("🟡");
    expect(style.cls).toContain("amber");
  });
});

describe("reliabilityStyle", () => {
  it("returns green check for Highly Sellable", () => {
    const style = reliabilityStyle("Highly Sellable");
    expect(style.icon).toBe("✅");
    expect(style.cls).toContain("emerald");
  });

  it("returns red X for Do Not Sell", () => {
    const style = reliabilityStyle("Do Not Sell");
    expect(style.icon).toBe("⛔");
    expect(style.cls).toContain("rose");
  });

  it("returns warning for Moderate Risk", () => {
    const style = reliabilityStyle("Moderate Risk");
    expect(style.icon).toBe("⚠️");
    expect(style.cls).toContain("amber");
  });

  it("handles undefined", () => {
    const style = reliabilityStyle(undefined);
    expect(style.icon).toBe("⚠️");
  });
});

describe("formatCurrency", () => {
  it("formats USD by default", () => {
    const result = formatCurrency(1234);
    expect(result).toContain("1,234");
  });

  it("formats with specific currency", () => {
    const result = formatCurrency(100, "EUR");
    expect(result).toContain("100");
  });

  it("handles zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0");
  });

  it("handles negative values", () => {
    const result = formatCurrency(-50);
    expect(result).toContain("50");
  });
});
