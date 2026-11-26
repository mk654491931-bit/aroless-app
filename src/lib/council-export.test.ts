import { describe, expect, it } from "vitest";
import type { CouncilReport } from "./council.server";
import { buildCouncilMarkdown } from "./council-export";

function report(overrides: Partial<CouncilReport> = {}): CouncilReport {
  return {
    query: "portable blender",
    country: "US",
    velora_score: 78,
    verdict: "GO",
    executive_report: "Talep güçlü, marj savunulabilir.",
    teams: [
      {
        team: "market",
        title: "Trend Ekibi",
        score: 82,
        engine: "gemini",
        summary: "Arama ilgisi yükseliyor.",
        bullets: ["TikTok'ta hızlanıyor"],
        metrics: [{ label: "Momentum", value: "+42%" }],
        raw_score: 80,
        review_score: 82,
        reviewer_engine: "groq",
        review_note: "Kanıt yeterli.",
        weight: 30,
        confidence: 84,
      },
    ],
    director_engine: "gemini",
    auditor_engine: "openrouter",
    auditor_score: 76,
    auditor_note: "Skor hafif iyimser.",
    action_plan: ["İlk 50 adetle test et"],
    risks: ["Navlun artışı"],
    signals: {
      keyword: "portable blender",
      country: "US",
      trends: { yearly: [], monthly: [50, 70], momentum_pct: 40, source: "google-trends" },
      reddit: [
        {
          title: "Best blender | test",
          subreddit: "BuyItForLife",
          score: 120,
          comments: 8,
          url: "https://reddit.com/r/BuyItForLife/x",
        },
      ],
      tiktok: [],
      amazon: [],
      google_rising: [],
      radar: [],
      github: [],
      sources: [{ name: "Google Trends", status: "active", items: 12 }],
      collected_at: new Date().toISOString(),
    },
    cache_hit: false,
    generated_at: "2026-11-26T20:00:00.000Z",
    data_coverage: 72,
    confidence: 81,
    disagreement: 9,
    kill_criteria: ["İlk 60 günde iade %8'i geçerse"],
    opportunity_window: "6-8 hafta",
    alt_market: "Kanada",
    depth: "full",
    skipped_stages: ["auditor"],
    ...overrides,
  };
}

describe("buildCouncilMarkdown", () => {
  it("skoru, ekipleri ve aksiyonları tek belgede toplar", () => {
    const md = buildCouncilMarkdown(report());
    expect(md).toContain("# AI Konsey Raporu — portable blender");
    expect(md).toContain("- **Aroless Score:** 78/100");
    expect(md).toContain("### Trend Ekibi — 82/100");
    expect(md).toContain("| Momentum | +42% |");
    expect(md).toContain("İlk 50 adetle test et");
    expect(md).toContain("| Google Trends | active | 12 |");
  });

  it("tablo hücrelerindeki boru karakterini kaçırır", () => {
    const md = buildCouncilMarkdown(
      report({
        query: "blender | pro",
        teams: [
          {
            ...report().teams[0],
            title: "Trend | Ekip",
            review_note: "satır\nsonu",
          },
        ],
      }),
    );
    expect(md).toContain("Trend \\| Ekip");
    expect(md).toContain("satır sonu");
  });

  it("boş bölümleri başlık olarak basmaz", () => {
    const md = buildCouncilMarkdown(
      report({ action_plan: [], risks: [], kill_criteria: [], signals: undefined as never }),
    );
    expect(md).not.toContain("## Aksiyon planı");
    expect(md).not.toContain("## Veri hatları");
    expect(md).toContain("## Ekipler");
  });
});
