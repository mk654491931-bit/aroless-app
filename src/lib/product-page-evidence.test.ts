import { describe, expect, it } from "vitest";

import { extractProductPageEvidence } from "./product-page-evidence";

const jsonLd = (product: Record<string, unknown>) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "ECARTEKS Oto Bagaj Organizer",
    offers: { "@type": "Offer", price: "846.90", priceCurrency: "TRY" },
    ...product,
  })}</script></head><body></body></html>`;

describe("extractProductPageEvidence", () => {
  it("JSON-LD aggregateRating puanını ve değerlendirme sayısını okur", () => {
    const html = jsonLd({
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.7", reviewCount: "46" },
    });
    expect(extractProductPageEvidence(html)).toEqual({
      rating: 4.7,
      ratingCount: 46,
      source: "jsonld",
    });
  });

  it("10 üzerinden puanı 5'lik ölçeğe normalize eder (JSON-LD bestRating)", () => {
    const html = jsonLd({
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "9.2",
        bestRating: "10",
        ratingCount: "88",
      },
    });
    expect(extractProductPageEvidence(html)).toMatchObject({ rating: 4.6, ratingCount: 88 });
  });

  it("JSON-LD yoksa sayfadaki açık Türkçe kalıbı okur", () => {
    const html = `<html><body>Ürün puanı 4,6 · 1.284 değerlendirme</body></html>`;
    expect(extractProductPageEvidence(html)).toMatchObject({
      rating: 4.6,
      ratingCount: 1284,
      source: "text",
    });
  });

  it("puan/değerlendirme yoksa UYDURMAZ", () => {
    expect(
      extractProductPageEvidence("<html><body>Bu ürün hakkında henüz yorum yok.</body></html>"),
    ).toEqual({ rating: null, ratingCount: null, source: "none" });
  });

  it("5 dışındaki puanı kabul etmez", () => {
    const html = `<html><body>"ratingValue": "9.2"</body></html>`;
    expect(extractProductPageEvidence(html).rating).toBeNull();
  });
});
