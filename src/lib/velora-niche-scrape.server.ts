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
  eurToUsdRate,
  getGoogleTrends,
  getSourcingEstimate,
  scrapeAmazonRetailPrices,
  scrapeBingPriceSignals,
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

/**
 * Faz 0'ın duvar saati tavanı.
 *
 * ÖLÇÜLEN GERÇEK PROFİL: en yavaş iki kaynak radar (8.6 sn) ve Reddit arşivi
 * (5-8.7 sn). 12 saniyelik tavan ikisini de kapsar ve Vercel Hobby'nin 300
 * saniyelik fonksiyon payının çok altında kalır. Kaynak başına tavanlar
 * yüzünden bu genel tavan normalde tetiklenmez; tetiklenirse bile elde edilen
 * kanıt korunur (aşağıdaki `timeout` bloğu).
 */
export const VELORA_HARVEST_BUDGET_MS = 12_000;

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

/**
 * Bir toplama işini zaman sınırı + dürüst durum raporuyla çalıştırır.
 *
 * KAYNAK BAŞINA ZAMAN TAVANI KRİTİKTİR. Ölçülen gerçek: Reddit arşivi 5-8
 * saniyeye çıkabiliyor. Önceki tasarımda yalnız TEK bir genel tavan vardı ve
 * genel tavan dolunca `emptyNicheSignals()` dönerdi — yani yavaş bir kaynak
 * (arşiv) çalışan Hacker News, Google News, GitHub ve fiyat kanıtının
 * TAMAMINI siliyordu. Şimdi her kaynağın kendi tavanı vardır: yavaş kaynak
 * `error` olur ve **diğer kaynakların kanıtı kurtulur**.
 */
async function collect<T>(
  name: string,
  run: () => Promise<T>,
  count: (value: T) => number,
  statuses: NicheSourceStatus[],
  perSourceMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout>${perSourceMs}ms`)), perSourceMs);
      }),
    ]);
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
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- 1. Reddit */

/**
 * TÜKETİCİ SİNYALİ KAYNAĞI — gerçek Reddit arşivi (Arctic Shift).
 *
 * NEDEN ARŞİV: `reddit.com` kendi uç noktalarını sunucu IP'lerine kapatmış.
 * Ölçülen durum: `search.json` → 403, `search.rss` → 429, `old.reddit.com` →
 * giriş sayfası (321 KB, 0 sonuç). Yani `scrapeReddit`'ın eski hali DAIMA
 * boş dönüyordu ve "Reddit talebi kanıtlandı" iddiası hiçbir zaman doğru
 * olmadı. `arctic-shift.photon-reddit.com` aynı veriyi, arşivlenmiş hâlde
 * ve anahtarsız sunar.
 *
 * SINIRLAR DÜRÜSTÇE BİLDİRİLİR: arşiv sorgusu kendi içinde zaman aşımına
 * uğrayabilir (422) ve arşiv canlı değil günceldir. Bu yüzden
 *   • sorgular SIRALI (paralel istekler 422 üretiyor),
 *   • kısa süre tavanı vardır,
 *   • sonuç boşsa kaynak `active` DEĞİL, `error` olarak raporlanır,
 *   • ajan istemi başlığında "ARŞİV" ibaresi görünür.
 */
const SUBREDDITS = ["TikTokMadeMeBuyIt", "amazonfinds", "BuyItForLife"];

const ARCTIC_BASE = "https://arctic-shift.photon-reddit.com/api";

type ArcticPost = {
  title?: unknown;
  subreddit?: unknown;
  score?: unknown;
  num_comments?: unknown;
  permalink?: unknown;
  created_utc?: unknown;
};

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Arşivden talep + şikâyet sinyali kazır.
 *
 * SORGULAMA DİSİPLİNİ (ölçülmüş): arşiv paralel sorgularda kendi içinde
 * kuyruğa alıyor — üç paralel istek 8 saniye sürdü (tek istek ~150 ms). Bu
 * yüzden her alt topluluk için **tek, birleştirilmiş** istek atılır, `limit`
 * dar tutulur ve sıra korunur: tavan aşılmaz, gereksiz istek de yapılmaz.
 */
async function scrapeReddit(niche: string): Promise<RedditSignal[]> {
  const words = niche
    .toLowerCase()
    .split(/[^a-z0-9çğıöşü]+/i)
    .filter((w) => w.length >= 4)
    .slice(0, 2);
  if (!words.length) return [];

  const out: RedditSignal[] = [];
  const seen = new Set<string>();
  // Sıralı istek: arşiv paralel sorgularda 422 "slow down" döndürüyor.
  for (const sub of SUBREDDITS) {
    let rows: ArcticPost[] = [];
    try {
      // `selftext` gövdede geçen kelimeyi arayan indeksli alan; `title` sorgusu
      // zaman aşımına uğradığı için gövde taranır, sonuç istemcide süzülür.
      const url = `${ARCTIC_BASE}/posts/search?subreddit=${sub}&selftext=${encodeURIComponent(words[0])}&limit=30`;
      const json = await grabJson<{ data?: ArcticPost[] }>(url, 5_000);
      rows = json.data ?? [];
    } catch {
      await sleep(200);
      continue; // bu alt topluluk için sonuç yok, sıradakine geç
    }
    for (const post of rows) {
      const title = String(post.title ?? "").trim();
      if (!title || seen.has(title)) continue;
      // Yalnız GERÇEKTEN nişle ilgili başlıklar alınır (kelime eşleşmesi).
      if (!words.some((w) => title.toLowerCase().includes(w))) continue;
      seen.add(title);
      out.push({
        title: title.slice(0, 180),
        subreddit: String(post.subreddit ?? sub),
        score: Number(post.score ?? 0),
        comments: Number(post.num_comments ?? 0),
        url: `https://reddit.com${String(post.permalink ?? "")}`,
        complaint: isComplaintTitle(title),
      });
    }
    if (out.length >= 12) break;
  }
  // Önce en çok konuşulanlar; aynı ses yoğunluğunda şikâyetler öne çıkar.
  return out.sort((a, b) => b.score + b.comments - (a.score + a.comments)).slice(0, 12);
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

