// ============================================================================
// Velora — Multi-Platform Automated Trend Discovery (server only)
//
// Ingestion streams (no paid platform APIs):
//   a) Web scraping  : Google Trends public pages, Amazon Best Sellers,
//                      TikTok Creative Center public trend lists, Yandex trends
//   b) Open RSS/webhook: any public RSS feed or webhook payload
//
// Every source degrades gracefully — a dead source reports `error` status and
// the pipeline keeps working with the remaining ones.
// ============================================================================
import { callGemini, callGroq, callLovableAI, extractJson } from "./ai.server";
import { callOpenRouter } from "./tools-ai.server";

export type TrendSource = "Google" | "Amazon" | "TikTok" | "Yandex" | "RSS" | "GitHub";
export type IngestKind = "scrape" | "rss" | "github";

export type ScrapedTrend = {
  id: string;
  source: TrendSource;
  kind: IngestKind;
  trend_name: string;
  category: string;
  region: string;
  metrics: { search_volume: number; growth_rate: number; rank: number };
  scraped_at: string;
  raw_payload: Record<string, unknown>;
};

export type SourceStatus = {
  source: TrendSource;
  kind: IngestKind;
  status: "active" | "error";
  items: number;
  detail: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function grab(url: string, ms = 8000, headers: Record<string, string> = {}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...headers },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clean = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? clean(m[1] ?? "") : "";
}

function items(xml: string): string[] {
  return xml.split(/<item[\s>]/i).slice(1).map((b) => b.split(/<\/item>/i)[0] ?? "");
}

function parseVolume(v: string): number {
  const n = parseFloat(v.replace(/[^\d.]/g, "")) || 0;
  if (/m/i.test(v)) return Math.round(n * 1_000_000);
  if (/k|b(?!$)/i.test(v)) return Math.round(n * 1000);
  return Math.round(n);
}

function mk(
  source: TrendSource,
  kind: IngestKind,
  name: string,
  region: string,
  category: string,
  metrics: Partial<ScrapedTrend["metrics"]>,
  raw: Record<string, unknown>,
): ScrapedTrend {
  return {
    id: `${source}-${uid()}`,
    source,
    kind,
    trend_name: name.slice(0, 120),
    category,
    region,
    metrics: {
      search_volume: Math.round(metrics.search_volume ?? 0),
      growth_rate: Math.round(metrics.growth_rate ?? 0),
      rank: metrics.rank ?? 0,
    },
    scraped_at: new Date().toISOString(),
    raw_payload: raw,
  };
}

/* ------------------------------------------------- 1. Google Trends (public) */
async function scrapeGoogle(region: string, category: string): Promise<ScrapedTrend[]> {
  const geo = region === "GLOBAL" ? "US" : region;
  const xml = await grab(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`);
  return items(xml)
    .slice(0, 20)
    .map((b, i) => {
      const title = tag(b, "title");
      const traffic = tag(b, "ht:approx_traffic") || tag(b, "approx_traffic");
      const vol = parseVolume(traffic) || 20000;
      return mk("Google", "scrape", title, geo, category, {
        search_volume: vol,
        growth_rate: Math.max(15, 220 - i * 9),
        rank: i + 1,
      }, { traffic, news: tag(b, "ht:news_item_title"), pubDate: tag(b, "pubDate") });
    })
    .filter((t) => t.trend_name);
}

/** Public Google News RSS fallback when a marketplace blocks the scraper. */
async function newsFallback(
  source: TrendSource, query: string, region: string, category: string,
): Promise<ScrapedTrend[]> {
  const xml = await grab(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    8000,
  );
  const out = items(xml).slice(0, 12).map((b, i) =>
    mk(source, "scrape", tag(b, "title"), region, category, {
      search_volume: 3000 + (12 - i) * 600,
      growth_rate: Math.max(10, 120 - i * 7),
      rank: i + 1,
    }, { fallback: "google-news-rss", query, link: tag(b, "link") }),
  ).filter((t) => t.trend_name);
  if (!out.length) throw new Error("source blocked, fallback empty");
  return out;
}

/* ------------------------------------------- 2. Amazon Best Sellers (public) */
const AMZ_HOST: Record<string, string> = {
  US: "www.amazon.com", GB: "www.amazon.co.uk", UK: "www.amazon.co.uk", DE: "www.amazon.de",
  FR: "www.amazon.fr", IT: "www.amazon.it", ES: "www.amazon.es", TR: "www.amazon.com.tr",
  CA: "www.amazon.ca", AU: "www.amazon.com.au", NL: "www.amazon.nl", JP: "www.amazon.co.jp",
};
const AMZ_PATH: Record<string, string> = {
  General: "", Electronics: "electronics", Home: "home-garden", Beauty: "beauty",
  Sports: "sporting-goods", Toys: "toys-and-games", Pet: "pet-supplies", Fashion: "fashion",
};

async function scrapeAmazon(region: string, category: string): Promise<ScrapedTrend[]> {
  const host = AMZ_HOST[region === "GLOBAL" ? "US" : region] ?? "www.amazon.com";
  const path = AMZ_PATH[category] ?? "";
  const html = await grab(`https://${host}/gp/movers-and-shakers/${path}`, 9000);
  const found = new Set<string>();
  const out: ScrapedTrend[] = [];
  const re = /<div[^>]*class="[^"]*_cDEzb_p13n-sc-css-line-clamp[^"]*"[^>]*>([^<]{6,140})<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const name = clean(m[1] ?? "");
    if (!name || found.has(name)) continue;
    found.add(name);
    out.push(
      mk("Amazon", "scrape", name, region, category, {
        search_volume: 8000 + (20 - out.length) * 900,
        growth_rate: Math.max(20, 300 - out.length * 12),
        rank: out.length + 1,
      }, { list: "movers-and-shakers", host }),
    );
  }
  if (!out.length) return await newsFallback("Amazon", "amazon best sellers trending product", region, category);
  return out;
}

