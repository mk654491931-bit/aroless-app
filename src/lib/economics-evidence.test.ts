import { describe, it, expect } from "vitest";

import {
  hasMeasuredEconomics,
  measuredMarginPct,
  measuredMoney,
} from "./economics-evidence";
import { enrichProduct, NOT_MEASURED } from "./recommendation";
import { netMarginView } from "@/features/finder/utils/export";
import type { WinningProduct } from "./gemini.functions";

/**
 * ÖLÇÜLMÜŞ GERÇEK (2026-10-03, ölçümlü keşif hattından gelen ürün):
 * fiyat + puan + satıcı ÖLÇÜLÜR, maliyet ÖLÇÜLMEZ. Hattın eski çıktısı
 * maliyet alanlarını boş bırakıyordu ama alt katmanlar onları "0" sayıyordu.
 */
function measuredOnlyProduct(overrides: Partial<WinningProduct> = {}): WinningProduct {
  return {
    name: "LED Masa Lambası",
    description: "Ölçülmüş satır",
    why_winning: "14 ajan puanı 71",
    target_audience: "",
    ad_angles: [],
    supplier_price_usd: "",
    selling_price_usd: "$24.99",
    profit_margin_pct: 0,
    startup_cost_usd: "",
    platform_fit: ["Trendyol"],
    platform_strategy: "",
    competitor_examples: [],
    supplier_links: [],
    alibaba_links: [],
    cost_breakdown: {
      supplier_cost: "",
      shipping_cost: "",
      platform_fee: "",
      ad_spend: "",
      net_profit: "",
      net_margin_pct: 0,
    },
    competition_level: "Medium",
    trend_score: 62,
    emoji: "📦",
    ...overrides,
  };
}

describe("measuredMoney", () => {
  it("metin biçimlerindeki tutarı okur", () => {
    expect(measuredMoney("$24.99")).toBeCloseTo(24.99);
    expect(measuredMoney("1.299,00")).toBeCloseTo(1299);
    expect(measuredMoney("1,299.00")).toBeCloseTo(1299);
    expect(measuredMoney(12)).toBe(12);
  });

  it("boş, çöp ve sıfır tutarı ÖLÇÜM saymaz", () => {
    expect(measuredMoney("")).toBeNull();
    expect(measuredMoney("  ")).toBeNull();
    expect(measuredMoney("belirtilmedi")).toBeNull();
    expect(measuredMoney(0)).toBeNull();
    expect(measuredMoney(-5)).toBeNull();
    expect(measuredMoney(null)).toBeNull();
    expect(measuredMoney(undefined)).toBeNull();
  });
});

describe("measuredMarginPct", () => {
  it("0 marjı ölçüm saymaz", () => {
    expect(measuredMarginPct(measuredOnlyProduct())).toBeNull();
  });

  it("gerçek marjı okur", () => {
    expect(
      measuredMarginPct({
        cost_breakdown: { net_margin_pct: 48 },
        profit_margin_pct: 0,
      }),
    ).toBe(48);
  });
});

describe("hasMeasuredEconomics", () => {
  it("yalnız fiyat/puan ölçülmüş üründe yanlış (maliyet ölçülmedi)", () => {
    expect(hasMeasuredEconomics(measuredOnlyProduct())).toBe(false);
  });

  it("gerçek maliyet girdisi varsa doğru", () => {
    expect(hasMeasuredEconomics(measuredOnlyProduct({ supplier_price_usd: "$7" }))).toBe(true);
  });
});

describe("ölçümlü hatta uydurma sayı üretilmez", () => {
  it("aylık satış/ciro/net kâr null döner (0 DEĞİL)", () => {
    const e = enrichProduct(measuredOnlyProduct());
    expect(e.est_monthly_sales).toBeNull();
    expect(e.est_monthly_revenue_usd).toBeNull();
    expect(e.est_monthly_net_profit_usd).toBeNull();
    expect(e.monthly_net_low_usd).toBeNull();
    expect(e.monthly_net_high_usd).toBeNull();
    expect(e.net_per_unit_usd).toBeNull();
  });

  it("marj ölçülmediği için ürün kırmızı 'Avoid' rozeti almaz", () => {
    const e = enrichProduct(
      measuredOnlyProduct({ competition_level: "High", trend_score: 20 }),
    );
    expect(e.recommendation).toBe("Watch");
  });

  it("kart '0% UNPROFITABLE' yazmaz", () => {
    expect(netMarginView(measuredOnlyProduct())).toEqual({ text: NOT_MEASURED, bad: false });
  });

  it("marj ölçülmüş klasik üründe hesap çalışır", () => {
    const view = netMarginView(
      measuredOnlyProduct({
        supplier_price_usd: "$7",
        cost_breakdown: {
          supplier_cost: "$7",
          shipping_cost: "$3",
          platform_fee: "$2",
          ad_spend: "$2",
          net_profit: "$10.99",
          net_margin_pct: 44,
        },
      }),
    );
    expect(view.text).toBe("44%");
    expect(view.bad).toBe(false);
  });

  it("eksik maliyet dökümünde kalan kalemleri TAHMİN edip net marj üretmez", () => {
    // Toptan ölçülür ama kargo/komisyon/reklam ölçülmez: eskiden
    // computeUnitEconomics bunları tahmin edip bir net marj üretiyordu.
    // Artık "—" döner — ölçülmemiş kalemi varsaymak uydurma olurdu.
    const view = netMarginView(
      measuredOnlyProduct({
        supplier_price_usd: "$5",
        cost_breakdown: {
          supplier_cost: "$5",
          shipping_cost: "",
          platform_fee: "",
          ad_spend: "",
          net_profit: "",
          net_margin_pct: 0,
        },
      }),
    );
    expect(view).toEqual({ text: NOT_MEASURED, bad: false });
  });
});
