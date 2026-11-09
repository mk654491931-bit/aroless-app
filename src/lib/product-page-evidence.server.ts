/**
 * ÜRÜN SAYFASI KANITI — ağ katmanı (ince).
 *
 * Arama/liste sayfası puan vermediğinde ürünün KENDİ sayfasını okur. Bu,
 * "Puan —" ve "Talep kanıtı —" alanlarını gerçek `aggregateRating` ile
 * doldurabilir. Kanıt yoksa hiçbir şey yazılmaz; istek başarısızsa hat DÜŞMEZ.
 *
 * GÜVENLİK: yalnız bilinen pazaryeri alan adlarına gidilir ve yönlendirmeler
 * elle izlenir; her adımda alan adı yeniden doğrulanır. Böylece kaynak
 * satırından gelen bir URL iç ağa yönlendirme aracı olamaz.
 */

import type { NormalizedProduct } from "./product-discovery.types";
import { evidenceCompleteness } from "./product-discovery-filter.server";
import { fetchThroughScraperApi } from "./product-image.server";
import { extractProductPageEvidence } from "./product-page-evidence";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const PAGE_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 2;

/** Puan/değerlendirme okuyabildiğimiz pazaryerleri. */
const ALLOWED_HOST_SUFFIXES = [
  "hepsiburada.com",
  "n11.com",
  "trendyol.com",
  "amazon.com",
  "amazon.com.tr",
  "amazon.de",
  "amazon.co.uk",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "aliexpress.com",
  "etsy.com",
  "newegg.com",
  "walmart.com",
  "otto.de",
  "flipkart.com",
  "rakuten.co.jp",
  "target.com",
  "ebay.com",
  "amzn.to",
] as const;

export function isAllowedProductPageUrl(raw: string): boolean {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function fetchDirect(url: string): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedProductPageUrl(current)) return null;
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Tek ürün sayfasını okur. Fail-soft: ağ/ayrıştırma hatasında `null`.
 * Önce ScraperAPI (anahtar varsa), sonra doğrudan istek denenir.
 */
export async function readProductPageEvidence(
  url: string,
  opts: { country?: string } = {},
): Promise<{ rating: number | null; ratingCount: number | null } | null> {
  if (!isAllowedProductPageUrl(url)) return null;
  const countryCode = /^[A-Za-z]{2}$/.test(opts.country ?? "")
    ? (opts.country as string).toLowerCase()
    : "tr";

  let html: string | null = null;
  try {
    html = await fetchThroughScraperApi(url, {
      countryCode,
      timeoutMs: PAGE_TIMEOUT_MS,
    });
  } catch {
    html = null;
  }
  if (!html) html = await fetchDirect(url);
  if (!html) return null;

  const evidence = extractProductPageEvidence(html);
  if (evidence.rating === null && evidence.ratingCount === null) return null;
  return { rating: evidence.rating, ratingCount: evidence.ratingCount };
}

/**
 * En güçlü N adayın eksik puan/değerlendirme sayısını ürün sayfasından
 * tamamlar. Yalnız eksik alan doldurulur; ölçülmüş değer EZİLMEZ.
 */
export async function enrichProductPageEvidence(
  products: readonly NormalizedProduct[],
  opts: { limit?: number; country?: string } = {},
): Promise<{
  products: NormalizedProduct[];
  attempted: number;
  enriched: number;
}> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, products.length));
  const targets = products
    .slice(0, limit)
    .filter(
      (p) =>
        p.url.trim() !== "" &&
        isAllowedProductPageUrl(p.url) &&
        (p.rating === null || p.ratingCount === null),
    );
  if (!targets.length) return { products: [...products], attempted: 0, enriched: 0 };

  const settled = await Promise.allSettled(
    targets.map(async (p) => ({
      product: p,
      evidence: await readProductPageEvidence(p.url, { country: opts.country }),
    })),
  );

  const updates = new Map<string, { rating: number | null; ratingCount: number | null }>();
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value.evidence) continue;
    updates.set(
      result.value.product.fingerprint || result.value.product.name,
      result.value.evidence,
    );
  }

  let enriched = 0;
  const out = products.map((p) => {
    const evidence = updates.get(p.fingerprint || p.name);
    if (!evidence) return p;
    const rating = p.rating ?? evidence.rating;
    const ratingCount = p.ratingCount ?? evidence.ratingCount;
    if (rating === p.rating && ratingCount === p.ratingCount) return p;

    const noteParts = [
      rating !== null ? `ürün sayfası puanı ${rating}/5` : "",
      ratingCount !== null ? `${ratingCount.toLocaleString("tr-TR")} değerlendirme` : "",
    ].filter(Boolean);
    const updated: NormalizedProduct = {
      ...p,
      rating,
      ratingCount,
      notes: [p.notes, noteParts.join(" · ")].filter(Boolean).join(" · ").slice(0, 200),
    };
    const { dataCompleteness, missingFields } = evidenceCompleteness(updated);
    const gain = Math.max(0, dataCompleteness - p.dataCompleteness);
    updated.dataCompleteness = dataCompleteness;
    updated.missingFields = missingFields;
    updated.preScore = Math.max(0, Math.min(100, Math.round(p.preScore + gain * 4)));
    enriched++;
    return updated;
  });

  return { products: out, attempted: targets.length, enriched };
}
