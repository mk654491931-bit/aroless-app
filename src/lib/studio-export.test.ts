import { describe, expect, it } from "vitest";
import type { CreativeKit } from "./creative-studio.server";
import { buildStudioMarkdown } from "./studio-export";

const kit: CreativeKit = {
  positioning: "Isıtmalı boyun yastığı",
  audience: "Masa başı çalışanlar",
  hooks: [{ angle: "Ağrı", hook: "Boynunuz her gün ağrıyor mu?", why: "Acıyı hedefler." }],
  ugc_script: {
    title: "Sabah rutini",
    duration_seconds: 30,
    scenes: [
      {
        second: "0-3",
        visual: "Ofiste boyun tutma",
        voiceover: "Sabah boynunuz tutuluyor mu?",
        text_overlay: "30 saniyede rahatla",
      },
    ],
    cta: "Şimdi keşfet",
  },
  ad_copies: [
    {
      platform: "TikTok",
      headline: "Boyun ağrısına ara",
      primary: "Isı 3 kademe.",
      description: "Taşınabilir.",
      cta: "Satın al",
    },
  ],
  image_prompts: [{ label: "Kahraman görsel", prompt: "Sıcak ışıklı masa" }],
  hashtags: ["#boyun", "#wellness"],
  ab_tests: [
    { hypothesis: "Acı açısı daha iyi", variant_a: "Acı", variant_b: "Rahatlama", metric: "CTR" },
  ],
  email_sms: { subject: "Boynunuz rahat olsun", body: "Yeni nesil ısıtma.", sms: "Kısa mesaj" },
  meta: { engines: ["gemini", "groq"], coverage: 92, missing_sections: [], repaired: false },
};

describe("buildStudioMarkdown", () => {
  it("tüm kit bölümlerini tek belgeye taşır", () => {
    const md = buildStudioMarkdown({
      product_name: "Isıtmalı Boyun Yastığı",
      platform: "TikTok",
      payload: kit,
      created_at: "2026-11-26T20:00:00.000Z",
    });
    expect(md).toContain("# Kreatif Paket — Isıtmalı Boyun Yastığı");
    expect(md).toContain("## Hook'lar");
    expect(md).toContain("| 0-3s | Ofiste boyun tutma |");
    expect(md).toContain("| TikTok | Boyun ağrısına ara |");
    expect(md).toContain("## A/B testleri");
    expect(md).toContain("**SMS:** Kısa mesaj");
    expect(md).not.toContain("\n\n\n");
  });

  it("boş pakette başlıkları uydurmaz", () => {
    const md = buildStudioMarkdown({
      product_name: "Boş ürün",
      platform: "Meta",
      payload: {
        positioning: "",
        audience: "",
        hooks: [],
        ugc_script: { title: "", duration_seconds: 30, scenes: [], cta: "" },
        ad_copies: [],
        image_prompts: [],
        hashtags: [],
        ab_tests: [],
        email_sms: { subject: "", body: "", sms: "" },
      },
    });
    expect(md).not.toContain("## Hook'lar");
    expect(md).not.toContain("## A/B testleri");
    expect(md).toContain("## Konumlandırma");
  });
});
