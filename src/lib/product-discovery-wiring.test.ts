/**
 * PRODUCT DISCOVERY — YENİ KAYNAK + HAT SÖZLEŞMELERİ.
 *
 * Kapsam (hepsi $0 ve ağsız):
 *   1. Kaynak yardımcıları: marka çıkarımı ve metinden puan okuma
 *      UYDURMAMALI — sayı yoksa `null` döner.
 *   2. Gemini kısa listesi 25'e çıkarıldı (14 ajana çeşitli girmesi için).
 *   3. `final` adımı uzlaşmayı ürünlerle BİRLEŞTİRİR; olmazsa hat çökmez.
 *   4. Ham DB sonucu tek şemaya iner (`parseDiscoveryResult`) — bozuk JSON
 *      arayüzü patlatmaz.
 *   5. `toWinningProducts` ÖLÇÜLMEYEN alanı doldurmaz (dürüstlük sözleşmesi).
 */
import { describe, expect, it } from "vitest";

import { brandFromTitle, ratingFromText } from "./product-discovery-sources.server";
import { GEMINI_SHORTLIST_SIZE, runFinalRankStep } from "./product-discovery-pipeline.server";
import { parseDiscoveryResult, type DiscoveryWinner } from "./product-discovery.functions";
import { toWinningProducts } from "@/features/finder/utils/discovery-result";
import {
  ConsensusSchema,
  productFingerprint,
  type NormalizedProduct,
} from "./product-discovery.types";

/* ------------------------------------------------- 1. Kaynak yardımcıları */

describe("marka çıkarımı (başlıktan, uydurmadan)", () => {
  it("başlığın büyük harfle başlayan ilk kelimesini marka alır", () => {
    expect(brandFromTitle("Philips 3000 Series Airfryer")).toBe("Philips");
    expect(brandFromTitle("Ninja Foodi 8-Qt Air Fryer")).toBe("Ninja");
  });

  it("sayı içeren ilk kelime marka DEĞİLDİR ( seri/numara markadır )", () => {
    expect(brandFromTitle("2024 Air Fryer")).toBe("");
    expect(brandFromTitle("5 Star Chef Knife")).toBe("");
  });

  it("anahtar kelimeleri marka sanmaz", () => {
    expect(brandFromTitle("Best Air Fryer for Families")).toBe("");
    expect(brandFromTitle("The Ultimate Guide")).toBe("");
    expect(brandFromTitle("Amazon Basics Air Fryer")).toBe("");
  });

  it("küçük harfle başlayan ilk kelime marka DEĞİLDİR (genel ad olabilir)", () => {
    expect(brandFromTitle("air fryer 5L")).toBe("");
  });

  it("bozuk girdide çökmez", () => {
    expect(brandFromTitle("")).toBe("");
    expect(brandFromTitle("   ")).toBe("");
    expect(brandFromTitle("!!!")).toBe("");
  });
});

describe("metinden puan okuma (uydurmadan)", () => {
  it("gerçek yazılmış puan ve sayıyı okur", () => {
    const r = ratingFromText("Rated 4.6 out of 5 by 1,284 buyers");
    expect(r.rating).toBeCloseTo(4.6);
    expect(r.count).toBe(1284);
  });

  it("Türkçe yazımı da okur", () => {
    const r = ratingFromText("4,5 yıldız · 312 değerlendirme");
    expect(r.rating).toBeCloseTo(4.5);
    expect(r.count).toBe(312);
  });

  it("SAYI YOKSA null döner (uydurma puan üretmez)", () => {
    const r = ratingFromText("Harika bir ürün, kesinlikle tavsiye ederim");
    expect(r.rating).toBeNull();
    expect(r.count).toBeNull();
  });

  it("5 üstü puanı reddeder (ölçek dışı veri)", () => {
    expect(ratingFromText("9 out of 5 stars").rating).toBeNull();
  });
});

/* ------------------------------------------ 2. Gemini kısa liste hedefi */

