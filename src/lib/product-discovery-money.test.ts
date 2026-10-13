/**
 * GENEL PARA BİRİMİ TESTLERİ (rapor P0-2).
 *
 * NEDEN: global ölçekte tek bir yanlış ayırıcı varsayımı fiyatı 100 katına
 * çıkarır („4,180 円“ = 4180 JPY, 4.18 değil; „₹12,34,567“ Hint gruplaması).
 * Bu testler GERÇEK ölçülmüş biçimleri kilitler; hiçbiri ağa çıkmaz.
 */
import { describe, expect, it } from "vitest";

import { parseAmount, parseMoney } from "./product-discovery-reader.server";

describe("parseAmount — ayırıcının ANLAMINI konumdan çıkarır", () => {
  it("Almanya/TR biçimi: virgül ONDALIK, nokta binlik", () => {
    expect(parseAmount("27,99")).toBe(27.99);
    expect(parseAmount("1.299,00")).toBe(1299);
    expect(parseAmount("1.234.567,89")).toBe(1234567.89);
  });

  it("ABD/UK biçimi: nokta ONDALIK, virgül binlik", () => {
    expect(parseAmount("1,299.00")).toBe(1299);
    expect(parseAmount("84.99")).toBe(84.99);
    expect(parseAmount("12,345.67")).toBe(12345.67);
  });

  it("Hint gruplaması (₹12,34,567) binlik sayılır, ondalık uydurulmaz", () => {
    expect(parseAmount("1,299")).toBe(1299);
    expect(parseAmount("12,34,567")).toBe(1234567);
  });

  it("Japon biçimi: „4,180“ ondalık DEĞİL (yen ondalık kullanmaz)", () => {
    expect(parseAmount("4,180")).toBe(4180);
    expect(parseAmount("1980")).toBe(1980);
  });

  it("boşluklu gruplama (FR/PL) ve NBSP okunur", () => {
    expect(parseAmount("1 299,00")).toBe(1299);
    expect(parseAmount("1\u00A0299,50")).toBe(1299.5);
  });

  it("tek haneli ondalık ve tek haneli puan", () => {
    expect(parseAmount("27,9")).toBe(27.9);
    expect(parseAmount("5.5")).toBe(5.5);
  });

  it("çöp/boş/anlamsız girdi `null` döner (0 UYDURULMAZ)", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("fiyat yok")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("99999999999")).toBeNull();
  });
});

describe("parseMoney — tutar + ISO para birimi", () => {
  it("sembol sayının ÖNÜNDE de ARKASINDA da olabilir", () => {
    expect(parseMoney("ab 27,99 €")).toEqual({ amount: 27.99, currency: "EUR" });
    expect(parseMoney("€ 27,99")).toEqual({ amount: 27.99, currency: "EUR" });
    expect(parseMoney("4,180 円")).toEqual({ amount: 4180, currency: "JPY" });
    expect(parseMoney("₹579 ₹809 28% off")).toEqual({ amount: 579, currency: "INR" });
  });

  it("`R$` `$`dan, `zł` tek `ł`den ÖNCE denenir (BRL/PLN doğru okunur)", () => {
    expect(parseMoney("R$ 89,90")).toEqual({ amount: 89.9, currency: "BRL" });
    expect(parseMoney("1 299,00 zł")).toEqual({ amount: 1299, currency: "PLN" });
    expect(parseMoney("$84.99")).toEqual({ amount: 84.99, currency: "USD" });
  });

  it("TL/£ eski biçimler de çalışır (mevcut TR hattı bozulmaz)", () => {
    expect(parseMoney("1.359,15 TL")).toEqual({ amount: 1359.15, currency: "TRY" });
    expect(parseMoney("£12.99")).toEqual({ amount: 12.99, currency: "GBP" });
  });

  it("para birimi yoksa `null` (yerel tutarı USD sanmayız)", () => {
    expect(parseMoney("579")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});
