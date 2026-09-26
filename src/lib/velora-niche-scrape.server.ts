// ============================================================================
// VELORA FAZ 0 — NİŞ KAZIMASI (14 ajan devreye girmeden ÖNCE).
//
// Bu modülün tek işi: seçilen niş için, AJANLARDAN BAĞIMSIZ olarak gerçek veri
// toplamak. 14 ajanın her biri kendi alanında bu taban kanıtı görür ve üstüne
// uzmanlık dilimini alır.
//
// KAYNAKLAR (hepsi ücretsiz, anahtarsız, paralel):
//   1. Google Trends        — 12 aylık ilgi + momentum
//   2. Reddit (3 subreddit) — tüketici talebi + ŞİKÂYET sinyalleri
//   3. Hacker News (Algolia)— nişe dair gerçek teknik/tartışma hacmi
//   4. Google News RSS      — "neden şimdi" bağlamı
//   5. DuckDuckGo→marketplace — GÖZLENEN perakende fiyatları (uydurma fiyat yok)
//   6. AliExpress sourcing  — tedarikçi maliyeti (canlı ya da dürüstçe "estimated")
//   7. Trend Radar          — Google/Amazon/TikTok/Yandex/RSS/GitHub kazımaları
//   8. GitHub               — nişe yönelik açık kaynak hareketi
//
// SÖZLEŞMELER:
//   • HAT ASLA FIRLATMAZ. Bir kaynak ölürse `status: "error"` olarak raporlanır
//     ve diğer kaynaklar karneyi beslemeye devam eder.
//   • SÜRE TAVANI ZORUNLUDUR. `budgetMs` dolunca kısmi kanıt döner; ajanlar
//     nötr puanlama kuralına geçer.
//   • SAYI UYDURULMAZ. `getGoogleTrends` ve `getSourcingEstimate` iç fallbacks
//     üretse de `live` bayraklarıyla ayrılır; ajan istemi bu ayrımı görür.
// ============================================================================

import { cached } from "./ai-cache.server";
import { fetchGitHubTrendsForNiche } from "./github-trends.server";
import {
  getGoogleTrends,
  getSourcingEstimate,
  scrapeMarketplaceSellers,
} from "./market-data.server";
import { runScrapeJob } from "./trend-radar.server";
import {
  emptyNicheSignals,
  medianPrice,
  NicheSignalsSchema,
  type HackerNewsSignal,
  type NewsHeadline,
  type NicheSignals,
  type NicheSourceStatus,
  type PriceSample,
  type RedditSignal,
} from "./velora-niche-signals";

/** Faz 0'ın duvar saati tavanı. Vercel Hobby fonksiyon payının çok altında. */
export const VELORA_HARVEST_BUDGET_MS = 9_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/* ------------------------------------------------------------------ utils */

async function grabJson<T>(url: string, ms: number): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

async function grabText(url: string, ms: number): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,text/xml" },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

const rssTag = (block: string, tag: string): string => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? decodeEntities(m[1] ?? "") : "";
};

/** Bir toplama işini zaman sınırı + dürüst durum raporuyla çalıştırır. */
async function collect<T>(
  name: string,
  run: () => Promise<T>,
  count: (value: T) => number,
  statuses: NicheSourceStatus[],
): Promise<T | null> {
  try {
    const value = await run();
    const items = Math.max(0, count(value));
    statuses.push({ name, status: "active", items, detail: "" });
    return value;
  } catch (error) {
    statuses.push({
      name,
      status: "error",
      items: 0,
      detail: error instanceof Error ? error.message.slice(0, 80) : "unreachable",
    });
    return null;
  }
}

/* ------------------------------------------------------------- 1. Reddit */

const SUBREDDITS = ["TikTokMadeMeBuyIt", "amazonfinds", "BuyItForLife"];

/**
 * ŞİKÂYET KELİMELERİ — kural tabanlı, dile bağlı değil.
 *
 * Neden gerekiyor: "en iyi X" arzı gösterir ama tek başına ürünün kalitesi hakkında
 * bilgi vermez. Aynı başlıktaki olumsuz deneyimler (kırıldı, iade, hayal kırıklığı)
 * ürün kalitesi riskidir ve UX/CFO/tedarik ajanları tam olarak bunu görmelidir.
 */
const COMPLAINT_TERMS = [
  "broke",
  "broken",
  "stopped working",
  "defective",
  "cheap",
  "flimsy",
  "disappoint",
  "regret",
  "returned",
  "return it",
  "refund",
  "waste of money",
  "overpriced",
  "scam",
  "avoid",
  "don't buy",
  "do not buy",
  "worst",
  "leaked",
  "too small",
  "not worth",
];

