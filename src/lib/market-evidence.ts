// Client-safe types + helpers for the live market verification layer.
// The server (market-verify.server.ts) fills these from real, free data
// sources (Google Trends, AliExpress, DuckDuckGo marketplace listings) so the
// numbers the AI returns can be cross-checked against the actual market.

export type EvidenceSeller = {
  seller: string;
  domain: string;
  platform: string;
  price_usd: number;
  url: string;
};

export type MarketEvidence = {
  /** Real 30-day / 12-month interest series (0-100). */
  trend_monthly: number[];
  trend_yearly: number[];
  trend_momentum_pct: number;
  trend_source: "google-trends" | "estimated";
  /** Real supplier price discovered on AliExpress (or heuristic estimate). */
  supplier_price_usd: number;
  supplier_shipping_usd: number;
  supplier_source: "aliexpress" | "estimated";
  /** Live marketplace listings found for this exact product. */
  sellers: EvidenceSeller[];
  /** Median real retail price across the found listings (0 = unknown). */
  market_price_usd: number;
  /** How far the AI's selling price sits from the real market median, %. */
  price_delta_pct: number;
  /** Signals actually verified against a live source. */
  verified_signals: string[];
  /** Signals that could not be verified and stay AI-estimated. */
  unverified_signals: string[];
  checked_at: string;
};

export type RealismVerdict = "Doğrulandı" | "Kısmen doğrulandı" | "Doğrulanamadı";

export function realismVerdict(score: number): RealismVerdict {
  if (score >= 75) return "Doğrulandı";
  if (score >= 45) return "Kısmen doğrulandı";
  return "Doğrulanamadı";
}

export function realismStyle(score: number): string {
  if (score >= 75) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (score >= 45) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

/** Median of a numeric list (0 when empty). */
export function median(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
