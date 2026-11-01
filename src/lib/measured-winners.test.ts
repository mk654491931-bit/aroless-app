import { describe, expect, it } from "vitest";
import type { NormalizedProduct } from "./product-discovery.types";
import { scoreDeterministically } from "./product-discovery-filter.server";
import { measuredWinnerRows } from "./measured-winners";

const product = (over: Partial<NormalizedProduct> = {}): NormalizedProduct =>
  ({
    name: "Cat Scratching Board",
    brand: "PawCo",
    seller: "Example Store",
    category: "Pet",
    priceUsd: 34.99,
    rating: 4.7,
    ratingCount: 214,
    inStock: true,
    sources: ["aliexpress-reader", "bing-shopping"],
    url: "https://example.com/cat-board",
    notes: "",
    viewed90d: 12000,
    id: "row-1",
    imageUrl: "https://example.com/cat-board.jpg",
    salesVolume: 860,
    gtin: "",
    mpn: "",
    brandMeasured: true,
    fingerprint: "cat-scratching-board|pawco|example-store",
    preScore: 74,
    signals: { demand: 72, competition: 58, margin: 80, rating: 76, availability: 85 },
    dataCompleteness: 5,
    missingFields: [],
    source: "scraped",
    supplier: null,
    grossMarginPct: 41,
    feeBudgetUsd: 12.4,
    cohortCompetitors: 3,
    launch: null,
    ...over,
  }) as NormalizedProduct;

describe("measuredWinnerRows — ölçülmüş kaynak satırı", () => {
  it("gerçek satırı 'measured' etiketiyle taşır, 14 ajan oyu uydurmaz", () => {
    const [row] = measuredWinnerRows([product()], 5);
    expect(row).toBeTruthy();
    expect(row!.scoreSource).toBe("measured");
    expect(row!.votes).toBe(0);
    expect(row!.councilScore).toBe(74);
    expect(row!.confidenceScore).toBeGreaterThan(50);
    expect(row!.priceUsd).toBe(34.99);
    expect(row!.imageUrl).toBe("https://example.com/cat-board.jpg");
    expect(row!.grossMarginPct).toBe(41);
    expect(row!.evidence.join(" ")).toContain("Satış");
    expect(row!.evidence.join(" ")).toContain("Brüt marj");
  });

  it("kanıtsız ve adsız satırları listeye koymaz", () => {
    const rows = measuredWinnerRows(
      [
        product({ name: "", fingerprint: "empty" }),
        product({
          name: "No evidence product",
          fingerprint: "no-evidence",
          priceUsd: null,
          rating: null,
          ratingCount: null,
          salesVolume: null,
          viewed90d: null,
          imageUrl: "",
          url: "",
        }),
      ],
      5,
    );
    expect(rows).toEqual([]);
  });

  it("aynı ürünün kopyasını tekilleştirir, yüksek skorlu kaydı tutar", () => {
    const rows = measuredWinnerRows(
      [
        product({ preScore: 50, sources: ["aliexpress-reader"] }),
        product({ preScore: 82, sources: ["aliexpress-reader", "bing-shopping"] }),
      ],
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.preScore).toBe(82);
    expect(rows[0]!.sources).toHaveLength(2);
  });
});

describe("scoreDeterministically — NaN koruması", () => {
  it("eksik bağlam alanları ön skoru NaN yapmaz", () => {
    const [scored] = scoreDeterministically([product()], {
      nicheMomentumPct: undefined,
      nicheEngagement: undefined,
    } as never);
    expect(scored).toBeTruthy();
    expect(Number.isFinite(scored!.preScore)).toBe(true);
    expect(scored!.preScore).toBeGreaterThanOrEqual(0);
    expect(scored!.preScore).toBeLessThanOrEqual(100);
  });
});