export function isComplaintTitle(title: string): boolean {
  const t = String(title ?? "").toLowerCase();
  return COMPLAINT_TERMS.some((term) => t.includes(term));
}

async function scrapeReddit(niche: string): Promise<RedditSignal[]> {
  const q = encodeURIComponent(niche.slice(0, 80));
  const results = await Promise.allSettled(
    SUBREDDITS.map(async (sub) => {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=top&t=month&limit=10`;
      const json = await grabJson<{
        data?: { children?: { data?: Record<string, unknown> }[] };
      }>(url, 5_000);
      const out: RedditSignal[] = [];
      for (const child of json.data?.children ?? []) {
        const d = child.data ?? {};
        const title = String(d["title"] ?? "").trim();
        if (!title) continue;
        out.push({
          title: title.slice(0, 180),
          subreddit: sub,
          score: Number(d["score"] ?? 0),
          comments: Number(d["num_comments"] ?? 0),
          url: `https://reddit.com${String(d["permalink"] ?? "")}`,
          complaint: isComplaintTitle(title),
        });
      }
      return out;
    }),
  );
  const rows = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Önce en çok konuşulanlar; aynı ses yoğunluğunda şikâyetler öne çıkar.
  return rows.sort((a, b) => b.score + b.comments - (a.score + a.comments)).slice(0, 12);
}

/* --------------------------------------------------------- 2. Hacker News */

type HnResponse = {
  hits?: {
    title?: string | null;
    points?: number | null;
    num_comments?: number | null;
    url?: string | null;
    objectID?: string;
  }[];
};

