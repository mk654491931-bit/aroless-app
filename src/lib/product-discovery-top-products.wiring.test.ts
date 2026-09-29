/**
 * NİHAİ 5 — BAĞLANTI TESTİ (ölü export'a karşı).
 *
 * Bu testin varlık sebebi: `buildTopProducts` önce yalnız kendi testinde
 * çağrılıyordu. Yani `top_products` sözleşmesi testlerde çalışıyor, ama
 * ÇALIŞAN HATTA hiç üretilmiyordu — istemci 5 ürünü asla göremezdi. Sözleşme
 * ancak `final` adımı onu gerçekten döndürdüğünde anlamlıdır.
 *
 * Kapsam:
 *   1. `final` adımı `buildTopProducts`'ı çağırıp sonucu döndürüyor.
 *   2. Adım rotası `top_products`'ı yanıta koyuyor.
 *   3. 25 uzlaşma satırı → TAM 5 `top_products` (uçtan uca bileşim).
 */
import { describe, expect, it } from "vitest";

import {
  buildTopProducts,
  DISCOVERY_FINAL_N,
  runFinalRankStep,
  TopProductsPayloadSchema,
} from "./product-discovery-pipeline.server";
import { COUNCIL_AGENT_KEYS } from "./council-chain.server";

const read = (p: string) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"));

/** 25 oy satırı + eşleşen 25 ürün: konsey çıktısının gerçek biçimi. */
const councilRows = (n = 25) =>
  Array.from({ length: n }, (_, i) => ({
    candidateId: `fp-${i}`,
    councilScore: 92 - i * 1.4,
    confidenceScore: 78 - i,
    coverage: 14,
    votes: {} as Record<string, number>,
    evidence: [] as string[],
  }));

/**
 * Kazanan ürün satırları — `runFinalRankStep` ürün eşlemesi BULDUĞUNDA
 * ürettiği biçim: konsenyus skoru ürünün üzerine yazılmış hâli.
 */
const winnerProducts = (n = 25) =>
  Array.from({ length: n }, (_, i) => ({
    fingerprint: `fp-${i}`,
    name: `Ürün ${i} Model X${100 + i}`,
    priceUsd: 20 + i,
    signals: { demand: 85 - i, margin: 75 - i, competition: 70 - i },
  }));

describe("nihai 5 — hat bağlantısı", () => {
  it("`final` adımı buildTopProducts'ı çağırır ve topProducts döndürür", async () => {
    const src = await read("src/lib/product-discovery-steps.server.ts");
    // Kaynak `ranked.products` OLMALI: consensus satırlarında ürün adı,
    // parmak izi ve sinyaller yoktur ve sözleşme boş gerekçeyle dolar.
    expect(src).toContain("buildTopProducts(\n          (ranked.products ?? []) as never");
    expect(src).not.toContain("buildTopProducts(ranked.consensus");
    expect(src).toContain("topProducts: top_products");
  });

  it("adım rotası top_products'ı yanıta koyar (istemci görebilsin)", async () => {
    const src = await read("src/routes/api/product-discovery.step.ts");
    expect(src).toContain("top_products: topProducts ?? []");
  });

  it("adım sonucu şeması topProducts'ı taşır", async () => {
    const src = await read("src/lib/product-discovery-pipeline.server.ts");
    expect(src).toContain("topProducts: z.array(z.any()).optional()");
  });
});

describe("nihai 5 — uçtan uca bileşim", () => {
  it("konsey 25 oy satırından 5 ürün seçer VE sözleşmeye döner", () => {
    // `final` adımının gerçekten yaptığı bileşim: önce konsey kazananları
    // belirler, sonra o KAZANAN ÜRÜNLER `top_products` şekline çevrilir.
    const ranked = runFinalRankStep(
      councilRows(25) as never,
      DISCOVERY_FINAL_N,
      new Map(winnerProducts(25).map((p) => [p.fingerprint, p])) as never,
    );
    expect(ranked.ok).toBe(true);
    const { top_products } = buildTopProducts((ranked.products ?? []) as never, DISCOVERY_FINAL_N);

    expect(top_products).toHaveLength(DISCOVERY_FINAL_N);
    expect(() => TopProductsPayloadSchema.parse({ top_products })).not.toThrow();
    // En yüksek konsenyus skoru kazanır ve kimliği GERÇEKTİR.
    expect(top_products[0]!.final_score).toBe(92);
    expect(top_products[0]!.id).toBe("fp-0");
    expect(top_products[0]!.title).toBe("Ürün 0 Model X100");
  });

  it("gerekçe ÖLÇÜLMÜŞ sinyalleri taşır — 'ölçülmedi' değil", () => {
    // Bu, ürün satırları yerine consensus satırları verildiğinde sessizce
    // bozulurdu: id "unknown", başlık "İsimsiz ürün", gerekçe "ölçülmedi".
    const ranked = runFinalRankStep(
      councilRows(25) as never,
      DISCOVERY_FINAL_N,
      new Map(winnerProducts(25).map((p) => [p.fingerprint, p])) as never,
    );
    const { top_products } = buildTopProducts((ranked.products ?? []) as never, DISCOVERY_FINAL_N);
    for (const p of top_products) {
      expect(p.id).not.toBe("unknown");
      expect(p.title).not.toBe("İsimsiz ürün");
      expect(p.selection_reason).not.toContain("ölçülmedi");
      expect(p.selection_reason).not.toContain("ölçülmedi");
      // Üç ölçütün SAYILARI görünür.
      expect(p.selection_reason).toMatch(/Trend gücü \d+\/100/);
      expect(p.selection_reason).toMatch(/Marj skoru \d+\/100/);
      expect(p.selection_reason).toMatch(/Rekabet (düşük|yüksek) \(\d+\/100\)/);
    }
  });

  it("her ürün 4 alan taşır ve gerekçesi üç ölçütü de içerir", () => {
    const ranked = runFinalRankStep(
      councilRows(25) as never,
      DISCOVERY_FINAL_N,
      new Map(winnerProducts(25).map((p) => [p.fingerprint, p])) as never,
    );
    const { top_products } = buildTopProducts((ranked.products ?? []) as never, DISCOVERY_FINAL_N);
    for (const p of top_products) {
      expect(Object.keys(p)).toEqual(["id", "title", "final_score", "selection_reason"]);
      expect(p.selection_reason.length).toBeGreaterThan(10);
    }
  });
});

describe("14 ajan — istenen üç ölçütü kapsıyor mu", () => {
  it("konsey tam 14 ajandan oluşur", () => {
    expect(COUNCIL_AGENT_KEYS).toHaveLength(14);
  });

  it("trend, kâr/fiyat ve rekabet ölçütlerinin karşılığı konseyde vardır", () => {
    const keys = new Set<string>(COUNCIL_AGENT_KEYS);
    // 1) Trend & viral potansiyel
    expect(keys.has("trend_hunter")).toBe(true);
    // 2) Kâr & fiyat dengesi
    expect(keys.has("cfo")).toBe(true);
    expect(keys.has("pricing_strategist")).toBe(true);
    // 3) Rekabet & pazar doygunluğu
    expect(keys.has("competitor_intel")).toBe(true);
  });
});