/* -------------------------------- 3. TikTok Creative Center (public endpoint) */
async function scrapeTikTok(region: string, category: string): Promise<ScrapedTrend[]> {
  const cc = region === "GLOBAL" ? "US" : region;
  const url =
    `https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list` +
    `?period=7&page=1&limit=20&order_by=popular&country_code=${cc}`;
  const raw = await grab(url, 9000, { "accept": "application/json", "referer": "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en" });
  const json = JSON.parse(raw) as {
    data?: { list?: Array<{ hashtag_name?: string; publish_cnt?: number; video_views?: number; rank?: number; trend?: Array<{ value?: number }> }> };
  };
  const list = json.data?.list ?? [];
  if (!list.length) return await newsFallback("TikTok", "tiktok viral product trend hashtag", cc, category);
  return list.slice(0, 20).map((h, i) => {
    const series = (h.trend ?? []).map((p) => Number(p.value ?? 0));
    const growth = series.length > 1 && series[0]
      ? Math.round(((series[series.length - 1]! - series[0]!) / Math.max(1, series[0]!)) * 100)
      : Math.max(10, 180 - i * 8);
    return mk("TikTok", "scrape", `#${h.hashtag_name ?? ""}`, cc, category, {
      search_volume: Number(h.video_views ?? h.publish_cnt ?? 0),
      growth_rate: growth,
      rank: Number(h.rank ?? i + 1),
    }, { publish_cnt: h.publish_cnt, video_views: h.video_views, series });
  }).filter((t) => t.trend_name.length > 1);
}

/* ------------------------------------------------ 4. Yandex public trend feed */
async function scrapeYandex(region: string, category: string): Promise<ScrapedTrend[]> {
  const xml = await grab("https://news.yandex.ru/index.rss", 8000).catch(() =>
    grab("https://yandex.com/news/export/index.rss", 8000),
  );
  return items(xml).slice(0, 15).map((b, i) =>
    mk("Yandex", "scrape", tag(b, "title"), region, category, {
      search_volume: 5000 + (15 - i) * 700,
      growth_rate: Math.max(8, 140 - i * 8),
      rank: i + 1,
    }, { link: tag(b, "link"), pubDate: tag(b, "pubDate") }),
  ).filter((t) => t.trend_name);
}

/* ------------------------------------------------- 5. Open RSS / webhook feed */
export const DEFAULT_RSS = [
  "https://www.retaildive.com/feeds/news/",
  "https://feeds.feedburner.com/Trendhunter",
  "https://news.google.com/rss/search?q=trending+product+ecommerce&hl=en-US&gl=US&ceid=US:en",
];

async function ingestRss(feeds: string[], region: string, category: string): Promise<ScrapedTrend[]> {
  const results = await Promise.allSettled(feeds.slice(0, 6).map((f) => grab(f, 8000)));
  const out: ScrapedTrend[] = [];
  results.forEach((r, fi) => {
    if (r.status !== "fulfilled") return;
    items(r.value).slice(0, 8).forEach((b, i) => {
      const title = tag(b, "title");
      if (!title) return;
      out.push(
        mk("RSS", "rss", title, region, category, {
          search_volume: 1500 + (8 - i) * 250,
          growth_rate: Math.max(5, 90 - i * 6),
          rank: i + 1,
        }, { feed: feeds[fi], link: tag(b, "link"), pubDate: tag(b, "pubDate") }),
      );
    });
  });
  if (!out.length) throw new Error("no rss items");
  return out;
}

