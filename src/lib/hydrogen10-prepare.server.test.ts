import { describe, expect, it } from "vitest";

import { prepareH10Run } from "./hydrogen10-prepare.server";
import type { SourceReport } from "./product-discovery-sources.server";
import type { RawProduct } from "./product-discovery.types";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const GTIN = "4006381333931";

function report(name: string, items: number, ok = true, error = ""): SourceReport {
  return { name, ok, items, ms: 120, error };
}

const raw: RawProduct[] = [
  {
    title: "Ninja AF101 Air Fryer 4 Qt",
    brand: "Ninja",
    seller: "Hepsiburada",
    priceUsd: 129.99,
    rating: 4.7,
    ratingCount: 1200,
    inStock: true,
    source: "tr-reader",
    url: "https://example.com/ninja-1",
    imageUrl: "https://example.com/ninja.jpg",
    gtin: GTIN,
  },
  {
    title: "Ninja AF101 Air Fryer 4 Qt",
    brand: "Ninja",
    seller: "Google Shopping",
    priceUsd: 119.99,
    rating: 4.6,
    ratingCount: 900,
    inStock: true,
    source: "google-shopping",
    url: "https://example.com/ninja-2",
    imageUrl: "https://example.com/ninja-2.jpg",
    gtin: GTIN,
  },
  {
    title: "Bozuk Fiyatlı Air Fryer",
    source: "tr-reader",
    priceUsd: 0,
    rating: 4.4,
    ratingCount: 50,
    inStock: true,
    url: "https://example.com/bad-price",
    imageUrl: "https://example.com/bad.jpg",
  },
  {
    title: "Stokta Olmayan Air Fryer",
    source: "tr-reader",
    priceUsd: 59,
    rating: 4.2,
    ratingCount: 40,
    inStock: false,
    url: "https://example.com/out",
    imageUrl: "https://example.com/out.jpg",
  },
  {
    title: "Düşük Puanlı Air Fryer",
    source: "bing-shopping",
    priceUsd: 40,
    rating: 3,
    ratingCount: 20,
    inStock: true,
    url: "https://example.com/low",
    imageUrl: "https://example.com/low.jpg",
  },
  {
    title: "Fiyatı Ölçülmemiş Air Fryer",
    source: "bing-shopping",
    priceUsd: null,
    rating: null,
    ratingCount: null,
    inStock: null,
    url: "https://example.com/no-price",
    imageUrl: "",
  },
  {
    title: "Air fryer - Wikipedia",
    source: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Air_fryer",
  },
];

const reports: SourceReport[] = [
  report("tr-reader", 4),
  report("google-shopping", 1),
  report("bing-shopping", 2),
  report("ebay-browse", 0, false, "anahtar tanımlı değil: EBAY_CLIENT_ID"),
  report("wikipedia", 1),
];

