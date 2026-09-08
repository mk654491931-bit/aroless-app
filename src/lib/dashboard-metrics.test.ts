import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WINDOW_DAYS,
  average,
  buildDashboardMetrics,
  TOP_NAME_MAX_LENGTH,
  type MetricAnalysis,
  type MetricFavorite,
} from "@/lib/dashboard-metrics";

const NOW = new Date("2026-09-08T12:00:00.000Z");

// Deterministic label so assertions do not depend on the runner's locale.
const formatDay = (d: Date) => d.toISOString().slice(0, 10);

function build(
  favorites: MetricFavorite[] = [],
  analyses: MetricAnalysis[] = [],
  now: Date = NOW,
) {
  return buildDashboardMetrics({ favorites, analyses, now, formatDay });
}

describe("average", () => {
  it("returns 0 for an empty set instead of NaN", () => {
    expect(average([])).toBe(0);
  });

  it("rounds to the nearest integer", () => {
    expect(average([1, 2])).toBe(2); // 1.5 -> 2
    expect(average([1, 1, 2])).toBe(1); // 1.33 -> 1
    expect(average([70, 80, 90])).toBe(80);
  });
});

describe("buildDashboardMetrics -- empty state", () => {
  it("produces a fully zeroed but well-formed shape", () => {
    const m = build();
    expect(m.collectionData).toEqual([]);
    expect(m.verdictPie).toEqual([]);
    expect(m.topRecommendations).toEqual([]);
    expect(m.averages).toEqual({ health: 0, viral: 0, trend: 0 });
    expect(m.engineRadar.every((p) => p.score === 0)).toBe(true);
    expect(m.activity).toHaveLength(ACTIVITY_WINDOW_DAYS);
    expect(m.activity.every((p) => p.count === 0)).toBe(true);
  });
});

describe("buildDashboardMetrics -- collections", () => {
  it("groups by collection name and counts", () => {
    const m = build([
      { collection_name: "Winter" },
      { collection_name: "Winter" },
      { collection_name: "Summer" },
    ]);
    expect(m.collectionData).toEqual([
      { name: "Winter", value: 2 },
      { name: "Summer", value: 1 },
    ]);
  });

  it("falls back to Default for missing, null and empty names", () => {
    const m = build([{}, { collection_name: null }, { collection_name: "" }]);
    expect(m.collectionData).toEqual([{ name: "Default", value: 3 }]);
  });
});

describe("buildDashboardMetrics -- activity window", () => {
  it("always returns exactly one bucket per day, oldest first", () => {
    const m = build();
    expect(m.activity).toHaveLength(14);
    expect(m.activity[13].date).toBe("2026-09-08");
    expect(m.activity[0].date).toBe("2026-08-26");
  });

  it("counts today into the last bucket", () => {
    const m = build([], [{ created_at: NOW.toISOString() }]);
    expect(m.activity[13].count).toBe(1);
  });

  it("places an analysis from 3 days ago in the right bucket", () => {
    const m = build([], [{ created_at: "2026-09-05T12:00:00.000Z" }]);
    expect(m.activity[10].count).toBe(1);
    expect(m.activity.reduce((s, p) => s + p.count, 0)).toBe(1);
  });

  it("includes the oldest day still inside the window", () => {
    const m = build([], [{ created_at: "2026-08-26T12:00:00.000Z" }]);
    expect(m.activity[0].count).toBe(1);
  });

  it("drops analyses older than the window", () => {
    const m = build([], [{ created_at: "2026-08-01T12:00:00.000Z" }]);
    expect(m.activity.reduce((s, p) => s + p.count, 0)).toBe(0);
  });

  it("drops future-dated analyses rather than crashing on a negative index", () => {
    const m = build([], [{ created_at: "2026-12-01T12:00:00.000Z" }]);
    expect(m.activity.reduce((s, p) => s + p.count, 0)).toBe(0);
  });

  it("ignores unparseable timestamps", () => {
    const m = build([], [{ created_at: "not-a-date" }, { created_at: "" }]);
    expect(m.activity.reduce((s, p) => s + p.count, 0)).toBe(0);
  });

  it("accumulates several analyses on the same day", () => {
    const m = build(
      [],
      [
        { created_at: "2026-09-08T01:00:00.000Z" },
        { created_at: "2026-09-08T06:00:00.000Z" },
        { created_at: "2026-09-08T11:00:00.000Z" },
      ],
    );
    expect(m.activity[13].count).toBe(3);
  });
});

