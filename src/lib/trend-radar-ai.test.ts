// Trend Radar AI füzyonu — sağlayıcılar ve ölçülmüş sinyal koruma sözleşmesi.
//
// Ağ çağrısı YOK: altı sağlayıcının yanıtları mock'lanır. Test, eski hatanın
// geri gelmemesini doğrular: yalnız 4 motor değil, tanımlı TÜM sağlayıcılar
// denenir; ayrıca AI'ın atladığı ölçülmüş bir trend listeden düşmez.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPoolCooldowns } from "./ai-pool.server";

const aiMocks = vi.hoisted(() => ({
  callGemini: vi.fn(),
  callGroq: vi.fn(),
  callOpenRouter: vi.fn(),
  callSweepProvider: vi.fn(),
  callLovableAI: vi.fn(),
}));

vi.mock("./ai.server", () => ({
  callGemini: aiMocks.callGemini,
  callGroq: aiMocks.callGroq,
  callLovableAI: aiMocks.callLovableAI,
  callSweepProvider: aiMocks.callSweepProvider,
  hasGateway: () => false,
  withDeadline: <T>(promise: Promise<T>) => promise,
  extractJson: <T>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  },
}));

vi.mock("./tools-ai.server", () => ({
  callOpenRouter: aiMocks.callOpenRouter,
}));

import { runDeepAnalysis, type ScrapedTrend } from "./trend-radar.server";

const trend = (over: Partial<ScrapedTrend>): ScrapedTrend => ({
  id: Math.random().toString(36).slice(2),
  source: "Google",
  kind: "scrape",
  trend_name: "portable blender",
  category: "Home",
  region: "US",
  metrics: { search_volume: 50000, growth_rate: 120, rank: 1 },
  scraped_at: "2026-11-02T00:00:00.000Z",
  raw_payload: {},
  ...over,
});

const json = (value: unknown) => JSON.stringify(value);

describe("Trend Radar çok sağlayıcılı AI füzyonu", () => {
  beforeEach(() => {
    resetPoolCooldowns();
    for (let i = 1; i <= 5; i++) {
      vi.stubEnv(`GEMINI_API_KEY_${i}`, `g${i}`);
      vi.stubEnv(`GROQ_API_KEY_${i}`, `q${i}`);
      vi.stubEnv(`OPENROUTER_API_KEY_${i}`, `o${i}`);
      vi.stubEnv(`HF_TOKEN_${i}`, `h${i}`);
    }
    vi.stubEnv("CEREBRAS_API_KEY", "c1");
    vi.stubEnv("SAMBANOVA_API_KEY", "s1");

    aiMocks.callGemini.mockResolvedValue(
      json({
        summary: "Portable blender iki platformda yükseliyor; yaz sezonu riski %18.",
        breakouts: [
          {
            trend_name: "Portable Blender",
            sources: ["Google", "TikTok"],
            ai_demand_score: 80,
            signal: "verified",
            confidence: 70,
            reasoning: "Google hacmi 90 B, TikTok büyümesi %160 ölçüldü.",
            sentiment: "positive",
            hooks: ["Yaz için hazır"],
            persona: "Seyahat eden sağlıklı yaşam alıcısı",
            positioning: "Çantasına sığan mutfak",
            ad_copy: "Her yerde taze smoothie.",
          },
        ],
        noise_filtered: ["siyasi gündem"],
        correlations: [{ theme: "mutfak", platforms: ["Google", "TikTok"], note: "ortak" }],
      }),
    );
    aiMocks.callGroq.mockResolvedValue(
      json({
        summary: "Kısa özet.",
        breakouts: [
          {
            trend_name: "Portable Blender",
            sources: ["Amazon"],
            ai_demand_score: 60,
            signal: "watch",
            confidence: 50,
            reasoning: "Amazon sıralaması 4.",
            sentiment: "neutral",
            hooks: [],
            persona: "",
            positioning: "",
            ad_copy: "",
          },
          {
            trend_name: "neck fan",
            sources: ["Amazon"],
            ai_demand_score: 90,
            signal: "verified",
            confidence: 72,
            reasoning: "Amazon movers listesinde 1.",
            sentiment: "positive",
            hooks: ["Sıcakta serin kal"],
            persona: "Ofis çalışanı",
            positioning: "Taşınabilir serinlik",
            ad_copy: "Boynunda klima.",
          },
        ],
        noise_filtered: [],
        correlations: [{ theme: "serinlik", platforms: ["Amazon"], note: "tek platform" }],
      }),
    );
    aiMocks.callOpenRouter.mockRejectedValue(new Error("quota"));
    aiMocks.callSweepProvider.mockRejectedValue(new Error("quota"));
    aiMocks.callLovableAI.mockRejectedValue(new Error("quota"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPoolCooldowns();
    vi.clearAllMocks();
  });

  it("anahtar yoksa ağ çağrısı yapmadan yerel senteze düşer", async () => {
    vi.unstubAllEnvs();
    resetPoolCooldowns();
    const result = await runDeepAnalysis(
      [trend({ trend_name: "portable blender" })],
      "deep",
      "US",
      "Home",
    );
    expect(result.engines).toEqual(["deterministic"]);
    expect(aiMocks.callGemini).not.toHaveBeenCalled();
    expect(aiMocks.callGroq).not.toHaveBeenCalled();
  });

  it("altı sağlayıcıyı dener, skorları birleştirir ve yerel sinyali korur", async () => {
    const result = await runDeepAnalysis(
      [
        trend({ trend_name: "portable blender", source: "Google" }),
        trend({
          trend_name: "Portable Blender",
          source: "TikTok",
          metrics: { search_volume: 90000, growth_rate: 160, rank: 1 },
        }),
        trend({
          trend_name: "neck fan",
          source: "Amazon",
          metrics: { search_volume: 30000, growth_rate: 40, rank: 5 },
        }),
        trend({
          trend_name: "cat scratching board",
          source: "Amazon",
          metrics: { search_volume: 7000, growth_rate: 55, rank: 9 },
        }),
      ],
      "deep",
      "US",
      "Home",
    );

    // Tanımlı altı sağlayıcı çağrıldı; cevap verenler listede.
    expect(aiMocks.callGemini).toHaveBeenCalledTimes(1);
    expect(aiMocks.callGroq).toHaveBeenCalledTimes(1);
    expect(aiMocks.callOpenRouter).toHaveBeenCalledTimes(1);
    expect(aiMocks.callSweepProvider).toHaveBeenCalledTimes(3);
    expect(result.engines).toEqual(["gemini", "groq"]);

    const blender = result.breakouts.find((b) => /blender/i.test(b.trend_name))!;
    // İki motorun 80 + 60 puanı ortalanır; kaynaklar birleşir.
    expect(blender.ai_demand_score).toBe(70);
    expect(blender.sources.sort()).toEqual(["Amazon", "Google", "TikTok"]);

    // AI bir ölçülmüş trendi atlarsa yerel motor onu korur.
    const cat = result.breakouts.find((b) => /cat scratching/i.test(b.trend_name));
    expect(cat).toBeTruthy();
    expect(cat!.reasoning).toContain("Ölçülmüş sinyal korundu.");
    expect(cat!.hooks).toEqual([]);

    // En uzun/nitelikli özet seçilir, gürültü ve korelasyon birleşir.
    expect(result.summary).toContain("Portable blender");
    expect(result.noise_filtered).toContain("siyasi gündem");
    expect(result.correlations.map((c) => c.theme)).toEqual(
      expect.arrayContaining(["mutfak", "serinlik"]),
    );
  });
});