async function scrapeHackerNews(niche: string): Promise<HackerNewsSignal[]> {
  const q = encodeURIComponent(niche.slice(0, 60));
  const url = `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=8`;
  const json = await grabJson<HnResponse>(url, 5_000);
  const out: HackerNewsSignal[] = [];
  for (const hit of json.hits ?? []) {
    const title = String(hit.title ?? "").trim();
    if (!title) continue;
    out.push({
      title: title.slice(0, 180),
      points: Number(hit.points ?? 0),
      comments: Number(hit.num_comments ?? 0),
      url: String(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`),
    });
  }
  // Konuşma hacmi yüksek olanlar gerçek ilgi sinyalidir.
  return out.sort((a, b) => b.points + b.comments - (a.points + a.comments)).slice(0, 6);
}

/* ------------------------------------------------------ 3. Google News RSS */

async function scrapeNews(niche: string, country: string): Promise<NewsHeadline[]> {
  const q = encodeURIComponent(`${niche} product`);
  const gl = (country || "US").toUpperCase().slice(0, 2);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=${gl}&ceid=${gl}:en`;
  const xml = await grabText(url, 5_000);
  const blocks = xml.split(/<item[\s>]/i).slice(1, 9);
  const out: NewsHeadline[] = [];
  for (const block of blocks) {
    const title = rssTag(block, "title");
    if (!title) continue;
    out.push({
      title: title.slice(0, 180),
      source: rssTag(block, "source").slice(0, 60),
      url: rssTag(block, "link"),
    });
  }
  if (!out.length) throw new Error("no rss items");
  return out;
}

/* ---------------------------------------------------------- 4. Fiyatlar */

async function scrapePrices(niche: string, country: string): Promise<PriceSample[]> {
  const sellers = await scrapeMarketplaceSellers(niche.slice(0, 60), country);
  return sellers
    .filter((s) => Number.isFinite(s.price_usd) && s.price_usd > 0)
    .slice(0, 12)
    .map((s) => ({ platform: s.platform || "Marketplace", priceUsd: s.price_usd }));
}

/* ------------------------------------------------------------- 5. Radar */

const RADAR_SOURCES = ["Google", "Amazon", "TikTok", "Yandex", "RSS", "GitHub"] as const;

type RadarJob = {
  trends: { source: string; trend_name: string }[];
  statuses: { source: string; status: "active" | "error"; items: number }[];
};

/* ------------------------------------------------------------------ ana */

/**
 * FAZ 0 — niş kazıması.
 *
 * Tüm kaynaklar `Promise.allSettled` ile Aynı anda koşar; yavaş/ölü bir kaynak
 * zinciri bekletmez. `budgetMs` dolduğunda elde edilen kısmi kanıt döner.
 */
export async function harvestNicheSignals(input: {
  niche: string;
  country?: string;
  platform?: string;
  budgetMs?: number;
}): Promise<NicheSignals> {
  const niche = String(input.niche ?? "").trim();
  const country = (input.country ?? "GLOBAL").toUpperCase();
  const platform = input.platform ?? "General";
  const budgetMs = input.budgetMs ?? VELORA_HARVEST_BUDGET_MS;
  if (!niche) return emptyNicheSignals({ country, platform });

  const statuses: NicheSourceStatus[] = [];

  // Faz 0 çıktısı bir kez üretilir: iki "hat" bu tek kazımanın üstünde karar verir.
  const harvest = (async (): Promise<NicheSignals> => {
    const [trends, reddit, hackerNews, news, prices, radar, github, supplier] = await Promise.all([
      collect(
        "Google Trends",
        () => getGoogleTrends(niche, country),
        (t) => t.yearly.length,
        statuses,
      ),
      collect(
        "Reddit",
        () => scrapeReddit(niche),
        (r) => r.length,
        statuses,
      ),
      collect(
        "Hacker News",
        () => scrapeHackerNews(niche),
        (h) => h.length,
        statuses,
      ),
      collect(
        "Google News",
        () => scrapeNews(niche, country),
        (n) => n.length,
        statuses,
      ),
      collect(
        "Marketplace prices",
        () => scrapePrices(niche, country),
        (p) => p.length,
        statuses,
      ),
      collect(
        "Trend Radar",
        () =>
          runScrapeJob({
            region: country,
            category: platform,
            sources: [...RADAR_SOURCES],
            niche,
          }) as Promise<RadarJob>,
        (r) => r.trends.length,
        statuses,
      ),
      collect(
        "GitHub",
        () => fetchGitHubTrendsForNiche(niche),
        (g) => g.length,
        statuses,
      ),
      collect(
        "Supplier pricing",
        // Fiyat bilinmiyor; kaynak tahmini dönerse `live:false` ile işaretlenir.
        () => getSourcingEstimate(niche, 40),
        (s) => (s.source === "aliexpress" ? 1 : 0),
        statuses,
      ),
    ]);

    const radarRows = radar?.trends ?? [];
    const bySource = (name: string) =>
      radarRows
        .filter((t) => t.source === name)
        .map((t) => t.trend_name)
        .slice(0, 10);
    const radarLines = [...new Set(radarRows.map((t) => `${t.source}: ${t.trend_name}`))].slice(
      0,
      16,
    );

    // Google Trends canlı veri vermediyse `source: "estimated"` işaretlidir;
    // momentum bu durumda null'dur — "ölçtük" demiyoruz.
    const trendsLive = Boolean(trends && trends.source === "google-trends");

    return NicheSignalsSchema.parse({
      niche,
      country,
      platform,
      collectedAt: new Date().toISOString(),

      trendSeries: trendsLive ? trends!.yearly : [],
      trendMomentumPct: trendsLive ? trends!.momentum_pct : null,
      googleRising: bySource("Google"),
      tiktok: bySource("TikTok"),
      amazonMovers: bySource("Amazon"),
      reddit: reddit ?? [],
      hackerNews: hackerNews ?? [],

      priceSamples: prices ?? [],
      retailMedianUsd: medianPrice(prices ?? []),
      supplier: supplier
        ? {
            priceUsd: supplier.supplier_price_usd,
            shippingUsd: supplier.shipping_usd,
            live: supplier.source === "aliexpress",
            sampleTitle: supplier.sample_title.slice(0, 140),
          }
        : null,

      news: news ?? [],
      github: (github ?? []).slice(0, 6).map((g) => ({
        fullName: g.full_name,
        stars: g.stargazers_count,
        description: (g.description ?? "").slice(0, 140),
        topics: g.topics.slice(0, 4),
      })),
      radar: radarLines,

      sources: statuses,
      live: statuses.some((s) => s.status === "active" && s.items > 0),
    });
  })();

  // Zaman tavanı: yavaş bir kaynak tüm kazımayı düşüremez.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NicheSignals>((resolve) => {
    timer = setTimeout(
      () => resolve(emptyNicheSignals({ niche, country, platform })),
      Math.max(500, budgetMs),
    );
  });
  try {
    return await Promise.race([harvest, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 24 saatlik önbellekli Faz 0 — aynı niş ikinci kez kazınmaz. */
export function harvestNicheSignalsCached(input: {
  niche: string;
  country?: string;
  platform?: string;
}): Promise<{ data: NicheSignals; cache_hit: boolean }> {
  const country = (input.country ?? "GLOBAL").toUpperCase();
  const platform = input.platform ?? "General";
  return cached("velora-harvest", [input.niche, country, platform], () =>
    harvestNicheSignals({ niche: input.niche, country, platform }),
  );
}
