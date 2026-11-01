import { describe, expect, it } from "vitest";
import {
  estimateBand,
  formatIntegerBand,
  formatMoneyBand,
  formatPercentBand,
} from "./ranges";

describe("estimateBand — tahminler kesin sayı gibi sunulmaz", () => {
  it("değerin çevresinde alt/üst bant üretir", () => {
    expect(estimateBand(100)).toEqual({ low: 75, high: 125 });
    expect(estimateBand(0)).toEqual({ low: 0, high: 1 });
  });

  it("geçersiz değerlerde bant uydurmaz", () => {
    expect(estimateBand(null)).toBeNull();
    expect(estimateBand(undefined)).toBeNull();
    expect(estimateBand(Number.NaN)).toBeNull();
    expect(estimateBand(-5)).toBeNull();
  });

  it("tam sayı, para ve yüzde biçimleri okunur", () => {
    expect(formatIntegerBand({ low: 900, high: 1200 })).toBe("~900–1.200");
    expect(formatMoneyBand({ low: 1200, high: 1800 }, (n) => `$${n}`)).toBe("$1200–$1800");
    expect(formatPercentBand(40, 6)).toBe("~%34–46");
    expect(formatPercentBand(99, 10, 0, 90)).toBe("~%89–90");
  });
});
