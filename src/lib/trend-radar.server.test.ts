import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availableTrendEngines,
  buildPrompt,
  localSynthesis,
  prepareTrendSignals,
  type ScrapedTrend,
} from "./trend-radar.server";
import { resetPoolCooldowns } from "./ai-pool.server";

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
        trend({
          trend_name: "Portable Blender",
          source: "TikTok",
          metrics: { search_volume: 90000, growth_rate: 160, rank: 2 },
        }),
        trend({
          trend_name: "neck fan",
          source: "Amazon",
          metrics: { search_volume: 30000, growth_rate: 40, rank: 5 },
        }),
        trend({
          trend_name: "siyasi gündem",
          source: "Google",
          metrics: { search_volume: 2000, growth_rate: -30, rank: 9 },
        }),
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

describe("Trend Radar AI sinyal hazırlığı", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPoolCooldowns();
  });

  it("aynı ürünü platformlar arasında tek sinyale indirger", () => {
    const signals = prepareTrendSignals([
      trend({
        trend_name: "Portable Blender",
        source: "Google",
        metrics: { search_volume: 50000, growth_rate: 120, rank: 4 },
      }),
      trend({
        trend_name: "portable blender",
        source: "TikTok",
        metrics: { search_volume: 90000, growth_rate: 160, rank: 1 },
      }),
      trend({
        trend_name: "neck fan",
        source: "Amazon",
        metrics: { search_volume: 30000, growth_rate: 40, rank: 5 },
      }),
    ]);

    expect(signals).toHaveLength(2);
    const blender = signals.find((s) => /blender/i.test(s.name))!;
    expect(blender.sources).toEqual(["Google", "TikTok"]);
    expect(blender.volume).toBe(90000);
    expect(blender.growth).toBe(160);
    expect(blender.rank).toBe(1);
    expect(blender.count).toBe(2);
  });

  it("prompt'a birleşik kaynakları ve GitHub kaynağını taşır", () => {
    const prompt = buildPrompt(
      [
        trend({ trend_name: "portable blender", source: "Google" }),
        trend({ trend_name: "Portable Blender", source: "TikTok" }),
      ],
      "deep",
      "US",
      "Home",
    );
    expect(prompt).toContain("sources=Google+TikTok");
    expect(prompt).toContain("GitHub");
    expect(prompt).toContain("DEDUPLICATED MULTI-PLATFORM SIGNALS");
  });

  it("tanımlı altı sağlayıcıyı deep modda, ilk üçünü fast modda kullanır", () => {
    vi.stubEnv("GEMINI_API_KEY_1", "g1");
    vi.stubEnv("GROQ_API_KEY_1", "q1");
    vi.stubEnv("OPENROUTER_API_KEY_1", "o1");
    vi.stubEnv("HF_TOKEN_1", "h1");
    vi.stubEnv("CEREBRAS_API_KEY", "c1");
    vi.stubEnv("SAMBANOVA_API_KEY", "s1");

    const deep = availableTrendEngines("deep").map((e) => e.name);
    expect(deep).toEqual(["gemini", "groq", "openrouter", "hf", "cerebras", "sambanova"]);
    expect(availableTrendEngines("fast").map((e) => e.name)).toEqual([
      "gemini",
      "groq",
      "openrouter",
    ]);
  });
});
