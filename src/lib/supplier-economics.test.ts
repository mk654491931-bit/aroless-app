// ============================================================================
// TEDARİK EKONOMİSİ TESTLERİ — saf fonksiyonlar, ağ YOK.
//
// KAPSAM: "ölçüldü mü?" sözleşmesi. Buradaki her `null` bir eksik değil, bir
// DÜRÜSTLÜK kararıdır: bilinmeyen sayı 0 yazılmaz.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  buildEconomics,
  buildMarginEvidence,
  buildSupplierEvidence,
  emptyMarginEvidence,
  emptySupplierEvidence,
  keyTokens,
  matchSupplierOffer,
  productTitleMatch,
  SupplierEvidenceSchema,
  SUPPLIER_MIN_RELEVANCE,
  type SupplierOfferLike,
} from "./supplier-economics";
import { hasMeasuredNetProfit } from "./economics-evidence";

/** Ölçülmüş toptan teklif (canlı AliExpress kartından alınan gerçek sayılar). */
function offer(over: Partial<SupplierOfferLike> = {}): SupplierOfferLike {
  return {
    title: "Cat Tree Tall Multi-Cat Climbing Tower Natural Sisal Scratching Post",
    unitPriceUsd: 26.36,
    listPriceUsd: 80.52,
    discountPct: 67,
    sold: 695,
    rating: 4.9,
    store: "PETRAEL Local Store",
    shipFrom: "US",
    url: "https://www.aliexpress.com/item/3256809985321027.html",
    ...over,
  };
}

describe("matchSupplierOffer", () => {
  it("alakalı teklifi bulur", () => {
    const hit = matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
      offer({ title: "Kedi tırmalama tahtası için battaniye" }),
      offer(),
    ]);
    expect(hit?.offer.url).toContain("3256809985321027");
  });

  it("alakasız teklifi KULLANMAZ — kanıt uydurmak marj uydurmaktan kötüdür", () => {
    const hit = matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
      offer({ title: "Wireless Bluetooth Speaker 40W" }),
    ]);
    expect(hit).toBeNull();
  });

  it("fiyatı olmayan teklifi aday saymaz", () => {
    const hit = matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
      offer({ unitPriceUsd: null }),
    ]);
    expect(hit).toBeNull();
  });
});

describe("buildSupplierEvidence", () => {
  it("fiyat bandını ÖLÇÜLEN tekliflerden kurar", () => {
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer(), offer({ unitPriceUsd: 17.52, sold: 154 }), offer({ unitPriceUsd: 44.4 })],
    );
    expect(evidence.samples).toBe(3);
    // p25/p75 DOĞRUSAL İNTERPOLASYONLA hesaplanır (3 örnek: sıralı
    // [17.52, 26.36, 44.40] → p25 = 17.52 + (26.36−17.52)×0.5 = 21.94).
    expect(evidence.supplierLowUsd).toBeCloseTo(21.94, 2);
    expect(evidence.supplierHighUsd).toBeCloseTo(35.38, 2);
    expect(evidence.supplierPriceUsd).toBeCloseTo(26.36, 2);
    expect(evidence.soldTotal).toBe(695 + 154 + 695);
  });

  it("eşleşme yoksa ALANLAR BOŞ kalır (0 yazmaz)", () => {
    expect(buildSupplierEvidence({ name: "Air Fryer", priceUsd: 99 }, [offer()])).toEqual(
      emptySupplierEvidence(),
    );
  });

  it("satış adedi ölçülmemişse null kalır", () => {
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer({ sold: null })],
    );
    expect(evidence.soldTotal).toBeNull();
  });
});

describe("buildMarginEvidence", () => {
  it("iki ÖLÇÜMDEN brüt marj ve kargoya kalan pay hesaplar", () => {
    const margin = buildMarginEvidence({ sellUsd: 97.99, supplierUsd: 26.36 });
    expect(margin.grossMarginPct).toBeCloseTo(73.1, 1);
    expect(margin.feeBudgetUsd).toBeCloseTo(71.63, 2);
  });

  it("satış fiyatı yoksa marj yoktur — 0 değil", () => {
    expect(buildMarginEvidence({ sellUsd: null, supplierUsd: 26.36 })).toEqual(
      emptyMarginEvidence(),
    );
  });

  it("toptan fiyat satıştan yüksekse marj hesaplanmaz", () => {
    expect(buildMarginEvidence({ sellUsd: 20, supplierUsd: 26.36 })).toEqual(emptyMarginEvidence());
  });

  it("NET marj ölçülmüş değil — kargo/komisyon kaynakta yok", () => {
    expect(buildMarginEvidence({ sellUsd: 97.99, supplierUsd: 26.36 }).netMarginPct).toBeNull();
  });
});