/**
 * GÖZLENEN perakende fiyatları — ÜÇ bağımsız kaynak paralel denenir.
 *
 * Neden üç kaynak: ölçüldü ki hiçbiri tek başına güvenilir değil.
 * DuckDuckGo bu sunucudan aralıklı `202` + bot-guard dönüyor, Amazon bot
 * koruması sayfayı ürünsüzleştiriyor, Bing News ise fiyatı nadiren taşıyor
 * ama hiç ölü değil. Tek kaynağa bağlı kalmak fiyat kanıtının rastgele
 * kaybolmasına yol açıyordu (0 ilan → medyan `null` → CFO ve fiyat stratejisti
 * ajanları kanıtsız kalıyordu). Şimdi kaynaklar birleştirilir.
 */
async function scrapePrices(niche: string, country: string): Promise<PriceSample[]> {
  const [ddg, amazon, bing] = await Promise.allSettled([
    scrapeMarketplaceSellers(niche.slice(0, 60), country),
    scrapeAmazonRetailPrices(),
    scrapeBingPriceSignals(niche.slice(0, 60)),
  ]);

  const fx = await eurToUsdRate();
  const out: PriceSample[] = [];

  for (const s of ddg.status === "fulfilled" ? ddg.value : []) {
    // Fiyatı olmayan sonuç uydurulmaz; yalnız gerçek fiyatlı olan alınır.
    if (Number.isFinite(s.price_usd) && s.price_usd > 0) {
      out.push({ platform: s.platform || "Marketplace", priceUsd: s.price_usd });
    }
  }

  for (const a of amazon.status === "fulfilled" ? amazon.value.samples : []) {
    // Kur ölçülebiliyorsa USD'ye çevrilir; ölçülemiyorsa fiyat AYNEN alınır ve
    // para birimi korunur (yanlış çarpan, çevrilmemiş fiyattan kötüdür).
    const usd =
      a.currency === "USD" ? a.price : a.currency === "EUR" && fx ? a.price * fx.rate : a.price;
    out.push({ platform: `Amazon (${a.currency})`, priceUsd: Math.round(usd * 100) / 100 });
  }

  for (const b of bing.status === "fulfilled" ? bing.value : []) {
    if (Number.isFinite(b.price_usd) && b.price_usd > 0) {
      out.push({ platform: "Haber (gözlenen fiyat)", priceUsd: b.price_usd });
    }
  }

  return out.slice(0, 16);
}

/* ------------------------------------------------------------- 5. Radar */

const RADAR_SOURCES = ["Google", "Amazon", "TikTok", "Yandex", "RSS", "GitHub"] as const;

type RadarJob = {
  trends: { source: string; trend_name: string }[];
  statuses: { source: string; status: "active" | "error"; items: number }[];
};

/* ------------------------------------------------------------------ ana */

