import { describe, expect, it } from "vitest";
import {
  cleanSupplierText,
  formatFxContext,
  isAllowedSupplierUrl,
} from "./tools-live-context.server";

describe("ücretsiz canlı araç bağlamı", () => {
  it("yalnız HTTPS ve bilinen tedarikçi alan adlarını kabul eder", () => {
    expect(isAllowedSupplierUrl("https://www.alibaba.com/company/123")).toBe(true);
    expect(isAllowedSupplierUrl("https://supplier.1688.com/page")).toBe(true);
    expect(isAllowedSupplierUrl("https://made-in-china.com/company")).toBe(true);
    expect(isAllowedSupplierUrl("http://www.alibaba.com/company/123")).toBe(false);
    expect(isAllowedSupplierUrl("https://alibaba.com.evil.example/company")).toBe(false);
    expect(isAllowedSupplierUrl("https://example.com/company")).toBe(false);
    expect(isAllowedSupplierUrl("not a url")).toBe(false);
  });

  it("tedarikçi sayfası metnini script/markdown ve HTML'den arındırır", () => {
    const text = cleanSupplierText(
      "<script>alert(1)</script><style>x</style>![görsel](x) [Fabrika](https://x) <b>10 yıl</b> üretim deneyimi",
    );
    expect(text).toContain("Fabrika");
    expect(text).toContain("10 yıl");
    expect(text).not.toContain("script");
    expect(text).not.toContain("<b>");
  });

  it("FX bağlamında kaynak, tarih ve USD tabanlı kurlar bulunur", () => {
    const context = formatFxContext({
      base: "USD",
      rates: { USD: 1, CNY: 7.1, EUR: 0.92, TRY: 34.2, JPY: 151 },
      updated: "2026-11-09T00:00:00Z",
      source: "open.er-api.com",
    });
    expect(context.text).toContain("1 USD = 7.1000 CNY");
    expect(context.text).toContain("1 USD = 34.2000 TRY");
    expect(context.text).toContain("open.er-api.com");
    expect(context.text).toContain("kur uydurma");
    expect(context.sources[0].url).toContain("open.er-api.com");
    expect(context.sources[0].fetchedAt).toBe("2026-11-09T00:00:00Z");
  });
});
