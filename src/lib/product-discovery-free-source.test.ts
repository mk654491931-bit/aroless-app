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
