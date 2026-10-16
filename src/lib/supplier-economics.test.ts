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
  nicheHitFloor,
  nicheKeyTokens,
  nicheMatch,
  productTitleMatch,
  supplierMatchKind,
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

describe("NİŞ seviyesi tedarik yedeği — çok dilli başlıklarda '—' kalmasın", () => {
  /** Canlı AliExpress kartlarından alınan GERÇEK İngilizce teklifler. */
  const englishOffers = [
    offer({ title: "Air Fryer 6L Large Capacity Oil-free Electric Oven", unitPriceUsd: 42.5 }),
    offer({ title: "Household Air Fryer 5.5L Digital Touch Screen Fryer Oven", unitPriceUsd: 35.2 }),
    offer({ title: "Wireless Bluetooth Speaker 40W", unitPriceUsd: 12 }),
  ];

  it("Türkçe başlıkta birebir eşleşme yok ama niş bandı ÖLÇÜLÜR", () => {
    const candidate = { name: "Bosch MAF240B0 Serie 2 Air Fryer Sıcak Hava Fritözü 4,5 L", priceUsd: 123.45 };
    // Yedek KAPALIYKEN (eski davranış) kanıt boş kalır — bu, ölçülen bugünkü hâl.
    expect(buildSupplierEvidence(candidate, englishOffers)).toEqual(emptySupplierEvidence());

    // Niş ifadeleri verildiğinde bant gerçek tekliflerden kurulur.
    const evidence = buildSupplierEvidence(candidate, englishOffers, {
      nicheQueries: ["air fryer"],
    });
    expect(evidence.samples).toBe(2);
    expect(evidence.supplierPriceUsd).toBeCloseTo(38.85, 2);
    // Kanıtın gücü SAKLANMAZ: bu bir niş bandıdır, birebir ürün fiyatı değil.
    expect(supplierMatchKind(evidence)).toBe("niche");
    // Alakasız hoparlör teklifi banda KARIMAZ.
    // p25 doğrusal interpolasyon: 35.2 + (42.5−35.2)×0.25 = 37.03
    expect(evidence.supplierLowUsd).toBeCloseTo(37.03, 2);
  });

  it("niş eşleşmesi marjı da hesaplanabilir kılar (marj '—' kalmasın)", () => {
    const { supplier, margin } = buildEconomics(
      { name: "Bosch MAF240B0 Sıcak Hava Fritözü", priceUsd: 123.45 },
      englishOffers,
      { nicheQueries: ["air fryer"] },
    );
    expect(supplier.supplierPriceUsd).not.toBeNull();
    expect(margin.grossMarginPct).toBeGreaterThan(0);
    expect(margin.netMarginPct).toBeNull();
  });

  it("niş ifadesi verilmezse DAVRANIŞ DEĞİŞMEZ (uydurma yok)", () => {
    expect(
      buildEconomics({ name: "Bosch MAF240B0 Sıcak Hava Fritözü", priceUsd: 123.45 }, englishOffers),
    ).toEqual({
      supplier: emptySupplierEvidence(),
      margin: emptyMarginEvidence(),
    });
  });

  it("birebir ürün eşleşmesi bulunduğunda tür 'product' kalır", () => {
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer()],
      { nicheQueries: ["cat tree"] },
    );
    expect(supplierMatchKind(evidence)).toBe("product");
  });
});

