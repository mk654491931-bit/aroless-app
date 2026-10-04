/**
 * ÜRÜN KALİTE KATMANI — saf birim testleri.
 *
 * Üç sözleşme kilitleniyor:
 *   1. `productId` hattın tamamında DEĞİŞMEZ ve iki farklı ürünü karıştırmaz.
 *   2. `dataCompletenessScore` YALNIZ ölçülmüş alanı ödüllendirir — eksik alan
 *      doldurulmaz, skoru düşürür ve ADIyla raporlanır.
 *   3. `sourceConfidence` modelin ürettiği satıra güven puanı VERMEZ.
 */
import { describe, expect, it } from "vitest";

import {
  bumpCount,
  COMPLETENESS_FIELDS,
  dataCompletenessScore,
  describeFunnel,
  emptyFunnel,
  PIPELINE_STAGES,
  productCompleteness,
  productIdOf,
  SOURCE_CONFIDENCE_WEIGHTS,
  sourceConfidence,
  stableProductId,
} from "./discovery-quality";
import { productFingerprint, type NormalizedProduct } from "./product-discovery.types";

describe("stableProductId — hat boyunca değişmez kimlik", () => {
  const base = { title: "Philips 3000 Series Airfryer", brand: "Philips", seller: "shop" };

  it("aynı girdiden aynı kimliği üretir (deterministik)", () => {
    expect(stableProductId(base)).toBe(stableProductId(base));
  });

  it("kimlik başlıktan türetilir ama başlığın kendisi DEĞİLDİR", () => {
    const id = stableProductId(base);
    expect(id.startsWith("p_")).toBe(true);
    // Uzun/boşluklu başlık kısaltılır ve hash ile sabitlenir.
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).not.toContain(" ");
  });

  it("farklı satır kimliği aynı ürünü AYRI ürün saymaz (QStash mükerrer teslimatı)", () => {
    // Aynı ürün, aynı kaynaktan iki farklı satır kimliğiyle geldi.
    const a = stableProductId({ ...base, id: "sku-111" });
    const b = stableProductId({ ...base, id: "sku-222" });
    expect(a).not.toBe(b);
    // Ama kaynak kimliği verilmediğinde ikisi de aynı ürüne çöker.
    expect(stableProductId({ ...base, id: "" })).toBe(stableProductId({ ...base, id: "" }));
  });

  it("iki farklı ürün farklı kimlik alır", () => {
    const a = stableProductId({ title: "Air Fryer 5.5L", brand: "Acme", seller: "shop" });
    const b = stableProductId({ title: "Robot Vacuum L5", brand: "Roborock", seller: "shop" });
    expect(a).not.toBe(b);
  });

  it("marka + model kodu aynıysa aynı kimliğe düşer (kopya birleşimi)", () => {
    // Ölçülen canlı kaçırma: aynı ürün iki mağazada farklı yazılınca iki kez
    // nihai listeye giriyordu. Model kodu aynıysa kimlik aynı olmalı.
    const a = stableProductId({ title: "CASABREWS CM5418 Espresso Machine", brand: "CASABREWS" });
    const b = stableProductId({ title: "CASABREWS CM5418 Espresso Machine", brand: "CASABREWS" });
    expect(a).toBe(b);
  });

  it("başlık boşsa kimlik UYDURMAZ, boş döner", () => {
    expect(stableProductId({ title: "" })).toBe("");
    expect(stableProductId({ title: "   " })).toBe("");
  });
});

describe("productIdOf — normalize üründen kimlik", () => {
  const product = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
    name: "Air Fryer 5.5L",
    brand: "Acme",
    seller: "shop",
    category: "",
    priceUsd: 59.9,
    rating: 4.6,
    ratingCount: 210,
    inStock: true,
    sources: ["test"],
    url: "https://example.test/p",
    notes: "",
    viewed90d: null,
    id: "p-1",
    imageUrl: "https://cdn.test/air-fryer.jpg",
    salesVolume: 940,
    fingerprint: productFingerprint({ title: "Air Fryer 5.5L", brand: "Acme", seller: "shop" }),
    preScore: 72,
    signals: { demand: 70, competition: 60, margin: 80, rating: 75, availability: 85 },
    dataCompleteness: 4,
    missingFields: [],
    source: "scraped",
    ...over,
  });

  it("kimlik boş değildir ve tekrarlanabilir", () => {
    expect(productIdOf(product())).toBe(productIdOf(product()));
    expect(productIdOf(product()).length).toBeGreaterThan(3);
  });

  it("kaynak satırı olmayan ürün de kimlik alır (id boş)", () => {
    expect(productIdOf(product({ id: "" })).length).toBeGreaterThan(3);
  });
});

