import { describe, expect, it } from "vitest";
import { buildShopifyCsv, netMarginView, resolveProductImage } from "@/lib/finder-formatting";

describe("netMarginView", () => {
  it("marks non-positive margin as unprofitable", () => {
    expect(netMarginView({ selling_price_usd: "$10", supplier_price_usd: "$20" })).toEqual({
      text: "0% (UNPROFITABLE)",
      bad: true,
    });
  });

  it("uses provided net profit from cost breakdown", () => {
    expect(
      netMarginView({
        selling_price_usd: "$100",
        supplier_price_usd: "$10",
        cost_breakdown: { net_profit: "$45" },
      }),
    ).toEqual({ text: "45%", bad: false });
  });
});

describe("buildShopifyCsv", () => {
  it("builds header + one row and strips HTML brackets from dynamic fields", () => {
    const csv = buildShopifyCsv([
      {
        name: "My Product",
        description: "desc <unsafe>",
        why_winning: "<tag>",
        target_audience: "all",
        ad_angles: ["x<y"],
        selling_price_usd: "$30",
        supplier_price_usd: "$10",
      },
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("&lt;unsafe>");
    expect(lines[1]).toContain("&lt;tag>");
  });
});

describe("resolveProductImage", () => {
  it("accepts real http(s) URLs", () => {
    expect(resolveProductImage({ image_url: "https://example.com/image.jpg" })).toBe(
      "https://example.com/image.jpg",
    );
  });

  it("rejects missing, non-http and placeholder domains", () => {
    expect(resolveProductImage({ image_url: "" })).toBeNull();
    expect(resolveProductImage({ image_url: "ftp://example.com/x.png" })).toBeNull();
    expect(resolveProductImage({ image_url: "https://picsum.photos/100/100" })).toBeNull();
  });
});
