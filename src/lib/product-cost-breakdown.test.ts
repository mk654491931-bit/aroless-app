import { describe, expect, it } from "vitest";

import { buildProductCostBreakdown } from "./product-cost-breakdown";
import type { WinningProduct } from "./gemini.functions";

type Input = Parameters<typeof buildProductCostBreakdown>[0];

const productMatch = {
  matchKind: "product",
  samples: 3,
  supplierPriceUsd: 15.92,
  supplierLowUsd: 15.92,
  supplierHighUsd: 15.92,
  supplierPriceHighUsd: null,
  listPriceUsd: null,
  discountPct: null,
  soldMax: null,
  store: "Test Store",
  shipFrom: "CN",
  url: "https://example.com/item",
  moqUnits: null,
  moqUnit: "",
} as unknown as NonNullable<WinningProduct["supplier_evidence"]>;

const base = {
  name: "Car Seat Cover Full Set",
  cost_breakdown: {
    supplier_cost: "15.92",
    shipping_cost: "",
    platform_fee: "",
    ad_spend: "",
    net_profit: "",
    net_margin_pct: 0,
  },
  selling_price_usd: "$45.99",
  supplier_price_usd: "15.92",
  supplier_evidence: productMatch,
  gross_margin_pct: 65.4,
  fee_budget_usd: 30.07,
  platform_fit: ["Amazon.com"],
  competition_level: "Medium" as const,
  trend_score: 70,
  conversion: { cvr_pct: 2.5 } as WinningProduct["conversion"],
  startup_cost_usd: "600",
  real_economics: undefined,
  sourcing: undefined,
} satisfies Input;

describe("buildProductCostBreakdown", () => {
  it("ölçülmüş maliyet varsa modelin önüne geçer", () => {
    const result = buildProductCostBreakdown({
      ...base,
      cost_breakdown: {
        supplier_cost: "15.92",
        shipping_cost: "4.00",
        platform_fee: "6.00",
        ad_spend: "5.00",
        net_profit: "15.00",
        net_margin_pct: 32.6,
      },
    });
    expect(result.shipping).toMatchObject({ usd: 4, basis: "measured" });
    expect(result.platformFee).toMatchObject({ usd: 6, basis: "measured" });
    expect(result.adSpend).toMatchObject({ usd: 5, basis: "measured" });
    expect(result.netProfit).toMatchObject({ usd: 15, basis: "measured" });
  });

  it("kargo/komisyon/CAC boşsa kaynağı belirtilmiş model değeri üretir", () => {
    const result = buildProductCostBreakdown(base);
    expect(result.shipping.usd).toBeGreaterThan(0);
    expect(result.shipping.basis).toBe("model");
    expect(result.platformFee.usd).toBeGreaterThan(0);
    expect(result.platformFee.basis).toBe("model");
    expect(result.adSpend.usd).toBeGreaterThan(0);
    expect(result.adSpend.basis).toBe("model");
    expect(result.netProfit.basis).toBe("model");
    expect(result.usedModel).toBe(true);
    expect(result.shipping.source).not.toContain("Kaynakta yok");
  });

  it("tedarik eşleşmediyse net kâr uydurmaz", () => {
    const result = buildProductCostBreakdown({
      ...base,
      supplier_evidence: null,
      supplier_price_usd: "",
      cost_breakdown: { ...base.cost_breakdown, supplier_cost: "" },
      gross_margin_pct: null,
      fee_budget_usd: null,
    });
    expect(result.supplier.usd).toBeNull();
    expect(result.netProfit.usd).toBeNull();
    expect(result.netProfit.basis).toBe("none");
    // Kargo/komisyon/CAC satış fiyatından bağımsız olarak hesaplanabilir.
    expect(result.shipping.basis).toBe("model");
    expect(result.platformFee.basis).toBe("model");
  });

  it("birebir tedarik yoksa ölçülen niş bandını gösterir, net kâr uydurmaz", () => {
    const result = buildProductCostBreakdown({
      ...base,
      supplier_price_usd: "",
      supplier_evidence: {
        ...productMatch,
        matchKind: "niche",
        supplierPriceUsd: null,
        supplierLowUsd: 12,
        supplierHighUsd: 33.65,
      },
      cost_breakdown: { ...base.cost_breakdown, supplier_cost: "" },
      fee_budget_usd: null,
      gross_margin_pct: null,
    });
    expect(result.supplier.usd).toBeNull();
    expect(result.supplier.source).toBe("Niş bandı $12.00–$33.65");
    expect(result.netProfit.usd).toBeNull();
  });

  it("tedarikçi ücretsiz kargo ve teslimat aralığı ölçtüyse onları kullanır", () => {
    const result = buildProductCostBreakdown({
      ...base,
      supplier_evidence: {
        ...productMatch,
        freeShipping: true,
        deliveryMinDays: 5,
        deliveryMaxDays: 11,
      },
    });
    expect(result.shipping).toMatchObject({
      usd: 0,
      basis: "measured",
      source: "Tedarikçi ücretsiz kargo",
    });
    expect(result.delivery).toMatchObject({
      min: 5,
      max: 11,
      basis: "measured",
      source: "Tedarik teklifi teslimatı",
    });
  });

  it("teslimat süresi ölçülmemişse platform tarifesini kullanır", () => {
    const result = buildProductCostBreakdown({
      ...base,
      platform_fit: ["Hepsiburada"],
    });
    expect(result.delivery).toMatchObject({
      min: 1,
      max: 3,
      basis: "model",
      source: "Platform teslimat tarifesi",
    });
  });
});
