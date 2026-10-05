// Vercel build yapılandırmasının ortam değişkenine karşı savunması.
//
// Bu testler build'i düşüren bir hata sınıfını kilitler: `VERCEL_FUNCTION_MAX_DURATION`
// boş veya sayı olmayan bir metin olduğunda `Number(...)` `0`/`NaN` üretir, Nitro
// bunu `vercel.functions.maxDuration` alanına yazar ve Vercel build'i
// YAPILANDIRMA DOĞRULAMASINDA reddeder — kurulum/derleme başlamadan, saniyeler
// içinde. Böyle bir hata kodla ilgisi olmadığı hâlde "build kırıldı" gibi
// göründüğü için env girdisinin tek bir yerde savunmacı çözülmesi şarttır.
import { describe, expect, it } from "vitest";
import { resolveFunctionMaxDuration, VERCEL_MAX_FUNCTION_SECONDS } from "../../nitro.config";

describe("resolveFunctionMaxDuration", () => {
  it("tanımlı değilse Vercel'in 300 sn varsayılanına düşer", () => {
    expect(resolveFunctionMaxDuration(undefined)).toBe(300);
    expect(VERCEL_MAX_FUNCTION_SECONDS).toBe(300);
  });

  it("boş ve whitespace değerleri varsayılana düşer (Number('') = 0 tuzağı)", () => {
    expect(resolveFunctionMaxDuration("")).toBe(300);
    expect(resolveFunctionMaxDuration("   ")).toBe(300);
  });

  it("sayı olmayan metni varsayılana düşer (NaN JSON'a yazılamaz)", () => {
    expect(resolveFunctionMaxDuration("abc")).toBe(300);
    expect(resolveFunctionMaxDuration("300sn")).toBe(300);
    expect(resolveFunctionMaxDuration("1e309")).toBe(300);
  });

  it("sıfır, negatif ve 10'un altındaki değerleri reddeder", () => {
    expect(resolveFunctionMaxDuration("0")).toBe(300);
    expect(resolveFunctionMaxDuration("-60")).toBe(300);
    expect(resolveFunctionMaxDuration("5")).toBe(300);
  });

  it("geçerli değeri korur, kesirli olanı yuvarlar", () => {
    expect(resolveFunctionMaxDuration("60")).toBe(60);
    expect(resolveFunctionMaxDuration(" 120 ")).toBe(120);
    expect(resolveFunctionMaxDuration("280.6")).toBe(281);
  });

  it("Hobby tavanının üstünü 300'e kırpar", () => {
    expect(resolveFunctionMaxDuration("800")).toBe(300);
    expect(resolveFunctionMaxDuration("5000")).toBe(300);
  });

  it("sonuç her zaman Vercel'in kabul ettiği aralıktadır", () => {
    for (const raw of [undefined, "", " ", "abc", "0", "-1", "5", "300", "9000"]) {
      const value = resolveFunctionMaxDuration(raw);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(300);
    }
  });
});
