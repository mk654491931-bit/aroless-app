/**
 * BAŞ ÜRÜN KURATÖRÜ — `top_products` sözleşme testi (AI YOK, ağ YOK, $0).
 *
 * Kapsam: 25 uzlaşma satırından nihai 5'in üretildiği çıktının dış sözleşmesi:
 *   1. En fazla 5 ürün, tam olarak istenen 4 alan.
 *   2. `final_score` 0-100 arası ve konsenyus skoruyla birebir aynı.
 *   3. `selection_reason` İSTENEN ÜÇ ÖLÇÜTLÜ (trend, marj/fiyat, rekabet)
 *      sinyallerden türetilir — model metni değil, ölçülmüş kanıttır.
 *   4. Sinyal ölçülmemişse gerekçe "veri yok" der, SAYI UYDURMAZ.
 *   5. Aynı girdiden bit bit aynı çıktı (deterministik).
 */
import { describe, expect, it } from "vitest";

import {
  buildTopProducts,
  DISCOVERY_FINAL_N,
  TopProductsPayloadSchema,
} from "./product-discovery-pipeline.server";

/** 25 uzlaşma satırı taklidi (konseyden gelen 25 aday). */
const consensusRows = (n = 25) =>
  Array.from({ length: n }, (_, i) => ({
    fingerprint: `fp-${i}`,
    name: `Ürün ${i} Model X${100 + i}`,
    councilScore: 90 - i * 1.5,
    confidenceScore: 80 - i,
    priceUsd: 20 + i,
    signals: { demand: 85 - i, margin: 75 - i, competition: 70 - i },
  }));

describe("buildTopProducts — baş ürün küratörü sözleşmesi", () => {
  it("25 adaydan en fazla 5 ürün döndürür", () => {
    const { top_products } = buildTopProducts(consensusRows(25));
    expect(top_products).toHaveLength(DISCOVERY_FINAL_N);
  });

  it("tam olarak 4 alan üretir ve şemaya uyar", () => {
    const { top_products } = buildTopProducts(consensusRows(25));
    expect(() => TopProductsPayloadSchema.parse({ top_products })).not.toThrow();
    for (const p of top_products) {
      expect(Object.keys(p)).toEqual(["id", "title", "final_score", "selection_reason"]);
      expect(p.id).toBeTruthy();
      expect(p.title.trim()).not.toBe("");
    }
  });

  it("final_score konsenyus skoruyla birebir aynıdır ve 0-100 içindedir", () => {
    const rows = consensusRows(25);
    const { top_products } = buildTopProducts(rows);
    rows.slice(0, DISCOVERY_FINAL_N).forEach((row, i) => {
      expect(top_products[i]!.final_score).toBe(Math.round(row.councilScore));
    });
    for (const p of top_products) {
      expect(p.final_score).toBeGreaterThanOrEqual(0);
      expect(p.final_score).toBeLessThanOrEqual(100);
    }
  });

  it("gerekçe istenen üç ölçütü de belirtir (trend, marj/fiyat, rekabet)", () => {
    const { top_products } = buildTopProducts(consensusRows(25));
    for (const p of top_products) {
      expect(p.selection_reason).toMatch(/Trend/);
      expect(p.selection_reason).toMatch(/Marj/);
      expect(p.selection_reason).toMatch(/Rekabet/);
      // Fiyat bandı gerekçeye gerçek fiyatla yazılır.
      expect(p.selection_reason).toMatch(/\$[\d.]+/);
    }
  });

  it("düşük rekabeti yüksek doygunluk olarak değil, avantaj olarak anlatır", () => {
    const open = buildTopProducts([
      { fingerprint: "a", name: "A", councilScore: 80, priceUsd: 30, signals: { demand: 80, margin: 80, competition: 90 } },
    ]);
    const saturated = buildTopProducts([
      { fingerprint: "b", name: "B", councilScore: 80, priceUsd: 30, signals: { demand: 80, margin: 80, competition: 20 } },
    ]);
    expect(open.top_products[0]!.selection_reason).toMatch(/düşük/);
    expect(open.top_products[0]!.selection_reason).toMatch(/doygunluk yok/);
    expect(saturated.top_products[0]!.selection_reason).toMatch(/yüksek/);
    expect(saturated.top_products[0]!.selection_reason).toMatch(/doymuş/);
  });

  it("ölçülmemiş sinyallerde SAYI UYDURMAZ, 'ölçülmedi' der", () => {
    const { top_products } = buildTopProducts([
      { fingerprint: "x", name: "Kanıtsız Ürün", councilScore: 55 }, // sinyal yok
    ]);
    const reason = top_products[0]!.selection_reason;
    expect(reason).toMatch(/Trend kanıtı yok/);
    expect(reason).toMatch(/Fiyat bandı ölçülmedi/);
    expect(reason).toMatch(/Rekabet ölçülmedi/);
    // Gövdede uydurma sayı yok.
    expect(reason).not.toMatch(/\d+\/100/);
    expect(reason).not.toMatch(/\$/);
  });

  it("kimlik boşsa fingerprint'e, o da yoksa 'unknown'a düşer (asla boş değil)", () => {
    const { top_products } = buildTopProducts([{ name: "Adsız", councilScore: 10 }]);
    expect(top_products[0]!.id).toBe("unknown");
    expect(top_products[0]!.title).toBe("Adsız");
  });

  it("skoru sıfır veya eksik olan satırda final_score 0-100 aralığında kalır", () => {
    const { top_products } = buildTopProducts([
      { fingerprint: "p1", name: "A", councilScore: 999 },
      { fingerprint: "p2", name: "B", councilScore: -50 },
      { fingerprint: "p3", name: "C" },
    ]);
    expect(top_products[0]!.final_score).toBe(100);
    expect(top_products[1]!.final_score).toBe(0);
    expect(top_products[2]!.final_score).toBe(0);
  });

  it("deterministiktir — aynı girdiden bit bit aynı çıktı", () => {
    const a = buildTopProducts(consensusRows(25));
    const b = buildTopProducts(consensusRows(25));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("konsol: nihai sözleşmenin gerçek çıktısı", () => {
    const { top_products } = buildTopProducts(consensusRows(25));
    console.log(
      [
        "",
        "=== BAŞ ÜRÜN KURATÖRÜ · top_products (deterministik, AI çağrısı yok) ===",
        JSON.stringify({ top_products }, null, 2),
        "=================================================================",
        "",
      ].join("\n"),
    );
    expect(top_products).toHaveLength(DISCOVERY_FINAL_N);
  });
});
