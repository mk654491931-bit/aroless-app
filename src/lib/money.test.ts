import { describe, expect, it } from "vitest";

import { detectCurrency, parseAmount, parseMoneyText, parseNumber } from "./money";
import { parseMoneyNum } from "./consistency";
import { parseMoney as unitParseMoney } from "./unit-economics";
import { money as realEconomicsMoney } from "./real-economics";
import { num as deepDiveNum } from "./deep-dive-complete";

describe("money — tek para sözleşmesi", () => {
  it("TRY binlik/ondalık biçimini 100 katına çıkarmaz", () => {
    expect(parseNumber("₺12.033,41")).toBe(12033.41);
    expect(parseAmount("12.033,41")).toBe(12033.41);
    expect(parseMoneyText("₺12.033,41")).toEqual({ amount: 12033.41, currency: "TRY" });
    expect(parseMoneyText("12.033,41 TRY")).toEqual({ amount: 12033.41, currency: "TRY" });
  });

  it("ABD ve Avrupa biçimlerini aynı kuralla okur", () => {
    expect(parseAmount("$1,299.00")).toBe(1299);
    expect(parseAmount("1.299,00 €")).toBe(1299);
    expect(parseAmount("1 299,00 zł")).toBe(1299);
    expect(parseAmount("₹12,34,567")).toBe(1234567);
    expect(parseAmount("4,180 円")).toBe(4180);
  });

  it("para birimi yoksa tutarı USD sanmaz", () => {
    expect(parseMoneyText("579")).toBeNull();
    expect(detectCurrency("579")).toBeNull();
    expect(parseMoneyText("12.033,41")).toBeNull();
  });

  it("sembol ve ISO kodunu birlikte tanır", () => {
    expect(detectCurrency("$12.99")).toBe("USD");
    expect(detectCurrency("12,99 €")).toBe("EUR");
    expect(detectCurrency("1.359,15 TL")).toBe("TRY");
    expect(detectCurrency("R$ 199,00")).toBe("BRL");
    expect(detectCurrency("USD 12.99")).toBe("USD");
  });

  it("mevcut tüm parserlar aynı sayıyı verir", () => {
    const raw = "₺12.033,41";
    expect(parseMoneyNum(raw)).toBe(12033.41);
    expect(unitParseMoney(raw)).toBe(12033.41);
    expect(realEconomicsMoney(raw)).toBe(12033.41);
    expect(deepDiveNum(raw)).toBe(12033.41);
  });

  it("işaretli net kârı korur", () => {
    expect(parseNumber("-$5.00")).toBe(-5);
    expect(parseNumber("-1.234,56 TL")).toBe(-1234.56);
    expect(parseAmount("-5")).toBeNull();
  });
});