describe("buildEconomics", () => {
  it("ölçülen tedarik + ölçülen marj birlikte döner", () => {
    const { supplier, margin } = buildEconomics(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer()],
    );
    expect(supplier.supplierPriceUsd).toBeCloseTo(26.36, 2);
    expect(margin.grossMarginPct).toBeCloseTo(73.1, 1);
    expect(margin.feeBudgetUsd).toBeCloseTo(71.63, 2);
  });
});

describe("SupplierEvidenceSchema", () => {
  it("kanıtı kaybetmeden geçirir (zod alanı düşürme hatasının regresyon testi)", () => {
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer()],
    );
    const parsed = SupplierEvidenceSchema.parse(evidence);
    expect(parsed.supplierPriceUsd).toBe(evidence.supplierPriceUsd);
    expect(parsed.samples).toBe(evidence.samples);
    expect(parsed.shipFrom).toBe("US");
  });
});

describe("keyTokens — başlığın SONDAN ayırt edici kelimeleri", () => {
  it("marka kelimelerini birakır, ürün adını taşıyan son kelimeleri alır", () => {
    expect(keyTokens("Frisco & Co. 34 in. Tall Cat Tree with 6 Sisal Scratching Posts")).toEqual([
      "sisal",
      "scratching",
      "posts",
    ]);
  });

  it("kısa ama ayırt edici kelimeyi atlamaz (mat/pad/toy)", () => {
    // "mat" 3 harfle: uzunluk filtresi 3'te bırakılıyor, aksi hâlde tırmalama
    // matı ile kedi ağacı aynı ürün sanılırdı (ölçülen hata).
    expect(keyTokens("Reversible Cat Scratcher Mat")).toEqual(["cat", "scratcher", "mat"]);
  });
});

describe("productTitleMatch — ölçülen alakasız eşleşme regresyonu", () => {
  it("alakasız ürün (dog crate) kedi ağacı teklifiyle EŞLEŞMEZ", () => {
    // ÖLÇÜLEN HATA: ilk sürümde bu satır 0,75 skorla eşleşiyor ve kartta
    // $83,58 “tedarik fiyatı” gösteriyordu.
    const score = productTitleMatch(
      "Frisco & Co. Extra Large Heavy Duty Dog Crate 54 inch, Single Door Divider Panel",
      "JHK 44In Cat Tree Tall Multi-Cat Climbing Tower Sisal Scratching Post",
    );
    expect(score).toBeLessThan(SUPPLIER_MIN_RELEVANCE);
    expect(
      matchSupplierOffer(
        {
          name: "Frisco & Co. Extra Large Heavy Duty Dog Crate 54 inch, Single Door Divider Panel",
          priceUsd: 79.99,
        },
        [offer()],
      ),
    ).toBeNull();
  });

  it("aynı nişte farklı ürün ailesini AYIRIR (mat ≠ kedi ağacı)", () => {
    const evidence = buildSupplierEvidence(
      {
        name: "FukUMARU Cat Scratching Mat 3 Pack, Reversible Cat Scratcher Board",
        priceUsd: 9.99,
      },
      [offer()],
    );
    expect(evidence.samples).toBe(0);
  });
});

describe("hasMeasuredNetProfit — toptan fiyat ölçüldü diye net marj UYDURULMAZ", () => {
  it("yalnız toptan maliyet varsa net kâr ÖLÇÜLMEMİŞ sayılır", () => {
    expect(hasMeasuredNetProfit({ cost_breakdown: { supplier_cost: "26.36" } })).toBe(false);
  });

  it("dört maliyet kalemi birlikte ölçülmüşse net kâr hesaplanabilir", () => {
    expect(
      hasMeasuredNetProfit({
        cost_breakdown: {
          supplier_cost: "26.36",
          shipping_cost: "8",
          platform_fee: "10",
          ad_spend: "5",
        },
      }),
    ).toBe(true);
  });

  it("ölçülmüş net kâr varsa kabul edilir", () => {
    expect(hasMeasuredNetProfit({ cost_breakdown: { net_profit: "71.63" } })).toBe(true);
  });
});
