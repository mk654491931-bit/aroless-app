import type { WinningProduct } from "./gemini.functions";

export type Recommendation = "Launch" | "Watch" | "Avoid";

export type EnrichedScores = {
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

  const sell = parseMoney(p.selling_price_usd);
  const netPer = parseMoney(p.cost_breakdown?.net_profit ?? "");
  const baseSales = 200 + Math.round((trend / 100) * 4800);
  const compMult = p.competition_level === "Low" ? 1.2 : p.competition_level === "High" ? 0.6 : 1.0;
  const est_monthly_sales = Math.round(baseSales * compMult);
  const est_monthly_revenue_usd = Math.round(est_monthly_sales * sell);
  const est_monthly_net_profit_usd = Math.round(est_monthly_sales * (netPer > 0 ? netPer : sell * (marginPct / 100)));

  return {
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
function parseMoney(s: string | undefined): number {
  if (!s) return 0;
  const m = String(s).match(/[\d,.]+/);
  if (!m) return 0;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

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