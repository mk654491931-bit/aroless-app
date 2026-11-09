import { describe, expect, it } from "vitest";

import { completeDeepDive } from "./deep-dive-complete";
import type { WinningProduct } from "./gemini.functions";

const base = {
  name: "Maison Lure Makyaj & Takı Organizeri",
  description: "Hepsiburada üzerinden ölçüldü.",
  why_winning: "Ölçülmüş fiyat ve görsel kanıtı var.",
  target_audience: "",
  ad_angles: [],
  supplier_price_usd: "",
  selling_price_usd: "$42.02",
  profit_margin_pct: 0,
  startup_cost_usd: "",
  platform_fit: ["Hepsiburada"],
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
  trend_score: 50,
  emoji: "📦",
  supplier_evidence: null,
  measured: {
    rating: null,
    ratingCount: null,
    salesVolume: null,
    viewed90d: null,
  },
} as unknown as WinningProduct;

describe("completeDeepDive", () => {
  it("eski plan bölümlerini kaynak etiketli model çıktısıyla doldurur", () => {
    const out = completeDeepDive(base);

    expect(out.launch_roadmap).toHaveLength(3);
    expect(out.launch_roadmap?.every((phase) => (phase.actions ?? []).length > 0)).toBe(true);
    expect(out.content_calendar).toHaveLength(4);
    expect(out.financial_projection).toHaveLength(3);
    expect(out.financial_projection?.[0]?.units).toBeGreaterThan(0);
    expect(out.financial_projection?.[0]?.revenue_usd).toMatch(/^\$/);
    expect(out.market_saturation).toMatchObject({
      score: 55,
      active_sellers: "Canlı satıcı sayısı ölçülmedi",
    });
    expect(out.pricing_ladder).toHaveLength(3);
    expect(out.scaling_playbook).toContain("model planı");
    expect(out.exit_criteria).toHaveLength(3);
  });

  it("tedarik eşleşmediğinde tedarikçi adı/fiyatı uydurmaz", () => {
    const out = completeDeepDive(base);

    expect(out.supplier_shortlist).toBeUndefined();
    expect(out.supplier_evidence).toBeNull();
    expect(out.supplier_price_usd).toBe("");
    expect(out.cost_breakdown.supplier_cost).toBe("");
    expect(out.cost_breakdown.net_profit).toBe("");
  });

  it("mevcut AI planını ve projeksiyonunu ezmez", () => {
    const existing = {
      ...base,
      launch_roadmap: [
        {
          phase: "Mevcut faz",
          days: "Gün 1-3",
          actions: ["Mevcut aksiyon"],
          budget_usd: "$10",
          kpi: "Mevcut KPI",
        },
      ],
      financial_projection: [
        {
          month: "1. Ay",
          units: 7,
          revenue_usd: "$294.14",
          ad_spend_usd: "$10.00",
          net_profit_usd: "$50.00",
        },
      ],
    } as WinningProduct;

    const out = completeDeepDive(existing);

    expect(out.launch_roadmap?.[0]?.phase).toBe("Mevcut faz");
    expect(out.launch_roadmap?.[0]?.actions).toEqual(["Mevcut aksiyon"]);
    // Eksik fazlar tamamlanır; mevcut faz ve mevcut ay korunur.
    expect(out.launch_roadmap).toHaveLength(3);
    expect(out.financial_projection?.[0]).toEqual(existing.financial_projection?.[0]);
    expect(out.financial_projection).toHaveLength(3);
  });

  it("satış fiyatı yoksa finansal projeksiyon üretmez", () => {
    const out = completeDeepDive({ ...base, selling_price_usd: "" } as WinningProduct);

    expect(out.financial_projection).toBeUndefined();
    expect(out.pricing_ladder).toBeUndefined();
    // Plan ve içerik takvimi fiyat olmadan da üretilebilir; bütçe ölçülmedi der.
    expect(out.launch_roadmap).toHaveLength(3);
    expect(out.launch_roadmap?.[0]?.budget_usd).toBe("Model bütçesi ölçülmedi");
  });

  it("girdi ürününü mutasyona uğratmaz", () => {
    completeDeepDive(base);

    expect(base.launch_roadmap).toBeUndefined();
    expect(base.financial_projection).toBeUndefined();
    expect(base.market_saturation).toBeUndefined();
  });
});
