// Defensive shim around hot-ticker: the live hot-feed server route can return
// an error envelope `{ items: [], error: "..." }` with a 200 status when the
// upstream market scan fails. That is fine for the ticker itself, but the same
// route is also inlined on the finder tab as a static "trending now" strip in
// some rendered views. In those cases the server-fn client may resolve with a
// non-array (e.g. a plain object without an `items` array) and a naive
// `.map` / spread would crash with "X.map is not a function".
//
// Keep the behavior identical to the live endpoint: always return an array for
// `items`, and expose a tiny helper that render code can call instead of
// trusting `data.items` shape.

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
  signals?: Record<string, unknown>;
};

export type HotFeed = {
  hour: string;
  refreshed_at: string;
  next_refresh_at: string;
  items: HotProduct[];
  error?: string;
};

/** Always return an array for `items`, even when the upstream payload is broken. */
export function sanitizeHotFeed(partial: Partial<HotFeed>): HotFeed {
  const rawItems = partial.items;
  const items: HotProduct[] =
    rawItems && Array.isArray(rawItems) ? rawItems : [];

  return {
    hour: partial.hour ?? "",
    refreshed_at: partial.refreshed_at ?? new Date().toISOString(),
    next_refresh_at: partial.next_refresh_at ?? new Date().toISOString(),
    items,
    error: partial.error,
  };
}
