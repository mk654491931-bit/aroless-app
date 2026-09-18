import { buyersPer1000 } from "@/lib/consistency";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct } from "@/lib/recommendation";

export type SortKey = "winner" | "ai" | "buyers" | "margin" | "trend" | "profit" | "realism" | "momentum";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "winner", label: "Winner Score" },
  { id: "ai", label: "AI score" },
  { id: "buyers", label: "Buyers / 1k" },
  { id: "margin", label: "Margin" },
  { id: "trend", label: "Trend" },
  { id: "profit", label: "Est. profit" },
  { id: "realism", label: "Doğrulanmışlık" },
  { id: "momentum", label: "Canlı momentum" },
];

export function sortValue(p: WinningProduct, key: SortKey): number {
  const e = enrichProduct(p);
  if (key === "winner") return p.winner_score ?? e.ai_score;
  if (key === "buyers") return buyersPer1000(p).value;
  if (key === "margin") return p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0;
  if (key === "trend") return e.trend_score;
  if (key === "profit") return e.est_monthly_net_profit_usd;
  if (key === "realism") return p.realism_score ?? 0;
  if (key === "momentum") return p.market_evidence?.trend_momentum_pct ?? 0;
  return e.ai_score;
}

export function sortProducts(
  list: WinningProduct[],
  key: SortKey,
  onlyLaunch: boolean,
  desc = true,
): WinningProduct[] {
  const filtered = onlyLaunch
    ? list.filter((p) => enrichProduct(p).recommendation === "Launch")
    : list;
  const dir = desc ? 1 : -1;
  return [...filtered].sort((a, b) => (sortValue(b, key) - sortValue(a, key)) * dir);
}
