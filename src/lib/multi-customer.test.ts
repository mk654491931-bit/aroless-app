import { describe, expect, it } from "vitest";
import {
  DISTRIBUTION_DIMENSIONS,
  PANEL_SIZE,
  applyMultiCustomerScenario,
  buildProductProfile,
  compareMultiCustomerResults,
  distribution,
  generatePersonas,
  simulateMultiCustomer,
  toMultiCustomerProduct,
} from "./multi-customer";

const strongProduct = {
  name: "Otomatik evcil hayvan su pınarı",
  description: "Kedi ve köpekler için filtreli, sessiz su pınarı",
  sellingPriceUsd: 34.9,
  targetAudience: "Evcil hayvan sahipleri",
  platform: "TikTok",
  rating: 4.6,
  ratingCount: 1200,
  salesVolume: 3500,
  competitionLevel: "Medium",
  trendScore: 68,
};

const weakProduct = {
  name: "Premium lüks saat",
  description: "Yüksek fiyatlı erkek kol saati",
  sellingPriceUsd: 180,
  targetAudience: "Erkek profesyoneller",
  platform: "Google",
  rating: 4.2,
  ratingCount: 80,
  salesVolume: 200,
  competitionLevel: "High",
  trendScore: 30,
};

describe("multi-customer simulation", () => {
  it("tam 1.000 benzersiz karakter üretir", () => {
    const personas = generatePersonas(strongProduct);
    expect(personas).toHaveLength(PANEL_SIZE);
    expect(new Set(personas.map((persona) => persona.id)).size).toBe(PANEL_SIZE);
    expect(new Set(personas.map((persona) => persona.label)).size).toBeGreaterThan(900);
  });

  it("aynı ürün için deterministiktir", () => {
    const first = simulateMultiCustomer(strongProduct);
    const second = simulateMultiCustomer(strongProduct);
    expect(first.buyers).toBe(second.buyers);
    expect(first.personas[0]?.propensity).toBe(second.personas[0]?.propensity);
    expect(first.topObjections).toEqual(second.topObjections);
  });

  it("tüm dağılımlar 1.000 kişiyi kapsar", () => {
    const result = simulateMultiCustomer(strongProduct);
    for (const dimension of DISTRIBUTION_DIMENSIONS) {
      const rows = result.distributions[dimension.key];
      expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(PANEL_SIZE);
      expect(rows.reduce((sum, row) => sum + row.buyers, 0)).toBe(result.buyers);
    }
    expect(result.buyers + result.nonBuyers).toBe(PANEL_SIZE);
  });

  it("güçlü üründe zayıf üründen daha fazla alıcı bulur", () => {
    const strong = simulateMultiCustomer(strongProduct);
    const weak = simulateMultiCustomer(weakProduct);
    expect(strong.buyers).toBeGreaterThan(weak.buyers);
    expect(strong.penetrationPct).toBeGreaterThan(0);
    expect(strong.penetrationPct).toBeLessThan(100);
  });

  it("fiyat yoksa fiyat uydurmaz ve güveni düşürür", () => {
    const profile = buildProductProfile({ name: "Fiyatı ölçülmemiş ürün" });
    expect(profile.priceKnown).toBe(false);
    expect(profile.priceUsd).toBeNull();
    expect(profile.missingSignals).toContain("fiyat");

    const result = simulateMultiCustomer({ name: "Fiyatı ölçülmemiş ürün" });
    expect(result.personas.every((persona) => persona.priceFit === "Fiyat yok")).toBe(true);
    expect(result.confidencePct).toBe(40);
  });

  it("alıcı ve almayan örneklerini farklı segmentlerden seçer", () => {
    const result = simulateMultiCustomer(strongProduct);
    expect(result.buyerExamples.length).toBeGreaterThan(0);
    expect(result.nonBuyerExamples.length).toBeGreaterThan(0);
    expect(new Set(result.buyerExamples.map((persona) => persona.decisionStyle)).size).toBe(
      result.buyerExamples.length,
    );
    expect(new Set(result.nonBuyerExamples.map((persona) => persona.decisionStyle)).size).toBe(
      result.nonBuyerExamples.length,
    );
  });

  it("dağılım satırları pay ve dönüşüm oranını doğru hesaplar", () => {
    const personas = generatePersonas(strongProduct);
    const rows = distribution(personas, "decisionStyle");
    expect(rows).toHaveLength(8);
    const total = rows.reduce((sum, row) => sum + row.buyers, 0);
    expect(total).toBe(personas.filter((persona) => persona.buy).length);
    for (const row of rows) {
      expect(row.total).toBe(row.buyers + row.nonBuyers);
      expect(row.ratePct).toBeCloseTo((row.buyers / row.total) * 100, 5);
    }
  });

  it("senaryo aynı 1.000 kişiyi kullanır ve fiyat etkisini ölçer", () => {
    const baseline = simulateMultiCustomer(strongProduct);
    const scenario = simulateMultiCustomer(strongProduct, { sellingPriceUsd: 19.9 });

    expect(scenario.personas.map((persona) => persona.id)).toEqual(
      baseline.personas.map((persona) => persona.id),
    );
    expect(scenario.personas.map((persona) => persona.incomeBand)).toEqual(
      baseline.personas.map((persona) => persona.incomeBand),
    );
    expect(scenario.buyers).toBeGreaterThan(baseline.buyers);

    const comparison = compareMultiCustomerResults(baseline, scenario);
    expect(comparison.buyersDelta).toBe(scenario.buyers - baseline.buyers);
    expect(comparison.gainedPersonas.length - comparison.lostPersonas.length).toBe(
      comparison.buyersDelta,
    );
    expect(comparison.gainedPersonas.every((persona) => persona.buy)).toBe(true);
    expect(comparison.lostPersonas.every((persona) => !persona.buy)).toBe(true);
    expect(comparison.segmentDeltas.reduce((sum, row) => sum + row.buyersDelta, 0)).toBe(
      comparison.buyersDelta,
    );
  });

  it("senaryo yalnızca verilen sinyali değiştirir", () => {
    const merged = applyMultiCustomerScenario(strongProduct, { rating: 4.9 });
    expect(merged.rating).toBe(4.9);
    expect(merged.sellingPriceUsd).toBe(strongProduct.sellingPriceUsd);
    expect(merged.platform).toBe(strongProduct.platform);
    expect(merged.ratingCount).toBe(strongProduct.ratingCount);

    const cleared = applyMultiCustomerScenario(strongProduct, { sellingPriceUsd: null });
    expect(cleared.sellingPriceUsd).toBeNull();
    expect(cleared.rating).toBe(strongProduct.rating);
  });

  it("Ürün Bulucu kartını köprüye taşırken ölçülmeyen alanları uydurmaz", () => {
    const mapped = toMultiCustomerProduct({
      name: "  Filtreli su pınarı  ",
      selling_price_usd: "34.90",
      platform_fit: ["TikTok"],
      measured: { rating: 4.6, ratingCount: 1200, salesVolume: null },
      data_sources: ["https://example.com/urun"],
    });
    expect(mapped.name).toBe("Filtreli su pınarı");
    expect(mapped.sellingPriceUsd).toBe(34.9);
    expect(mapped.platform).toBe("TikTok");
    expect(mapped.rating).toBe(4.6);
    expect(mapped.ratingCount).toBe(1200);
    expect(mapped.salesVolume).toBeNull();
    expect(mapped.source).toBe("https://example.com/urun");

    const missing = toMultiCustomerProduct({ name: "Sadece adı olan ürün" });
    expect(missing.sellingPriceUsd).toBeNull();
    expect(missing.rating).toBeNull();
    expect(missing.ratingCount).toBeNull();
    expect(missing.salesVolume).toBeNull();
  });
});
