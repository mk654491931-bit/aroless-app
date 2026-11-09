// ============================================================================
// HIDROJEN10 — saf veri sözleşmesi (tarayıcı + sunucu).
//
// Bu dosya AĞA ÇIKMAZ, DB OKUMAZ, AI ÇAĞIRMAZ. Niş anahtarı, pazar kataloğu,
// cache tazeliği ve arayüzün kullandığı ürün/teklif tipleri burada tek yerde
// tanımlanır. Sunucu tarafı (scrape + Supabase) `hydrogen10-store.server.ts`
// ve `hydrogen10.functions.ts` içindedir.
//
// DÜRÜSTLÜK KURALI: ölçülmemiş fiyat/puan/stok `null` kalır. `0` yalnız
// gerçekten sıfır ölçüldüğünde kullanılır. Bu yüzden tipler `number | null`
// ve `boolean | null`; arayüzde `—` ile gösterilir.
// ============================================================================

import { TARGET_COUNTRIES } from "./countries";

export const H10_SCHEMA_VERSION = 1;
export const H10_CACHE_HOURS = 24;
export const H10_CACHE_MS = H10_CACHE_HOURS * 60 * 60 * 1000;
export const H10_MAX_QUERY_LENGTH = 160;

/* --------------------------------------------------------------- Pazar */

export type H10Country = {
  code: string;
  label: string;
  flag: string;
  currency: string;
};

/**
 * Ülke kataloğu — mevcut `TARGET_COUNTRIES` tek kaynaktır.
 *
 * `GLOBAL` bir ülke değildir; anahtara giremez. Mevcut ürün bulucuda "UK"
 * yazımı kullanılıyor ama ISO kodu `GB`; cache anahtarı ve kaynak adaptörleri
 * GB beklediği için burada dönüştürülür.
 */
export const H10_COUNTRIES: H10Country[] = TARGET_COUNTRIES.filter(
  (country) => country.code !== "GLOBAL",
).map((country) => ({
  code: country.code === "UK" ? "GB" : country.code,
  label: country.code === "UK" ? "United Kingdom (GB)" : country.label,
  flag: country.flag,
  currency: country.currency,
}));

export const H10_DEFAULT_COUNTRY = "US";

export type H10Platform = {
  id: string;
  label: string;
};

export const H10_PLATFORMS: H10Platform[] = [
  { id: "general", label: "Genel (tüm pazaryerleri)" },
  { id: "amazon", label: "Amazon" },
  { id: "walmart", label: "Walmart" },
  { id: "ebay", label: "eBay" },
  { id: "trendyol", label: "Trendyol" },
  { id: "hepsiburada", label: "Hepsiburada" },
  { id: "n11", label: "n11" },
  { id: "aliexpress", label: "AliExpress" },
  { id: "etsy", label: "Etsy" },
  { id: "tiktok_shop", label: "TikTok Shop" },
  { id: "shopify", label: "Shopify" },
  { id: "woocommerce", label: "WooCommerce" },
];

export const H10_DEFAULT_PLATFORM = "general";

/** Ülke kodunu ISO alpha-2'ye indirger; bilinmiyorsa varsayılana döner. */
export function normalizeH10Country(input: unknown): H10Country {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase();
  const code = raw === "UK" ? "GB" : raw;
  return (
    H10_COUNTRIES.find((country) => country.code === code) ??
    H10_COUNTRIES.find((country) => country.code === H10_DEFAULT_COUNTRY)!
  );
}

/** Platform etiketini (`Amazon`) ya da kimliğini (`amazon`) kabul eder. */
export function normalizeH10Platform(input: unknown): H10Platform {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return (
    H10_PLATFORMS.find(
      (platform) => platform.id === raw || platform.label.toLowerCase() === raw,
    ) ?? H10_PLATFORMS.find((platform) => platform.id === H10_DEFAULT_PLATFORM)!
  );
}

/* --------------------------------------------------------- Niş anahtarı */

/**
 * Sorguyu cache anahtarına çevirir.
 *
 * Yeni sürümde KASITLI OLARAK eşanlamlı birleştirme yok: `airfryer` ile
 * `air fryer` aynı anahtara düşmez. Yanlış cache, eksik cache'ten daha
 * pahalıdır; alias tablosu ayrı bir iş olarak eklenebilir.
 */
export function normalizeH10Query(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, H10_MAX_QUERY_LENGTH);
}