describe("dataCompletenessScore — yalnız ÖLÇÜLMÜŞ alan ödüllendirilir", () => {
  it("hiçbir alan ölçülmediyse 0 döner ve EKSİKLERİ ADIYLA listeler", () => {
    const result = dataCompletenessScore({});
    expect(result.score).toBe(0);
    expect(result.measured).toBe(0);
    expect(result.missing).toHaveLength(COMPLETENESS_FIELDS.length);
    expect(result.missing).toContain("Başlık");
    expect(result.missing).toContain("Fiyat");
  });

  it("tam ölçülmüş ürün 100 alır", () => {
    const result = dataCompletenessScore({
      title: "Air Fryer 5.5L",
      url: "https://shop.test/p",
      priceUsd: 59.9,
      currencyMeasured: true,
      rating: 4.6,
      ratingCount: 210,
      imageUrl: "https://cdn.test/a.jpg",
      imageVerified: true,
      inStock: true,
      brand: "Acme",
      category: "Mutfak",
    });
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it("eksik alan skoru DÜŞÜRÜR — sahte doldurma yok", () => {
    const full = dataCompletenessScore({
      title: "A",
      url: "https://s.test/p",
      priceUsd: 10,
      rating: 4,
      ratingCount: 10,
      imageUrl: "https://c.test/a.jpg",
      imageVerified: true,
      inStock: true,
      brand: "B",
      category: "C",
    });
    const thin = dataCompletenessScore({ title: "A" });
    expect(thin.score).toBeLessThan(full.score);
    expect(thin.missing.length).toBeGreaterThan(0);
  });

  it("DOĞRULANMAMIŞ görsel sayılmaz (adresi olması yeterli değil)", () => {
    const unverified = dataCompletenessScore({ imageUrl: "https://c.test/a.jpg" });
    expect(unverified.missing).toContain("Ürün görseli");
    const verified = dataCompletenessScore({
      imageUrl: "https://c.test/a.jpg",
      imageVerified: true,
    });
    expect(verified.missing).not.toContain("Ürün görseli");
  });

  it("fiyat 0/negatif/NaN ÖLÇÜM DEĞİLDİR", () => {
    for (const priceUsd of [0, -5, Number.NaN]) {
      const result = dataCompletenessScore({ title: "A", priceUsd });
      expect(result.missing).toContain("Fiyat");
    }
  });

  it("stok BİLİNMEYORSEN nötr sayılır (null ≠ false)", () => {
    expect(dataCompletenessScore({ inStock: null }).missing).toContain("Stok");
    expect(dataCompletenessScore({ inStock: false }).missing).not.toContain("Stok");
  });

  it("normalize üründen de hesaplanır", () => {
    const result = productCompleteness({
      name: "Air Fryer",
      brand: "Acme",
      seller: "s",
      category: "",
      priceUsd: 59.9,
      rating: 4.6,
      ratingCount: 210,
      inStock: true,
      sources: ["t"],
      url: "https://e.test/p",
      notes: "",
      viewed90d: null,
      id: "x",
      imageUrl: "https://c.test/a.jpg",
      salesVolume: null,
      fingerprint: "fp",
      preScore: 50,
      signals: { demand: 50, competition: 50, margin: 50, rating: 50, availability: 50 },
      dataCompleteness: 3,
      missingFields: [],
      source: "scraped",
    } as NormalizedProduct);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });
});

describe("sourceConfidence — yalnız gerçek veriden", () => {
  const strong = {
    origin: "scraped" as const,
    url: "https://shop.test/p",
    sourceCount: 3,
    completenessScore: 100,
  };

  it("çok kaynaklı, tam ölçülmüş satır yüksek güven alır", () => {
    expect(sourceConfidence(strong)).toBeGreaterThanOrEqual(90);
  });

  it("AI ÜRETİMİ satır güven almaz (0) — kanıt değildir", () => {
    expect(sourceConfidence({ ...strong, origin: "ai" })).toBe(0);
  });

  it("kaynak adresi olmayan satır düşer", () => {
    const withUrl = sourceConfidence(strong);
    const withoutUrl = sourceConfidence({ ...strong, url: "" });
    expect(withoutUrl).toBeLessThan(withUrl);
  });

  it("eksik alan arttıkça güven düşer", () => {
    expect(sourceConfidence({ ...strong, completenessScore: 20 })).toBeLessThan(
      sourceConfidence(strong),
    );
  });

  it("ikinci bağımsız kaynak güveni hızlı artırır", () => {
    const one = sourceConfidence({ ...strong, sourceCount: 1 });
    const two = sourceConfidence({ ...strong, sourceCount: 2 });
    expect(two).toBeGreaterThan(one);
    expect(sourceConfidence({ ...strong, sourceCount: 4 })).toBeGreaterThanOrEqual(two);
  });

  it("ağırlıklar toplamı 1'dir (skor 100'ü aşamaz)", () => {
    const total = Object.values(SOURCE_CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("skor 0-100 aralığında kalır", () => {
    expect(sourceConfidence({})).toBeGreaterThanOrEqual(0);
    expect(sourceConfidence(strong)).toBeLessThanOrEqual(100);
  });
});

describe("funnel gözlemlenebilirliği", () => {
  it("boş huni tüm aşamaları 0 yapar", () => {
    const funnel = emptyFunnel();
    expect(Object.keys(funnel)).toHaveLength(PIPELINE_STAGES.length);
    expect(Object.values(funnel).every((n) => n === 0)).toBe(true);
  });

  it("aşamaları sayıyla, sırayla listeler", () => {
    const line = describeFunnel({ scraped: 1842, filtered: 312, top75: 75 });
    expect(line).toContain("SCRAPED: 1842");
    expect(line).toContain("FILTERED: 312");
    expect(line.indexOf("SCRAPED")).toBeLessThan(line.indexOf("TOP75"));
  });

  it("eleme dökümünü ekler (hangi aşamada kaç ürün elendi)", () => {
    const line = describeFunnel(
      { scraped: 1000, filtered: 75 },
      { "bozuk görsel": 82, "eksik fiyat": 101, duplicate: 230 },
    );
    expect(line).toContain("duplicate: 230");
    expect(line).toContain("eksik fiyat: 101");
  });

  it("sıfır eleme sayılarını yazmaz (gürültü olmaz)", () => {
    const line = describeFunnel({ scraped: 10 }, { duplicate: 0, rating: 0 });
    expect(line).not.toContain("duplicate");
    expect(line).toBe("SCRAPED: 10");
  });

  it("bozuk girdide NaN üretmez", () => {
    expect(bumpCount(Number.NaN)).toBe(1);
    expect(bumpCount(undefined, 5)).toBe(5);
    expect(bumpCount(-3)).toBe(0);
  });
});
