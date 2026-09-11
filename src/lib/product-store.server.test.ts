import { describe, expect, it, vi, type Mock } from "vitest";
import type { ProductInsert, ProductStoreClient } from "./product-store.server";
import { parseMoney, persistStreamedProduct, toProductInsert } from "./product-store.server";
import type { StreamedProduct } from "./product-stream.shared";

const product: StreamedProduct = {
  id: "mini-blender-0",
  name: "Mini Blender",
  why_now: "TikTok demand spiked this week",
  country: "US",
  country_flag: "🇺🇸",
  marketplace: "Shopify",
  budget_usd: "$800 - $2,000",
  supplier_cost_usd: "$8.40",
  retail_price_usd: "$29.99",
  margin_pct: 42,
  demand_signal: "1.2M TikTok views",
  competition: "Low",
  audience: "Gym goers",
  ad_angle: "Blend anywhere",
  sourcing: "AliExpress",
  lead_time: "9 days",
  first_week_plan: ["a", "b"],
  risks: ["stock"],
  score: 88,
};

function fakeClient(result: { data: { id?: string } | null; error: { message: string } | null }): {
  client: ProductStoreClient;
  insert: Mock;
} {
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => result }),
  }));
  return {
    client: { from: () => ({ insert }) } as unknown as ProductStoreClient,
    insert,
  };
}

describe("parseMoney", () => {
  it("extracts the first real number from money strings", () => {
    expect(parseMoney("$29.99")).toBeCloseTo(29.99);
    expect(parseMoney("$1,299")).toBe(1299);
    expect(parseMoney("—")).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
  });
});

describe("toProductInsert", () => {
  it("maps streamed products onto the products table columns", () => {
    const row = toProductInsert(product, { userId: "user-1", targetCountry: "US" });
    expect(row.user_id).toBe("user-1");
    expect(row.title).toBe("Mini Blender");
    expect(row.cost_price).toBeCloseTo(8.4);
    expect(row.selling_price).toBeCloseTo(29.99);
    expect(row.trend_score).toBe(88);
    expect(row.profit_margin).toBe(42);
    expect(row.competition_level).toBe("Low");
    expect(row.sellability_verdict).toBe("Highly Sellable");
    expect(row.status_message).toBe("TikTok demand spiked this week");
  });

  it("clamps out-of-range scores and flags weak products", () => {
    const row = toProductInsert(
      { ...product, score: 140, margin_pct: 2, why_now: "" },
      { userId: "user-1", targetCountry: "US" },
    );
    expect(row.trend_score).toBe(100);
    expect(row.sellability_verdict).toBe("Do Not Sell");
    expect(row.status_message).toBeNull();
  });
});

describe("persistStreamedProduct", () => {
  it("persists immediately when the user is authenticated", async () => {
    const { client, insert } = fakeClient({ data: { id: "row-1" }, error: null });
    const outcome = await persistStreamedProduct(
      product,
      { userId: "user-1", targetCountry: "US" },
      client,
    );

    expect(outcome).toEqual({ saved: true, rowId: "row-1" });
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]?.[0] as ProductInsert[] | undefined;
    expect(rows?.[0]?.user_id).toBe("user-1");
  });

  it("skips the write for anonymous callers instead of failing", async () => {
    const { client, insert } = fakeClient({ data: null, error: null });
    const outcome = await persistStreamedProduct(
      product,
      { userId: null, targetCountry: "US" },
      client,
    );

    expect(outcome).toEqual({ saved: false, skipped: "unauthenticated" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns the DB error without throwing so the stream continues", async () => {
    const { client } = fakeClient({ data: null, error: { message: "duplicate key" } });
    const outcome = await persistStreamedProduct(
      product,
      { userId: "user-1", targetCountry: "US" },
      client,
    );

    expect(outcome.saved).toBe(false);
    expect(outcome.error).toBe("duplicate key");
  });

  it("contains unexpected client failures", async () => {
    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => {
              throw new Error("socket hang up");
            },
          }),
        }),
      }),
    } as unknown as ProductStoreClient;

    const outcome = await persistStreamedProduct(
      product,
      { userId: "user-1", targetCountry: "US" },
      client,
    );
    expect(outcome.saved).toBe(false);
    expect(outcome.error).toBe("socket hang up");
  });
});
