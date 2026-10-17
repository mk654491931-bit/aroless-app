// BULUCU HERO — render testi.
//
// NEDEN VAR: ana sayfanın başlık bloğu yeniden düzenlendi. Bu test, metnin
// gerçekten ÇEVİRİ anahtarlarından geldiğini (sabit Türkçe metin gömülmediğini),
// dört güven çipinin de basıldığını ve premium hareketin dayandığı süs
// öğelerinin ekran okuyuculardan gizli olduğunu sabitler.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `[${key}]`,
  }),
}));

import { FinderHero } from "./finder-hero";

const html = () => renderToStaticMarkup(<FinderHero />);

describe("FinderHero", () => {
  it("başlığı çeviri anahtarlarından basar (gömülü metin yok)", () => {
    const out = html();
    expect(out).toContain("[hero_1]");
    expect(out).toContain("[hero_2]");
    // Başlık metni tek bir h1 içinde ve iki ayrı satır olarak durur.
    expect(out).toContain("<h1");
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("canlı araştırma rozetini ve kurumsal kimlik satırını basar", () => {
    const out = html();
    expect(out).toContain("[ui.live_research]");
    expect(out).toContain("[common.app_name]");
    expect(out).toContain("[common.tagline]");
  });

  it("dört güven çipini de basar", () => {
    const out = html();
    for (const key of ["ui.f1", "ui.f2", "ui.f3", "ui.f4"]) {
      expect(out).toContain(`[${key}]`);
    }
  });

  it("marka gradyanı sınıfını taşır (premium tipografi kancası)", () => {
    expect(html()).toContain("finder-hero-phrase");
  });

  it("süs öğeleri (dikey çizgi + hairline) ekran okuyucudan gizli", () => {
    const out = html();
    expect(out).toContain('aria-hidden="true" class="finder-hero-bar"');
    expect(out).toContain("finder-hero-rule");
    // Dekoratif çizgi ve rozet noktası için metin yok.
    expect(out.match(/aria-hidden="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