export function hydrogen10CanonicalKey(input: {
  query: string;
  country: string;
  platform: string;
  currency: string;
}): string {
  const query = normalizeH10Query(input.query);
  const country = normalizeH10Country(input.country).code;
  const platform = normalizeH10Platform(input.platform).id;
  const currency = String(input.currency ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
  return `v${H10_SCHEMA_VERSION}|${query}|${country}|${platform}|${currency}`;
}

export type H10Market = {
  country: H10Country;
  platform: H10Platform;
  query: string;
  queryNormalized: string;
  canonicalKey: string;
};

export function resolveH10Market(input: {
  query: string;
  country?: unknown;
  platform?: unknown;
}): H10Market {
  const country = normalizeH10Country(input.country);
  const platform = normalizeH10Platform(input.platform);
  const query = String(input.query ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, H10_MAX_QUERY_LENGTH);
  const queryNormalized = normalizeH10Query(query);
  return {
    country,
    platform,
    query,
    queryNormalized,
    canonicalKey: hydrogen10CanonicalKey({
      query,
      country: country.code,
      platform: platform.id,
      currency: country.currency,
    }),
  };
}

/* ------------------------------------------------------------- Cache */

export type H10NicheStatus = "empty" | "queued" | "scraping" | "ready" | "partial" | "failed";

export function h10FreshUntil(lastScrapedAt: string | null | undefined): string | null {
  if (!lastScrapedAt) return null;
  const time = new Date(lastScrapedAt).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + H10_CACHE_MS).toISOString();
}

export function isH10Fresh(
  freshUntil: string | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (!freshUntil) return false;
  const time = new Date(freshUntil).getTime();
  if (!Number.isFinite(time)) return false;
  return time > (typeof now === "number" ? now : now.getTime());
}

/* --------------------------------------------------------- Kaynak sağlığı */

export type H10SourceStatus =
  | "ok"
  | "no_results"
  | "partial"
  | "not_configured"
  | "failed";

export type H10SourceHealth = {
  source: string;
  displayName: string;
  status: H10SourceStatus;
  items: number;
  invalidItems: number;
  latencyMs: number;
  error: string | null;
};

/** Kaynak adını DB'deki `^[a-z0-9_]+$` sözleşmesine çevirir. */
export function h10SourceSlug(input: unknown): string {
  const slug = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "unknown";
}

/**
 * `runSources` raporu ile gerçek satır sayısını tek duruma indirger.
 *
 * `failed` ile `no_results` ASLA birleştirilmez; `not_configured` bir hata
 * değildir ve ayrı gösterilir.
 */
export function h10SourceStatus(input: {
  ok: boolean;
  items: number;
  error?: string | null;
  invalidItems?: number;
}): H10SourceStatus {
  const error = String(input.error ?? "");
  if (!input.ok) {
    if (
      /anahtar tanımlı değil|anahtar yok|api key|not configured|missing key|missing env/i.test(
        error,
      )
    ) {
      return "not_configured";
    }
    return "failed";
  }
  if (input.items <= 0) return "no_results";
  if ((input.invalidItems ?? 0) > 0) return "partial";
  return "ok";
}

export function h10StatusLabel(status: H10NicheStatus | H10SourceStatus): string {
  switch (status) {
    case "ok":
      return "Çalışıyor";
    case "no_results":
      return "Sonuç yok";
    case "partial":
      return "Kısmi";
    case "not_configured":
      return "Yapılandırılmadı";
    case "failed":
      return "Hata";
    case "ready":
      return "Hazır";
    case "empty":
      return "Boş";
    case "queued":
      return "Sırada";
    case "scraping":
      return "Taranıyor";
    default:
      return status;
  }
}

export function h10StatusTone(status: H10NicheStatus | H10SourceStatus): string {
  switch (status) {
    case "ok":
    case "ready":
      return "border-[var(--profit)]/35 bg-[var(--profit)]/10 text-[var(--profit)]";
    case "partial":
    case "scraping":
    case "queued":
      return "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]";
    case "not_configured":
      return "border-white/15 bg-white/5 text-muted-foreground";
    default:
      return "border-red-400/35 bg-red-400/10 text-red-300";
  }
}

/* ------------------------------------------------------------- Ürün/teklif */

