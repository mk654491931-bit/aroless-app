import { describe, it, expect } from "vitest";
import {
  computeWinnerScore,
  evidenceLabel,
  evidenceStyle,
  attachWinnerScores,
} from "./winner-score";
import type { MarketEvidence } from "./market-evidence";

describe("computeWinnerScore", () => {
  it("returns a score between 0 and 100", () => {
    const result = computeWinnerScore({
      name: "Test Product",
      description: "A test product",
      selling_price_usd: "$29.99",
      supplier_price_usd: "$5.00",
      competition_level: "Medium",
      trend_score: 70,
      profit_margin_pct: 40,
    });

    expect(result.winner_score).toBeGreaterThanOrEqual(0);
    expect(result.winner_score).toBeLessThanOrEqual(100);
  });

  it("returns a valid verdict", () => {
    const result = computeWinnerScore({
      name: "Great Product",
      description: "Amazing product",
      selling_price_usd: "$49.99",
      supplier_price_usd: "$8.00",
      competition_level: "Low",
      trend_score: 85,
      profit_margin_pct: 55,
      differentiation: ["Unique design", "Better quality"],
      review_pain_points: [{ complaint: "Bad quality", fix: "Use better materials" }],
      bundles: [{ name: "Bundle", contents: "Product + accessories", price_usd: "$59.99", why: "Higher AOV" }],
    });

    expect(["Kazanan", "Güçlü aday", "Riskli", "Zayıf"]).toContain(result.verdict);
  });

  it("has 6 score components", () => {
    const result = computeWinnerScore({
      name: "Test",
      selling_price_usd: "$30",
      supplier_price_usd: "$5",
      competition_level: "Medium",
      trend_score: 60,
    });

    expect(result.components).toHaveLength(6);
    expect(result.components.map((c) => c.key)).toEqual([
      "demand",
      "margin",
      "competition",
      "evidence",
      "differentiation",
      "logistics",
    ]);
  });

  it("penalizes bulky products in logistics", () => {
    const bulky = computeWinnerScore({
      name: "Large Sofa Couch",
      description: "A big sofa",
      selling_price_usd: "$500",
      supplier_price_usd: "$150",
      competition_level: "Medium",
      trend_score: 60,
    });

    const normal = computeWinnerScore({
      name: "Phone Case",
      description: "A phone case",
      selling_price_usd: "$15",
      supplier_price_usd: "$2",
      competition_level: "Medium",
      trend_score: 60,
    });

    const bulkyLogistics = bulky.components.find((c) => c.key === "logistics");
    const normalLogistics = normal.components.find((c) => c.key === "logistics");

    expect(bulkyLogistics!.score).toBeLessThan(normalLogistics!.score);
  });

  it("penalizes regulated products", () => {
    const result = computeWinnerScore({
      name: "Lithium Battery Pack",
      description: "A battery",
      selling_price_usd: "$30",
      supplier_price_usd: "$8",
      competition_level: "Medium",
      trend_score: 70,
    });

    expect(result.penalties.length).toBeGreaterThan(0);
    expect(result.penalties.some((p) => p.includes("Mevzuat"))).toBe(true);
  });

  it("penalizes fragile products in logistics", () => {
    const fragile = computeWinnerScore({
      name: "porselen bardak seti",
      description: "Ceramic cup set",
      selling_price_usd: "$40",
      supplier_price_usd: "$10",
      competition_level: "Medium",
      trend_score: 60,
    });

    const normal = computeWinnerScore({
      name: "Silicone Kitchen Utensil",
      description: "Flexible kitchen tool",
      selling_price_usd: "$15",
      supplier_price_usd: "$3",
      competition_level: "Medium",
      trend_score: 60,
    });

    const fragileLogistics = fragile.components.find((c) => c.key === "logistics");
    const normalLogistics = normal.components.find((c) => c.key === "logistics");

    // Porselen (ceramic) should be penalized more than silicone
    expect(fragileLogistics!.score).toBeLessThanOrEqual(normalLogistics!.score);
  });

  it("gives higher scores with viral proof", () => {
    const withViral = computeWinnerScore({
      name: "Viral Gadget",
      description: "Trending gadget",
      selling_price_usd: "$25",
      supplier_price_usd: "$4",
      competition_level: "Low",
      trend_score: 80,
      viral_proof: [{ url: "https://tiktok.com/video/123", views: "5M" }],
    });

    const withoutViral = computeWinnerScore({
      name: "Regular Gadget",
      description: "Normal gadget",
      selling_price_usd: "$25",
      supplier_price_usd: "$4",
      competition_level: "Low",
      trend_score: 80,
    });

    expect(withViral.winner_score).toBeGreaterThanOrEqual(withoutViral.winner_score);
  });

  it("handles empty/minimal product gracefully", () => {
    const result = computeWinnerScore({});
    expect(result.winner_score).toBeGreaterThanOrEqual(0);
    expect(result.winner_score).toBeLessThanOrEqual(100);
    expect(result.components).toHaveLength(6);
  });
});