describe("Gemini kısa listesi", () => {
  // Hattın sözleşmesi 75 → 25 → 5'tir. Kısa liste 12'ye düşürüldüğünde 14
  // ajan dar bir havuzda oy çeşitliliğini kaybediyordu; hedef 25 adaydır ve
  // bu hâlâ TEK bir Gemini çağrısıdır.
  it("25 aday seçiyor (konsey çeşitliliği için)", () => {
    expect(GEMINI_SHORTLIST_SIZE).toBe(25);
  });
});

/* ------------------------------------------- 3. final: uzlaşma + ürün eşleşmesi */

const winnerProduct = (name: string): NormalizedProduct => ({
  name,
  brand: "Acme",
  seller: "shop",
  category: "",
  priceUsd: 59.9,
  rating: 4.6,
  ratingCount: 210,
  inStock: true,
  sources: ["test"],
  url: "https://example.test/p",
  notes: "4.6 puan · 210 değerlendirme",
  viewed90d: null,
  id: "sku-winner",
  imageUrl: "https://example.test/p.jpg",
  salesVolume: 940,
  fingerprint: productFingerprint({ title: name, brand: "Acme", seller: "shop" }),
  preScore: 72,
  signals: { demand: 70, competition: 60, margin: 80, rating: 75, availability: 85 },
  dataCompleteness: 4,
  missingFields: [],
  source: "scraped",
});

const consensusFor = (product: NormalizedProduct, councilScore: number) =>
  ConsensusSchema.parse({
    candidateId: product.fingerprint,
    name: product.name,
    councilScore,
    votes: 14,
    coverage: 1,
    disagreement: 5,
    confidenceScore: 80,
    minScore: councilScore - 5,
    maxScore: councilScore + 5,
    evidence: ["talep kanıtı güçlü"],
  });

describe("final adımı: uzlaşma + ürün birleşimi", () => {
  it("konsens puanına göre sıralar ve ÜRÜNÜ yanında taşır", () => {
    const a = winnerProduct("Ürün A");
    const b = winnerProduct("Ürün B");
    const byId = new Map([
      [a.fingerprint, a],
      [b.fingerprint, b],
    ]);

    const result = runFinalRankStep([consensusFor(a, 60), consensusFor(b, 90)], 5, byId);

    expect(result.status).toBe("completed");
    expect(result.consensus.map((c) => c.name)).toEqual(["Ürün B", "Ürün A"]);
    // Arayüzün görebilmesi için ürün de dönmeli.
    expect(result.products).toHaveLength(2);
    expect(result.products[0]!.name).toBe("Ürün B");
    expect((result.products[0] as unknown as { councilScore: number }).councilScore).toBe(90);
  });

  it("ürün eşleşmezse HAT ÇÖKMEZ (eski gövde senaryosu)", () => {
    const a = winnerProduct("Ürün A");
    const result = runFinalRankStep([consensusFor(a, 77)], 5, new Map());
    expect(result.ok).toBe(true);
    expect(result.consensus).toHaveLength(1);
    expect(result.products).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("taşınmadı");
  });

  it("topN kadar keser", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((n) => winnerProduct(n));
    const byId = new Map(rows.map((p) => [p.fingerprint, p]));
    const result = runFinalRankStep(
      rows.map((p, i) => consensusFor(p, 50 + i)),
      3,
      byId,
    );
    expect(result.consensus).toHaveLength(3);
    expect(result.products).toHaveLength(3);
  });
});

/* ------------------------------------- 4. Ham DB sonucunun şemaya inmesi */

