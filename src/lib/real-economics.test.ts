import { describe, expect, it } from "vitest";

import { realEconomics } from "./real-economics";

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
