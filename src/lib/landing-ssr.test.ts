/**
 * GİRİŞ SAYFASININ SUNUCUDA ÇİZİLMESİ (SEO) regresyon testi.
 *
 * Ölçülen kusur (düzeltmeden önce): `/` rotası `ssr: false` idi. Sitemap'te
 * priority 1.0 olan tek sayfa buydu ama crawler'a giden HTML boş bir kabuktu
 * (`<div class="page-fade"></div>`); sayfa metni yalnız JS çalıştıktan sonra
 * oluşuyordu. Sosyal önizleme botları ve JS çalıştırmayan crawler'lar için
 * site "içeriksiz" görünüyordu.
 *
 * Kural: (1) rota SSR'lı kalmalı, (2) yükleme dalı da landing'i çizmeli —
 * aksi hâlde sunucu yine boş/spinner HTML'i gönderir, (3) landing bileşeni
 * render sırasında tarayıcı API'lerine dokunmamalı (SSR'ı çökertmesin).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

const indexRoute = read("src/routes/index.tsx");
const landing = read("src/components/marketing-landing.tsx");
const sitemap = read("src/routes/sitemap[.]xml.ts");

describe("/ rotası sunucuda çizilir", () => {
  it("ssr kapatılmamış", () => {
    expect(indexRoute).not.toContain("ssr: false");
  });

  it("yükleme dalı spinner DEĞİL landing çizer (SSR'da içerik çıksın)", () => {
    expect(indexRoute).toContain("if (loading || !user) return <MarketingLanding />;");
    // Sunucu oturumu göremez: `loading` true iken boş kare gönderilmemeli.
    expect(indexRoute).not.toMatch(/if \(loading\) \{\s*return \(\s*<div[^>]*min-h-screen/);
  });

  it("landing bileşeni render sırasında tarayıcı API'si kullanmaz", () => {
    const renderBody = landing.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(renderBody).not.toMatch(/\bwindow\./);
    expect(renderBody).not.toMatch(/\bdocument\./);
    expect(renderBody).not.toMatch(/\blocalStorage\b/);
    expect(renderBody).not.toMatch(/\bnavigator\./);
  });

  it("sitemap hâlâ / adresini 1.0 önceliğiyle listeler", () => {
    expect(sitemap).toMatch(/\{\s*path: "\/",\s*changefreq: "weekly",\s*priority: "1\.0"\s*\}/);
    expect(sitemap).toContain("siteBaseUrl(request)");
  });
});