describe("nicheKeyTokens / nicheMatch", () => {
  it("niş ifadesinin jenerik olmayan kelimelerini alır, tekrarları birleştirir", () => {
    // Türkçe harfler ASCII'ye indirilir; noktasız ı AKSİ hâlde kelimeyi
    // bölerdi ve niş anahtarı kaybolurdu.
    expect(nicheKeyTokens(["Sıcak Hava Fritözü", "air fryer", "air fryer 5l"]).sort()).toEqual([
      "air",
      "fritozu",
      "fryer",
      "hava",
      "sicak",
    ]);
  });

  it("kısa kelimeleri (2 harf) atlar", () => {
    expect(nicheKeyTokens(["led tv"])).toEqual(["led"]);
  });

  it("isabet oranını ölçer ve niş dışı teklifi 0 verir", () => {
    expect(nicheMatch("Air Fryer 6L Oil-free", ["air", "fryer"])).toBe(1);
    expect(nicheMatch("Wireless Bluetooth Speaker", ["air", "fryer"])).toBe(0);
    expect(nicheMatch("Steel Air Compressor", ["air", "fryer"])).toBeCloseTo(0.5, 5);
  });

  it("6+ harfli kelimelerde ilk 6 harf toleransı vardır (vacuum ↔ vacuums)", () => {
    expect(nicheMatch("Robot Vacuums 4000Pa", ["vacuum"])).toBe(1);
    // 5 harfli kelimede tolerans YOKTUR: sahte eşleşme üretmemek için.
    expect(nicheMatch("Air Fryers 6L", ["fryer"])).toBe(0);
  });

  it("eşik: 3 anahtarda 2, 2 anahtarda 1, tek anahtarda 1 isabet", () => {
    expect(nicheHitFloor(1)).toBe(1);
    expect(nicheHitFloor(2)).toBe(1);
    expect(nicheHitFloor(3)).toBe(2);
    expect(nicheHitFloor(4)).toBe(2);
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
    expect(parsed.matchKind).toBe("product");
  });

  it("MOQ + FOB ARALIĞI eşleşen tekliften kanıta geçer (ölçülen, uydurulmayan)", () => {
    // MIC kartından ölçülmüş gerçek satırlar: US$13.00-15.00 FOB, 1.200 adet MOQ.
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer({ unitPriceUsd: 13, unitPriceHighUsd: 15, moqUnits: 1200, moqUnit: "pieces" })],
    );
    expect(evidence.supplierPriceUsd).toBe(13);
    expect(evidence.supplierPriceHighUsd).toBe(15);
    expect(evidence.moqUnits).toBe(1200);
    expect(evidence.moqUnit).toBe("pieces");
    // Şemadan da kaybolmaz (zod alan düşürme hatasının regresyonu).
    const parsed = SupplierEvidenceSchema.parse(evidence);
    expect(parsed.moqUnits).toBe(1200);
    expect(parsed.supplierPriceHighUsd).toBe(15);
  });

  it("MOQ ölçülmediyse `null` kalır — 0 yazmak 'bedava sipariş' demek olurdu", () => {
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer()],
    );
    expect(evidence.moqUnits).toBeNull();
    expect(evidence.moqUnit).toBe("");
    expect(evidence.supplierPriceHighUsd).toBeNull();
  });

  it("satış adedi olmayan (MOQ'lu) teklifin mağazası kaybolmaz", () => {
    // AliExpress satış adedi olup mağaza adı BOŞ kart üretebiliyor (ölçüldü:
    // 60 kartın 10'u). Birleşik havuzda MIC'in firma adı bu durumda korunur.
    const evidence = buildSupplierEvidence(
      { name: "Cat Tree with Scratching Post", priceUsd: 97.99 },
      [offer({ store: "", sold: 695 })],
    );
    expect(evidence.store).toBe("");
    const withMargin = buildMarginEvidence({
      sellUsd: 97.99,
      supplierUsd: evidence.supplierPriceUsd,
    });
    expect(withMargin.grossMarginPct).not.toBeNull();
  });

  it("`matchKind` EKLENMEDEN ÖNCE yazılmış kayıtları düşürmez", () => {
    // Eski kayıtta alan yoktur; zorunlu olsaydı zod hatayı fırlatır ve üst
    // alan `.catch(null)` ile TÜM kanıtı silerdi (ölçülen hata sınıfı).
    const legacy = {
      samples: 2,
      supplierPriceUsd: 26.36,
      supplierLowUsd: 21.94,
      supplierHighUsd: 35.38,
      listPriceUsd: 80.52,
      discountPct: 67,
      soldTotal: 695,
      store: "PETRAEL Local Store",
      shipFrom: "US",
      url: "https://www.aliexpress.com/item/3256809985321027.html",
    };
    const parsed = SupplierEvidenceSchema.parse(legacy);
    expect(parsed.supplierPriceUsd).toBe(26.36);
    expect(parsed.matchKind).toBeUndefined();
    // MOQ/FOB aralığı alanları da eski kayıtta YOKTUR: zorunlu olsalardı aynı
    // şekilde tüm kanıt düşerdi.
    expect(parsed.moqUnits).toBeUndefined();
    expect(parsed.supplierPriceHighUsd).toBeUndefined();
    // Taşımayan kayıt "birebir ürün" sayılır (eskiden tek yol oydu).
    expect(supplierMatchKind(parsed)).toBe("product");
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
