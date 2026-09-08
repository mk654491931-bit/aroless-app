import { describe, expect, it } from "vitest";
import { sortProducts, toProductList, toResultsCsv, type FinderProduct } from "@/lib/finder-derivations";

const enrichProduct = (product: FinderProduct) => ({
  ai_score: product.winner_score ?? 0,
  trend_score: product.trend_score ?? 0,
  est_monthly_net_profit_usd: product.winner_score ?? 0,
  recommendation: product.winner_score && product.winner_score >= 70 ? "Launch" : "Hold",
});

const buyersPer1000 = (product: FinderProduct) => product.winner_score ?? 0;

describe("toProductList", () => {
  it("extracts direct arrays and drops non-objects", () => {
    expect(toProductList([{ name: "A" }, null, 1])).toEqual([{ name: "A" }]);
  });

  it("extracts products/results/data object wrappers", () => {
    expect(toProductList({ products: [{ name: "A" }] })).toEqual([{ name: "A" }]);
    expect(toProductList({ results: [{ name: "B" }] })).toEqual([{ name: "B" }]);
    expect(toProductList({ data: [{ name: "C" }] })).toEqual([{ name: "C" }]);
    expect(toProductList({ data: { products: [{ name: "D" }] } })).toEqual([{ name: "D" }]);
  });

  it("returns an empty list for invalid shapes", () => {
    expect(toProductList(null)).toEqual([]);
    expect(toProductList("x")).toEqual([]);
    expect(toProductList({ nope: true })).toEqual([]);
  });
});

describe("sortProducts", () => {
  const sample: FinderProduct[] = [
    { name: "Low", winner_score: 10 },
    { name: "High", winner_score: 90 },
    { name: "Mid", winner_score: 50 },
  ];

  it("sorts descending by default criteria", () => {
    const sorted = sortProducts(sample, "winner", false, true, { enrichProduct, buyersPer1000 });
    expect(sorted.map((p) => p.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts ascending when desc=false", () => {
    const sorted = sortProducts(sample, "winner", false, false, { enrichProduct, buyersPer1000 });
    expect(sorted.map((p) => p.name)).toEqual(["Low", "Mid", "High"]);
  });

  it("applies launch-only filtering before sorting", () => {
    const sorted = sortProducts(sample, "winner", true, true, { enrichProduct, buyersPer1000 });
    expect(sorted.map((p) => p.name)).toEqual(["High"]);
  });
});

describe("toResultsCsv", () => {
  it("writes a quoted CSV and escapes quotes", () => {
    const csv = toResultsCsv(
      [{ name: 'A "quoted"', winner_score: 75, supplier_price_usd: "$10", selling_price_usd: "$30", profit_margin_pct: 50 }],
      { enrichProduct, buyersPer1000 },
    );
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"A ""quoted"""');
  });
});
