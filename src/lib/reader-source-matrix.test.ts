/**
 * ÜLKE-KAYNAK MATRİSİ TESTLERİ (rapor P0-4).
 *
 * NEDEN: \"global\" demek her aramada TÜM okuyucuları koşmak değildir. Ölçülen
 * sayfa boyutlarıyla arama maliyeti ülkeye göre 33K-57K token; yanlış kaynağı
 * koşmak kotayı boşa harcar ve ürün satırı ÜRETMEZ. Bu testler hem bütçe
 * tablosunu hem de kapıların iki yerde AYNI kaldığını kilitler.
 */
import { describe, expect, it } from "vitest";

import { parseBestBuyProducts } from "./product-discovery-sources.server";
import {
  GLOBAL_SEARCH_COUNTRIES,
  LOCAL_SITES,
  READER_SOURCES,
  normalizeCountry,
  readerPlanFor,
  readerTokensPerSearch,
} from "./product-discovery-reader.server";

describe("readerPlanFor — ülkeye göre koşacak kaynaklar", () => {
  it("TR'de Hepsiburada+n11 ve AliExpress koşar, Newegg/Otto/Flipkart/Rakuten koşmaz", () => {
    const ids = readerPlanFor("TR").map((s) => s.id);
    expect(ids).toEqual(["tr-reader", "aliexpress-reader"]);
  });

  it("DE'de Otto devreye girer; TR okuyucusu ve Flipkart kapanır", () => {
    const ids = readerPlanFor("de").map((s) => s.id);
    expect(ids).toContain("otto-reader");
    expect(ids).not.toContain("tr-reader");
    expect(ids).not.toContain("flipkart-reader");
  });

  it("IN'de Flipkart, JP'de Rakuten, US'te Newegg koşar", () => {
    expect(readerPlanFor("IN").map((s) => s.id)).toEqual(["aliexpress-reader", "flipkart-reader"]);
    expect(readerPlanFor("JP").map((s) => s.id)).toEqual(["aliexpress-reader", "rakuten-reader"]);
    expect(readerPlanFor("US").map((s) => s.id)).toEqual(["aliexpress-reader", "newegg-reader"]);
  });

  it("ülke bilinmiyorsa yalnız ülkeden bağımsız kaynak koşar (boşa okuma yok)", () => {
    expect(readerPlanFor("").map((s) => s.id)).toEqual(["aliexpress-reader"]);
    expect(normalizeCountry(" tr ")).toBe("TR");
  });

  it("token bütçesi ülkeye göre hesaplanır (maliyet görünür)", () => {
    expect(readerTokensPerSearch("TR")).toBe(57_000 + 17_000);
    expect(readerTokensPerSearch("DE")).toBe(16_300 + 17_000);
    expect(readerTokensPerSearch("JP")).toBe(15_600 + 17_000);
    // Her ülke için plan /health'te raporlanır.
    expect(GLOBAL_SEARCH_COUNTRIES.length).toBeGreaterThanOrEqual(8);
    for (const country of GLOBAL_SEARCH_COUNTRIES) {
      expect(readerTokensPerSearch(country)).toBeGreaterThan(0);
    }
  });
});

describe("kapı tutarlılığı — liste iki yerde kilitli", () => {
  it("Otto/Flipkart/Rakuten ülke listeleri okuyucu modülüyle birebir aynı", () => {
    // `product-discovery-sources.server.ts` ülke kapıları bu listelerle AYNI
    // olmak zorunda; iki yerde ayrı tutmak sessizce kapsam kaybettirir.
    const byCountry: Record<string, readonly string[]> = {
      "otto-reader": LOCAL_SITES.otto.countries,
      "flipkart-reader": LOCAL_SITES.flipkart.countries,
      "rakuten-reader": LOCAL_SITES.rakuten.countries,
    };
    for (const [id, countries] of Object.entries(byCountry)) {
      const source = READER_SOURCES.find((s) => s.id === id);
      expect(source?.countries).toEqual(countries);
    }
  });

  it("AliExpress ülkeden bağımsızdır (her ülkede tek ortak kaynak)", () => {
    const ae = READER_SOURCES.find((s) => s.id === "aliexpress-reader");
    expect(ae?.countries).toEqual(["*"]);
  });

  it("Newegg ülke listesi ABD merkezlidir ve TR'yi içermez", () => {
    const newegg = READER_SOURCES.find((s) => s.id === "newegg-reader");
    expect(newegg?.countries).toContain("US");
    expect(newegg?.countries).not.toContain("TR");
  });
});

describe("parseBestBuyProducts — ücretsiz API yanıtı ölçülmüş alana indirgenir", () => {
  const fixture = {
    products: [
      {
        name: "Insignia 0.7 Cu. Ft. Microwave",
        salePrice: 59.99,
        regularPrice: 79.99,
        customerReviewAverage: 4.4,
        customerReviewCount: 1234,
        image: "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/x.jpg",
        url: "https://www.bestbuy.com/site/insignia-microwave/123.p?skuId=123",
        manufacturer: "Insignia",
      },
      // Fiyatı olmayan satır havuza GİRMEZ (fiyatsız ürün kazanan olamaz).
      { name: "Fiyatsız ürün", url: "https://www.bestbuy.com/site/x/1.p" },
      // Değerlendirmesi olmayan satır girer ama puanı `null` olur (0 değil).
      {
        name: "Yeni çıkan ürün",
        regularPrice: 199.99,
        customerReviewAverage: 0,
        customerReviewCount: 0,
        url: "https://www.bestbuy.com/site/y/2.p",
      },
    ],
  };

  it("gerçek fiyat, GERÇEK puan ve görseli taşır", () => {
    const rows = parseBestBuyProducts(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Insignia 0.7 Cu. Ft. Microwave",
      priceUsd: 59.99,
      rating: 4.4,
      ratingCount: 1234,
      source: "bestbuy-api",
      seller: "Best Buy",
      brand: "Insignia",
    });
    expect(rows[0]?.notes).toContain("liste $79.99");
  });

  it("puan 0 ise `null` yazılır (\"0 puan\" ölçüm değil) ve regularPrice yedek olur", () => {
    const rows = parseBestBuyProducts(fixture);
    expect(rows[1]?.priceUsd).toBe(199.99);
    expect(rows[1]?.rating).toBeNull();
    expect(rows[1]?.ratingCount).toBeNull();
  });

  it("bozuk/boş yanıt `[]` döner", () => {
    expect(parseBestBuyProducts(null)).toEqual([]);
    expect(parseBestBuyProducts({})).toEqual([]);
    expect(parseBestBuyProducts({ products: "nope" })).toEqual([]);
  });
});
