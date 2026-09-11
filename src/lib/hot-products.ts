// Client-safe types + fetcher for the hourly "most sellable right now" feed.
// Every value comes from the live Google-Search-grounded market scan — there is
// no local catalog, no seeded pseudo-metric and no demo fallback.

/** Real, evidence-backed market signals returned by the live scan. */
export type ProductSignals = {
  search_volume_monthly?: number;
  social_views_now?: number;
  social_views_7d_ago?: number;
  active_stores?: number;
  ads_running_14d?: number;
  amazon_sellers?: number;
  review_count?: number;
  quality_complaint_pct?: number;
  sizing_complaint_pct?: number;
  shipping_complaint_pct?: number;
  on_time_delivery_pct?: number;
  stock_stability_pct?: number;
  lead_time_days?: number;
  cpc_usd?: number;
  cvr_pct?: number;
  sources?: string[];
};

export type HotProduct = {
  id: string;
  name: string;
  why_now: string;
  country: string;
  country_flag: string;
  marketplace: string;
  budget_usd: string;
  supplier_cost_usd: string;
  retail_price_usd: string;
  margin_pct: number;
  demand_signal: string;
  competition: "Low" | "Medium" | "High";
  audience: string;
  ad_angle: string;
  sourcing: string;
  lead_time: string;
  first_week_plan: string[];
  risks: string[];
  score: number;
  signals?: ProductSignals;
};

export type HotFeed = {
  hour: string;
  refreshed_at: string;
  next_refresh_at: string;
  items: HotProduct[];
  error?: string;
  /** The scan hit the gateway budget; `items` holds everything found so far. */
  partial?: boolean;
};

/** Builds the feed envelope from products streamed by the discovery endpoint. */
export function buildHotFeedFromItems(items: HotProduct[], now = new Date()): HotFeed {
  const iso = now.toISOString();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return {
    hour: iso.slice(0, 13),
    refreshed_at: iso,
    next_refresh_at: next.toISOString(),
    items,
  };
}

/**
 * Last-resort reader: consumes the streaming discovery endpoint so a slow scan
 * (the one that used to die with HTTP 524) still fills the feed instead of
 * leaving the UI on an empty state.
 */
async function fetchHotProductsStreamed(niche: string): Promise<HotProduct[]> {
  const { streamProductDiscovery } = await import("./product-stream");
  const result = await streamProductDiscovery(
    { niche: niche.trim() || undefined },
    {},
    AbortSignal.timeout(180_000),
  );
  return result.items;
}

/** Live progress a caller can render while an async discovery job runs. */
export type HotFeedProgress = {
  status: string;
  stage: string;
  stageLabel: string;
  progress: number;
  partial: boolean;
};

export type FetchHotProductsOptions = {
  onProgress?: (progress: HotFeedProgress) => void;
};

/**
 * Resolves the live feed, fastest path first:
 *
 *   1. the hourly JSON cache (milliseconds, works signed-out);
 *   2. an **async Product Discovery job** — start → `jobId` → status polling —
 *      when the cache is cold/empty and the caller is signed in. This is the
 *      path that replaced the 90-100s synchronous request that triggered
 *      Cloudflare 524s: nothing long-lived is ever held open on the browser's
 *      connection.
 *   3. the SSE stream as a last resort (queue not configured, signed-out, or
 *      the job could not be authorized).
 */
export async function fetchHotProducts(
  arg?: unknown,
  options: FetchHotProductsOptions = {},
): Promise<HotFeed> {
  const niche = typeof arg === "string" ? arg : "";
  const qs = niche.trim() ? `?niche=${encodeURIComponent(niche.trim())}` : "";
  const now = new Date().toISOString();
  const fallback: HotFeed = {
    hour: "",
    refreshed_at: now,
    next_refresh_at: now,
    items: [],
    error: "Live market feed temporarily unavailable",
  };

  try {
    const res = await fetch(`/api/public/hot-products${qs}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json()) as Partial<HotFeed>;
      const items = json.items ?? [];
      if (items.length > 0) {
        return {
          hour: json.hour ?? "",
          refreshed_at: json.refreshed_at ?? now,
          next_refresh_at: json.next_refresh_at ?? now,
          items,
          ...(json.error ? { error: json.error } : {}),
          ...(json.partial ? { partial: true } : {}),
        };
      }
    }
  } catch (error) {
    console.warn("[hot-products] live feed cache unavailable; queueing a background scan", error);
  }

  // Async job path. Signed-out callers get `unauthorized` and fall through to
  // the public stream, so the landing-page ticker keeps working unchanged.
  try {
    const { runDiscoveryJob } = await import("./discovery-job");
    const run = await runDiscoveryJob(
      { niche: niche.trim(), targetCountry: "GLOBAL" },
      options.onProgress ? { onProgress: options.onProgress } : {},
    );
    if (run.ok) {
      const result = run.job.result;
      if (result && result.products.length > 0) {
        const feed = buildHotFeedFromItems(result.products);
        return result.partial ? { ...feed, partial: true } : feed;
      }
      if (result) {
        // A terminal job with zero products: report the empty feed honestly
        // instead of re-running the whole scan on the stream.
        return { ...buildHotFeedFromItems([]), error: "Bu niş için ürün bulunamadı." };
      }
    } else if (run.reason === "error") {
      console.warn("[hot-products] async discovery job failed", run.message);
    }
  } catch (error) {
    console.warn("[hot-products] async discovery path failed", error);
  }

  // Last resort: read the same scan as a stream so a slow scan still fills the
  // feed. The stream always ends with a partial-but-successful payload before
  // the 100s wall instead of leaving an empty state.
  try {
    const items = await fetchHotProductsStreamed(niche);
    if (items.length > 0) return buildHotFeedFromItems(items);
  } catch (error) {
    console.warn("[hot-products] streaming fallback failed; rendering an empty state", error);
  }

  return fallback;
}

export const HOT_FEED_QUERY_KEY = ["hot-products"] as const;
