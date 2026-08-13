// ============================================================================
// Velora — Predictive Trend Data Pipeline (server only, $0 sources)
//
//   • Google Trends   — search volume / interest curve
//   • Reddit JSON API — r/TikTokMadeMeBuyIt, r/amazonfinds, r/BuyItForLife
//   • TikTok Creative Center + Amazon Movers & Shakers (public scrape)
//   • GitHub public scraper/e-commerce repos
//
// Every source degrades gracefully; the pipeline never throws.
// Results are cached for 24h through the smart cache layer.
// ============================================================================
import { cached } from "./ai-cache.server";
import { getGoogleTrends } from "./market-data.server";
import { fetchGitHubTrendsForNiche } from "./github-trends.server";
import { runScrapeJob } from "./trend-radar.server";

export type RedditSignal = {
  title: string;
  subreddit: string;
  score: number;
  comments: number;
  url: string;
};

export type PipelineSignals = {
  keyword: string;
  country: string;
  trends: { yearly: number[]; monthly: number[]; momentum_pct: number; source: string };
  reddit: RedditSignal[];
  tiktok: string[];
  amazon: string[];
  google_rising: string[];
  github: { full_name: string; stars: number; description: string; topics: string[] }[];
  sources: { name: string; status: "active" | "error"; items: number }[];
  collected_at: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const SUBREDDITS = ["TikTokMadeMeBuyIt", "amazonfinds", "BuyItForLife"];

async function timed(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "application/json" } });
  } finally {
    clearTimeout(t);
  }
}

/** Public Reddit JSON API — consumer buying signals, no auth required. */
export async function fetchRedditSignals(keyword: string): Promise<RedditSignal[]> {
  const q = encodeURIComponent(keyword.slice(0, 80));
  const out: RedditSignal[] = [];
  for (const sub of SUBREDDITS) {
    try {
      const url = keyword
        ? `https://www.reddit.com/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=top&t=month&limit=8`
        : `https://www.reddit.com/r/${sub}/top.json?t=week&limit=8`;
      const res = await timed(url);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: { children?: { data?: Record<string, unknown> }[] };
      };
      for (const c of json.data?.children ?? []) {
        const d = c.data ?? {};
        const title = String(d["title"] ?? "").trim();
        if (!title) continue;
        out.push({
          title: title.slice(0, 160),
          subreddit: sub,
          score: Number(d["score"] ?? 0),
          comments: Number(d["num_comments"] ?? 0),
          url: `https://reddit.com${String(d["permalink"] ?? "")}`,
        });
      }
      // stagger between subreddits so Reddit never rate-limits us
      await new Promise((r) => setTimeout(r, 180));
    } catch {
      /* skip dead subreddit */
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

async function collect(keyword: string, country: string, category: string): Promise<PipelineSignals> {
  const sources: PipelineSignals["sources"] = [];

  const [trendsRes, redditRes, scrapeRes, ghRes] = await Promise.allSettled([
    getGoogleTrends(keyword, country),
    fetchRedditSignals(keyword),
    runScrapeJob({ region: country, category, sources: ["Google", "Amazon", "TikTok"], niche: keyword }),
    fetchGitHubTrendsForNiche(keyword),
  ]);

  const trends =
    trendsRes.status === "fulfilled"
      ? {
          yearly: trendsRes.value.yearly,
          monthly: trendsRes.value.monthly,
          momentum_pct: trendsRes.value.momentum_pct,
          source: trendsRes.value.source,
        }
      : { yearly: [], monthly: [], momentum_pct: 0, source: "unavailable" };
  sources.push({
    name: "Google Trends",
    status: trendsRes.status === "fulfilled" ? "active" : "error",
    items: trends.yearly.length,
  });

  const reddit = redditRes.status === "fulfilled" ? redditRes.value : [];
  sources.push({ name: "Reddit", status: redditRes.status === "fulfilled" ? "active" : "error", items: reddit.length });

  let tiktok: string[] = [];
  let amazon: string[] = [];
  let google_rising: string[] = [];
  if (scrapeRes.status === "fulfilled") {
    const byName = (s: string) =>
      scrapeRes.value.trends.filter((t) => t.source === s).map((t) => t.trend_name).slice(0, 10);
    tiktok = byName("TikTok");
    amazon = byName("Amazon");
    google_rising = byName("Google");
    for (const st of scrapeRes.value.statuses) {
      sources.push({ name: st.source === "Amazon" ? "Amazon Movers & Shakers" : `${st.source} Creative/Public`, status: st.status, items: st.items });
    }
  } else {
    sources.push({ name: "TikTok / Amazon scrape", status: "error", items: 0 });
  }

  const github =
    ghRes.status === "fulfilled"
      ? ghRes.value.slice(0, 6).map((r) => ({
          full_name: r.full_name,
          stars: r.stargazers_count,
          description: (r.description ?? "").slice(0, 140),
          topics: r.topics.slice(0, 4),
        }))
      : [];
  sources.push({ name: "GitHub scrapers", status: ghRes.status === "fulfilled" ? "active" : "error", items: github.length });

  return {
    keyword,
    country,
    trends,
    reddit,
    tiktok,
    amazon,
    google_rising,
    github,
    sources,
    collected_at: new Date().toISOString(),
  };
}

/** Cached (24h) multi-source signal collection. */
export async function collectSignals(
  keyword: string,
  country = "GLOBAL",
  category = "General",
): Promise<{ data: PipelineSignals; cache_hit: boolean }> {
  return cached("signals", [keyword, country, category], () => collect(keyword, country, category));
}

/** Compact prompt block fed to every council member. */
export function signalsBlock(s: PipelineSignals): string {
  const lines: string[] = [
    `KEYWORD: ${s.keyword} | TARGET COUNTRY: ${s.country}`,
    `GOOGLE TRENDS momentum: ${s.trends.momentum_pct}% (source ${s.trends.source}); 12-month series: ${s.trends.yearly.join(",") || "n/a"}`,
  ];
  if (s.google_rising.length) lines.push(`GOOGLE RISING QUERIES: ${s.google_rising.join(" | ")}`);
  if (s.amazon.length) lines.push(`AMAZON MOVERS & SHAKERS: ${s.amazon.join(" | ")}`);
  if (s.tiktok.length) lines.push(`TIKTOK CREATIVE CENTER: ${s.tiktok.join(" | ")}`);
  if (s.reddit.length)
    lines.push(
      `REDDIT CONSUMER SIGNALS:\n${s.reddit
        .slice(0, 8)
        .map((r) => `- r/${r.subreddit} (${r.score} upvotes, ${r.comments} comments): ${r.title}`)
        .join("\n")}`,
    );
  if (s.github.length)
    lines.push(
      `GITHUB SCRAPER/E-COMMERCE REPO SIGNALS:\n${s.github
        .map((g) => `- ${g.full_name} (${g.stars}★): ${g.description} [${g.topics.join(", ")}]`)
        .join("\n")}`,
    );
  return lines.join("\n");
}
