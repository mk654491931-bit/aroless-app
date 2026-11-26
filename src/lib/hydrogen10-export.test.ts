import { describe, expect, it } from "vitest";
import type { H10Offer, H10Product } from "./hydrogen10";
import { buildHydrogen10Csv } from "./hydrogen10-export";

const offer: H10Offer = {
  id: "o1",
  source: "tr-reader",
  seller: "Mağaza",
  currency: "TRY",
  priceLocalMinor: 49900,
  priceUsd: 14.5,
  fxRate: 34.4,
  fxAt: "2026-11-26T20:00:00.000Z",
  rating: 4.6,
  ratingCount: 120,
  inStock: true,
  sourceUrl: "https://ornek.com/urun",
  sourceItemId: "sku-1",
  evidence: "measured",
  observedAt: "2026-11-26T20:00:00.000Z",
  firstSeenAt: "2026-11-20T20:00:00.000Z",
  lastSeenAt: "2026-11-26T20:00:00.000Z",
};

function product(overrides: Partial<H10Product> = {}): H10Product {
  return {
    id: "p1",
    identityKey: "air-fryer",
    fingerprint: "fp",
    gtin: null,
    mpn: null,
    title: "Air Fryer, 5L",
    brand: "Marka",
    imageUrl: "",
    category: "Kitchen",
    offers: [offer],
    sourceCount: 1,
    bestPriceUsd: 14.5,
    bestPriceLocalMinor: 49900,
    bestPriceCurrency: "TRY",
    bestRating: 4.6,
    bestRatingCount: 120,
    inStock: true,
    lastSeenAt: "2026-11-26T20:00:00.000Z",
    ...overrides,
  };
}

describe("buildHydrogen10Csv", () => {
  it("başlıkları ve ürün satırlarını üretir", () => {
    const csv = buildHydrogen10Csv([product()]);
    expect(csv).toContain("Urun,Marka,Kategori");
    expect(csv).toContain('"Air Fryer, 5L"');
    expect(csv).toContain("499.00,TRY,4.6,120,evet");
    expect(csv).toContain("tr-reader,https://ornek.com/urun");
  });

  it("bilinmeyen fiyat/stok alanlarını boş bırakır", () => {
    const csv = buildHydrogen10Csv([
      product({
        bestPriceUsd: null,
        bestPriceLocalMinor: null,
        bestRating: null,
        bestRatingCount: null,
        inStock: null,
        lastSeenAt: null,
        offers: [],
      }),
    ]);
    expect(csv.split("\n")[1]).toBe('"Air Fryer, 5L",Marka,Kitchen,0,1,,,TRY,,,,,,');
  });
});
