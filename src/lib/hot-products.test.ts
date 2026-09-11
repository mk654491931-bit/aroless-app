import { describe, expect, it } from "vitest";
import { buildHotFeedFromItems, type HotProduct } from "./hot-products";

const product: HotProduct = {
  id: "mini-blender-0",
  name: "Mini Blender",
  why_now: "Rising demand",
  country: "US",
  country_flag: "🇺🇸",
  marketplace: "Shopify",
  budget_usd: "$800",
  supplier_cost_usd: "$8.40",
  retail_price_usd: "$29.99",
  margin_pct: 42,
  demand_signal: "1.2M views",
  competition: "Low",
  audience: "Gym goers",
  ad_angle: "Blend anywhere",
  sourcing: "AliExpress",
  lead_time: "9 days",
  first_week_plan: ["a", "b"],
  risks: ["stock"],
  score: 88,
};

describe("buildHotFeedFromItems", () => {
  it("wraps streamed products in a feed envelope", () => {
    const at = new Date("2026-09-11T07:45:00.000Z");
    const feed = buildHotFeedFromItems([product], at);

    expect(feed.items).toEqual([product]);
    expect(feed.hour).toBe("2026-09-11T07");
    expect(feed.refreshed_at).toBe(at.toISOString());
    expect(feed.next_refresh_at).toBe("2026-09-11T08:00:00.000Z");
    expect(feed.error).toBeUndefined();
  });

  it("returns an empty feed when nothing streamed", () => {
    const feed = buildHotFeedFromItems([], new Date("2026-09-11T07:00:00.000Z"));
    expect(feed.items).toEqual([]);
    expect(feed.next_refresh_at).toBe("2026-09-11T08:00:00.000Z");
  });
});
