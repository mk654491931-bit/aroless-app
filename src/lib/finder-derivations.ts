export type FinderProduct = {
  name: string;
  winner_score?: number | null;
  profit_margin_pct?: number | null;
  trend_score?: number | null;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  realism_score?: number | null;
  competition_level?: string | null;
  evidence_level?: string | null;
  market_evidence?: {
    trend_momentum_pct?: number | null;
  } | null;
  cost_breakdown?: {
    net_margin_pct?: number | null;
  } | null;
};

export type SortKey =
  | "winner"
  | "ai"
  | "buyers"
  | "margin"
  | "trend"
  | "profit"
  | "realism"
  | "momentum";

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

export type EnrichedFinderProduct = {
  ai_score: number;
  trend_score: number;
  est_monthly_net_profit_usd: number;
  recommendation: string;
};

type SortDeps = {
  enrichProduct: (product: FinderProduct) => EnrichedFinderProduct;
  buyersPer1000: (product: FinderProduct) => number;
};

function sortValue(product: FinderProduct, key: SortKey, deps: SortDeps): number {
  const enriched = deps.enrichProduct(product);
  if (key === "winner") return product.winner_score ?? enriched.ai_score;
  if (key === "buyers") return deps.buyersPer1000(product);
  if (key === "margin") return product.cost_breakdown?.net_margin_pct ?? product.profit_margin_pct ?? 0;
  if (key === "trend") return enriched.trend_score;
  if (key === "profit") return enriched.est_monthly_net_profit_usd;
  if (key === "realism") return product.realism_score ?? 0;
  if (key === "momentum") return product.market_evidence?.trend_momentum_pct ?? 0;
  return enriched.ai_score;
}

export function sortProducts(
  list: FinderProduct[],
  key: SortKey,
  onlyLaunch: boolean,
  desc: boolean,
  deps: SortDeps,
): FinderProduct[] {
  const filtered = onlyLaunch
    ? list.filter((product) => deps.enrichProduct(product).recommendation === "Launch")
    : list;
  const direction = desc ? 1 : -1;
  return [...filtered].sort(
    (left, right) => (sortValue(right, key, deps) - sortValue(left, key, deps)) * direction,
  );
}

export function toProductList<T extends object>(response: unknown): T[] {
  if (Array.isArray(response)) {
    return response.filter((item) => item !== null && typeof item === "object") as T[];
  }
  if (!response || typeof response !== "object") return [];
  const obj = response as Record<string, unknown>;
  for (const candidate of [obj.products, obj.results, obj.data]) {
    if (Array.isArray(candidate)) return candidate as T[];
    if (candidate && typeof candidate === "object") {
      const inner = (candidate as Record<string, unknown>).products;
      if (Array.isArray(inner)) return inner as T[];
    }
  }
  return [];
}

export function toResultsCsv(
  list: FinderProduct[],
  deps: { enrichProduct: (product: FinderProduct) => EnrichedFinderProduct; buyersPer1000: (product: FinderProduct) => number },
): string {
  const head = [
    "Product",
    "Supplier price",
    "Selling price",
    "Margin %",
    "AI score",
    "Trend",
    "Buyers per 1000",
    "CVR %",
    "Recommendation",
    "Est. monthly profit USD",
  ];
  const rows = list.map((product) => {
    const enriched = deps.enrichProduct(product);
    const buyers = deps.buyersPer1000(product);
    return [
      product.name,
      product.supplier_price_usd,
      product.selling_price_usd,
      product.profit_margin_pct,
      enriched.ai_score,
      enriched.trend_score,
      buyers,
      (buyers / 10).toFixed(1),
      enriched.recommendation,
      enriched.est_monthly_net_profit_usd,
    ];
  });
  return [head, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
