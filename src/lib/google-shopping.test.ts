import { describe, expect, it, vi } from "vitest";

import {
  chooseGoogleShoppingRows,
  googleShoppingMinRows,
  googleShoppingProviderPlan,
  mergeShoppingRows,
} from "./google-shopping.server";
import type { RawProduct } from "./product-discovery.types";

const row = (title: string, source: string, price = 10): RawProduct => ({
  title,
  brand: "",
  seller: "",
  priceUsd: price,
  rating: null,
  ratingCount: null,
  inStock: null,
  source,
  url: `https://example.test/${encodeURIComponent(title)}`,
  notes: "",
});

const rows = (prefix: string, n: number, source: string): RawProduct[] =>
  Array.from({ length: n }, (_, i) => row(`${prefix} air fryer model ${i}`, source, 20 + i));

describe("Google Shopping sağlayıcı planı", () => {
  it("kota genişliğine göre sıralar: Serper → SearchAPI → SerpAPI", () => {
    expect(
      googleShoppingProviderPlan({
        SERPER_API_KEY: "1",
        SEARCHAPI_KEY: "2",
        SERPAPI_KEY: "3",
      }),
    ).toEqual(["serper", "searchapi", "serpapi"]);
  });

  it("yalnız tanımlı sağlayıcıları döndürür (boş anahtar sayılmaz)", () => {
    expect(googleShoppingProviderPlan({ SEARCHAPI_KEY: "  ", SERPAPI_KEY: "x" })).toEqual([
      "serpapi",
    ]);
    expect(googleShoppingProviderPlan({})).toEqual([]);
  });

  it("kalite eşiği varsayılan 20, GOOGLE_SHOPPING_MIN_ROWS ile 1..60 arası", () => {
    expect(googleShoppingMinRows({})).toBe(20);
    expect(googleShoppingMinRows({ GOOGLE_SHOPPING_MIN_ROWS: "60" })).toBe(60);
    expect(googleShoppingMinRows({ GOOGLE_SHOPPING_MIN_ROWS: "999" })).toBe(60);
    expect(googleShoppingMinRows({ GOOGLE_SHOPPING_MIN_ROWS: "bozuk" })).toBe(20);
  });
});

describe("Google Shopping yedekli seçim — kota tasarrufu", () => {
  it("birincil 20 benzersiz satır verdiyse yedekleri ÇAĞIRMAZ", async () => {
    const load = vi.fn(async (provider: string) => rows(provider, 20, provider));

    const result = await chooseGoogleShoppingRows(["serper", "searchapi", "serpapi"], load);

    expect(result.rows).toHaveLength(20);
    expect(result.used).toEqual(["serper"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("birincil zayıfsa yedekle tamamlar; hedefe ulaşınca üçüncüyü atlar", async () => {
    const load = vi.fn(async (provider: string) =>
      provider === "serper" ? rows("serper", 5, "serper") : rows("searchapi", 18, "searchapi"),
    );

    const result = await chooseGoogleShoppingRows(["serper", "searchapi", "serpapi"], load);

    expect(result.used).toEqual(["serper", "searchapi"]);
    expect(result.rows).toHaveLength(23);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bütün sağlayıcılar zayıfsa hepsini dener ve benzersiz satırları birleştirir", async () => {
    const load = vi.fn(async (provider: string) => rows(provider, 5, provider));

    const result = await chooseGoogleShoppingRows(["serper", "searchapi", "serpapi"], load);

    expect(result.used).toEqual(["serper", "searchapi", "serpapi"]);
    expect(result.rows).toHaveLength(15);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("bir sağlayıcı hata verse de sonraki yedek devreye girer", async () => {
    const load = vi.fn(async (provider: string) => {
      if (provider === "serper") throw new Error("429");
      return rows("searchapi", 20, "searchapi");
    });

    const result = await chooseGoogleShoppingRows(["serper", "searchapi", "serpapi"], load);

    expect(result.rows).toHaveLength(20);
    expect(result.used).toEqual(["serper", "searchapi"]);
  });
});

describe("Google Shopping satır birleştirme", () => {
  it("aynı başlığı iki kez saymaz, fiyatı ilk ölçümden korur", () => {
    const target = [row("Ninja Air Fryer AF101 4 Qt", "serper", 89.99)];
    const added = mergeShoppingRows(target, [
      row("Ninja Air Fryer AF101 4 Qt", "searchapi", 99.99),
      row("Cosori Air Fryer 5.8L", "searchapi", 119),
    ]);

    expect(added).toBe(1);
    expect(target).toHaveLength(2);
    expect(target[0]?.priceUsd).toBe(89.99);
  });
});
