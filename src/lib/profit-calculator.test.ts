import { describe, expect, it } from "vitest";
import { calculateProfit } from "./profit-calculator";

describe("calculateProfit", () => {
  it("eksik satış fiyatı veya tedarik fiyatıyla sayı üretmez", () => {
    expect(calculateProfit({ price: null, cogs: 10, vatPct: 20 })).toEqual({
      vat: null,
      net: null,
      marginPct: null,
    });
    expect(calculateProfit({ price: 100, cogs: null, vatPct: 20 })).toEqual({
      vat: null,
      net: null,
      marginPct: null,
    });
    expect(calculateProfit({ price: 0, cogs: 10, vatPct: 20 }).net).toBeNull();
  });

  it("KDV, kargo, platform komisyonu ve CAC'ı net kârdan düşer", () => {
    const result = calculateProfit({
      price: 100,
      cogs: 30,
      shipping: 5,
      platformFee: 10,
      adSpend: 20,
      vatPct: 20,
    });
    expect(result.vat).toBe(20);
    expect(result.net).toBe(15);
    expect(result.marginPct).toBe(15);
  });

  it("boş kargo/komisyon/CAC kalemlerini 0 sayar", () => {
    const result = calculateProfit({ price: 100, cogs: 30, vatPct: 20 });
    expect(result.net).toBe(50);
    expect(result.marginPct).toBe(50);
  });

  it("geçersiz KDV oranında KDV'yi 0 sayar", () => {
    const result = calculateProfit({ price: 100, cogs: 40, vatPct: Number.NaN });
    expect(result.vat).toBe(0);
    expect(result.net).toBe(60);
  });

  it("negatif maliyetleri hesaba katmaz", () => {
    const result = calculateProfit({
      price: 100,
      cogs: 30,
      shipping: -5,
      platformFee: -10,
      adSpend: -20,
      vatPct: 0,
    });
    expect(result.net).toBe(70);
  });
});