/**
 * Kaynak başına bütçe (ms) — canlı ölçümlere göre, en yavağa en geniş pay.
 *
 * ÖLÇÜM (bu repo üzerinden canlı, `runScrapeJob` dahil):
 *   Hacker News 300 ms · Google News RSS 40-450 ms · fiyat ~1.4 sn
 *   (bot-guard beklemesiyle) · GitHub 380 ms · AliExpress 900 ms + 750 KB ·
 *   **Radar 8.6 sn** (6 kaynak; ölçüldü, 68 trend üretir) ·
 *   Reddit arşivi 5-8.7 sn · Google Trends 429 (hızlı hata).
 *
 * NOT: Ham uç noktalar 731 ms'de dönüyor ama `runScrapeJob` içindeki
 * dönüşüm/normalizasyon katmanı toplamı 8.6 sn'e çıkarıyor. Tavan bu ölçüme
 * göre 10 sn; Faz 0'ın genel tavanı 9 sn olduğu için radar KISMİ sonuç
 * döndürse bile diğer kaynaklar etkilenmez.
 */
const SOURCE_BUDGET_MS = {
  trends: 2_500, // 429 → hızlı hata (80 ms)
  reddit: 6_000, // 5-8.7 sn ölçüldü; 6 sn'de kesilir, diğer kanıt yaşar
  hackerNews: 3_000, // ~300 ms
  news: 3_000, // 40-450 ms
  prices: 4_000, // 3 kaynak + bot-guard beklemesi ~1.4 sn
  radar: 10_000, // ölçülen 8.6 sn → 68 satır kazanç
  github: 3_000, // 380 ms
  supplier: 6_000, // 850 ms + 750 KB indirme
} as const;

/**
 * FAZ 0 — niş kazıması.
 *
 * Tüm kaynaklar AYNI anda koşar ve HER BİRİ kendi tavanına sahiptir: yavaş ya
 * da ölü bir kaynak yalnızca kendi satırını `error` yapar, diğer kaynakların
 * kanıtını silmez. Genel `budgetMs` tavanı ise tüm zincirin son emniyet
 * ağıdır ve dolduğunda dürüstçe `harvest_incomplete` notuyla kısmi sonuç verir.
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
        SOURCE_BUDGET_MS.trends,
      ),
      collect(
        "Reddit arşivi",
        () => scrapeReddit(niche),
        (r) => r.length,
        statuses,
        SOURCE_BUDGET_MS.reddit,
      ),
      collect(
        "Hacker News",
        () => scrapeHackerNews(niche),
        (h) => h.length,
        statuses,
        SOURCE_BUDGET_MS.hackerNews,
      ),
      collect(
        "Google News",
        () => scrapeNews(niche, country),
        (n) => n.length,
        statuses,
        SOURCE_BUDGET_MS.news,
      ),
      collect(
        "Marketplace prices",
        () => scrapePrices(niche, country),
        (p) => p.length,
        statuses,
        SOURCE_BUDGET_MS.prices,
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
        SOURCE_BUDGET_MS.radar,
      ),
      collect(
        "GitHub",
        () => fetchGitHubTrendsForNiche(niche),
        (g) => g.length,
        statuses,
        SOURCE_BUDGET_MS.github,
      ),
      collect(
        "Supplier pricing",
        // Fiyat bilinmiyor; kaynak tahmini dönerse `live:false` ile işaretlenir.
        () => getSourcingEstimate(niche, 40),
        (s) => (s.source === "aliexpress" ? 1 : 0),
        statuses,
        SOURCE_BUDGET_MS.supplier,
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
            // Tedarik ajanı "ölçülen mi, tahmin mi" ayrımını ve para birimini
            // görebilmeli; %28'lik kural tahminiyle canlı fiyatı ayırt etmesin.
            samples: supplier.samples ?? 0,
            currency: supplier.currency ?? "USD",
            fxRate: supplier.fx_rate ?? null,
            fxSource: supplier.fx_source ?? "",
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

  // Genel tavan SON EMNİYET AĞIDIR. Kaynak başına tavanlar sayesinde buraya
  // normalde ulaşılmaz; ulaşılırsa elde edilen KISMİ kanıt korunur. Önceki
  // hâlde buraya ulaşılınca `emptyNicheSignals()` dönüyor, yani 8 saniyelik
  // yavaş bir Reddit sorgusu çalışan Hacker News + Google News + GitHub
  // kanıtının tamamını siliyordu. Şimdi o satırlar `harvest_incomplete` notuyla
  // boş bırakılır ve elde edilen her şey korunur.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NicheSignals>((resolve) => {
    timer = setTimeout(
      () => {
        statuses.push({
          name: "Harvest budget",
          status: "error",
          items: 0,
          detail: `budget>${budgetMs}ms`,
        });
        resolve(
          NicheSignalsSchema.parse({
            niche,
            country,
            platform,
            collectedAt: new Date().toISOString(),
            sources: statuses,
            live: statuses.some((s) => s.status === "active" && s.items > 0),
          }),
        );
      },
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