export type H10Offer = {
  id: string;
  source: string;
  seller: string;
  currency: string;
  priceLocalMinor: number | null;
  priceUsd: number | null;
  fxRate: number | null;
  fxAt: string | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  sourceUrl: string;
  sourceItemId: string | null;
  evidence: "measured" | "derived" | "estimated";
  observedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type H10Product = {
  id: string;
  identityKey: string;
  fingerprint: string;
  gtin: string | null;
  mpn: string | null;
  title: string;
  brand: string;
  imageUrl: string;
  category: string;
  offers: H10Offer[];
  sourceCount: number;
  bestPriceUsd: number | null;
  bestPriceLocalMinor: number | null;
  bestPriceCurrency: string;
  bestRating: number | null;
  bestRatingCount: number | null;
  inStock: boolean | null;
  lastSeenAt: string | null;
};

export type H10RunSummary = {
  id: string;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  rowCount: number;
  sourceStats: H10SourceHealth[];
  error: string | null;
};

export type H10SearchSuccess = {
  ok: true;
  nicheId: string;
  canonicalKey: string;
  query: string;
  country: string;
  platform: string;
  currency: string;
  dataSource: "db" | "live";
  stale: boolean;
  refreshing: boolean;
  status: H10NicheStatus;
  lastScrapedAt: string | null;
  freshUntil: string | null;
  nextRefreshAt: string | null;
  rowCount: number;
  productCount: number;
  products: H10Product[];
  sourceHealth: H10SourceHealth[];
  recentRuns: H10RunSummary[];
  notes: string[];
  message: string | null;
};

export type H10SearchFailure = {
  ok: false;
  code: "schema_missing" | "busy" | "no_sources" | "failed" | "invalid_input";
  message: string;
  details?: string;
};

export type H10SearchResult = H10SearchSuccess | H10SearchFailure;

export function isH10SearchSuccess(
  result: H10SearchResult | null | undefined,
): result is H10SearchSuccess {
  return !!result && result.ok === true;
}

export function isH10SearchFailure(
  result: H10SearchResult | null | undefined,
): result is H10SearchFailure {
  return !!result && result.ok === false;
}

export type H10Observation = {
  id: number;
  source: string;
  currency: string;
  priceLocalMinor: number | null;
  priceUsd: number | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  observedAt: string;
  eligible: boolean;
  rejectionReason: string | null;
  changed: boolean;
};

export type H10ProductDetail = {
  ok: true;
  product: {
    id: string;
    identityKey: string;
    gtin: string | null;
    mpn: string | null;
    title: string;
    brand: string;
    imageUrl: string;
    category: string;
    createdAt: string;
    lastSeenAt: string | null;
  };
  offers: H10Offer[];
  observations: H10Observation[];
  rangeDays: 7 | 30 | 90;
};

export type H10ProductDetailResult =
  | H10ProductDetail
  | {
      ok: false;
      code: "schema_missing" | "not_found" | "failed";
      message: string;
    };

export function isH10ProductDetail(
  result: H10ProductDetailResult | null | undefined,
): result is H10ProductDetail {
  return !!result && result.ok === true;
}

/* --------------------------------------------------------------- Filtreler */

export type H10Sort = "price_asc" | "rating_desc" | "reviews_desc" | "sources_desc" | "freshness_desc";

export type H10Filters = {
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  minRating: number | null;
  inStockOnly: boolean;
  source: string;
  sort: H10Sort;
};

export const H10_DEFAULT_FILTERS: H10Filters = {
  minPriceUsd: null,
  maxPriceUsd: null,
  minRating: null,
  inStockOnly: false,
  source: "all",
  sort: "sources_desc",
};

function priceOf(product: H10Product): number | null {
  return product.bestPriceUsd ?? product.bestPriceLocalMinor;
}

function freshnessOf(product: H10Product): number {
  const raw = product.lastSeenAt ?? product.offers[0]?.observedAt ?? "";
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Filtreler YALNIZ DB'deki niş verisine uygulanır. Bu fonksiyonun ağ/DB
 * bağımlılığı yoktur; filtre değişikliği yeni kazıma başlatmaz.
 */
export function filterH10Products(
  products: readonly H10Product[],
  filters: Partial<H10Filters> = {},
): H10Product[] {
  const merged = { ...H10_DEFAULT_FILTERS, ...filters };
  return products
    .filter((product) => {
      if (merged.source !== "all" && !product.offers.some((offer) => offer.source === merged.source)) {
        return false;
      }
      if (merged.inStockOnly && product.inStock !== true) return false;
      if (merged.minRating !== null && (product.bestRating ?? 0) < merged.minRating) return false;
      const price = priceOf(product);
      if (merged.minPriceUsd !== null && (price === null || price < merged.minPriceUsd)) return false;
      if (merged.maxPriceUsd !== null && (price === null || price > merged.maxPriceUsd)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (merged.sort) {
        case "price_asc": {
          const ap = priceOf(a);
          const bp = priceOf(b);
          if (ap === null && bp === null) return 0;
          if (ap === null) return 1;
          if (bp === null) return -1;
          return ap - bp;
        }
        case "rating_desc":
          return (b.bestRating ?? -1) - (a.bestRating ?? -1);
        case "reviews_desc":
          return (b.bestRatingCount ?? -1) - (a.bestRatingCount ?? -1);
        case "freshness_desc":
          return freshnessOf(b) - freshnessOf(a);
        case "sources_desc":
        default:
          return b.sourceCount - a.sourceCount || freshnessOf(b) - freshnessOf(a);
      }
    });
}

/* ------------------------------------------------------------- Biçimleme */

export function h10CurrencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export function formatH10Minor(minor: number | null, currency: string): string {
  if (minor === null || !Number.isFinite(minor)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function formatH10Usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatH10Rating(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function formatH10Count(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function h10AgeLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "hiç taranmadı";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "bilinmiyor";
  const diff = Math.max(0, now.getTime() - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

/** Görsel yoksa kart boş kutu göstermesin diye güvenli baş harfler. */
export function h10Monogram(title: string): string {
  return String(title ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("en-US") ?? "")
    .join("");
}
