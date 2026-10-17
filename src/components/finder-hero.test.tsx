// BULUCU HERO — render testi.
//
// NEDEN VAR: ana sayfanın başlık bloğu ORTALANMIŞ premium bir kompozisyona
// çevrildi. Bu test, metnin gerçekten ÇEVİRİ anahtarlarından geldiğini (sabit
// Türkçe metin gömülmediğini), başlığın tek h1 içinde ortalandığını, dört güven
// çipinin basıldığını ve simetrik süslerin (yandaki çizgiler, elmas) ekran
// okuyuculardan gizli olduğunu sabitler.
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
  it("başlığı çeviri anahtarlarından basar ve ortalar (gömülü metin yok)", () => {
    const out = html();
    expect(out).toContain("[hero_1]");
    expect(out).toContain("[hero_2]");
    // Tek bir h1 ve kompozisyon ortalanmış.
    expect(out).toContain("<h1");
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
    expect(out).toContain("text-center");
  });

  it("canlı araştırma rozetini ve kurumsal kimlik satırını basar", () => {
    const out = html();
    expect(out).toContain("[ui.live_research]");
    expect(out).toContain("[app_name]");
    expect(out).toContain("[tagline]");
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

  it("çevre ışığı katmanı var, dekoratif ve metin taşımıyor", () => {
    const out = html();
    expect(out).toContain("finder-hero-aura");
    // Halo, başlık metinlerinden ÖNCE (arkasında) basılır ve aria-hidden'dır.
    expect(out.indexOf("finder-hero-aura")).toBeLessThan(out.indexOf("finder-hero-phrase"));
    expect(out).toMatch(/<span aria-hidden="true" class="finder-hero-aura"><\/span>/);
  });

  it("yavaş geçen ikinci ışık katmanı da dekoratif ve başlığın arkasında", () => {
    const out = html();
    expect(out).toContain("finder-hero-sweep");
    expect(out.indexOf("finder-hero-sweep")).toBeLessThan(out.indexOf("finder-hero-phrase"));
    expect(out).toMatch(/<span aria-hidden="true" class="finder-hero-sweep"><\/span>/);
  });

  it("canlı araştırma noktası ping katmanının kancasını taşır", () => {
    expect(html()).toContain("finder-hero-live-dot");
  });

  it("simetrik süsler (yandaki çizgiler + elmas + ortadan açılan hairline) gizli", () => {
    const out = html();
    expect(out).toContain("finder-hero-flank");
    // Sağdaki çizgi aynalanmış varyantı taşır (simetri).
    expect(out).toContain("finder-hero-flank-rev");
    expect(out).toContain("finder-hero-diamond");
    expect(out).toContain("finder-hero-rule");
    // Yandaki iki çizgi + elmas + alt çizgi + rozet noktası: hepsi aria-hidden.
    expect(out.match(/aria-hidden="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
