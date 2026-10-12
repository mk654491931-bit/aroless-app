import { describe, expect, it } from "vitest";

import { averageLinkedMarginPct, measurePickAccuracy, pickKey, type PickLike } from "./pick-outcomes";
import type { RoiEntry } from "./roi-math";

const pick = (over: Partial<PickLike> = {}): PickLike => ({
  title: "Air Fryer 6 Qt Digital",
  day: "2026-10-12",
  winnerScore: 80,
  momentum: 9,
  priceMin: 45,
  priceMax: 60,
  marginPct: 32,
  ...over,
});

const entry = (over: Partial<RoiEntry> = {}): RoiEntry => ({
  id: "e1",
  product_name: "Air Fryer 6 Qt Digital Siyah",
  platform: "Shopify",
  country: "US",
  currency: "USD",
  cost_price: 20,
  sell_price: 59,
  shipping_cost: 5,
  other_cost: 2,
  ad_spend: 100,
  orders: 10,
  refunds: 0,
  expected_margin_pct: 30,
  notes: null,
  created_at: "2026-10-20T00:00:00Z",
  ...over,
});

describe("pickKey", () => {
  it("aynı ürünün farklı yazımlarını eşler", () => {
    expect(pickKey("Air Fryer 6 Qt Digital Siyah")).toBe(pickKey("air fryer 6 qt digital siyah"));
  });
});

describe("measurePickAccuracy — öneri → gerçek sonuç", () => {
  it("ROI kaydı olan öneriyi bağlar ve isabet oranını hesaplar", () => {
    const acc = measurePickAccuracy([pick()], [entry()]);
    // 10 × (59 − 27) = 320 brüt − 100 reklam = 220 net kâr
    expect(acc.linked).toBe(1);
    expect(acc.profitRate).toBe(1);
    expect(acc.totalProfit).toBe(220);
    expect(acc.summary).toContain("1 tanesi gerçek ROI kaydıyla eşleşti");
  });

  it("sonuçsuz öneri oranlara GİRMEZ (0 kâr varsayılmaz)", () => {
    const acc = measurePickAccuracy(
      [pick(), pick({ title: "Robot Süpürge X" })],
      [entry()],
    );
    expect(acc.picks).toBe(2);
    expect(acc.linked).toBe(1);
    expect(acc.profitRate).toBe(1);
    expect(acc.unlinkedTitles).toEqual(["Robot Süpürge X"]);
  });

  it("zarar eden öneri isabeti düşürür", () => {
    const acc = measurePickAccuracy(
      [pick()],
      [entry({ ad_spend: 900 })], // 320 brüt − 900 reklam = -580
    );
    expect(acc.profitRate).toBe(0);
    expect(acc.totalProfit).toBe(-580);
  });

  it("aynı ürünün birden çok ROI kaydını TEK öneri sayar (çift sayım yok)", () => {
    const acc = measurePickAccuracy([pick()], [entry(), entry({ id: "e2", orders: 5, ad_spend: 50 })]);
    expect(acc.picks).toBe(1);
    expect(acc.linked).toBe(1);
    // 220 + (5 × 32 − 50) = 220 + 110 = 330
    expect(acc.totalProfit).toBe(330);
  });

  it("kriter bazlı isabet üretir (orana yalnız SONUCA BAĞLANAN kayıtlar girer)", () => {
    const acc = measurePickAccuracy(
      [pick(), pick({ title: "Ucuz Ürün Z", winnerScore: 55, momentum: 3, marginPct: 12 })],
      [entry()], // yalnız ilk öneri gerçek sonuca bağlanıyor
    );
    const highScore = acc.byCriterion.find((c) => c.id === "yuksek-skor")!;
    expect(highScore.picks).toBe(1); // yalnız 70+ skorlu öneri
    expect(highScore.linked).toBe(1);
    expect(highScore.profitRate).toBe(1);
    // Momentum kriterini İKİ öneri taşıyor ama biri sonuçsuz: oran tek kayda dayanır.
    const momentum = acc.byCriterion.find((c) => c.id === "pozitif-momentum")!;
    expect(momentum.picks).toBe(2);
    expect(momentum.linked).toBe(1);
    expect(momentum.profitRate).toBe(1);
    // Hiç bağlanmayan kriter açıkça `null` der (0 değil).
    const margin = acc.byCriterion.find((c) => c.id === "marj-var")!;
    expect(margin.picks).toBe(2);
    expect(margin.linked).toBe(1);
  });

  it("hiç eşleşme yoksa açıkça söyler (uydurma oran yok)", () => {
    const acc = measurePickAccuracy([pick()], []);
    expect(acc.profitRate).toBeNull();
    expect(acc.totalProfit).toBeNull();
    expect(acc.summary).toContain("sonuca bağlanan öneri yok");
    expect(averageLinkedMarginPct(acc)).toBeNull();
  });
});