describe("prepareH10Run", () => {
  const run = prepareH10Run(raw, reports, { currency: "USD" }, NOW);

  it("her ham satırı arşivler; ürün olmayan satırı ürüne çevirmez", () => {
    expect(run.rowCount).toBe(6);
    expect(run.observations).toHaveLength(6);
    expect(run.ingestRows).toHaveLength(7); // 6 ürün + 1 wikipedia sinyali
    expect(run.invalidCount).toBe(2); // 1 tr geçersiz + 1 wikipedia sinyali
    expect(run.products).toHaveLength(5);
    expect(run.products.some((product) => product.title.includes("Wikipedia"))).toBe(false);
    expect(run.ingestRows.find((row) => row.title.includes("Wikipedia"))?.rejectionReason).toBe(
      "non_product",
    );
  });

  it("aynı GTIN'i tek kanonik üründe birleştirir, satıcıyı kimliğe katmaz", () => {
    const ninja = run.products.find((product) => product.title.includes("Ninja"));
    expect(ninja).toBeTruthy();
    expect(ninja?.gtin).toBe(GTIN);
    expect(ninja?.offers).toHaveLength(2);
    expect(new Set(ninja?.offers.map((offer) => offer.source))).toEqual(
      new Set(["tr_reader", "google_shopping"]),
    );
  });

  it("null fiyatı korur, 0 fiyatı geçerli fiyat gibi yazmaz", () => {
    const noPriceProduct = run.products.find((product) => product.title.includes("Ölçülmemiş"));
    expect(noPriceProduct).toBeTruthy();
    expect(noPriceProduct?.offers[0]?.priceUsd).toBeNull();
    expect(noPriceProduct?.offers[0]?.priceLocalMinor).toBeNull();

    const bad = run.observations.find(
      (observation) => observation.rejectionReason === "invalid_price",
    );
    expect(bad).toBeTruthy();
    expect(bad?.priceUsd).toBeNull();
    expect(bad?.eligible).toBe(false);
  });

  it("filtreye takılan teklifleri eligible=false ile işaretler", () => {
    const badPrice = run.products
      .flatMap((product) => product.offers)
      .find((offer) => offer.sourceUrl === "https://example.com/bad-price");
    const outOfStock = run.products
      .flatMap((product) => product.offers)
      .find((offer) => offer.sourceUrl === "https://example.com/out");
    const lowRating = run.products
      .flatMap((product) => product.offers)
      .find((offer) => offer.sourceUrl === "https://example.com/low");
    const ninja = run.products.find((product) => product.title.includes("Ninja"));

    expect(badPrice?.eligible).toBe(false);
    expect(outOfStock?.eligible).toBe(false);
    expect(lowRating?.eligible).toBe(false);
    expect(ninja?.offers.every((offer) => offer.eligible)).toBe(true);
  });

  it("stok üç durumludur: bilinmeyen null elenmez, false elenir", () => {
    const unknown = run.products.find((product) => product.title.includes("Ölçülmemiş"));
    const out = run.observations.find(
      (observation) => observation.rejectionReason === "out_of_stock",
    );
    expect(unknown?.offers[0]?.inStock).toBeNull();
    expect(unknown).toBeTruthy();
    expect(out?.inStock).toBe(false);
    expect(out?.eligible).toBe(false);
  });

  it("kaynak sağlığını failed/no_results/not_configured/partial olarak ayırır", () => {
    const bySource = new Map(run.sourceHealth.map((source) => [source.source, source]));
    expect(bySource.get("ebay_browse")?.status).toBe("not_configured");
    expect(bySource.get("tr_reader")?.status).toBe("partial");
    expect(bySource.get("google_shopping")?.status).toBe("ok");
    expect(bySource.get("wikipedia")?.status).toBe("partial");
    expect(run.status).toBe("partial");
    expect(run.sourceHealth.find((source) => source.source === "ebay_browse")?.error).toContain(
      "anahtar",
    );
  });

  it("gözlem zamanı ve para birimi tek kaynaktan gelir", () => {
    expect(
      run.observations.every((observation) => observation.observedAt === NOW.toISOString()),
    ).toBe(true);
    expect(run.observations.every((observation) => observation.currency === "USD")).toBe(true);
    expect(run.observations.every((observation) => observation.evidence === "measured")).toBe(true);
  });

  it("seçilen platforma ait olmayan satırı arşivler ama ürüne çevirmez", () => {
    const rows: RawProduct[] = [
      {
        title: "Amazon Air Fryer 5L",
        brand: "Acme",
        seller: "Amazon",
        source: "serpapi-shopping",
        url: "https://www.amazon.com/dp/B000TEST01",
        imageUrl: "https://example.com/amazon.jpg",
        priceUsd: 89.99,
        rating: 4.6,
        ratingCount: 200,
        inStock: true,
      },
      {
        title: "Trendyol Air Fryer 5L",
        brand: "Acme",
        seller: "Trendyol",
        source: "tr-reader",
        url: "https://www.trendyol.com/urun",
        imageUrl: "https://example.com/trendyol.jpg",
        priceUsd: 79.99,
        rating: 4.5,
        ratingCount: 150,
        inStock: true,
      },
    ];
    const filtered = prepareH10Run(
      rows,
      [report("serpapi-shopping", 1), report("tr-reader", 1)],
      { currency: "USD", platform: "amazon" },
      NOW,
    );

    expect(filtered.products).toHaveLength(1);
    expect(filtered.products[0]?.title).toContain("Amazon");
    expect(filtered.observations).toHaveLength(1);
    expect(filtered.ingestRows).toHaveLength(2);
    expect(filtered.ingestRows.find((row) => row.title.includes("Trendyol"))?.rejectionReason).toBe(
      "platform_mismatch",
    );
    expect(filtered.notes.some((note) => note.includes("Platform filtresi"))).toBe(true);
  });
});
