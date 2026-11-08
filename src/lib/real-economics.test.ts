import { describe, expect, it } from "vitest";

import { countryVatModel, landedCostModel, realEconomics } from "./real-economics";

/**
 * ÖLÇÜLEN TEDARİK FİYATI MODELE UYDURULMAZ.
 *
 * Ölçülen hata: `realEconomics`, tedarik fiyatını perakendenin %12–55 bandına
 * çekiyordu. Sayfadan ölçülen $80 toptan fiyat, $100 satış fiyatında marjı
 * negatife düşürdüğü için sessizce $55'e "düzeltiliyor" ve model kârlı
 * görünüyordu. Ölçümü değiştirmek, ölçümü silmekle aynıdır.
 */
describe("realEconomics — ölçülmüş tedarik fiyatı", () => {
  it("ölçülmüş fiyatı band düzeltmesi olmadan aynen kullanır", () => {
    const result = realEconomics({
      selling_price_usd: 100,
      supplier_price_usd: 80,
      supplier_price_measured: true,
      shipping_cost: 5,
      category: "pet",
      country: "US",
      platform: "Shopify",
    });

    expect(result.supplier).toBe(80);
    expect(result.supplier_measured).toBe(true);
    // Bandın dışında olduğu için "düzeltildi" denmez; ölçüm olduğu gibi
    // kullanılır ve net sonuç negatifse negatif görünür.
    expect(result.net_per_unit).toBeLessThan(0);
    expect(result.assumptions[0]).toContain("ÖLÇÜLDÜ");
  });

  it("ölçülmemiş/AI fiyatını model bandına çeker ve ölçüm diye etiketlemez", () => {
    const result = realEconomics({
      selling_price_usd: 100,
      supplier_price_usd: 80,
      shipping_cost: 5,
      category: "pet",
      country: "US",
      platform: "Shopify",
    });

    expect(result.supplier).toBeCloseTo(30, 2);
    expect(result.supplier_measured).toBe(false);
    expect(result.assumptions[0]).toContain("ölçülmedi/AI tahmini");
  });
});

describe("landedCostModel — ülke KDV rejimi", () => {
  const base = {
    selling_price_usd: 30,
    supplier_price_usd: 10,
    supplier_price_measured: true as const,
    platform: "Amazon",
    category: "Home",
  };

  it("KDV DAHİL ülkede (DE) fiyatın içinden KDV düşer", () => {
    const de = landedCostModel({ ...base, country: "DE" });
    expect(de.vat.known).toBe(true);
    expect(de.vat.included).toBe(true);
    expect(de.vat.rate).toBeCloseTo(0.19, 2);
    expect(de.vat_cost).toBeCloseTo(30 - 30 / 1.19, 2);
    expect(de.landed_cost).toBeCloseTo(
      de.supplier + de.shipping + de.platform_fee + de.payment_fee + de.returns_cost + de.misc + de.vat_cost,
      2,
    );
    expect(de.net_after_landed).toBeCloseTo(30 - de.landed_cost, 2);
  });

  it("satış vergisi checkout'ta eklenen ülkede (US) ayrıca KDV düşmez", () => {
    const us = landedCostModel({ ...base, country: "US" });
    expect(us.vat.known).toBe(true);
    expect(us.vat.included).toBe(false);
    expect(us.vat_cost).toBe(0);
  });

  it("aynı üründe DE landed > US landed; KDV modeli kârı şişirmez", () => {
    const de = landedCostModel({ ...base, country: "DE" });
    const us = landedCostModel({ ...base, country: "US" });
    expect(de.landed_cost).toBeGreaterThan(us.landed_cost);
    expect(de.net_after_landed).toBeLessThan(us.net_after_landed);
  });

  it("bilinmeyen ülkede sayı uydurulmaz", () => {
    const model = countryVatModel("ZZ");
    expect(model.known).toBe(false);
    expect(model.rate).toBe(0);
    const global = landedCostModel({ ...base, country: "ZZ" });
    expect(global.vat_cost).toBe(0);
  });
});
