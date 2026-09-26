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

/* ------------------------------------------------------- Free FX (EUR→USD) */

/**
 * ÇAKIŞMA ÖNLEYİCİ: AliExpress her ülkeden farklı para biriminde fiyat
 * döndürüyor (bu sunucudan EUR geliyor). Kaynağın kendi sembolünü ($10.52,
 * `currencyCode:"USD"`) okumadan **sabit bir kuruş çarpanı** uydurmak, tedarik
 * ajanının marjı tamamen yanlış hesaplamasına yol açar. Bu yüzden kuruş
 * çarpanı ÖLÇÜLMEK zorundadır.
 *
 * Kaynaklar sırayla denenir; hepsi 12 saatlik önbellekten gelir. Hiçbiri
 * yanıt vermezse `null` döner ve çağıran taraf fiyatı **çevirmeden** bırakıp
 * para birimini açıkça belirtir — yanlış bir çarpan, dönüştürülmemiş bir
 * fiyattan daha kötüdür.
 */
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let fxCache: { rate: number; at: number; source: string } | null = null;

const FX_ENDPOINTS: readonly {
  url: string;
  parse: (json: unknown) => number | null;
  name: string;
}[] = [
  {
    name: "frankfurter.app",
    url: "https://api.frankfurter.app/latest?from=EUR&to=USD",
    parse: (json) => {
      const rates = (json as { rates?: { USD?: number } } | null)?.rates;
      return typeof rates?.USD === "number" && rates.USD > 0 ? rates.USD : null;
    },
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/EUR",
    parse: (json) => {
      const rates = (json as { rates?: { USD?: number } } | null)?.rates;
      return typeof rates?.USD === "number" && rates.USD > 0 ? rates.USD : null;
    },
  },
];

/** Ölçülmüş EUR→USD kuruş çarpanı; ölçülemiyorsa `null` (uydurma yok). */
export async function eurToUsdRate(): Promise<{ rate: number; source: string } | null> {
  if (fxCache && Date.now() - fxCache.at < FX_CACHE_TTL_MS)
    return { rate: fxCache.rate, source: fxCache.source };
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await timedFetch(
        endpoint.url,
        { headers: { accept: "application/json" } },
        4_000,
      );
      if (!res.ok) continue;
      const rate = endpoint.parse(await res.json());
      if (rate && rate > 0.2 && rate < 5) {
        fxCache = { rate, at: Date.now(), source: endpoint.name };
        return { rate, source: endpoint.name };
      }
    } catch {
      // Sonraki kaynağa geç; hepsi ölürse `null` döner.
    }
  }
  return null;
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

/** Deterministik pseudo-series — yalnız SPARKLINE görselleştirme içindir. */
function estimatedSeries(keyword: string, n: number): number[] {
  let h = 0;
  for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return Array.from({ length: n }, (_, i) => {
    const wave = Math.sin((i / n) * Math.PI * 2 + (h % 17)) * 18;
    const drift = (i / n) * ((h % 23) - 8);
    return Math.max(4, Math.min(100, Math.round(52 + wave + drift + ((h >> (i % 7)) % 9))));
  });
}

/** Yalnız İSTEMCİ tarafındaki boş grafik için; sunucu kanıtına GİRMEZ. */
export function sparklineForPreview(keyword: string, n = 12): number[] {
  return estimatedSeries(keyword.slice(0, 80), n);
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
    // DÜRÜSTLÜK: Google Trends 429/403 verdiğinde `estimatedSeries` ile bir seri
    // UYDURMAK, 14 ajanın tamamına "ölçülmüş ilgi" diye yalan söylemekti.
    // Bunun yerine boş seri + `estimated` döner; Faz 0 bu bayrağı görüp trend
    // satırlarını kanıta katmaz ve ajan "VERİ YOK" deyip nötr puanlar.
    return finalize(kw, geo, [], [], "estimated");
  }
}

function finalize(
  keyword: string,
  geo: string,
  yearly: number[],
  monthly: number[],
  source: TrendSeries["source"],
): TrendSeries {
  // Boş seri (kaynak ölü) → momentum ÜRETİLMEZ. `0`, "ölçtük ve sıfır bulduk"
  // anlamına gelir ve ajanları yanlış yönlendirirdi; NaN yerine boş kalırsa
  // çağıran taraf `null` olarak "VERİ YOK" der.
  if (yearly.length === 0) {
    return { keyword, geo, yearly: [], monthly: [], momentum_pct: Number.NaN, source };
  }
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
  /** Ölçülen kur çarpanı ve fiyatın orijinal para birimi (şeffaflık için). */
  currency?: string;
  fx_rate?: number;
  fx_source?: string;
  /** Kaç ilan okundu — 3'ten azsa tahmin sayılmaz, tahmine düşülür. */
  samples?: number;
};

