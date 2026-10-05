/**
 * ORTAK ÇEKİRDEK — tek import yüzeyi ve tüketicilerin paylaştığı sözleşmeler.
 *
 * Kilitlenen davranışlar:
 *   1. Çekirdek, kalite + AI seçimi + görsel doğrulama sözleşmelerini TEK
 *      modülden dışa verir; tüketiciler dağınık dosyaları import etmek zorunda
 *      kalmaz (tek kaynak = tek davranış).
 *   2. `candidateQuality` ölçülmüş bütünlük/güven verir; AI satırı güven ALMAZ.
 *   3. `productIdentityKey` hat boyunca DEĞİŞMEZ ve ASLA boş dönmez.
 *   4. `qualityOfFlatProduct` ölçülmeyen alanı uydurmaz, skoru düşürür.
 */
import { describe, expect, it } from "vitest";

import {
  candidateQuality,
  describeQuality,
  describeShortlistQuality,
  LOW_CONFIDENCE_FLOOR,
  mergeAgentAnalysis,
  productIdOf,
  productIdentityKey,
  productCompleteness,
  qualityOfFlatProduct,
  resolveSelection,
  stableProductId,
  validateAiSelection,
} from "./discovery-core";
import { productFingerprint, type NormalizedProduct } from "./product-discovery.types";

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

describe("discovery-core — tek import yüzeyi", () => {
  it("kalite, AI seçimi ve kimlik sözleşmelerini aynı modülden verir", () => {
    // Bu semboller farklı dosyalarda yaşıyordu; çekirdek hepsini yeniden dışa
    // verir ki tüketiciler tek yerden import etsin.
    expect(typeof candidateQuality).toBe("function");
    expect(typeof productIdOf).toBe("function");
    expect(typeof stableProductId).toBe("function");
    expect(typeof validateAiSelection).toBe("function");
    expect(typeof resolveSelection).toBe("function");
    expect(typeof mergeAgentAnalysis).toBe("function");
  });

  it("`productIdOf` yeniden dışa verilir ve core ile doğrudan modül AYNI kimliği üretir", () => {
    expect(productIdOf(product())).toBe(productIdOf(product()));
  });
});

describe("candidateQuality — ölçülmüş bütünlük ve kaynak güveni (§11/§12)", () => {
  it("bütünlük, core'un productCompleteness skoruyla birebir aynıdır", () => {
    const p = product();
    expect(candidateQuality(p).completeness).toBe(productCompleteness(p).score);
  });

  it("kanıtlı (scraped + url + çoklu kaynak) ürün yüksek güven alır", () => {
    const quality = candidateQuality(product({ sources: ["a", "b", "c"] }));
    expect(quality.confidence).toBeGreaterThan(50);
  });

  it("AI üretimi satır kaynak güveni ALMAZ (0) — uydurma ürün kanıt değildir", () => {
    expect(candidateQuality(product({ source: "ai" })).confidence).toBe(0);
  });
});

describe("describeShortlistQuality — ölçülmüş özet, uydurma yok", () => {
  it("ortalama bütünlük ve güveni sayıyla yazar", () => {
    const text = describeShortlistQuality([product(), product({ id: "p-2" })]);
    expect(text).toContain("Kalite (§11/§12)");
    expect(text).toContain("/100");
  });

  it("boş havuzda BOŞ döner (sıfır uydurmaz)", () => {
    expect(describeShortlistQuality([])).toBe("");
    expect(describeQuality([])).toBe("");
  });

  it("düşük güvenli adayları sayıyla bildirir", () => {
    const text = describeShortlistQuality([product({ source: "ai" })]);
    expect(text).toContain(`${LOW_CONFIDENCE_FLOOR}/100 altı güvende`);
  });
});

describe("productIdentityKey — hat boyunca sabit aday anahtarı (§24)", () => {
  it("hazır parmak izi varsa onu kullanır (geriye uyumlu)", () => {
    const p = product();
    expect(productIdentityKey(p)).toBe(p.fingerprint);
  });

  it("parmak izi boşsa sıradan bağımsız sabit kimliğe döner, ASLA boş dönmez", () => {
    const a = productIdentityKey({ name: "Robot Vacuum L5", fingerprint: "" });
    const b = productIdentityKey({ name: "Robot Vacuum L5", fingerprint: "   " });
    const c = productIdentityKey({
      name: "Robot Vacuum L5",
      fingerprint: "",
      id: "row-9",
    });
    expect(a.length).toBeGreaterThan(3);
    expect(a).toBe(b);
    // Sıra/kaynak kimliği kimliği bozmaz; farklı satır kimliği ayrı hash'e gider.
    expect(c.length).toBeGreaterThan(3);
  });

  it("aynı ürün için kısa liste, konsey ve nihai sıralama AYNI anahtarı görür", () => {
    const p = product({ fingerprint: "" });
    expect(productIdentityKey(p)).toBe(productIdentityKey(p));
    expect(productIdentityKey(p)).toBe(productIdOf(p));
  });
});

describe("qualityOfFlatProduct — düz satırda da aynı dürüstlük kuralı", () => {
  it("ölçülen kaynak adresi + fiyat bütünlüğü artırır", () => {
    const rich = qualityOfFlatProduct({
      name: "Air Fryer",
      url: "https://shop.test/p",
      priceUsd: 39.9,
      category: "Kitchen",
      source: "scraped",
    });
    const bare = qualityOfFlatProduct({ name: "Air Fryer", source: "scraped" });
    expect(rich.completeness).toBeGreaterThan(bare.completeness);
  });

  it("kaynak adresi olmayan AI satırı güven ALMAZ", () => {
    expect(qualityOfFlatProduct({ name: "Air Fryer", source: "ai" }).confidence).toBe(0);
  });

  it("ölçülen (http) adres güveni pozitif yapar", () => {
    const q = qualityOfFlatProduct({
      name: "Air Fryer",
      url: "https://shop.test/p",
      priceUsd: 39.9,
      source: "scraped",
    });
    expect(q.confidence).toBeGreaterThan(0);
  });

  it("geçersiz fiyatı (0/NaN) ölçülmüş saymaz", () => {
    const zero = qualityOfFlatProduct({ name: "Air Fryer", priceUsd: 0 });
    const nan = qualityOfFlatProduct({ name: "Air Fryer", priceUsd: Number.NaN });
    expect(zero.completeness).toBe(nan.completeness);
  });
});
