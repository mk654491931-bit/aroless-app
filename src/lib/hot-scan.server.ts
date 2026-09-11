// ============================================================================
// Live market scan (server only)
//
// Extracted from the `/api/public/hot-products` route so both the cached JSON
// endpoint and the streaming product-discovery endpoint share exactly one
// scanner implementation. The scan itself is unchanged: Google-Search-grounded
// Gemini, real SKUs only, no synthetic fallback.
//
// The only addition is `onItem`, which fires the moment a product is normalised
// so callers can push it to the database and stream it to the client without
// waiting for the rest of the scan.
// ============================================================================

import { mapBatched } from "./concurrency.server";
import type { ProductSignals, StreamedProduct } from "./product-stream.shared";

export type MarketScanPayload = {
  hour: string;
  refreshed_at: string;
  next_refresh_at: string;
  items: StreamedProduct[];
  niche?: string;
  /** Budget exhausted: `items` holds everything the scan produced so far. */
  partial?: boolean;
  partialReason?: "gateway_budget";
};

/** ISO timestamp of the next UTC hour boundary (feed refresh cadence). */
export function nextHourIso(from = new Date()): string {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

export type MarketScanOptions = {
  signal?: AbortSignal;
  /** Awaited per product; a throw here must not abort the whole scan. */
  onItem?: (product: StreamedProduct, index: number) => void | Promise<void>;
  /**
   * How many `onItem` handlers (DB write + emit) may run in parallel. Batching
   * them keeps the scan short without stampeding the database.
   */
  concurrency?: number;
};

export function hourKey(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const FLAGS: Record<string, string> = {
  US: "🇺🇸",
  UK: "🇬🇧",
  GB: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
  TR: "🇹🇷",
  ES: "🇪🇸",
  IT: "🇮🇹",
  NL: "🇳🇱",
  CA: "🇨🇦",
  AU: "🇦🇺",
  AE: "🇦🇪",
  SA: "🇸🇦",
  BR: "🇧🇷",
  MX: "🇲🇽",
  JP: "🇯🇵",
  KR: "🇰🇷",
  IN: "🇮🇳",
  PL: "🇵🇱",
  SE: "🇸🇪",
};

/** Keeps a reported number only when it is a real, finite, positive value. */
export function pnum(v: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

export function normalizeSignals(raw: unknown): ProductSignals | undefined {
  const s = (raw ?? {}) as Record<string, unknown>;
  const out: ProductSignals = {
    search_volume_monthly: pnum(s["search_volume_monthly"]),
    social_views_now: pnum(s["social_views_now"]),
    social_views_7d_ago: pnum(s["social_views_7d_ago"]),
    active_stores: pnum(s["active_stores"], 5000),
    ads_running_14d: pnum(s["ads_running_14d"], 5000),
    amazon_sellers: pnum(s["amazon_sellers"], 5000),
    review_count: pnum(s["review_count"]),
    quality_complaint_pct: pnum(s["quality_complaint_pct"], 100),
    sizing_complaint_pct: pnum(s["sizing_complaint_pct"], 100),
    shipping_complaint_pct: pnum(s["shipping_complaint_pct"], 100),
    on_time_delivery_pct: pnum(s["on_time_delivery_pct"], 100),
    stock_stability_pct: pnum(s["stock_stability_pct"], 100),
    lead_time_days: pnum(s["lead_time_days"], 120),
    cpc_usd: pnum(s["cpc_usd"], 50),
    cvr_pct: pnum(s["cvr_pct"], 30),
    sources: Array.isArray(s["sources"])
      ? (s["sources"] as unknown[]).slice(0, 6).map(String)
      : undefined,
  };
  for (const k of Object.keys(out) as Array<keyof ProductSignals>) {
    if (out[k] === undefined) delete out[k];
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeMarketProduct(raw: unknown, i: number): StreamedProduct | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = String(r["name"] ?? "").trim();
  if (!name) return null;
  const country = String(r["country"] ?? "US")
    .toUpperCase()
    .slice(0, 3);
  const comp = String(r["competition"] ?? "Medium");
  return {
    id: `${slug(name)}-${i}`,
    name: name.slice(0, 90),
    why_now: String(r["why_now"] ?? "").slice(0, 240),
    country,
    country_flag: FLAGS[country] ?? "🌍",
    marketplace: String(r["marketplace"] ?? "Shopify"),
    budget_usd: String(r["budget_usd"] ?? "$500 - $1,500"),
    supplier_cost_usd: String(r["supplier_cost_usd"] ?? "—"),
    retail_price_usd: String(r["retail_price_usd"] ?? "—"),
    margin_pct: Math.max(0, Math.min(95, Math.round(Number(r["margin_pct"]) || 0))),
    demand_signal: String(r["demand_signal"] ?? "").slice(0, 220),
    competition: comp === "Low" || comp === "High" ? comp : "Medium",
    audience: String(r["audience"] ?? "").slice(0, 160),
    ad_angle: String(r["ad_angle"] ?? "").slice(0, 220),
    sourcing: String(r["sourcing"] ?? "AliExpress / 1688"),
    lead_time: String(r["lead_time"] ?? "8-15 days"),
    first_week_plan: Array.isArray(r["first_week_plan"])
      ? (r["first_week_plan"] as unknown[]).slice(0, 6).map(String)
      : [],
    risks: Array.isArray(r["risks"]) ? (r["risks"] as unknown[]).slice(0, 4).map(String) : [],
    score: Math.max(0, Math.min(100, Math.round(Number(r["score"]) || 70))),
    signals: normalizeSignals(r["signals"]),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }
}

async function scanPrompt(niche: string): Promise<string> {
  const { callGemini } = await import("@/lib/ai.server");
  const now = new Date();
  const focus = niche
    ? `NICHE FOCUS: every product must belong to the "${niche}" niche/category. If the niche is narrow, still return the 10 strongest real SKUs inside it.`
    : `NICHE FOCUS: none — cover a spread of niches, countries and marketplaces.`;

  const prompt = `You are a live e-commerce market scanner with web access. Using CURRENT real web data (${now.toISOString().slice(0, 10)}, hour ${now.getUTCHours()}:00 UTC), list the 10 products that are MOST SELLABLE RIGHT NOW for a dropshipper/e-commerce seller.

${focus}

Rules:
- Real, specific, nameable SKUs currently selling online. No categories, no invented items.
- Use real supplier price bands (AliExpress/1688/CJ) and real retail bands.
- Pick the single best COUNTRY market and the single best MARKETPLACE/channel for each.
- State the realistic STARTING BUDGET (USD range) needed to launch it profitably.
- "signals" must contain measured, web-evidenced numbers. OMIT any signal field you cannot ground in real data — never guess, never fill a placeholder. List the domains you used in signals.sources.

Return ONLY JSON:
{"items":[{"name":string,"why_now":string,"country":string (2-letter ISO code),"marketplace":string,"budget_usd":string (e.g. "$800 - $2,000"),"supplier_cost_usd":string,"retail_price_usd":string,"margin_pct":number,"demand_signal":string (real search/social/marketplace evidence),"competition":"Low"|"Medium"|"High","audience":string,"ad_angle":string,"sourcing":string,"lead_time":string,"first_week_plan":string[4],"risks":string[3],"score":number 1-100,
"signals":{"search_volume_monthly":number,"social_views_now":number,"social_views_7d_ago":number,"active_stores":number,"ads_running_14d":number,"amazon_sellers":number,"review_count":number,"quality_complaint_pct":number,"sizing_complaint_pct":number,"shipping_complaint_pct":number,"on_time_delivery_pct":number,"stock_stability_pct":number,"lead_time_days":number,"cpc_usd":number,"cvr_pct":number,"sources":string[]}}]}`;

  const key = process.env["GEMINI_API_KEY_3"] || process.env["GEMINI_API_KEY"];
  const text = await callGemini(prompt, key, 0.6, true, [
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ]);
  return text;
}

/**
 * Runs one full live market scan.
 *
 * When `onItem` is provided it is awaited for every normalised product before
 * the scan finishes, which is what lets the caller persist + stream each
 * product immediately instead of waiting for the whole batch.
 */
export async function buildMarketScan(
  niche: string,
  options: MarketScanOptions = {},
): Promise<MarketScanPayload> {
  const { extractJson } = await import("@/lib/ai.server");
  const now = new Date();

  throwIfAborted(options.signal);
  const text = await scanPrompt(niche);
  throwIfAborted(options.signal);

  const parsed = extractJson<{ items?: unknown[] }>(text, { items: [] });
  const raw = (parsed.items ?? []).slice(0, 12);

  const items: StreamedProduct[] = [];
  for (let i = 0; i < raw.length; i++) {
    throwIfAborted(options.signal);
    const product = normalizeMarketProduct(raw[i], i);
    if (!product) continue;
    items.push(product);
  }

  // Persist + stream the products in small parallel batches: the per-product
  // work (DB write, SSE frame) is independent, so awaiting it one by one only
  // added latency. A failing handler still cannot kill the scan.
  if (options.onItem) {
    const handlers = options.onItem;
    await mapBatched(items, options.concurrency ?? 3, async (product, index) => {
      throwIfAborted(options.signal);
      try {
        await handlers(product, index);
      } catch (error) {
        console.error("[hot-scan] onItem handler failed", error);
      }
    });
  }

  items.sort((a, b) => b.score - a.score);

  return {
    hour: hourKey(now),
    refreshed_at: now.toISOString(),
    next_refresh_at: nextHourIso(now),
    items,
    ...(niche ? { niche } : {}),
  };
}