/**
 * AliExpress tedarik fiyatı — GERÇEK, yapılandırılmış alanlardan.
 *
 * ÖNCEKİ HALİ HATALIYDI: sayfadaki `US $12.34` kalıbını arıyordu, ama sayfa
 * `{"minPrice":118.74,"formattedPrice":"€118,74","currencyCode":"EUR"}`
 * yapısında döndüğü için **hiç eşleşme olmuyor** ve her zaman uydurma
 * tahmine (`%28`) düşüyordu. Ölçülen tedarik maliyeti sanılan %28 kuralı
 * CFO ve tedarik ajanlarının marj hesabını tamamen yanlış gösteriyordu.
 *
 * Şimdi: gerçek `minPrice` alanları okunur, para birimi **kaynaktan** alınır
 * ve gerekiyorsa ölçülmüş kurla USD'ye çevrilir. Kur alınamazsa fiyat
 * olduğu gibi döner (`currency` alanı bunu açıkça söyler) — asla uydurma
 * çarpan kullanılmaz.
 */
export async function getSourcingEstimate(
  keyword: string,
  sellingPriceUsd: number,
): Promise<SourcingEstimate> {
  const fallback = (): SourcingEstimate => ({
    supplier_price_usd: Math.max(1, Math.round(sellingPriceUsd * 0.28 * 100) / 100),
    shipping_usd: Math.max(1.5, Math.round(sellingPriceUsd * 0.08 * 100) / 100),
    source: "estimated",
    sample_title: "",
    currency: "USD",
    samples: 0,
  });
  try {
    const res = await timedFetch(
      `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(keyword.slice(0, 60)).replace(/%20/g, "-")}.html`,
      { headers: { accept: "text/html" } },
      8000,
    );
    if (!res.ok) return fallback();
    // Sayfa ~750 KB; fiyat alanları başın içinde, 400 KB'a güvenli.
    const html = (await res.text()).slice(0, 900_000);

    // GERÇEK yapı: "minPrice":118.74 — her satır bir ürünün fiyatıdır.
    const raw = [...html.matchAll(/"minPrice"\s*:\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0.5 && n < 5000);
    if (raw.length < 3) return fallback();

    // Para birimi kaynaktan okunur (bu sunucudan "EUR", ABD'den "USD").
    const currency = /"currencyCode"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1]?.toUpperCase() ?? "USD";
    const toUsd = async (value: number): Promise<number> => {
      if (currency === "USD") return value;
      if (currency === "EUR") {
        const fx = await eurToUsdRate();
        return fx ? value * fx.rate : value;
      }
      // Bilinmeyen para birimi: çevirme YAPMA, kuruş çarpanı uydurma.
      return value;
    };

    raw.sort((a, b) => a - b);
    const medianNative = raw[Math.floor(raw.length / 2)];
    const medianUsd = await toUsd(medianNative);
    const title = /<title>([^<]{3,120})<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    const fx = currency === "USD" ? null : await eurToUsdRate();
    return {
      supplier_price_usd: Math.round(medianUsd * 100) / 100,
      // Navlun ürün fiyatıyla orantılı; toplam maliyet ayrı satırda raporlanır.
      shipping_usd: Math.max(1.5, Math.round(medianUsd * 0.25 * 100) / 100),
      source: "aliexpress",
      sample_title: title,
      currency,
      samples: raw.length,
      ...(fx && currency === "EUR"
        ? { fx_rate: Math.round(fx.rate * 10_000) / 10_000, fx_source: fx.source }
        : {}),
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
  const empty: ProductPhysical = {
    found: false,
    name: "",
    weight_g: null,
    dimensions: null,
    categories: "",
  };
  if (!/^[0-9]{6,14}$/.test(barcode)) return empty;
  try {
    const res = await timedFetch(
      `https://world.openproductsfacts.org/api/v2/product/${barcode}?fields=product_name,quantity,product_quantity,categories,packaging`,
    );
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        quantity?: string;
        product_quantity?: string;
        categories?: string;
        packaging?: string;
      };
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
  const key = process.env["OPEN_PAGERANK_KEY"];
  const list = [...new Set(domains.filter(Boolean))].slice(0, 20);
  if (!key || !list.length) return {};
  try {
    const qs = list.map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
    const res = await timedFetch(`https://openpagerank.com/api/v1.0/getPageRank?${qs}`, {
      headers: { "API-OPR": key },
    });
    if (!res.ok) return {};
    const json = (await res.json()) as {
      response?: { domain?: string; page_rank_decimal?: number }[];
    };
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

export type ScrapedSeller = {
  seller: string;
  domain: string;
  platform: string;
  price_usd: number;
  url: string;
  /** Varsa kaynağın verdiği ham başlık (haber kaynakları için anlamlı). */
  title?: string;
};

const PLATFORM_BY_HOST: [RegExp, string][] = [
  [/amazon\./i, "Amazon"],
  [/ebay\./i, "eBay"],
  [/etsy\./i, "Etsy"],
  [/walmart\./i, "Walmart"],
  [/aliexpress\./i, "AliExpress"],
  [/myshopify\.com/i, "Shopify"],
  [/temu\./i, "Temu"],
  [/trendyol\./i, "Trendyol"],
  [/hepsiburada\./i, "Hepsiburada"],
];

function platformOf(host: string): string {
  for (const [re, name] of PLATFORM_BY_HOST) if (re.test(host)) return name;
  return "Bağımsız mağaza";
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Mağaza/host eşleşmesi — sayısal alan bulunmazsa bu sonuç ATILIR. */
function priceFrom(text: string): number {
  const match = /(?:US\s?\$|\$|USD|EUR|€|GBP|£)\s?([0-9]{1,5}(?:[.,][0-9]{2})?)/.exec(text);
  if (!match) return 0;
  const n = Number(match[1].replace(",", "."));
  // Uydurma aralık dışı: 0.01 veya 99.000 $ bir perakende fiyatı değildir.
  if (!Number.isFinite(n) || n < 1 || n > 4000) return 0;
  return n;
}

/**
 * Amazon kategori "çok satanlar" sayfasından perakende fiyat + yıldız okur.
 *
 * NEDEN VAR: `html.duckduckgo.com` bu sunucudan sık sık HTTP 202 + bot-guard
 * döndürüyor; o zaman `scrapeMarketplaceSellers` boş dönüyor ve perakende fiyat
 * kanıtı kayboluyor. Amazon ikinci kaynak olarak denenir.
 *
 * DÜRÜSTLÜK VE KIRILGANLIK UYARISI: Amazon bot koruması sık sık devreye
 * girip sayfayı ürünsüz döndürür (ölçüldü: 332 KB geliyor ama 0 ürün, 0 fiyat).
 * Bu yüzden fonksiyon **asla hata fırlatmaz**; kırılgan bir kaynak olduğu
 * yorumda yazılıdır ve Faz 0'daki "her kaynak ölü olabilir" sözleşmesine
 * uyar. Kur ölçülemezse fiyat olduğu gibi döner, kuruş çarpanı uydurulmaz.
 */
export async function scrapeAmazonRetailPrices(
  categoryId = "258639011",
): Promise<{ samples: { price: number; currency: string; title: string; rating: number }[] }> {
  try {
    const res = await timedFetch(
      `https://www.amazon.com/gp/bestsellers/electronics/${categoryId}/`,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,*/*",
          "accept-language": "en-US,en;q=0.9",
          "upgrade-insecure-requests": "1",
        },
      },
      6_000,
    );
    if (!res.ok) return { samples: [] };
    // Sayfa ~330 KB; ürün kartları bu aralıkta.
    const body = (await res.text()).slice(0, 700_000);
    const currency =
      /_cDEzb_p13n-sc-price_[A-Za-z0-9]+"[^>]*>\s*([A-Z]{3})\s/.exec(body)?.[1]?.toUpperCase() ??
      "USD";

    const samples: { price: number; currency: string; title: string; rating: number }[] = [];
    for (const m of body.matchAll(
      /_cDEzb_p13n-sc-price_[A-Za-z0-9]+"[^>]*>\s*(?:US\s?)?(?:USD|EUR|GBP|\$|€|£)\s?([0-9]{1,5}(?:[.,][0-9]{2})?)/g,
    )) {
      const price = Number(m[1].replace(",", "."));
      if (!Number.isFinite(price) || price < 1 || price > 4000) continue;
      const before = body.slice(Math.max(0, (m.index ?? 0) - 1_500), m.index ?? 0);
      const title = [...before.matchAll(/aria-label="([^"]{10,120})"/g)].map((x) => x[1]).pop();
      const rating = Number(/([0-5](?:\.[0-9])?)\s*out of 5 stars/.exec(before)?.[1] ?? 0);
      samples.push({
        price: Math.round(price * 100) / 100,
        currency,
        title: (title ?? "Amazon çok satanlar").slice(0, 120),
        rating: Number.isFinite(rating) ? rating : 0,
      });
      if (samples.length >= 12) break;
    }
    return { samples };
  } catch {
    return { samples: [] };
  }
}

/**
 * Bing News RSS — nişe özel, GÖZLENEN fiyat sinyali.
 *
 * NEDEN: ölçüldü ki ne DuckDuckGo ne de Amazon bu sunucudan güvenilir ürün
 * fiyatı veriyor (DDG `202` bot-guard, Amazon ürünsüz sayfa). Bing News RSS
 * ise sabit çalışıyor ve haber başlıklarında ürün fiyatını taşıyor
 * ("$69 air fryer", "Yoga Mats You Can Buy For $30"). Bu bir fiyat TABLOSU
 * değil, nişte konuşulan GERÇEK fiyat noktalarıdır; ajanlara "fiyat aralığı
 * bu kadar" sinyalini verirken sınırı yorumda yazılıdır.
 */
export async function scrapeBingPriceSignals(query: string): Promise<ScrapedSeller[]> {
  try {
    const res = await timedFetch(
      `https://www.bing.com/news/search?q=${encodeURIComponent(`"${query.slice(0, 60)}"`)}&format=RSS`,
      { headers: { accept: "application/rss+xml,application/xml,*/*" } },
      5_000,
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.split(/<item[\s>]/).slice(1, 12);
    const out: ScrapedSeller[] = [];
    for (const b of blocks) {
      const text = b
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ");
      const price = priceFrom(text);
      // Fiyatı olmayan haber ürün fiyatı kanıtı DEĞİLDİR; atlanır.
      if (!price) continue;
      const title = /<title>([\s\S]*?)<\/title>/.exec(b)?.[1]?.trim() ?? "";
      const link = /<link>([\s\S]*?)<\/link>/.exec(b)?.[1]?.trim() ?? "";
      out.push({
        seller: "Bing News",
        domain: "bing.com",
        platform: "Haber fiyatı",
        price_usd: price,
        url: link,
        title: decode(title).slice(0, 120),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Ücretsiz perakende fiyat kazıması — GERÇEK, GÖZLENMİŞ fiyatlar.
 *
 * ÖNCEKİ HALİ ÜÇ AYRI YANLIŞ YAPIYORDU:
 *  1) `POST` gönderiyordu; DuckDuckGo POST'a `202` + bot-guard sayfası
 *     döndürüyor, bu yüzden `res.ok` doğru olsa bile `class="result` bloğu
 *     hiç bulunamıyor ve sonuç **sessizce boş** dönüyordu.
 *  2) Blok ayracı `class="result results_links` idi; gerçek HTML'de sınıf
 *     sırası farklı olduğu için yine eşleşme olmuyordu.
 *  3) Fiyat regex'i İLK 4000 baytta arıyordu; snippet genelde 4 KB sonrasında.
 *
 * Şimdi: çalışan `GET` + doğru blok ayracı + **bot-guard için kısa bekleme
 * ile bir kez tekrar**. Fiyatı olmayan sonuç uydurulmaz; `price_usd: 0` döner
 * ve çağıran taraf bunu "bilinmiyor" diye okur.
 */
export async function scrapeMarketplaceSellers(
  query: string,
  country: string,
): Promise<ScrapedSeller[]> {
  const region = geoOf(country).toLowerCase();
  const q = `${query} buy price`;
  const url =
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` +
    (region ? `&kl=${encodeURIComponent(`${region}-${region}`)}` : "");

  // Bot-guard `202` döndüğünde sayfa boş gelir; kısa bir bekleme sonrası tek
  // deneme daha yapılır. Ölçüldü: ilk istek 202, ~1.2 sn sonra 200 dönüyor.
  let html = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1_200));
    }
    try {
      const res = await timedFetch(url, { headers: { accept: "text/html" } }, 6_000);
      if (!res.ok) continue;
      const candidate = await res.text();
      // `202` bot-guard sayfasında sonuç bloğu bulunmaz; atlanır.
      if (candidate.includes("result__a")) {
        html = candidate;
        break;
      }
    } catch {
      // Sonraki denemeye geç; en sonunda boş döner.
    }
  }
  if (!html) return [];

  // Sonuçları link üzerinden ayır; her blokta hem başlık hem snippet var.
  const blocks = html.split(/result__a/).slice(1, 26);
  const out: ScrapedSeller[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const href = /href="([^"]+)"/.exec(b)?.[1] ?? "";
    const raw = decodeURIComponent(/uddg=([^&"]+)/.exec(href)?.[1] ?? href);
    if (!raw) continue;
    let host = "";
    try {
      host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(
        /^www\./,
        "",
      );
    } catch {
      continue;
    }
    if (!host || host.includes("duckduckgo")) continue;
    if (seen.has(host)) continue;
    seen.add(host);

    // Fiyat yalnız bu bloğun görünen metninden okunur (uydurma yok).
    const visible = decode(b.slice(0, 1_200));
    out.push({
      seller: host.split(".")[0].replace(/^\w/, (m) => m.toUpperCase()),
      domain: host,
      platform: platformOf(host),
      price_usd: priceFrom(visible),
      url: raw,
    });
    if (out.length >= 12) break;
  }
  return out;
}
