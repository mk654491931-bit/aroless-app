import { describe, expect, it } from "vitest";
import { aggregateRoi, computeRoi, type RoiEntry } from "./roi-math";

function entry(overrides: Partial<RoiEntry>): RoiEntry {
  return {
    id: crypto.randomUUID(),
    product_name: "Test ürün",
    platform: "Shopify",
    country: "US",
    currency: "USD",
    cost_price: 5,
    sell_price: 20,
    shipping_cost: 2,
    other_cost: 1,
    ad_spend: 100,
    orders: 20,
    refunds: 2,
    expected_margin_pct: 40,
    notes: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("roi-math", () => {
  it("iadeyi siparişten düşer ve net kârı hesaplar", () => {
    const stats = computeRoi(entry({ orders: 10, refunds: 2, ad_spend: 20 }));
    expect(stats.netOrders).toBe(8);
    expect(stats.revenue).toBe(160);
    expect(stats.cogs).toBe(64);
    expect(stats.netProfit).toBe(76);
    expect(stats.marginPct).toBeCloseTo(47.5, 1);
  });

  it("farklı para birimlerini toplamaz; seçili para birimini kullanır", () => {
    const usd = entry({ currency: "USD", orders: 10, refunds: 0, ad_spend: 50 });
    const tryEntry = entry({ currency: "TRY", orders: 10, refunds: 0, ad_spend: 50 });
    const aggregate = aggregateRoi([usd, tryEntry], "USD");
    expect(aggregate.currency).toBe("USD");
    expect(aggregate.mixedCurrencies).toBe(true);
    expect(aggregate.currencies).toEqual(["TRY", "USD"]);
    // Yalnız USD satırı toplanır; TRY ciroya eklenmez.
    expect(aggregate.revenue).toBe(200);
    expect(aggregate.byCurrency.TRY?.revenue).toBe(200);
    expect(aggregate.byCurrency.TRY?.rows).toBe(1);
  });

  it("tek para biriminde tüm satırları toplar", () => {
    const aggregate = aggregateRoi([
      entry({ orders: 10, refunds: 0, ad_spend: 50 }),
      entry({ orders: 5, refunds: 0, ad_spend: 25 }),
    ]);
    expect(aggregate.mixedCurrencies).toBe(false);
    expect(aggregate.rows).toHaveLength(2);
    expect(aggregate.orders).toBe(15);
    expect(aggregate.winners + aggregate.losers).toBe(2);
  });
});
