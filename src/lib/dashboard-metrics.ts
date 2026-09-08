// ============================================================================
// Pure dashboard derivations.
//
// This module is deliberately dependency-free: no React, no server functions,
// no Supabase types. Inputs are described structurally so any row shape that
// carries the needed fields fits, which is what makes every rule below
// unit-testable without a browser, a session or a database.
//
// Extracted verbatim from src/routes/dashboard.tsx -- the numbers this produces
// are intentionally identical to the previous inline implementation.
// ============================================================================

/** Number of days shown by the activity chart. */
export const ACTIVITY_WINDOW_DAYS = 14;

/** Maximum bars in the "top recommendations" chart. */
export const TOP_RECOMMENDATION_LIMIT = 6;

/** Product names longer than this are ellipsised on the axis. */
export const TOP_NAME_MAX_LENGTH = 20;

const MS_PER_DAY = 86_400_000;

export type MetricProduct = {
  health_score?: number | null;
  viral_probability_90d?: number | null;
  trend_score?: number | null;
  sellability_verdict?: string | null;
};

export type MetricFavorite = {
  collection_name?: string | null;
  product?: MetricProduct | null;
};

export type MetricAnalysis = {
  created_at: string;
  results?: unknown;
};

export type NamedCount = { name: string; count: number };
export type NamedValue = { name: string; value: number };
export type ActivityPoint = { date: string; count: number };
export type RadarPoint = { metric: string; score: number };

export type DashboardMetrics = {
  /** Saved products grouped by collection, for the collections pie. */
  collectionData: NamedValue[];
  /** One entry per day in the activity window, oldest first. */
  activity: ActivityPoint[];
  /** Most frequently recommended products, highest first. */
  topRecommendations: NamedCount[];
  /** Average engine scores across saved products. */
  engineRadar: RadarPoint[];
  /** AI sellability verdict distribution. */
  verdictPie: NamedValue[];
  /** Raw averages, exposed for headline stats. */
  averages: { health: number; viral: number; trend: number };
};

/** Mean, rounded, or 0 for an empty set. Never NaN. */
export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

/** Default axis label format — matches the previous inline behaviour. */
function defaultFormatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export type BuildDashboardMetricsInput = {
  favorites: readonly MetricFavorite[];
  analyses: readonly MetricAnalysis[];
  /** Injectable for deterministic tests; defaults to the current time. */
  now?: Date;
  /** Injectable so tests do not depend on the runner's locale or timezone. */
  formatDay?: (date: Date) => string;
};

export function buildDashboardMetrics({
  favorites,
  analyses,
  now = new Date(),
  formatDay = defaultFormatDay,
}: BuildDashboardMetricsInput): DashboardMetrics {
  // ---- Saved products by collection ---------------------------------------
  const collectionCounts: Record<string, number> = {};
  for (const favorite of favorites) {
    const key = favorite.collection_name || "Default";
    collectionCounts[key] = (collectionCounts[key] ?? 0) + 1;
  }
  const collectionData = Object.entries(collectionCounts).map(([name, value]) => ({
    name,
    value,
  }));

  // ---- Activity over the trailing window ----------------------------------
  const activity: ActivityPoint[] = [];
  const lastIndex = ACTIVITY_WINDOW_DAYS - 1;
  for (let offset = lastIndex; offset >= 0; offset--) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    activity.push({ date: formatDay(day), count: 0 });
  }
  for (const analysis of analyses) {
    const created = new Date(analysis.created_at).getTime();
    if (Number.isNaN(created)) continue;
    const daysAgo = Math.floor((now.getTime() - created) / MS_PER_DAY);
    if (daysAgo >= 0 && daysAgo <= lastIndex) {
      activity[lastIndex - daysAgo].count++;
    }
  }

  // ---- Most recommended products ------------------------------------------
  const nameCounts: Record<string, number> = {};
  for (const analysis of analyses) {
    const results = Array.isArray(analysis.results)
      ? (analysis.results as Array<{ name?: unknown }>)
      : [];
    for (const product of results) {
      const name = product?.name;
      if (typeof name === "string" && name !== "") {
        nameCounts[name] = (nameCounts[name] ?? 0) + 1;
      }
    }
  }
  const topRecommendations = Object.entries(nameCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RECOMMENDATION_LIMIT)
    .map(([name, count]) => ({
      name:
        name.length > TOP_NAME_MAX_LENGTH
          ? `${name.slice(0, TOP_NAME_MAX_LENGTH)}\u2026`
          : name,
      count,
    }));

  // ---- Engine scores and verdicts -----------------------------------------
  const healthScores: number[] = [];
  const viralScores: number[] = [];
  const trendScores: number[] = [];
  const verdictCounts: Record<string, number> = {};

  for (const favorite of favorites) {
    const product = favorite.product;
    if (!product) continue;
    if (typeof product.health_score === "number") healthScores.push(product.health_score);
    if (typeof product.viral_probability_90d === "number") {
      viralScores.push(product.viral_probability_90d);
    }
    if (typeof product.trend_score === "number") trendScores.push(product.trend_score);
    const verdict = product.sellability_verdict || "Unknown";
    verdictCounts[verdict] = (verdictCounts[verdict] ?? 0) + 1;
  }

  const averages = {
    health: average(healthScores),
    viral: average(viralScores),
    trend: average(trendScores),
  };

  const engineRadar: RadarPoint[] = [
    { metric: "Health", score: averages.health },
    { metric: "Viral", score: averages.viral },
    { metric: "Trend", score: averages.trend },
    {
      metric: "Confidence",
      score: favorites.length ? Math.min(100, favorites.length * 10) : 0,
    },
    {
      metric: "Diversity",
      score: collectionData.length ? Math.min(100, collectionData.length * 20) : 0,
    },
  ];

  const verdictPie = Object.entries(verdictCounts).map(([name, value]) => ({ name, value }));

  return {
    collectionData,
    activity,
    topRecommendations,
    engineRadar,
    verdictPie,
    averages,
  };
}