/* ------------------------------------------------- 6. GitHub public repos */
async function scrapeGitHub(region: string, category: string, niche?: string): Promise<ScrapedTrend[]> {
  const { fetchGitHubTrendsForNiche } = await import("./github-trends.server");
  const query = (niche || category || "trending").replace(/[^\w\s-]/g, " ").trim();
  const repos = await fetchGitHubTrendsForNiche(query);
  if (!repos.length) throw new Error("no github repos found");
  return repos.slice(0, 15).map((r, i) =>
    mk("GitHub", "github", r.full_name, region, category, {
      search_volume: r.stargazers_count,
      growth_rate: Math.min(300, Math.max(10, Math.round((r.stargazers_count / Math.max(1, r.forks_count || 1)) * 10))),
      rank: i + 1,
    }, {
      html_url: r.html_url,
      language: r.language,
      forks: r.forks_count,
      topics: r.topics,
      pushed_at: r.pushed_at,
      created_at: r.created_at,
    }),
  );
}

/** Normalizes an arbitrary webhook payload into the standard trend schema. */
export function normalizeWebhook(payload: unknown, region = "GLOBAL"): ScrapedTrend[] {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown[] })?.items)
      ? (payload as { items: unknown[] }).items
      : [payload];
  return arr.slice(0, 50).map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const name = String(o["trend_name"] ?? o["title"] ?? o["name"] ?? "").trim();
    const m = (o["metrics"] ?? {}) as Record<string, unknown>;
    return mk("RSS", "rss", name || `Webhook item ${i + 1}`, String(o["region"] ?? region), String(o["category"] ?? "General"), {
      search_volume: Number(m["search_volume"] ?? o["volume"] ?? 0),
      growth_rate: Number(m["growth_rate"] ?? o["growth"] ?? 0),
      rank: Number(m["rank"] ?? i + 1),
    }, o);
  }).filter((t) => t.trend_name);
}

/* ------------------------------------------------------------ Orchestration */

export type ScrapeJob = { trends: ScrapedTrend[]; statuses: SourceStatus[]; ran_at: string };

export async function runScrapeJob(opts: {
  region: string;
  category: string;
  sources: TrendSource[];
  rssFeeds?: string[];
  niche?: string;
}): Promise<ScrapeJob> {
  const region = (opts.region || "GLOBAL").toUpperCase();
  const category = opts.category || "General";
  const want = new Set(opts.sources.length ? opts.sources : (["Google", "Amazon", "TikTok", "Yandex", "RSS"] as TrendSource[]));
  const feeds = (opts.rssFeeds?.length ? opts.rssFeeds : DEFAULT_RSS).filter(Boolean);

  type Job = { source: TrendSource; kind: IngestKind; run: () => Promise<ScrapedTrend[]> };
  const allJobs: Job[] = [
    { source: "Google", kind: "scrape", run: () => scrapeGoogle(region, category) },
    { source: "Amazon", kind: "scrape", run: () => scrapeAmazon(region, category) },
    { source: "TikTok", kind: "scrape", run: () => scrapeTikTok(region, category) },
    { source: "Yandex", kind: "scrape", run: () => scrapeYandex(region, category) },
    { source: "RSS", kind: "rss", run: () => ingestRss(feeds, region, category) },
    { source: "GitHub", kind: "github", run: () => scrapeGitHub(region, category, opts.niche) },
  ];
  const jobs = allJobs.filter((j) => want.has(j.source));

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const trends: ScrapedTrend[] = [];
  const statuses: SourceStatus[] = settled.map((r, i) => {
    const j = jobs[i]!;
    if (r.status === "fulfilled") {
      trends.push(...r.value);
      return { source: j.source, kind: j.kind, status: "active", items: r.value.length, detail: "OK" };
    }
    return { source: j.source, kind: j.kind, status: "error", items: 0, detail: String((r.reason as Error)?.message ?? "unreachable").slice(0, 80) };
  });

  return { trends, statuses, ran_at: new Date().toISOString() };
}

/* ------------------------------------------------- Velora Deep AI Intelligence */

