import { describe, expect, it } from "vitest";
import {
  sanitizeCountry,
  sanitizeHotProductsNiche,
  sanitizeProductImageQuery,
  sanitizeStringArray,
  sanitizeToolId,
  sanitizeToolInputMap,
  sanitizeTrendAnalysisInput,
  sanitizeTrendRadarAction,
  sanitizeTrendRadarCategory,
  sanitizeTrendRadarMode,
  sanitizeTrendView,
} from "@/lib/api-request-sanitizers";

describe("api request sanitizer call sites", () => {
  it("sanitizes short query params", () => {
    expect(sanitizeHotProductsNiche(" mug\u200B \u202E niche ")).toBe("mug niche");
    expect(sanitizeProductImageQuery("lamp\n\nshade")).toBe("lamp shade");
  });

  it("normalizes view and country values", () => {
    expect(sanitizeTrendView("next")).toBe("next");
    expect(sanitizeTrendView("next\u202E")).toBe("next");
    expect(sanitizeTrendView("unknown")).toBe("now");
    expect(sanitizeCountry("tr\u200B")).toBe("TR");
    expect(sanitizeCountry("")).toBe("GLOBAL");
  });

  it("sanitizes tool payload keys and values", () => {
    expect(sanitizeToolId("consensus\u202E")).toBe("consensus");
    expect(
      sanitizeToolInputMap({
        "pro\u200Bduct": "A\u0000B",
      }),
    ).toEqual({ product: "AB" });
  });

  it("sanitizes trend-analysis prompt fields", () => {
    const sanitized = sanitizeTrendAnalysisInput({
      name: "  Ürün\u202E ",
      keyword: "k\neyword",
      why: "a\u0000bc\u202E",
      country: "tr\u200B",
    });
    expect(sanitized).toMatchObject({
      name: "Ürün",
      keyword: "k eyword",
      why: "abc",
      country: "TR",
    });
  });

  it("sanitizes trend-radar action payload fields", () => {
    expect(sanitizeTrendRadarAction("brief\u202E")).toBe("brief");
    expect(sanitizeTrendRadarCategory("Gen\u0000eral")).toBe("General");
    expect(sanitizeTrendRadarMode("strategy\u200B")).toBe("strategy");
    expect(sanitizeTrendRadarMode("invalid")).toBe("fast");
    expect(sanitizeStringArray(["a\u202E", "b"], 2, 5)).toEqual(["a", "b"]);
  });
});
