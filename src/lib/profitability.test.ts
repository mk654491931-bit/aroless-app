import { describe, it, expect } from "vitest";
import { netMarginOf, rankProfitable } from "./profitability";

describe("netMarginOf", () => {
  it("calculates margin from cost breakdown", () => {
    const product = {
      selling_price_usd: "$50",
      cost_breakdown: {
        supplier_cost: "$8",
        shipping_cost: "$3",
        platform_fee: "$5",
        ad_spend: "$6",
        net_profit: "$28",
        net_margin_pct: 56,
      },
      platform_fit: ["Shopify"],
      competition_level: "Medium" as const,
    };

    const margin = netMarginOf(product);
    expect(margin).toBeGreaterThan(0);
  });

  it("uses supplier_price_usd when no cost breakdown", () => {
    const product = {
      selling_price_usd: "$40",
      supplier_price_usd: "$8",
      platform_fit: ["Shopify"],
      competition_level: "Low" as const,
    };

    const margin = netMarginOf(product);
    expect(margin).toBeGreaterThan(0);
  });

  it("returns 0 for zero-price product", () => {
    const product = {
      selling_price_usd: "$0",
      supplier_price_usd: "$5",
    };

    const margin = netMarginOf(product);
    expect(margin).toBe(0);
  });
});

describe("rankProfitable", () => {
  it("returns products sorted by profitability", () => {
    const products = [
      {
        name: "Low margin",
        selling_price_usd: "$20",
        supplier_price_usd: "$12",
        profit_margin_pct: 10,
        cost_breakdown: { supplier_cost: "$12", shipping_cost: "$3", platform_fee: "$2", ad_spend: "$3", net_margin_pct: 10 },
        platform_fit: ["Shopify"],
        competition_level: "High" as const,
      },
      {
        name: "High margin",
        selling_price_usd: "$50",
        supplier_price_usd: "$5",
        profit_margin_pct: 60,
        cost_breakdown: { supplier_cost: "$5", shipping_cost: "$2", platform_fee: "$4", ad_spend: "$5", net_margin_pct: 60 },
        platform_fit: ["Shopify"],
        competition_level: "Low" as const,
      },
    ];

    const ranked = rankProfitable(products);
    expect(ranked.length).toBeGreaterThan(0);
    // High margin product should be first
    expect(ranked[0].name).toBe("High margin");
  });

  it("never returns empty array", () => {
    const products = [
      {
        name: "Unprofitable",
        selling_price_usd: "$5",
        supplier_price_usd: "$4",
        cost_breakdown: { supplier_cost: "$4", shipping_cost: "$3", platform_fee: "$1", ad_spend: "$3", net_margin_pct: -20 },
        platform_fit: ["Shopify"],
        competition_level: "High" as const,
      },
    ];

    const ranked = rankProfitable(products);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const ranked = rankProfitable([]);
    expect(ranked).toEqual([]);
  });

  it("prefers profitable products over unprofitable ones", () => {
    const products = [
      {
        name: "Profitable",
        selling_price_usd: "$60",
        supplier_price_usd: "$8",
        cost_breakdown: { supplier_cost: "$8", shipping_cost: "$3", platform_fee: "$5", ad_spend: "$6", net_margin_pct: 42 },
        platform_fit: ["Shopify"],
        competition_level: "Low" as const,
      },
      {
        name: "Unprofitable",
        selling_price_usd: "$15",
        supplier_price_usd: "$10",
        cost_breakdown: { supplier_cost: "$10", shipping_cost: "$4", platform_fee: "$2", ad_spend: "$5", net_margin_pct: -6 },
        platform_fit: ["Shopify"],
        competition_level: "High" as const,
      },
    ];

    const ranked = rankProfitable(products);
    expect(ranked[0].name).toBe("Profitable");
  });
});