export type AiMode = "fast" | "deep" | "strategy";

export type AiTrendVerdict = {
  trend_name: string;
  sources: TrendSource[];
  ai_demand_score: number;
  signal: "verified" | "noise" | "watch";
  confidence: number;
  reasoning: string;
  sentiment: "positive" | "neutral" | "negative";
  hooks: string[];
  persona: string;
  positioning: string;
  ad_copy: string;
};

export type AiSynthesis = {
  mode: AiMode;
  engines: string[];
  summary: string;
  breakouts: AiTrendVerdict[];
  noise_filtered: string[];
  correlations: { theme: string; platforms: TrendSource[]; note: string }[];
  scores: Record<string, number>;
};

const MODE_BRIEF: Record<AiMode, string> = {
  fast: "FAST SYNTHESIS: be quick and decisive, short reasoning, top signals only.",
  deep: "DEEP MARKET RESEARCH: analyse demand durability, seasonality, saturation and buyer intent in depth.",
  strategy: "E-COMMERCE STRATEGY MODE: focus on how to sell it — offers, hooks, personas, creative angles, pricing.",
};

function buildPrompt(trends: ScrapedTrend[], mode: AiMode, region: string, category: string): string {
  const lines = trends.slice(0, 70).map((t) =>
    `${t.source}|${t.trend_name}|vol=${t.metrics.search_volume}|growth=${t.metrics.growth_rate}%|rank=${t.metrics.rank}`,
  ).join("\n");
  return `You are VELORA DEEP AI INTELLIGENCE, a multi-platform e-commerce trend analyst.
${MODE_BRIEF[mode]}
Region: ${region} | Category: ${category}

RAW MULTI-PLATFORM SIGNALS (scraped web + RSS, one per line):
${lines}

Tasks:
1. NOISE FILTERING: discard one-off news spikes, celebrity/politics chatter and non-commercial noise.
2. CROSS-PLATFORM CORRELATION: find themes appearing on 2+ platforms (Amazon product + TikTok hashtag + Google/Yandex search).
3. UNIFIED AI DEMAND SCORE 0-100 per surviving trend, based on multi-platform momentum and purchase intent.
4. ACTIONABLE STRATEGY for the breakout trends.

Return ONLY minified JSON (all prose in Turkish):
{"summary": string (max 240 chars),
 "breakouts": [{"trend_name": string, "sources": ["Google"|"Amazon"|"TikTok"|"Yandex"|"RSS"], "ai_demand_score": 0-100,
   "signal": "verified"|"watch", "confidence": 0-100, "reasoning": string (2 sentences),
   "sentiment": "positive"|"neutral"|"negative", "hooks": [string] (3),
   "persona": string, "positioning": string, "ad_copy": string (max 220 chars)}] (5-8 items, best first),
 "noise_filtered": [string] (3-6 discarded signals),
 "correlations": [{"theme": string, "platforms": [string], "note": string}] (2-4)}`;
}

