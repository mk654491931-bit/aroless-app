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
  specConflict,
  specMap,
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

  it("EŞİT alakalılıkta BAŞLATILABİLİR teklifi seçer (düşük MOQ, kaynak sırası değil)", () => {
    // Ölçülen sorun: aynı nişte MOQ 10 olan teklif varken MOQ 1.000 olan teklif
    // kanıta yazılıyordu, yani "ilk sipariş 26.360 dolar" görünüyordu.
    const expensive = offer({ unitPriceUsd: 26.36, moqUnits: 1000, url: "https://x/1.html" });
    const startable = offer({ unitPriceUsd: 26.36, moqUnits: 10, url: "https://x/2.html" });
    const hit = matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
      expensive,
      startable,
    ]);
    expect(hit?.offer.url).toBe("https://x/2.html");
    // İlk sipariş sermayesi en küçük olan kazanır.
    const mid = offer({ unitPriceUsd: 26.36, moqUnits: 50, url: "https://x/3.html" });
    expect(
      matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
        startable,
        mid,
      ])?.offer.url,
    ).toBe("https://x/2.html");
    expect(
      matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
        mid,
        startable,
      ])?.offer.url,
    ).toBe("https://x/2.html");
  });

  it("MOQ'su BİLİNMEYEN teklif, KANITLI yüksek MOQ'dan iyidir (kanıt yok ≠ kanıt kötü)", () => {
    const unknownMoq = offer({
      unitPriceUsd: 26.36,
      moqUnits: null,
      url: "https://x/unknown.html",
    });
    const highMoq = offer({ unitPriceUsd: 26.36, moqUnits: 5000, url: "https://x/high.html" });
    expect(
      matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
        highMoq,
        unknownMoq,
      ])?.offer.url,
    ).toBe("https://x/unknown.html");
  });

  it("alakalılık FARKLIYSA başlatılabilirlik onu EZMEZ (önce eşleşme kalitesi)", () => {
    const exact = offer({
      title: "Cat Tree with Scratching Post Tall Tower",
      unitPriceUsd: 26.36,
      moqUnits: 1000,
      url: "https://x/exact.html",
    });
    const partial = offer({
      title: "Cat Scratching Post",
      unitPriceUsd: 20,
      moqUnits: 1,
      url: "https://x/partial.html",
    });
    const hit = matchSupplierOffer({ name: "Cat Tree with Scratching Post", priceUsd: 97.99 }, [
      partial,
      exact,
    ]);
    expect(hit!.relevance).toBeGreaterThan(SUPPLIER_MIN_RELEVANCE);
    expect(hit?.offer.url).toBe("https://x/exact.html");
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
    offer({
      title: "Household Air Fryer 5.5L Digital Touch Screen Fryer Oven",
      unitPriceUsd: 35.2,
    }),
    offer({ title: "Wireless Bluetooth Speaker 40W", unitPriceUsd: 12 }),
  ];

  it("Türkçe başlıkta birebir eşleşme yok ama niş bandı ÖLÇÜLÜR", () => {
    const candidate = {
      name: "Bosch MAF240B0 Serie 2 Air Fryer Sıcak Hava Fritözü 4,5 L",
      priceUsd: 123.45,
    };
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

  it("niş havuzunda MOQ/aralık HAVUZUN İLK teklifinden değil, EN BAŞLATILABİLİR tekliften alınır", () => {
    // ÖLÇÜLEN HATA: eski kod `nicheOffers[0]`i seçiyordu — yani kaynak
    // sırasına göre rastgele bir teklifi. Aynı nişte MOQ 10 olan tedarikçi
    // masadayken kanıta MOQ 1.000 yazılabiliyor, "ilk sipariş sermayesi" bu
    // ürünün değil o rastgele teklifin rakamı oluyordu.
    const offers = [
      offer({
        title: "Air Fryer 6L Large Capacity Oil-free Electric Oven",
        unitPriceUsd: 40,
        unitPriceHighUsd: 42,
        moqUnits: 1000,
        moqUnit: "pieces",
        store: "Buyuk MOQ Ltd.",
        sold: 12,
      }),
      offer({
        title: "Household Air Fryer 5.5L Digital Touch Screen Fryer Oven",
        unitPriceUsd: 41,
        unitPriceHighUsd: 43,
        moqUnits: 10,
        moqUnit: "pieces",
        store: "Kucuk MOQ Ltd.",
        sold: 4200,
      }),
    ];
    const evidence = buildSupplierEvidence(
      { name: "Bosch MAF240B0 Sıcak Hava Fritözü", priceUsd: 129.9 },
      offers,
      { nicheQueries: ["air fryer"] },
    );
    expect(supplierMatchKind(evidence)).toBe("niche");
    expect(evidence.moqUnits).toBe(10);
    expect(evidence.store).toBe("Kucuk MOQ Ltd.");
    // Bant YİNE havuzun tamamından kurulur (medyan değişmez).
    expect(evidence.samples).toBe(2);
    expect(evidence.supplierPriceUsd).toBe(40.5);
  });

  it("tüm niş teklifleri tavanın üstündeyse en DÜŞÜK ilk sipariş sermayesi seçilir", () => {
    const offers = [
      offer({
        title: "Air Fryer 6L Large Capacity Electric Oven",
        unitPriceUsd: 30,
        moqUnits: 900, // 27.000 $
        store: "Cok Pahali Ltd.",
        sold: 5,
      }),
      offer({
        title: "Household Air Fryer 5.5L Digital Fryer Oven",
        unitPriceUsd: 60,
        moqUnits: 100, // 6.000 $ — daha küçük ilk sipariş
        store: "Daha Az Pahali Ltd.",
        sold: 3100,
      }),
    ];
    const evidence = buildSupplierEvidence(
      { name: "Bosch MAF240B0 Sıcak Hava Fritözü", priceUsd: 199 },
      offers,
      { nicheQueries: ["air fryer"] },
    );
    expect(evidence.store).toBe("Daha Az Pahali Ltd.");
    expect(evidence.moqUnits).toBe(100);
  });

  it("niş ifadesi verilmezse DAVRANIŞ DEĞİŞMEZ (uydurma yok)", () => {
    expect(
      buildEconomics(
        { name: "Bosch MAF240B0 Sıcak Hava Fritözü", priceUsd: 123.45 },
        englishOffers,
      ),
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

/* ------------------------------------------------------------------ */
/* ÖLÇÜ ÇELİŞME KAPISI — "6 Qt ürün 3 Qt teklifle fiyatlanamaz"         */
/* ------------------------------------------------------------------ */

describe("specConflict / specMap — ölçü çelişmesi yakalanır, yanlış alarm üretilmez", () => {
  it("hacim farkı (liter ↔ quart) çelişmedir — birimler çevrilerek karşılaştırılır", () => {
    // Ölçüm notu: 6 Qt ile 5,5 L AYNI hacimdir (6 × 0,946 = 5,68 L) ve kapı
    // bunu doğru şekilde çelişme SAYMAZ; kapı asıl olarak 10 L ↔ 3 L gibi
    // gerçek boy farklarını yakalar.
    expect(specConflict("8-in-1 Air Fryer 6 Qt, Premium Ceramic", "Air Fryer 3 L Oven")).toBe(true);
    expect(specConflict("10L Large Capacity Air Fryer", "Family Air Fryer 3 L")).toBe(true);
  });

  it("6 Qt ile 5,5 L AYNI sayılır — doğru tedarikçi ölçü yüzünden kaybedilmez", () => {
    expect(specConflict("8-in-1 Air Fryer 6 Qt", "Air Fryer 5.5L Digital Oven")).toBe(false);
  });

  it("aynı hacim farklı yazımla ÇELİŞMEZ (5,5L ↔ 5.5 l)", () => {
    expect(specConflict("Air Fryer 5,5 L Digital", "Air Fryer 5.5L Digital Oven")).toBe(false);
    expect(specConflict("Air Fryer 6 qt", "Air Fryer 6 Quart")).toBe(false);
  });

  it("±%10 tolerans içindeki fark çelişme sayılmaz (pazarlama yuvarlaması)", () => {
    expect(specConflict("Air Fryer 6.0 L", "Air Fryer 6.3L")).toBe(false);
    expect(specConflict("Air Fryer 6.0 L", "Air Fryer 7.0L")).toBe(true);
  });

  it("güç farkı çelişmedir (1000W ↔ 1500W)", () => {
    expect(specConflict("Air Fryer 1500W Digital", "Air Fryer 2000W Oven")).toBe(true);
    expect(specConflict("Air Fryer 1500W Digital", "Air Fryer 1500 W Oven")).toBe(false);
  });

  it("adet/paket farkı çelişmedir (2 paket teklif tekli ürünle bir tutulmaz)", () => {
    expect(specConflict("Bamboo Organizer 1 pc", "Bamboo Organizer 4 pcs set")).toBe(true);
  });

  it("tek taraflı ölçü KARAR VERDİRMEZ (uydurma yok)", () => {
    expect(specConflict("Air Fryer with Digital Touch", "Air Fryer 3 L Oven")).toBe(false);
    expect(specConflict("Air Fryer 6 Qt", "Air Fryer with Digital Touch")).toBe(false);
  });

  it("hiç ölçü yoksa çelişme de yoktur", () => {
    expect(specConflict("Cat Tree with Scratching Post", "Cat Tree Tall Climbing Tower")).toBe(
      false,
    );
  });

  it("yanlış okumaya açık yazımlar ölçü SAYILMAZ (2 in 1, model kodu)", () => {
    // “2 in 1” inch olarak okunursa doğru tedarikçi kaybedilirdi.
    expect(specMap("2 in 1 Robot Vacuum and Mop").length).toBeUndefined();
    expect(specMap("Robot Vacuum MAF240B0").length).toBeUndefined();
    // Gerçek ölçüler okunur.
    expect(specMap("Air Fryer 6 Qt").volume).toBeCloseTo(5678.1, 0);
    expect(specMap("Tower Fan 180 cm").length).toEqual([1800]);
    expect(specMap("Air Fryer 1500W").power).toEqual([1500]);
  });

  it("MATCH KAPISI: en ALAKALI ama YANLIŞ BOY teklif elenir (marj yanlış fiyattan hesaplanmaz)", () => {
    // İki teklif de başlık olarak tam eşleşiyor; ayıran tek şey HACİM.
    // Kapı olmasa ucuz olan (3 L) seçilir ve 10 L'lik ürünün marjı onun
    // fiyatından hesaplanırdı — ölçülen yanlış maliyet.
    const offers = [
      offer({ title: "Air Fryer 3 L Capacity Oven", unitPriceUsd: 19.9 }),
      offer({ title: "Air Fryer 10L Large Capacity Oven", unitPriceUsd: 45.5 }),
    ];
    const hit = matchSupplierOffer(
      { name: "Air Fryer 10L Large Capacity Oven", priceUsd: 129.9 },
      offers,
    );
    expect(hit?.offer.unitPriceUsd).toBe(45.5);
  });
});
