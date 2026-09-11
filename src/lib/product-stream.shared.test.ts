import { describe, expect, it } from "vitest";
import { parseProductStreamFrame, productStreamErrorMessage } from "./product-stream.shared";

describe("parseProductStreamFrame", () => {
  it("ignores comment heartbeats and connection flushes", () => {
    expect(parseProductStreamFrame(":ping")).toBeNull();
    expect(parseProductStreamFrame(": initial-connect")).toBeNull();
    expect(parseProductStreamFrame("\n:ping\n")).toBeNull();
    expect(parseProductStreamFrame("")).toBeNull();
  });

  it("parses a named data frame and keeps its event name", () => {
    const frame = 'event: agent\ndata: {"agent":"Market Scanner","status":"running","tier":1}';
    const event = parseProductStreamFrame(frame);
    expect(event).toEqual({
      type: "agent",
      agent: "Market Scanner",
      status: "running",
      tier: 1,
    });
  });

  it("parses a typed data frame carrying a streamed product", () => {
    const product = {
      id: "mini-blender-0",
      name: "Mini Blender",
      why_now: "Rising",
      country: "US",
      country_flag: "🇺🇸",
      marketplace: "Shopify",
      budget_usd: "$500",
      supplier_cost_usd: "$8",
      retail_price_usd: "$29",
      margin_pct: 42,
      demand_signal: "TikTok viral",
      competition: "Low" as const,
      audience: "Gym goers",
      ad_angle: "Blend anywhere",
      sourcing: "AliExpress",
      lead_time: "9 days",
      first_week_plan: ["a", "b", "c", "d"],
      risks: ["stock"],
      score: 88,
    };
    const event = parseProductStreamFrame(
      `data: ${JSON.stringify({ type: "product", index: 0, product, saved: true, rowId: "row-1" })}`,
    );
    expect(event?.type).toBe("product");
    if (event?.type === "product") {
      expect(event.saved).toBe(true);
      expect(event.rowId).toBe("row-1");
      expect(event.product.name).toBe("Mini Blender");
    }
  });

  it("drops malformed or unknown frames instead of throwing", () => {
    expect(parseProductStreamFrame("data: {not-json")).toBeNull();
    expect(parseProductStreamFrame('data: {"type":"mystery"}')).toBeNull();
    expect(parseProductStreamFrame("data: [1,2,3]")).toBeNull();
    expect(parseProductStreamFrame("event: ping\ndata: ")).toBeNull();
  });

  it("supports multi-line data payloads", () => {
    const event = parseProductStreamFrame(
      'event: stage\ndata: {"stage":"scan",\ndata: "label":"scanning"}',
    );
    expect(event).toEqual({ type: "stage", stage: "scan", label: "scanning" });
  });
});

describe("productStreamErrorMessage", () => {
  it("prefers server-provided messages", () => {
    expect(productStreamErrorMessage({ error: "kredi bitti" }, "fallback")).toBe("kredi bitti");
    expect(productStreamErrorMessage({ message: "yavaş" }, "fallback")).toBe("yavaş");
    expect(productStreamErrorMessage(null, "fallback")).toBe("fallback");
  });
});
