import { describe, expect, it } from "vitest";

import { auditNumericClaims, measuredCriteria, winnerCriteria } from "./winner-criteria";

const base = {
  name: "Air Fryer 6 Qt",
  priceUsd: 41.42,
  rating: 4.9,
  ratingCount: null,
  salesVolume: 144,
  viewed90d: null,
  imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/A.jpg_960x960q75.jpg",
  sourceUrl: "https://www.aliexpress.com/item/1.html",
  sources: ["aliexpress-reader"],
  marginPct: 38,
  supplierPriceUsd: 22,
};

describe("winnerCriteria — denetlenebilir kazanan kararı", () => {
  it("ölçülen ürün 6/6 kriterle 'kanitli' verir", () => {
    const r = winnerCriteria(base);
    expect(r.measured).toBe(6);
    expect(r.total).toBe(6);
    expect(r.verdict).toBe("kanitli");
    expect(r.unmeasuredRate).toBe(0);
    expect(r.criteria.every((c) => c.status === "measured")).toBe(true);
    expect(r.summary).toContain("6/6");
    // Talep kanıtı satış adedini taşır (değerlendirme sayısı değil).
    expect(r.criteria.find((c) => c.id === "demand")!.value).toContain("144");
  });

  it("ölçülmeyen kriter '—' gösterir, 0 UYDURULMAZ", () => {
    const r = winnerCriteria({
      ...base,
      priceUsd: null,
      rating: null,
      salesVolume: null,
      marginPct: null,
      supplierPriceUsd: null,
      imageUrl: "",
    });
    expect(r.verdict).toBe("zayif");
    for (const c of r.criteria) {
      expect(c.value).toBe("—");
      expect(c.evidence).toBeNull();
      expect(c.detail).not.toContain("0%");
    }
    // Eksik kriterler özette ADIYLA görünür.
    expect(r.summary).toContain("Satış fiyatı");
    expect(r.summary).toContain("Görsel");
  });

  it("3-4 kriter ölçülünce 'kismi' der (tek skor yerine kanıt durumu)", () => {
    const r = winnerCriteria({
      ...base,
      marginPct: null,
      supplierPriceUsd: null,
      rating: null,
    });
    expect(r.measured).toBe(3);
    expect(r.verdict).toBe("kismi");
  });

  it("ölçülmüş kriterler kaynak + adres kanıtı taşır", () => {
    const r = winnerCriteria(base);
    const price = measuredCriteria(r).find((c) => c.id === "price")!;
    expect(price.evidence?.source).toBe("aliexpress-reader");
    expect(price.evidence?.url).toBe(base.sourceUrl);
  });
});

describe("auditNumericClaims — ölçülmeyen sayı gösterilmez", () => {
  it("kanıtta olan sayıyı korur", () => {
    const { kept, dropped } = auditNumericClaims(
      "Bu ürün son 90 günde 144 adet sattı. Marj %38.",
      [144, 38],
    );
    expect(dropped).toHaveLength(0);
    expect(kept).toContain("144");
    expect(kept).toContain("%38");
  });

  it("kanıtı olmayan sayı içeren cümleyi düşürür", () => {
    const { kept, dropped } = auditNumericClaims(
      "Bu ürün son 90 günde 144 adet sattı. Aylık net kâr 4200 dolar olur.",
      [144],
    );
    expect(dropped[0]).toContain("4200");
    expect(kept).toContain("144");
    expect(kept).not.toContain("4200");
  });

  it("ürün adındaki küçük sayıları iddia saymaz", () => {
    const { dropped } = auditNumericClaims("Air Fryer 6 Qt, 2 kişilik porsiyon.", []);
    expect(dropped).toHaveLength(0);
  });

  it("tolerans: yuvarlanmış eşleşme kabul edilir", () => {
    const { dropped } = auditNumericClaims("Marj %38,4 olarak ölçüldü.", [38]);
    expect(dropped).toHaveLength(0);
  });
});
