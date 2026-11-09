import { describe, expect, it } from "vitest";

import {
  H10_COUNTRIES,
  filterH10Products,
  formatH10Minor,
  formatH10Usd,
  h10FreshUntil,
  h10SourceStatus,
  h10StatusLabel,
  isH10Fresh,
  normalizeH10Query,
  resolveH10Market,
  type H10Product,
} from "./hydrogen10";

function product(partial: Partial<H10Product> & Pick<H10Product, "id" | "title">): H10Product {
  const offers = partial.offers ?? [];
  return {
    id: partial.id,
    title: partial.title,
    identityKey: partial.identityKey ?? `f:${partial.id}`,
    fingerprint: partial.fingerprint ?? `f:${partial.id}`,
    gtin: partial.gtin ?? null,
    mpn: partial.mpn ?? null,
    brand: partial.brand ?? "",
    imageUrl: partial.imageUrl ?? "",
    category: partial.category ?? "",
    offers,
    sourceCount: partial.sourceCount ?? new Set(offers.map((offer) => offer.source)).size,
    bestPriceUsd: partial.bestPriceUsd ?? null,
    bestPriceLocalMinor: partial.bestPriceLocalMinor ?? null,
    bestPriceCurrency: partial.bestPriceCurrency ?? "USD",
    bestRating: partial.bestRating ?? null,
    bestRatingCount: partial.bestRatingCount ?? null,
    inStock: partial.inStock ?? null,
    lastSeenAt: partial.lastSeenAt ?? null,
  };
}

describe("Hidrojen10 niş anahtarı", () => {
  it("noktalama ve boşlukları normalize eder, eşanlamlı birleştirmez", () => {
    expect(normalizeH10Query("  Air-Fryer   5.5L  ")).toBe("air fryer 5 5l");
    expect(normalizeH10Query("airfryer")).toBe("airfryer");
    expect(normalizeH10Query("air fryer")).toBe("air fryer");
  });

  it("UK'yi ISO GB'ye çevirir; para birimi ülkeden gelir", () => {
    const market = resolveH10Market({
      query: "air fryer",
      country: "UK",
      platform: "Amazon",
    });
    expect(market.country.code).toBe("GB");
    expect(market.country.currency).toBe("GBP");
    expect(market.platform.id).toBe("amazon");
    expect(market.canonicalKey).toBe("v1|air fryer|GB|amazon|GBP");
  });

  it("aynı sorgu farklı ülkede ayrı anahtar üretir", () => {
    const us = resolveH10Market({ query: "air fryer", country: "US", platform: "general" });
    const de = resolveH10Market({ query: "air fryer", country: "DE", platform: "general" });
    expect(us.canonicalKey).not.toBe(de.canonicalKey);
    expect(us.canonicalKey).toBe("v1|air fryer|US|general|USD");
    expect(de.canonicalKey).toBe("v1|air fryer|DE|general|EUR");
  });

  it("bilinmeyen ülke/platform güvenli varsayılana düşer", () => {
    const market = resolveH10Market({ query: "x", country: "ZZ", platform: "bilinmeyen" });
    expect(market.country.code).toBe("US");
    expect(market.platform.id).toBe("general");
  });
});

describe("Hidrojen10 cache tazeliği", () => {
  it("24 saat sınırını doğru hesaplar", () => {
    const last = "2026-11-08T10:00:00.000Z";
    expect(h10FreshUntil(last)).toBe("2026-11-09T10:00:00.000Z");
    expect(isH10Fresh("2026-11-09T10:00:00.000Z", new Date("2026-11-08T10:00:00.000Z"))).toBe(true);
    expect(isH10Fresh("2026-11-09T10:00:00.000Z", new Date("2026-11-09T10:00:00.000Z"))).toBe(false);
    expect(isH10Fresh(null)).toBe(false);
  });
});

describe("Hidrojen10 kaynak durumu", () => {
  it("failed ile no_results'u karıştırmaz", () => {
    expect(h10SourceStatus({ ok: true, items: 0 })).toBe("no_results");
    expect(h10SourceStatus({ ok: false, items: 0, error: "timeout" })).toBe("failed");
  });

  it("anahtarsız kaynağı hata saymaz", () => {
    expect(
      h10SourceStatus({
        ok: false,
        items: 0,
        error: "anahtar tanımlı değil: EBAY_CLIENT_ID",
      }),
    ).toBe("not_configured");
  });

  it("geçersiz satır varsa kısmi der", () => {
    expect(h10SourceStatus({ ok: true, items: 10, invalidItems: 2 })).toBe("partial");
    expect(h10StatusLabel("not_configured")).toBe("Yapılandırılmadı");
  });
});

describe("Hidrojen10 filtreleri", () => {
  const rows = [
    product({
      id: "1",
      title: "A",
      bestPriceUsd: 30,
      bestRating: 4.5,
      bestRatingCount: 100,
      inStock: true,
      sourceCount: 2,
      offers: [
        {
          id: "o1",
          source: "tr-reader",
          seller: "",
          currency: "USD",
          priceLocalMinor: 3000,
          priceUsd: 30,
          fxRate: null,
          fxAt: null,
          rating: 4.5,
          ratingCount: 100,
          inStock: true,
          sourceUrl: "",
          sourceItemId: null,
          evidence: "measured",
          observedAt: "2026-11-08T10:00:00.000Z",
          firstSeenAt: "2026-11-08T10:00:00.000Z",
          lastSeenAt: "2026-11-08T10:00:00.000Z",
        },
      ],
    }),
    product({
      id: "2",
      title: "B",
      bestPriceUsd: 80,
      bestRating: 4.9,
      bestRatingCount: 10,
      inStock: null,
      sourceCount: 1,
      offers: [],
    }),
    product({ id: "3", title: "C" }),
  ];

  it("fiyat/puan/stok filtrelerini uygular", () => {
    expect(filterH10Products(rows, { maxPriceUsd: 50 }).map((row) => row.id)).toEqual(["1"]);
    expect(filterH10Products(rows, { minRating: 4.8 }).map((row) => row.id)).toEqual(["2"]);
    expect(filterH10Products(rows, { inStockOnly: true }).map((row) => row.id)).toEqual(["1"]);
  });

  it("kaynak filtresi teklifler üzerinden çalışır", () => {
    expect(filterH10Products(rows, { source: "tr-reader" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterH10Products(rows, { source: "yok" })).toEqual([]);
  });

  it("fiyat sıralamasında bilinmeyen fiyat sona düşer", () => {
    expect(filterH10Products(rows, { sort: "price_asc" }).map((row) => row.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

describe("Hidrojen10 para biçimleme", () => {
  it("null fiyatı 0 gibi göstermez", () => {
    expect(formatH10Minor(null, "USD")).toBe("—");
    expect(formatH10Usd(null)).toBe("—");
    expect(formatH10Minor(12999, "USD")).toContain("129.99");
  });

  it("ülke kataloğunda GLOBAL yoktur ve para birimi taşır", () => {
    expect(H10_COUNTRIES.every((country) => country.code !== "GLOBAL")).toBe(true);
    expect(H10_COUNTRIES.every((country) => country.currency.length === 3)).toBe(true);
  });
});