describe("buildDashboardMetrics -- top recommendations", () => {
  const analysis = (names: string[]): MetricAnalysis => ({
    created_at: NOW.toISOString(),
    results: names.map((name) => ({ name })),
  });

  it("ranks by frequency, highest first", () => {
    const m = build([], [analysis(["A", "B", "A"]), analysis(["A"])]);
    expect(m.topRecommendations[0]).toEqual({ name: "A", count: 3 });
    expect(m.topRecommendations[1]).toEqual({ name: "B", count: 1 });
  });

  it("caps the list at six entries", () => {
    const m = build([], [analysis(["a", "b", "c", "d", "e", "f", "g", "h"])]);
    expect(m.topRecommendations).toHaveLength(6);
  });

  it("ellipsises names longer than the axis limit", () => {
    const long = "x".repeat(TOP_NAME_MAX_LENGTH + 5);
    const m = build([], [analysis([long])]);
    expect(m.topRecommendations[0].name).toBe(`${"x".repeat(TOP_NAME_MAX_LENGTH)}\u2026`);
  });

  it("leaves names at exactly the limit untouched", () => {
    const exact = "y".repeat(TOP_NAME_MAX_LENGTH);
    const m = build([], [analysis([exact])]);
    expect(m.topRecommendations[0].name).toBe(exact);
  });

  it("skips missing, empty and non-string names", () => {
    const m = build([], [
      { created_at: NOW.toISOString(), results: [{}, { name: "" }, { name: 7 }, null] },
    ] as MetricAnalysis[]);
    expect(m.topRecommendations).toEqual([]);
  });

  it("tolerates results that are not arrays", () => {
    const m = build([], [
      { created_at: NOW.toISOString(), results: null },
      { created_at: NOW.toISOString(), results: "nope" },
      { created_at: NOW.toISOString() },
    ]);
    expect(m.topRecommendations).toEqual([]);
  });
});

describe("buildDashboardMetrics -- engine scores", () => {
  it("averages only numeric scores", () => {
    const m = build([
      { product: { health_score: 80, viral_probability_90d: 60, trend_score: 40 } },
      { product: { health_score: 60, viral_probability_90d: 40, trend_score: 20 } },
    ]);
    expect(m.averages).toEqual({ health: 70, viral: 50, trend: 30 });
  });

  it("ignores null and non-numeric score fields", () => {
    const m = build([
      { product: { health_score: 90 } },
      { product: { health_score: null, trend_score: undefined } },
    ] as MetricFavorite[]);
    expect(m.averages.health).toBe(90);
    expect(m.averages.trend).toBe(0);
  });

  it("counts a zero score rather than treating it as absent", () => {
    const m = build([{ product: { health_score: 0 } }, { product: { health_score: 100 } }]);
    expect(m.averages.health).toBe(50);
  });

  it("skips favourites with no product at all", () => {
    const m = build([{ product: null }, {}, { product: { health_score: 50 } }]);
    expect(m.averages.health).toBe(50);
    expect(m.verdictPie).toEqual([{ name: "Unknown", value: 1 }]);
  });

  it("caps confidence at 100 (10 per saved product)", () => {
    const many = Array.from({ length: 30 }, () => ({ product: { health_score: 1 } }));
    const confidence = build(many).engineRadar.find((p) => p.metric === "Confidence");
    expect(confidence!.score).toBe(100);

    const few = Array.from({ length: 3 }, () => ({ product: { health_score: 1 } }));
    expect(build(few).engineRadar.find((p) => p.metric === "Confidence")!.score).toBe(30);
  });

  it("caps diversity at 100 (20 per collection)", () => {
    const spread = Array.from({ length: 9 }, (_, i) => ({ collection_name: `c${i}` }));
    expect(build(spread).engineRadar.find((p) => p.metric === "Diversity")!.score).toBe(100);

    const two = [{ collection_name: "a" }, { collection_name: "b" }];
    expect(build(two).engineRadar.find((p) => p.metric === "Diversity")!.score).toBe(40);
  });

  it("always returns the same five radar axes in order", () => {
    expect(build().engineRadar.map((p) => p.metric)).toEqual([
      "Health",
      "Viral",
      "Trend",
      "Confidence",
      "Diversity",
    ]);
  });
});

describe("buildDashboardMetrics -- verdicts", () => {
  it("counts verdicts by label", () => {
    const m = build([
      { product: { sellability_verdict: "Winner" } },
      { product: { sellability_verdict: "Winner" } },
      { product: { sellability_verdict: "Risky" } },
    ]);
    expect(m.verdictPie).toEqual([
      { name: "Winner", value: 2 },
      { name: "Risky", value: 1 },
    ]);
  });

  it("falls back to Unknown for missing, null and empty verdicts", () => {
    const m = build([
      { product: {} },
      { product: { sellability_verdict: null } },
      { product: { sellability_verdict: "" } },
    ]);
    expect(m.verdictPie).toEqual([{ name: "Unknown", value: 3 }]);
  });
});

describe("buildDashboardMetrics -- purity", () => {
  it("does not mutate its inputs", () => {
    const favorites: MetricFavorite[] = [{ collection_name: "A", product: { health_score: 1 } }];
    const analyses: MetricAnalysis[] = [
      { created_at: NOW.toISOString(), results: [{ name: "P" }] },
    ];
    const snapshot = JSON.stringify({ favorites, analyses });
    build(favorites, analyses);
    expect(JSON.stringify({ favorites, analyses })).toBe(snapshot);
  });

  it("does not mutate the injected now", () => {
    const now = new Date(NOW);
    build([], [], now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });

  it("is deterministic for the same input", () => {
    const favorites: MetricFavorite[] = [{ collection_name: "A" }];
    const analyses: MetricAnalysis[] = [{ created_at: NOW.toISOString() }];
    expect(build(favorites, analyses)).toEqual(build(favorites, analyses));
  });
});
