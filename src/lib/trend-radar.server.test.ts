import { describe, expect, it } from "vitest";
import { localSynthesis, type ScrapedTrend } from "./trend-radar.server";

const trend = (over: Partial<ScrapedTrend>): ScrapedTrend => ({
  id: Math.random().toString(36).slice(2),
  source: "Google",
  kind: "scrape",
  trend_name: "portable blender",
  category: "General",
  region: "US",
  metrics: { search_volume: 50000, growth_rate: 120, rank: 1 },
  scraped_at: "2026-11-01T00:00:00.000Z",
  raw_payload: {},
  ...over,
});

describe("localSynthesis — AI yokken Trend Radar boş kalmaz", () => {
  it("ölçülmüş hacim/büyümeyi kullanır, kaynakları birleştirir ve NaN üretmez", () => {
    const result = localSynthesis(
      [
        trend({ trend_name: "portable blender", source: "Google" }),
        trend({ trend_name: "Portable Blender", source: "TikTok", metrics: { search_volume: 90000, growth_rate: 160, rank: 2 } }),
        trend({ trend_name: "neck fan", source: "Amazon", metrics: { search_volume: 30000, growth_rate: 40, rank: 5 } }),
        trend({ trend_name: "siyasi gündem", source: "Google", metrics: { search_volume: 2000, growth_rate: -30, rank: 9 } }),
      ],
      "fast",
      "US",
      "General",
    );

    expect(result.engines).toEqual(["deterministic"]);
    expect(result.breakouts.length).toBeGreaterThan(0);
    expect(result.breakouts.every((b) => Number.isFinite(b.ai_demand_score))).toBe(true);
    expect(result.breakouts.every((b) => Number.isFinite(b.confidence))).toBe(true);

    const blender = result.breakouts.find((b) => /blender/i.test(b.trend_name));
    expect(blender).toBeTruthy();
    // Aynı ürün iki platformda: kaynaklar birleşir, çapraz sinyal bonusu gelir.
    expect(blender!.sources.sort()).toEqual(["Google", "TikTok"]);
    expect(blender!.reasoning).toMatch(/90\s*B/);
    expect(result.scores[blender!.trend_name]).toBe(blender!.ai_demand_score);

    // Negatif büyüme gürültüye yazılır, breakout'a girmez.
    expect(result.noise_filtered.join(" ")).toContain("siyasi gündem");
    expect(result.breakouts.some((b) => b.trend_name === "siyasi gündem")).toBe(false);
  });

  it("aynı temayı iki platformda bulunca korelasyon üretir", () => {
    const result = localSynthesis(
      [
        trend({ trend_name: "cat scratching board", source: "Amazon" }),
        trend({ trend_name: "cat scratching pad", source: "TikTok" }),
      ],
      "deep",
      "US",
      "Pet",
    );
    expect(result.correlations.length).toBeGreaterThan(0);
    expect(result.correlations[0]!.platforms.length).toBeGreaterThanOrEqual(2);
  });

  it("boş sinyalde uydurma ürün üretmez", () => {
    const result = localSynthesis([], "fast", "US", "General");
    expect(result.breakouts).toEqual([]);
    expect(result.scores).toEqual({});
    expect(result.summary).toContain("0 canlı sinyal");
  });
});
