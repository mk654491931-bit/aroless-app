// Shared profitability gate: whichever AI engine the user picks (Default Gemini,
// HF Llama, HF Qwen or Hybrid), only genuinely profitable products surface, and
// the most profitable ones come first.
import { computeUnitEconomics, MIN_NET_MARGIN_PCT, parseMoney } from "@/lib/unit-economics";

type AnyProduct = {
  name?: string;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  competition_level?: string;
  platform_fit?: string[];
  profit_margin_pct?: number;
  trend_score?: number;
  unified_score?: number;
  cost_breakdown?: {
    supplier_cost?: string;
    shipping_cost?: string;
    platform_fee?: string;
    ad_spend?: string;
    net_profit?: string;
    net_margin_pct?: number;
  };
};

/** Net margin % actually earned per unit, derived from the full cost stack. */
export function netMarginOf(p: AnyProduct): number {
  const declared = Number(p.cost_breakdown?.net_margin_pct);
  const e = computeUnitEconomics({
    retail_price: p.selling_price_usd,
    supplier_cost: p.cost_breakdown?.supplier_cost ?? p.supplier_price_usd,
    shipping: p.cost_breakdown?.shipping_cost,
    platform_fee: p.cost_breakdown?.platform_fee,
    ad_spend: p.cost_breakdown?.ad_spend,
    marketplace: p.platform_fit?.[0],
    competition: p.competition_level,
  });
  if (Number.isFinite(declared) && declared > 0 && parseMoney(p.selling_price_usd) > 0) {
    // Trust the model's own breakdown only when it is not more optimistic than the derived stack.
    return Math.min(declared, Math.max(e.net_margin_pct, 0));
  }
  return e.net_margin_pct;
}

/**
 * Drops unprofitable products and ranks the rest by profit first.
 * If every candidate fails the gate, the best few are still returned (ranked)
 * so the user never sees an empty screen — the UI already flags weak margins.
 */
export function rankProfitable<T extends AnyProduct>(products: T[]): T[] {
  const scored = products.map((p) => {
    const margin = netMarginOf(p);
    const quality = p.unified_score ?? p.trend_score ?? 60;
    return { p, margin, rank: margin * 0.7 + quality * 0.3 };
  });
  scored.sort((a, b) => b.rank - a.rank);
  const profitable = scored.filter((s) => s.margin >= MIN_NET_MARGIN_PCT);
  const kept = profitable.length ? profitable : scored.slice(0, Math.min(3, scored.length));
  return kept.map((s) => s.p);
}
