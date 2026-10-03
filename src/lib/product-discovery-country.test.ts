import { describe, it, expect } from "vitest";

import { marketplacesForCountry, runSources } from "./product-discovery-sources.server";
import { englishProductQuery } from "./product-discovery-query";

/**
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı: "kedi tırmalama tahtası" yazdım,
 * film önerisi çıktı, "her ülkede doğru çalışsın"):
 *
 *   1. Sorgu dili: `englishProductQuery("kedi tırmalama tahtası")` →
 *      "ked tirmalam tahta" idi. Sözlükte olmayan kelimeler KÖKÜne
 *      kırpılıyordu; global pazaryere çöp sorgu gidiyordu → 0 ürün.
 *   2. Küresellik: pazaryeri kaynağı yalnız Trendyol + Hepsiburada'ya
 *      bakıyordu. Türkiye dışındaki hiçbir kullanıcı için yerel pazar
 *      denenmiyordu.
 */
describe("englishProductQuery — sözlükte olmayan kelimeler bozulmaz", () => {
  it("Türkçe ek soyma yalnız sözlükte karşılığı varsa uygulanır", () => {
    // "scratching" seçildi: gerçek ürün başlıkları "cat scratching board"
    // diyor; "scratcher" kelime biçimi yüzden güçlü eşleşme sayılmıyordu
    // (ölçülen hata, 2026-10-03).
    expect(englishProductQuery("kedi tırmalama tahtası")).toBe("cat scratching board");
    expect(englishProductQuery("kedi tırmalama tahtası")).not.toContain("ked ");
    expect(englishProductQuery("kedi tırmalama tahtası")).not.toContain("tirmalam");
  });

  it("bilinen ürün kelimeleri çevrilmeye devam eder", () => {
    expect(englishProductQuery("LED masa lambası")).toBe("led desk lamp");
    expect(englishProductQuery("kedi kumu")).toBe("cat litter");
  });

  it("İngilizce niş olduğu gibi kalır", () => {
    expect(englishProductQuery("cat scratching board")).toBe("cat scratching board");
  });
});

describe("marketplacesForCountry — her ülke kendi yerel pazarını arar", () => {
  it("TR → Trendyol + Hepsiburada", () => {
    const { code, sites } = marketplacesForCountry("TR");
    expect(code).toBe("TR");
    expect(sites.map((s) => s.name)).toEqual(["Trendyol", "Hepsiburada"]);
  });

  it("DE → Alman pazaryerleri", () => {
    const { code, sites } = marketplacesForCountry("de");
    expect(code).toBe("DE");
    expect(sites.map((s) => s.name)).toContain("Otto");
    expect(sites.map((s) => s.name)).toContain("Amazon DE");
  });

  it("BR → Brezilya yerel pazarı", () => {
    expect(marketplacesForCountry("BR").sites.map((s) => s.name)).toEqual(["Mercado Livre"]);
  });

  it("bilinmeyen ülke uydurulmaz: kod korunur, liste geniş kapsama düşer", () => {
    const { code, sites } = marketplacesForCountry("ZZ");
    expect(code).toBe("ZZ");
    expect(sites.length).toBeGreaterThan(0);
  });

  it("arama URL'i ülkeye göre değişir", () => {
    const de = marketplacesForCountry("DE").sites[0].search("led lampe");
    expect(de).toContain("amazon.de");
    const tr = marketplacesForCountry("TR").sites[0].search("led lamba");
    expect(tr).toContain("trendyol.com");
  });
});

describe("runSources — hedef ülkeyi kaynağa taşır", () => {
  it("ülke verildiğinde scrapeForCountry kullanılır", async () => {
    const seen: string[] = [];
    const { products, reports } = await runSources(
      "kedi tırmalama tahtası",
      [
        {
          name: "probe",
          timeoutMs: 2_000,
          scrape: () => Promise.resolve([]),
          scrapeForCountry: (_niche, country) => {
            seen.push(country);
            return Promise.resolve([]);
          },
        },
      ],
      { capMs: 2_000, country: "JP" },
    );
    expect(seen).toEqual(["JP"]);
    expect(products).toEqual([]);
    expect(reports[0].ok).toBe(true);
  });

  it("ülke verilmezse eski scrape yolu korunur", async () => {
    let called = false;
    await runSources(
      "x",
      [
        {
          name: "probe",
          timeoutMs: 2_000,
          scrape: () => {
            called = true;
            return Promise.resolve([]);
          },
        },
      ],
      { capMs: 2_000 },
    );
    expect(called).toBe(true);
  });
});
