// Server-only integrations with FREE external data sources.
// Every helper degrades gracefully: on failure it returns null/[] so the
// AI pipeline and UI keep working without the external source.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function timedFetch(url: string, init: RequestInit = {}, ms = 7000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

const ISO: Record<string, string> = { GLOBAL: "", UK: "GB" };
const geoOf = (code: string) => ISO[(code || "").toUpperCase()] ?? (code || "").toUpperCase();

/* ------------------------------------------------------------------ Trends */

export type TrendSeries = {
  keyword: string;
  geo: string;
  /** 12-month interest values, 0-100. */
  yearly: number[];
  /** 30-day interest values, 0-100. */
  monthly: number[];
  momentum_pct: number;
  source: "google-trends" | "estimated";
};

function stripGuard(text: string): unknown {
  const i = text.indexOf("{");
  return i < 0 ? null : JSON.parse(text.slice(i));
}

async function trendSeries(keyword: string, geo: string, time: string): Promise<number[]> {
  const req = {
    comparisonItem: [{ keyword, geo, time }],
    category: 0,
    property: "",
  };
  const explore = await timedFetch(
    `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(req))}`,
  );
  if (!explore.ok) throw new Error("trends explore " + explore.status);
  const parsed = stripGuard(await explore.text()) as {
    widgets?: { id?: string; token?: string; request?: unknown }[];
  } | null;
  const w = parsed?.widgets?.find((x) => x.id === "TIMESERIES");
  if (!w?.token || !w.request) throw new Error("no timeseries widget");

  const data = await timedFetch(
    `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(w.request),
    )}&token=${encodeURIComponent(w.token)}`,
  );
  if (!data.ok) throw new Error("trends data " + data.status);
  const json = stripGuard(await data.text()) as {
    default?: { timelineData?: { value?: number[] }[] };
  } | null;
  const points = (json?.default?.timelineData ?? [])
    .map((p) => Number(p.value?.[0] ?? 0))
    .filter((n) => Number.isFinite(n));
  if (!points.length) throw new Error("empty series");
  return points;
}

/** Deterministic pseudo-series so the UI always has a sparkline. */
function estimatedSeries(keyword: string, n: number): number[] {
  let h = 0;
  for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return Array.from({ length: n }, (_, i) => {
    const wave = Math.sin((i / n) * Math.PI * 2 + (h % 17)) * 18;
    const drift = (i / n) * ((h % 23) - 8);
    return Math.max(4, Math.min(100, Math.round(52 + wave + drift + ((h >> (i % 7)) % 9))));
  });
}

function downsample(v: number[], n: number): number[] {
  if (v.length <= n) return v;
  const step = v.length / n;
  return Array.from({ length: n }, (_, i) => v[Math.floor(i * step)]);
}

export async function getGoogleTrends(keyword: string, country: string): Promise<TrendSeries> {
  const geo = geoOf(country);
  const kw = keyword.slice(0, 80);
  try {
    const [yearly, monthly] = await Promise.all([
      trendSeries(kw, geo, "today 12-m"),
      trendSeries(kw, geo, "today 1-m"),
    ]);
    return finalize(kw, geo, downsample(yearly, 52), downsample(monthly, 30), "google-trends");
  } catch {
    return finalize(kw, geo, estimatedSeries(kw, 52), estimatedSeries(kw + "30d", 30), "estimated");
  }
}

function finalize(
  keyword: string, geo: string, yearly: number[], monthly: number[],
  source: TrendSeries["source"],
): TrendSeries {
  const half = Math.max(1, Math.floor(monthly.length / 2));
  const first = monthly.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const last = monthly.slice(-half).reduce((a, b) => a + b, 0) / half;
  const momentum = first > 0 ? ((last - first) / first) * 100 : 0;
  return { keyword, geo, yearly, monthly, momentum_pct: Math.round(momentum), source };
}

/* -------------------------------------------------------- Supplier sourcing */

export type SourcingEstimate = {
  supplier_price_usd: number;
  shipping_usd: number;
  source: "aliexpress" | "estimated";
  sample_title: string;
};