describe("parseDiscoveryResult", () => {
  it("geçerli sonucu ürün + uzlaşma olarak ayırır", () => {
    const parsed = parseDiscoveryResult({
      products: [{ name: "A", fingerprint: "fp", councilScore: 80 }],
      consensus: [{ candidateId: "fp", name: "A", councilScore: 80 }],
    });
    expect(parsed.products).toHaveLength(1);
    expect(parsed.products[0]!.councilScore).toBe(80);
    expect(parsed.consensus).toHaveLength(1);
  });

  it("eksik alanları VARSAYILANA düşürür (arayüz patlamaz)", () => {
    const parsed = parseDiscoveryResult({ products: [{ name: "A" }] });
    expect(parsed.products).toHaveLength(1);
    expect(parsed.products[0]!.signals.demand).toBe(50);
    expect(parsed.products[0]!.sources).toEqual([]);
    expect(parsed.products[0]!.priceUsd).toBeNull();
  });

  it("tamamen bozuk girdide boş liste döner, patlamaz", () => {
    expect(parseDiscoveryResult(null).products).toEqual([]);
    expect(parseDiscoveryResult("çöp").products).toEqual([]);
    expect(parseDiscoveryResult({ products: "sayı değil" }).products).toEqual([]);
  });
});

/* --------------------------------- 5. Arayüz eşlemesi: ölçülmeyen boş kalır */

describe("toWinningProducts — dürüst eşleme", () => {
  const row = (over: Partial<DiscoveryWinner> = {}): DiscoveryWinner => ({
    name: "Air Fryer 5.5L",
    brand: "Acme",
    seller: "shop",
    category: "",
    priceUsd: 59.9,
    rating: 4.6,
    ratingCount: 210,
    inStock: true,
    sources: ["itunes"],
    url: "https://example.test/p",
    notes: "4.6 puan · 210 kullanıcı puanı",
    preScore: 72,
    dataCompleteness: 5,
    fingerprint: "fp-1",
    signals: { demand: 70, competition: 60, margin: 80, rating: 75, availability: 85 },
    councilScore: 84,
    confidenceScore: 88,
    votes: 14,
    agreement: 0.9,
    evidence: ["talep kanıtı güçlü", "fiyat bandı sağlıklı"],
    ...over,
  });

  it("ölçülen alanları taşır", () => {
    const [product] = toWinningProducts([row()]);
    expect(product!.name).toBe("Air Fryer 5.5L");
    expect(product!.selling_price_usd).toBe("$59.90");
    expect(product!.trend_score).toBe(70);
    expect(product!.health_score).toBe(100);
    expect(product!.why_winning).toContain("14 ajan puanı 84");
    expect(product!.data_sources).toEqual(["itunes"]);
  });

  it("ÖLÇÜLMEYEN ekonomik alanlara DEĞER UYDURMAZ", () => {
    const [product] = toWinningProducts([row()]);
    // Kazımada tedarik maliyeti YOK; uydurulmuş bir maliyet satılabilir
    // görünür bir ürün yaratırdı.
    expect(product!.supplier_price_usd).toBe("");
    expect(product!.startup_cost_usd).toBe("");
    expect(product!.profit_margin_pct).toBe(0);
    expect(product!.cost_breakdown.supplier_cost).toBe("");
    expect(product!.target_audience).toBe("");
    expect(product!.ad_angles).toEqual([]);
  });

  it("fiyat yoksa fiyat alanı boş kalır (0 yazılmaz)", () => {
    const [product] = toWinningProducts([row({ priceUsd: null })]);
    expect(product!.selling_price_usd).toBe("");
  });

  it("rakipleri aynı koşudaki kardeşlerden doldurur", () => {
    const rows = [row({ fingerprint: "a" }), row({ fingerprint: "b", name: "Ürün B" })];
    const [first] = toWinningProducts(rows, rows);
    expect(first!.competitor_examples).toEqual(["Ürün B"]);
  });

  it("rekabet sinyalini üç seviyeli etikete çevirir", () => {
    const high = toWinningProducts([
      row({ signals: { demand: 50, competition: 80, margin: 50, rating: 50, availability: 50 } }),
    ])[0]!;
    const low = toWinningProducts([
      row({ signals: { demand: 50, competition: 20, margin: 50, rating: 50, availability: 50 } }),
    ])[0]!;
    expect(high.competition_level).toBe("High");
    expect(low.competition_level).toBe("Low");
  });
});
