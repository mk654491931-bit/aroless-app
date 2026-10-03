import { describe, it, expect } from "vitest";

import {
  extractPrice,
  readRating,
  serpApiConfigured,
  toRawProducts,
} from "./serpapi-shopping.server";

/**
 * SerpAPI Google Shopping yanıtının ürün satırına dönüşümü.
 *
 * Bu testler AĞ KULLANMAZ: dönüşüm saf olduğu için gerçek SerpAPI yanıt
 * şekliyle (başlık + `extracted_price` + `rating` + `rating_count` +
 * `thumbnail` + `source`) sınanabilir. Anahtar yoksa kaynağın HİÇ ağ
 * çağrısı yapmaması da ayrıca sınanır.
 */
describe("extractPrice", () => {
  it("extracted_price sayısını kullanır", () => {
    const p = extractPrice({ extracted_price: 24.99, price: "$24.99" });
    expect(p?.amount).toBeCloseTo(24.99);
    expect(p?.currency).toBe("USD");
  });

  it("Avrupa biçimini okur ve para birimini verir", () => {
    const p = extractPrice({ price: "1.299,00 €" });
    expect(p?.amount).toBeCloseTo(1299);
    expect(p?.currency).toBe("EUR");
  });

  it("TL ve BRL sembollerini tanır", () => {
    expect(extractPrice({ price: "₺849,90" })?.currency).toBe("TRY");
    expect(extractPrice({ price: "R$ 199,00" })?.currency).toBe("BRL");
  });

  it("fiyat yoksa null döner (kart uydurulmaz)", () => {
    expect(extractPrice({})).toBeNull();
    expect(extractPrice({ price: "ücretsiz" })).toBeNull();
    expect(extractPrice({ extracted_price: 0 })).toBeNull();
  });
});

describe("readRating", () => {
  it("0-5 puanı ve değerlendirme sayısını okur", () => {
    expect(readRating({ rating: 4.3, rating_count: 128 })).toEqual({ rating: 4.3, count: 128 });
  });

  it("10'lu sistem gelirse 5'e normalize eder", () => {
    expect(readRating({ rating: 9 }).rating).toBe(4.5);
  });

  it("ölçülmemiş puan null'dır, 0 değil", () => {
    expect(readRating({})).toEqual({ rating: null, count: null });
    expect(readRating({ rating: 0, rating_count: 5 }).rating).toBeNull();
  });
});

describe("toRawProducts", () => {
  const results = [
    {
      title: "Kedi Tırmalama Tahtası Ahşap",
      extracted_price: 349.9,
      price: "₺349,90",
      rating: 4.4,
      rating_count: 312,
      thumbnail: "https://cdn.example.test/a.jpg",
      source: "Trendyol",
      link: "https://www.trendyol.com/x",
    },
    {
      title: "Kedi Tırmalama Tahtası Sisal",
      price: "1.299,00 €",
      rating: 4.1,
      reviews: 88,
      source: "Amazon DE",
    },
    { title: "Fiyatsız satır", extracted_price: 0 },
    { title: "Tamamen alakasız", extracted_price: 10 },
  ];

  it("gerçek satırları fiyat + puan + görsel + mağaza ile üretir", () => {
    const rows = toRawProducts(results, "kedi tırmalama tahtası");
    expect(rows).toHaveLength(2);
    expect(rows[0].priceUsd).toBeCloseTo(349.9);
    expect(rows[0].rating).toBeCloseTo(4.4);
    expect(rows[0].ratingCount).toBe(312);
    expect(rows[0].imageUrl).toBe("https://cdn.example.test/a.jpg");
    expect(rows[0].seller).toBe("Trendyol");
    expect(rows[0].source).toBe("serpapi-shopping");
  });

  it("fiyatsız satırı eler, alakasız satırı niş kapısı eler", () => {
    const rows = toRawProducts(results, "kedi tırmalama tahtası");
    expect(rows.some((r) => r.title === "Fiyatsız satır")).toBe(false);
    expect(rows.some((r) => r.title === "Tamamen alakasız")).toBe(false);
  });

  it("aynı başlığı iki kez üretmez", () => {
    const dup = [results[0], { ...results[0] }];
    expect(toRawProducts(dup, "kedi tırmalama tahtası")).toHaveLength(1);
  });

  it("yanıt yoksa boş döner", () => {
    expect(toRawProducts(undefined, "x")).toEqual([]);
  });
});

describe("serpApiConfigured", () => {
  it("anahtar yoksa false döner — kaynak ağ çağrısı YAPMAZ", () => {
    if (!process.env.SERPAPI_KEY && !process.env.SERP_API_KEY && !process.env.SERPAPI_API_KEY) {
      expect(serpApiConfigured()).toBe(false);
    }
  });
});
