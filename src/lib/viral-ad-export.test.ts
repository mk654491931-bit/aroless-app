import { describe, expect, it } from "vitest";
import type { GeneratedViralAd } from "./viral_ads.functions";
import { buildViralAdMarkdown, buildViralAdText } from "./viral-ad-export";

const result: GeneratedViralAd = {
  metrics: {
    engagement_pct: 5,
    views_per_hour: 1200,
    age_hours: 48,
    duration_fit: 80,
    virality_score: 78,
    format: "demo",
    verdict: "yükselen",
    engagement_estimated: false,
  },
  source_numbers: "100.000 izlenme · %5 etkileşim",
  hook_variants: ["Bunu görünce şaşıracaksın", "Üç saniyede anlatıyorum"],
  script: [
    {
      second: "0-3",
      visual: "Ürün elde",
      voiceover: "Bunu görünce şaşıracaksın",
      text_overlay: "3 saniyede",
    },
  ],
  cta: "Şimdi dene",
  targeting: "25-34, mobil",
  why: "Ölçülen hız yüksek.",
  predicted: { hook_rate: "%28-34", ctr: "%2-3", cpm: "$8-12" },
  provider: "gemini",
};

const meta = { title: "Portable blender", niche: "Kitchen", platform: "TikTok" };

describe("viral-ad-export", () => {
  it("düz metinde hook, senaryo ve ölçülen referansı korur", () => {
    const text = buildViralAdText(meta, result);
    expect(text).toContain("HOOK: Bunu görünce şaşıracaksın");
    expect(text).toContain("0-3 | Ürün elde | VO:");
    expect(text).toContain("Ölçülen referans: 100.000 izlenme");
  });

  it("Markdown'da başlıkları ve çekim tablosunu üretir", () => {
    const md = buildViralAdMarkdown(meta, result);
    expect(md).toContain("# Viral Reklam Planı — Portable blender");
    expect(md).toContain("| Saniye | Görsel | Seslendirme | Ekran yazısı |");
    expect(md).toContain("| 0-3 | Ürün elde |");
    expect(md).toContain("## Beklenen bantlar");
  });

  it("boş isteğe bağlı alanlarda gereksiz satır bırakmaz", () => {
    const md = buildViralAdMarkdown(meta, result);
    expect(md).not.toContain("\n\n\n");
  });
});
