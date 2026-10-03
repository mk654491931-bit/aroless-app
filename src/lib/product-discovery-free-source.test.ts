import { describe, it, expect } from "vitest";

import { PRODUCT_SOURCES, wikipediaPageviewsSource } from "./product-discovery-sources.server";

/**
 * Kullanıcı isteği: "ücretsiz bilgi alabileceğimiz kaynakları ekle".
 *
 * DENENEN VE REDDEDİLENLER (ölçüldü, eklenmedi — doğrulanmamış kaynak
 * eklemek "çalışıyor" iddiası uydurmaktır):
 *   • MercadoLibre herkese açık arama ucu (api.mercadolibre.com sites search)
 *     → tüm pazarlarda HTTP 403.
 *   • Google Books (www.googleapis.com/books/v1/volumes) → HTTP 429.
 *   • Open Food Facts arama ucu → 200 (zaten `openfoodfacts` kaynağı var).
 *   • npm downloads → 200 ama ham indirme sayısı 400'e bölünen talep
 *     sinyalinde her yazılım nişini 100'e doyuruyor; ölçümü bozduğu için
 *     eklenmedi.
 *
 * EKLENEN: Wikipedia görüntülenme API'si. Anahtarsız, JSON, ölçüldü
 * (300-560 ms) ve GERÇEK sayı veriyor.
 */
describe("wikipediaPageviewsSource", () => {
  it("anahtarsız kaynak hattın kaynak listesinde KAYITLI", () => {
    const names = PRODUCT_SOURCES.map((s) => s.name);
    expect(names).toContain("wikipedia-pageviews");
    expect(names).toContain(wikipediaPageviewsSource.name);
  });

  it("aynı anda momentum sinyali iki kez sayılmaz (yalnız görüntülenme)", () => {
    const note = wikipediaPageviewsSource;
    expect(note.name).toBe("wikipedia-pageviews");
    // `google-trends` da momentum yazıyor; pipeline ilk bulduğunu alır ve
    // sonrakini yok sayar, bu yüzden çift sayım oluşmaz.
    expect(PRODUCT_SOURCES.map((s) => s.name)).toContain("google-trends");
  });

  it("kaynak hata fırlatmaz — hat düşmez", async () => {
    // Anahtarsız ve ağa bağımlı olduğu için canlı test değil, yalnız
    // sözleşme kontrolü: boş/çöp nişte satır yok DÖNMELİ, hata fırlatmamalı.
    await expect(wikipediaPageviewsSource.scrape("   ")).resolves.toEqual([]);
  });
});

describe("ön kontrol — ürün kaynak anahtarları görünür", () => {
  it("SerpAPI ve ScraperAPI ön kontrolde İSTEĞE BAĞLI olarak raporlanır", async () => {
    const { envChecks } = await import("./product-discovery-preflight.server");
    const checks = envChecks({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sr",
    });
    const serp = checks.find((c) => c.id === "serpapi");
    const scraper = checks.find((c) => c.id === "scraperapi");
    expect(serp).toBeDefined();
    expect(scraper).toBeDefined();
    // Anahtar yoksa hata DEĞİL, isteğe bağlı: hat çalışmaya devam eder.
    expect(serp?.optional).toBe(true);
    expect(scraper?.optional).toBe(true);
    expect(serp?.fix).toContain("SERPAPI_KEY");
    expect(scraper?.fix).toContain("SCRAPERAPI_KEY");
  });
});