describe("evidenceLabel", () => {
  it("returns correct labels", () => {
    expect(evidenceLabel("verified")).toBe("Doğrulanmış");
    expect(evidenceLabel("partial")).toBe("Kısmen doğrulanmış");
    expect(evidenceLabel("ai_only")).toBe("Yalnızca AI tahmini");
  });
});

describe("evidenceStyle", () => {
  it("returns emerald for verified", () => {
    expect(evidenceStyle("verified")).toContain("emerald");
  });

  it("returns amber for partial", () => {
    expect(evidenceStyle("partial")).toContain("amber");
  });

  it("returns rose for ai_only", () => {
    expect(evidenceStyle("ai_only")).toContain("rose");
  });
});

describe("viral kanıt yalnızca DOĞRULANDIYSA puanlanır (uydurma kanıt koruması)", () => {
  /** Canlı doğrulama katmanının ürettiği kanıt bloğu (tüm alanlar zorunlu). */
  function evidence(over: Partial<MarketEvidence> = {}): MarketEvidence {
    return {
      trend_monthly: [],
      trend_yearly: [],
      trend_momentum_pct: 12,
      trend_source: "google-trends",
      supplier_price_usd: 5,
      supplier_shipping_usd: 2,
      supplier_source: "aliexpress",
      sellers: [],
      market_price_usd: 30,
      price_delta_pct: 5,
      verified_signals: [],
      unverified_signals: [],
      checked_at: new Date(0).toISOString(),
      ...over,
    };
  }
  const base = {
    name: "Test Product",
    selling_price_usd: "$30",
    supplier_price_usd: "$5",
    competition_level: "Medium",
    trend_score: 70,
  };
  const demandOf = (p: Parameters<typeof computeWinnerScore>[0]) =>
    computeWinnerScore(p).components.find((c) => c.key === "demand")?.score ?? 0;
  const fakeViral = { viral_proof: [{ url: "https://www.tiktok.com/@ghost/video/0000000000" }] };

  it("adres açılamadıysa (viral_verified false) bonus VERİLMEZ", () => {
    const unverified = demandOf({ ...base, ...fakeViral, market_evidence: evidence() });
    const verified = demandOf({
      ...base,
      ...fakeViral,
      market_evidence: evidence({ viral_verified: true }),
    });
    expect(verified).toBeGreaterThan(unverified);
  });

  it("canlı doğrulama hiç çalışmadıysa (market_evidence yok) bonus VERİLMEZ", () => {
    const noEvidence = demandOf({ ...base, ...fakeViral });
    const viralVerified = demandOf({
      ...base,
      ...fakeViral,
      market_evidence: evidence({ viral_verified: true }),
    });
    expect(noEvidence).toBeLessThan(viralVerified);
  });

  it("viral kanıt doğrulanınca talep gerekçesi bunu açıkça söyler", () => {
    const breakdown = computeWinnerScore({
      ...base,
      ...fakeViral,
      market_evidence: evidence({ viral_verified: true }),
    });
    const demand = breakdown.components.find((c) => c.key === "demand");
    expect(demand?.reason).toContain("doğrulandı");
    const viralMetric = demand?.evidence?.find((e) => e.metric === "Viral kanıt");
    expect(viralMetric?.verified).toBe(true);
  });

  it("doğrulanmamış adres kanıt olarak LİNKLENMEZ", () => {
    const breakdown = computeWinnerScore({
      ...base,
      ...fakeViral,
      market_evidence: evidence(),
    });
    const viralMetric = breakdown.components
      .find((c) => c.key === "demand")
      ?.evidence?.find((e) => e.metric === "Viral kanıt");
    expect(viralMetric?.verified).toBe(false);
    expect(viralMetric?.url).toBeUndefined();
  });
});

describe("attachWinnerScores", () => {
  it("adds scores to products without winner_score", () => {
    const products = [
      { name: "Product A", selling_price_usd: "$30", supplier_price_usd: "$5" },
      { name: "Product B", selling_price_usd: "$20", supplier_price_usd: "$3" },
    ];

    const scored = attachWinnerScores(products) as Array<{ winner_score?: number; score_breakdown?: unknown }>;

    expect(scored).toHaveLength(2);
    expect(scored[0].winner_score).toBeDefined();
    expect(scored[0].score_breakdown).toBeDefined();
    expect(scored[1].winner_score).toBeDefined();
  });

  it("preserves existing winner_score", () => {
    const products = [
      {
        name: "Scored Product",
        winner_score: 85,
        score_breakdown: { winner_score: 85, components: [], evidence_level: "verified" as const, penalties: [], flags: [], verdict: "Kazanan" as const },
      },
    ];

    const scored = attachWinnerScores(products) as Array<{ winner_score?: number }>;
    expect(scored[0].winner_score).toBe(85);
  });
});