const ENGINES: { name: string; run: (p: string) => Promise<string> }[] = [
  { name: "gemini", run: (p) => callGemini(p, process.env["GEMINI_API_KEY_1"] || process.env["GEMINI_1_API_KEY"] || process.env["GEMINI_API_KEY"], 0.45, false, ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"]) },
  { name: "groq", run: (p) => callGroq(p, 0.4) },
  { name: "openrouter", run: (p) => callOpenRouter(p, 0.4) },
  { name: "lovable", run: (p) => callLovableAI(p, 0.4) },
];

/** Hybrid: 2 engines for fast mode, 4 for deep/strategy — outputs fused. */
export async function runDeepAnalysis(
  trends: ScrapedTrend[],
  mode: AiMode,
  region: string,
  category: string,
): Promise<AiSynthesis> {
  const prompt = buildPrompt(trends, mode, region, category);
  const pool = mode === "fast" ? ENGINES.slice(0, 2) : ENGINES;
  const settled = await Promise.allSettled(pool.map((e) => e.run(prompt)));

  const parsed: { engine: string; data: Record<string, unknown> }[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const data = extractJson<Record<string, unknown>>(r.value, {});
    if (Array.isArray(data["breakouts"])) parsed.push({ engine: pool[i]!.name, data });
  });

  if (!parsed.length) {
    return {
      mode, engines: [], summary: "AI motorlarına şu an ulaşılamadı — ham sinyaller aşağıda listeleniyor.",
      breakouts: [], noise_filtered: [], correlations: [], scores: {},
    };
  }

  // Fuse: average AI demand score per trend across engines, union of strategy fields.
  const byName = new Map<string, { v: AiTrendVerdict; scores: number[] }>();
  for (const p of parsed) {
    for (const rawB of (p.data["breakouts"] as unknown[]).slice(0, 10)) {
      const b = (rawB ?? {}) as Record<string, unknown>;
      const name = String(b["trend_name"] ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const score = Math.max(0, Math.min(100, Math.round(Number(b["ai_demand_score"]) || 0)));
      const arr = (k: string, n: number) => (Array.isArray(b[k]) ? (b[k] as unknown[]).slice(0, n).map(String) : []);
      const cur = byName.get(key);
      if (cur) {
        cur.scores.push(score);
        if (!cur.v.hooks.length) cur.v.hooks = arr("hooks", 3);
        if (!cur.v.reasoning) cur.v.reasoning = String(b["reasoning"] ?? "");
        cur.v.sources = Array.from(new Set([...cur.v.sources, ...(arr("sources", 5) as TrendSource[])]));
      } else {
        byName.set(key, {
          scores: [score],
          v: {
            trend_name: name,
            sources: arr("sources", 5) as TrendSource[],
            ai_demand_score: score,
            signal: String(b["signal"] ?? "watch") === "verified" ? "verified" : "watch",
            confidence: Math.max(0, Math.min(100, Math.round(Number(b["confidence"]) || 60))),
            reasoning: String(b["reasoning"] ?? "").slice(0, 400),
            sentiment: (["positive", "neutral", "negative"].includes(String(b["sentiment"])) ? String(b["sentiment"]) : "neutral") as AiTrendVerdict["sentiment"],
            hooks: arr("hooks", 3),
            persona: String(b["persona"] ?? "").slice(0, 240),
            positioning: String(b["positioning"] ?? "").slice(0, 240),
            ad_copy: String(b["ad_copy"] ?? "").slice(0, 300),
          },
        });
      }
    }
  }

  const breakouts = Array.from(byName.values()).map(({ v, scores }) => {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    // Multi-engine agreement bumps confidence.
    return { ...v, ai_demand_score: avg, confidence: Math.min(100, v.confidence + (scores.length - 1) * 8) };
  }).sort((a, b) => b.ai_demand_score - a.ai_demand_score).slice(0, 8);

  const first = parsed[0]!.data;
  const noise = new Set<string>();
  parsed.forEach((p) => (Array.isArray(p.data["noise_filtered"]) ? p.data["noise_filtered"] : []).slice(0, 4).forEach((n) => noise.add(String(n))));

  const correlations = (Array.isArray(first["correlations"]) ? first["correlations"] : []).slice(0, 4).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      theme: String(o["theme"] ?? ""),
      platforms: (Array.isArray(o["platforms"]) ? o["platforms"] : []).map(String) as TrendSource[],
      note: String(o["note"] ?? "").slice(0, 240),
    };
  });

  const scores: Record<string, number> = {};
  breakouts.forEach((b) => (scores[b.trend_name] = b.ai_demand_score));

  return {
    mode,
    engines: parsed.map((p) => p.engine),
    summary: String(first["summary"] ?? "").slice(0, 320),
    breakouts,
    noise_filtered: Array.from(noise).slice(0, 6),
    correlations,
    scores,
  };
}

/** Deep product brief for one trend (modal). */
export async function runProductBrief(trend: string, region: string, category: string): Promise<Record<string, unknown>> {
  const prompt = `You are VELORA DEEP AI INTELLIGENCE. Write a full e-commerce product brief for the breakout trend below.
Trend: ${trend} | Region: ${region} | Category: ${category}

Return ONLY minified JSON (all prose in Turkish):
{"headline": string, "opportunity": string (3 sentences),
 "audience": [{"persona": string, "pain": string, "trigger": string}] (3),
 "angles": [string] (4 positioning angles),
 "hooks": [string] (5 scroll-stopping ad hooks),
 "ad_copy": [{"channel": "TikTok"|"Meta"|"Google", "copy": string}] (3),
 "pricing": {"suggested_retail_usd": number, "landed_cost_usd": number, "margin_pct": number},
 "risks": [string] (3), "next_steps": [string] (4)}`;
  const settled = await Promise.allSettled(ENGINES.slice(0, 2).map((e) => e.run(prompt)));
  for (const r of settled) {
    if (r.status === "fulfilled") {
      const data = extractJson<Record<string, unknown>>(r.value, {});
      if (data["headline"] || data["hooks"]) return data;
    }
  }
  return {};
}
