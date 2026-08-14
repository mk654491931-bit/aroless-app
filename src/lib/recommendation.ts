import type { WinningProduct } from "./gemini.functions";
import { realEconomics } from "./real-economics";

export type Recommendation = "Launch" | "Watch" | "Avoid";

export type EnrichedScores = {
  /** Gerçekçi aylık net kâr aralığı (düşük / yüksek senaryo). */
  monthly_net_low_usd: number;
  monthly_net_high_usd: number;
  net_per_unit_usd: number;
  ai_score: number;
  opportunity_score: number;
  trend_score: number;
  confidence_score: number;
  recommendation: Recommendation;
  est_monthly_sales: number;
  est_monthly_revenue_usd: number;
  est_monthly_net_profit_usd: number;
};

// Deterministic enrichment derived from Gemini output
export function enrichProduct(p: WinningProduct): EnrichedScores {
  const trend = clamp(p.trend_score ?? 70, 0, 100);
  const compPenalty = p.competition_level === "High" ? 25 : p.competition_level === "Medium" ? 10 : 0;
  const marginPct = clamp(p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 30, 0, 100);
  const opportunity = clamp(Math.round(trend * 0.6 + marginPct * 0.5 - compPenalty), 0, 100);
  const ai = clamp(Math.round((trend + opportunity + marginPct) / 3), 0, 100);
  const confidence = clamp(100 - compPenalty - Math.max(0, 60 - trend) / 2, 40, 99);

  let recommendation: Recommendation = "Watch";
  if (opportunity >= 75 && p.competition_level !== "High") recommendation = "Launch";
  else if (opportunity < 45 || (p.competition_level === "High" && marginPct < 30)) recommendation = "Avoid";

  // Gerçek dünya modeli: reklam bütçesiyle sınırlı hacim, gerçek komisyon/CAC/iade.
  const re = p.real_economics ?? realEconomics({
    selling_price_usd: p.selling_price_usd,
    supplier_price_usd: p.supplier_price_usd,
    shipping_cost: p.cost_breakdown?.shipping_cost,
    competition_level: p.competition_level,
    platform: p.platform_fit?.[0],
    trend_score: trend,
    cvr_pct: p.conversion?.cvr_pct,
    startup_cost_usd: p.startup_cost_usd,
  });
  const est_monthly_sales = re.monthly.units;
  const est_monthly_revenue_usd = re.monthly.revenue_usd;
  const est_monthly_net_profit_usd = re.monthly.net_profit_usd;

  return {
    monthly_net_low_usd: re.monthly.low_usd,
    monthly_net_high_usd: re.monthly.high_usd,
    net_per_unit_usd: re.net_per_unit,
    ai_score: ai,
    opportunity_score: opportunity,
    trend_score: trend,
    confidence_score: Math.round(confidence),
    recommendation,
    est_monthly_sales,
    est_monthly_revenue_usd,
    est_monthly_net_profit_usd,
  };
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

export function recommendationStyle(r: Recommendation) {
  if (r === "Launch") return { emoji: "🟢", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" };
  if (r === "Avoid") return { emoji: "🔴", cls: "border-rose-500/40 bg-rose-500/15 text-rose-300" };
  return { emoji: "🟡", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300" };
}

export type SellabilityVerdict = "Highly Sellable" | "Moderate Risk" | "Do Not Sell";

export function reliabilityStyle(v: SellabilityVerdict | undefined) {
  if (v === "Highly Sellable") return { cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300", icon: "✅" };
  if (v === "Do Not Sell") return { cls: "border-rose-500/40 bg-rose-500/15 text-rose-300", icon: "⛔" };
  return { cls: "border-amber-500/40 bg-amber-500/15 text-amber-300", icon: "⚠️" };
}

export function formatCurrency(n: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${n.toLocaleString()}`;
  }
}