/** AliExpress price discovery (public search JSON-ish page), with heuristic fallback. */
export async function getSourcingEstimate(
  keyword: string, sellingPriceUsd: number,
): Promise<SourcingEstimate> {
  const fallback = (): SourcingEstimate => ({
    supplier_price_usd: Math.max(1, Math.round(sellingPriceUsd * 0.28 * 100) / 100),
    shipping_usd: Math.max(1.5, Math.round(sellingPriceUsd * 0.08 * 100) / 100),
    source: "estimated",
    sample_title: "",
  });
  try {
    const res = await timedFetch(
      `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(keyword.slice(0, 60)).replace(/%20/g, "-")}.html`,
      { headers: { accept: "text/html" } },
      8000,
    );
    if (!res.ok) return fallback();
    const html = (await res.text()).slice(0, 400_000);
    const prices = [...html.matchAll(/US\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0.5 && n < 5000)
      .slice(0, 20)
      .sort((a, b) => a - b);
    if (prices.length < 3) return fallback();
    const median = prices[Math.floor(prices.length / 2)];
    const title = /<title>([^<]{3,120})<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    return {
      supplier_price_usd: Math.round(median * 100) / 100,
      shipping_usd: Math.max(1.5, Math.round(median * 0.25 * 100) / 100),
      source: "aliexpress",
      sample_title: title,
    };
  } catch {
    return fallback();
  }
}

/* --------------------------------------------------- Open Products Facts */

export type ProductPhysical = {
  found: boolean;
  name: string;
  weight_g: number | null;
  dimensions: string | null;
  categories: string;
};

export async function getProductPhysical(barcode: string): Promise<ProductPhysical> {
  const empty: ProductPhysical = { found: false, name: "", weight_g: null, dimensions: null, categories: "" };
  if (!/^[0-9]{6,14}$/.test(barcode)) return empty;
  try {
    const res = await timedFetch(
      `https://world.openproductsfacts.org/api/v2/product/${barcode}?fields=product_name,quantity,product_quantity,categories,packaging`,
    );
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      status?: number;
      product?: { product_name?: string; quantity?: string; product_quantity?: string; categories?: string; packaging?: string };
    };
    const p = json.product;
    if (!p) return empty;
    const grams = Number(p.product_quantity);
    return {
      found: true,
      name: p.product_name ?? "",
      weight_g: Number.isFinite(grams) && grams > 0 ? grams : null,
      dimensions: p.quantity ?? p.packaging ?? null,
      categories: p.categories ?? "",
    };
  } catch {
    return empty;
  }
}

/* ------------------------------------------------------------ Open PageRank */

export async function getDomainRanks(domains: string[]): Promise<Record<string, number>> {
  const key = process.env['OPEN_PAGERANK_KEY'];
  const list = [...new Set(domains.filter(Boolean))].slice(0, 20);
  if (!key || !list.length) return {};
  try {
    const qs = list.map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
    const res = await timedFetch(`https://openpagerank.com/api/v1.0/getPageRank?${qs}`, {
      headers: { "API-OPR": key },
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { response?: { domain?: string; page_rank_decimal?: number }[] };
    const out: Record<string, number> = {};
    for (const r of json.response ?? []) {
      if (r.domain) out[r.domain] = Number(r.page_rank_decimal) || 0;
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------- Lightweight marketplace scraper */

export type ScrapedSeller = { seller: string; domain: string; platform: string; price_usd: number; url: string };

const PLATFORM_BY_HOST: [RegExp, string][] = [
  [/amazon\./i, "Amazon"], [/ebay\./i, "eBay"], [/etsy\./i, "Etsy"],
  [/walmart\./i, "Walmart"], [/aliexpress\./i, "AliExpress"], [/myshopify\.com/i, "Shopify"],
  [/temu\./i, "Temu"], [/trendyol\./i, "Trendyol"], [/hepsiburada\./i, "Hepsiburada"],
];

function platformOf(host: string): string {
  for (const [re, name] of PLATFORM_BY_HOST) if (re.test(host)) return name;
  return "Bağımsız mağaza";
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .trim();
}

/** Free DuckDuckGo HTML search — top marketplace listings without SerpAPI. */
export async function scrapeMarketplaceSellers(query: string, country: string): Promise<ScrapedSeller[]> {
  const region = geoOf(country).toLowerCase();
  const q = `${query} buy price`;
  try {
    const res = await timedFetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ q, kl: region ? `${region}-${region}` : "us-en" }).toString(),
    }, 9000);
    if (!res.ok) return [];
    const html = await res.text();
    const blocks = html.split('class="result results_links').slice(1, 25);
    const out: ScrapedSeller[] = [];
    for (const b of blocks) {
      const href = /result__a[^>]+href="([^"]+)"/.exec(b)?.[1] ?? "";
      const raw = decodeURIComponent(/uddg=([^&"]+)/.exec(href)?.[1] ?? href);
      let host = "";
      try { host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { continue; }
      if (!host || host.includes("duckduckgo")) continue;
      const snippet = decode(b.slice(0, 4000));
      const price = Number(/[$€£]\s*([0-9]{1,4}(?:[.,][0-9]{2})?)/.exec(snippet)?.[1]?.replace(",", "."));
      if (out.some((s) => s.domain === host)) continue;
      out.push({
        seller: host.split(".")[0].replace(/^\w/, (m) => m.toUpperCase()),
        domain: host,
        platform: platformOf(host),
        price_usd: Number.isFinite(price) ? price : 0,
        url: raw,
      });
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return [];
  }
}
