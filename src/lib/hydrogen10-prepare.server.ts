// ============================================================================
// HIDROJEN10 — HAM KAYNAK SATIRLARINI KALICI GÖZLEMLERE HAZIRLAR.
//
// Bu modül ağ/DB'ye dokunmaz; böylece veri sözleşmesi testleri Supabase
// olmadan koşabilir. `runSources` çıktısı burada normalize edilir, ürün
// kimliği çıkarılır, teklifler tekilleştirilir ve HER geçerli satır için bir
// gözlem üretilir (filtreye takılanlar dahil).
//
// ÖNEMLİ: `normalizeRaw` çağrısı `.server` dosyasından gelir; bu dosya da
// yalnız sunucuda import edilir. Tarayıcı yalnız `hydrogen10.ts` tiplerini
// kullanır.
// ============================================================================

import { normalizeRaw } from "./product-discovery-filter.server";
import { isSellableProductRow } from "./product-discovery-query";
import {
  productFingerprint,
  productIdentityKeys,
  RawProductSchema,
  type NormalizedProduct,
  type RawProduct,
} from "./product-discovery.types";
import type { SourceReport } from "./product-discovery-sources.server";
import {
  h10SourceSlug,
  h10SourceStatus,
  type H10SourceHealth,
  type H10SourceStatus,
} from "./hydrogen10";

export type H10PreparedOffer = {
  source: string;
  seller: string;
  sourceItemId: string | null;
  currency: string;
  priceLocalMinor: number | null;
  priceUsd: number | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  sourceUrl: string;
  evidence: "measured" | "derived" | "estimated";
  eligible: boolean;
  rejectionReason: string | null;
  observedAt: string;
};

export type H10PreparedProduct = {
  identityKey: string;
  fingerprint: string;
  gtin: string | null;
  mpn: string | null;
  title: string;
  brand: string;
  imageUrl: string;
  category: string;
  offers: H10PreparedOffer[];
};

export type H10PreparedObservation = {
  identityKey: string;
  source: string;
  seller: string;
  sourceItemId: string | null;
  currency: string;
  priceLocalMinor: number | null;
  priceUsd: number | null;
  rating: number | null;
  ratingCount: number | null;
  inStock: boolean | null;
  sourceUrl: string;
  evidence: "measured" | "derived" | "estimated";
  eligible: boolean;
  rejectionReason: string | null;
  changed: boolean;
  rawHash: string;
  observedAt: string;
};

export type H10PreparedIngestRow = {
  source: string;
  title: string;
  sourceItemId: string | null;
  sourceUrl: string;
  currency: string;
  priceUsd: number | null;
  eligible: boolean;
  rejectionReason: string | null;
  rawHash: string;
  raw: Record<string, unknown>;
  observedAt: string;
};

export type H10PreparedRun = {
  products: H10PreparedProduct[];
  observations: H10PreparedObservation[];
  ingestRows: H10PreparedIngestRow[];
  sourceHealth: H10SourceHealth[];
  rowCount: number;
  invalidCount: number;
  status: "ready" | "partial" | "failed";
  notes: string[];
  error: string | null;
};

/** 32-bit FNV-1a — yalnız değişim tespiti için, kriptografik değil. */
export function h10Hash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function productKeyOf(product: NormalizedProduct): { identityKey: string; fingerprint: string } {
  // Ürün kimliği: GTIN → marka+MPN → model kodu → normalize başlık+marka.
  // Satıcı kimliğe GİRMEZ; satıcı teklif alanıdır.
  const fingerprint = productFingerprint({
    title: product.name,
    brand: product.brand,
  });
  const keys = productIdentityKeys({
    title: product.name,
    brand: product.brand,
    gtin: product.gtin,
    mpn: product.mpn,
    fingerprint,
  });
  const identityKey =
    keys.find((key) => key.startsWith("g:")) ??
    keys.find((key) => key.startsWith("mpn:")) ??
    keys.find((key) => key.startsWith("m:")) ??
    keys.find((key) => key.startsWith("f:")) ??
    keys[0] ??
    `f:${fingerprint || product.name.toLocaleLowerCase("en-US")}`;
  return { identityKey, fingerprint };
}

type Eligibility = { eligible: boolean; reason: string | null };

/**
 * Filtre kapıları — kaynak veya AI kararı değil, sözleşme kapıları.
 * Fiyat `null` elenmez (ölçülmemiş olabilir); yalnız bozuk fiyat elenir.
 */
export function h10Eligibility(product: NormalizedProduct): Eligibility {
  if (product.inStock === false) return { eligible: false, reason: "out_of_stock" };
  if (
    product.priceUsd !== null &&
    (!Number.isFinite(product.priceUsd) || product.priceUsd <= 0)
  ) {
    return { eligible: false, reason: "invalid_price" };
  }
  if (
    product.rating !== null &&
    product.ratingCount !== null &&
    product.ratingCount >= 3 &&
    product.rating < 3.5
  ) {
    return { eligible: false, reason: "low_rating" };
  }
  const hasEvidence =
    product.priceUsd !== null ||
    product.brand.trim() !== "" ||
    product.seller.trim() !== "" ||
    product.url.trim() !== "" ||
    product.imageUrl.trim() !== "" ||
    (product.salesVolume ?? 0) > 0 ||
    (product.viewed90d ?? 0) > 0 ||
    (product.ratingCount ?? 0) > 0;
  if (!hasEvidence) return { eligible: false, reason: "no_evidence" };
  return { eligible: true, reason: null };
}

function offerRichness(product: NormalizedProduct): number {
  return (
    product.dataCompleteness * 10 +
    (product.priceUsd !== null ? 5 : 0) +
    (product.imageUrl ? 2 : 0) +
    (product.ratingCount !== null ? 2 : 0)
  );
}

function validPrice(product: NormalizedProduct): number | null {
  if (product.priceUsd === null) return null;
  if (!Number.isFinite(product.priceUsd) || product.priceUsd <= 0) return null;
  return Math.round(product.priceUsd * 100) / 100;
}

function localMinorFor(currency: string, priceUsd: number | null): number | null {
  // Yerel fiyat yalnız USD pazarında kaynağın USD fiyatıyla eşleşir. Diğer
  // ülkelerde kaynak satırı normalize USD taşıyor; onu yerel fiyat sanıp
  // `price_local_minor` alanına yazmak ölçülmemiş bir iddia olurdu.
  if (currency !== "USD" || priceUsd === null) return null;
  return Math.round(priceUsd * 100);
}

/**
 * Ham kaynak çıktısı → ürün + teklif + gözlem.
 *
 * `reports` kaynak sağlığını taşır. Geçersiz satırlar gözleme dönüşmez
 * (başlıksız/ürün olmayan satırın ürün kimliği yoktur); sayıları kaynak
 * sağlığında `invalidItems` olarak görünür.
 */
export function prepareH10Run(
  raw: readonly RawProduct[],
  reports: readonly SourceReport[],
  market: { currency: string },
  now: Date = new Date(),
): H10PreparedRun {
  const observedAt = now.toISOString();
  const products = new Map<string, H10PreparedProduct>();
  const offerByKey = new Map<string, { offer: H10PreparedOffer; richness: number }>();
  const observations: H10PreparedObservation[] = [];
  const ingestRows: H10PreparedIngestRow[] = [];
  const rawCountBySource = new Map<string, number>();
  const validCountBySource = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const input of raw) {
    const rawSource = String(input.source ?? "").trim();
    const source = h10SourceSlug(rawSource);
    bump(rawCountBySource, source);
    const rawTitle = String(input.title ?? "").trim();
    // Sözleşme "her kazınan veri" der: seçilmiş alanlar değil, kaynağın
    // döndürdüğü satırın TAMAMI arşivlenir (kategori, görsel, not, talep
    // sinyalleri dahil). JSONB'ye yazılamayan değerler JSON'a indirgenir.
    const rawSnapshot: Record<string, unknown> = JSON.parse(
      JSON.stringify(input),
    ) as Record<string, unknown>;
    const baseIngest = {
      source,
      title: rawTitle,
      sourceItemId: null as string | null,
      sourceUrl: String(input.url ?? ""),
      currency: market.currency,
      priceUsd: null as number | null,
      rawHash: h10Hash(`${source}|${rawTitle}|${JSON.stringify(rawSnapshot)}`),
      raw: rawSnapshot,
      observedAt,
    };

    const parsed = RawProductSchema.safeParse(input);
    if (!parsed.success || parsed.data.title.trim() === "") {
      ingestRows.push({
        ...baseIngest,
        eligible: false,
        rejectionReason: !parsed.success ? "invalid_row" : "invalid_title",
      });
      continue;
    }
    if (
      !isSellableProductRow(parsed.data.title, parsed.data.source, {
        priceUsd: parsed.data.priceUsd,
        rating: parsed.data.rating,
      })
    ) {
      ingestRows.push({
        ...baseIngest,
        eligible: false,
        rejectionReason: "non_product",
      });
      continue;
    }

    let product: NormalizedProduct;
    try {
      product = normalizeRaw(parsed.data);
    } catch {
      ingestRows.push({
        ...baseIngest,
        eligible: false,
        rejectionReason: "normalize_failed",
      });
      continue;
    }
    if (!product.name.trim() || product.source !== "scraped") {
      ingestRows.push({
        ...baseIngest,
        eligible: false,
        rejectionReason: "invalid_product",
      });
      continue;
    }

    bump(validCountBySource, source);
    const { identityKey, fingerprint } = productKeyOf(product);
    const priceUsd = validPrice(product);
    const priceLocalMinor = localMinorFor(market.currency, priceUsd);
    const eligibility = h10Eligibility(product);
    const sourceItemId = product.id.trim() ? product.id.slice(0, 120) : null;

    ingestRows.push({
      ...baseIngest,
      title: product.name,
      sourceItemId,
      sourceUrl: product.url,
      priceUsd,
      eligible: eligibility.eligible,
      rejectionReason: eligibility.reason,
      rawHash: h10Hash(`${source}|${product.name}|${JSON.stringify(rawSnapshot)}`),
    });

    const observation: H10PreparedObservation = {
      identityKey,
      source,
      seller: product.seller,
      sourceItemId,
      currency: market.currency,
      priceLocalMinor,
      priceUsd,
      rating: product.rating,
      ratingCount: product.ratingCount,
      inStock: product.inStock,
      sourceUrl: product.url,
      evidence: "measured",
      eligible: eligibility.eligible,
      rejectionReason: eligibility.reason,
      changed: false,
      rawHash: h10Hash(
        [
          product.name,
          product.brand,
          source,
          product.seller,
          priceUsd ?? "null",
          product.rating ?? "null",
          product.ratingCount ?? "null",
          product.inStock === null ? "null" : String(product.inStock),
        ].join("|"),
      ),
      observedAt,
    };
    observations.push(observation);

    const existingProduct = products.get(identityKey);
    if (!existingProduct) {
      products.set(identityKey, {
        identityKey,
        fingerprint,
        gtin: product.gtin || null,
        mpn: product.mpn || null,
        title: product.name,
        brand: product.brand,
        imageUrl: product.imageUrl,
        category: product.category,
        offers: [],
      });
    } else {
      existingProduct.title = existingProduct.title || product.name;
      existingProduct.brand = existingProduct.brand || product.brand;
      existingProduct.imageUrl = existingProduct.imageUrl || product.imageUrl;
      existingProduct.category = existingProduct.category || product.category;
      existingProduct.gtin = existingProduct.gtin || product.gtin || null;
      existingProduct.mpn = existingProduct.mpn || product.mpn || null;
    }

    const offerKey = `${identityKey}\u0000${source}`;
    const preparedOffer: H10PreparedOffer = {
      source,
      seller: product.seller,
      sourceItemId,
      currency: market.currency,
      priceLocalMinor,
      priceUsd,
      rating: product.rating,
      ratingCount: product.ratingCount,
      inStock: product.inStock,
      sourceUrl: product.url,
      evidence: "measured",
      eligible: eligibility.eligible,
      rejectionReason: eligibility.reason,
      observedAt,
    };
    const richness = offerRichness(product);
    const incumbent = offerByKey.get(offerKey);
    if (!incumbent || richness > incumbent.richness) {
      offerByKey.set(offerKey, { offer: preparedOffer, richness });
    }
  }

  for (const [key, value] of offerByKey) {
    const identityKey = key.split("\u0000")[0] ?? "";
    const product = products.get(identityKey);
    if (product) product.offers.push(value.offer);
  }
  for (const product of products.values()) {
    product.offers.sort((a, b) => (a.priceUsd ?? Number.POSITIVE_INFINITY) - (b.priceUsd ?? Number.POSITIVE_INFINITY));
  }

  const sourceHealth: H10SourceHealth[] = [];
  const reportSlugs = new Set<string>();
  for (const report of reports) {
    const source = h10SourceSlug(report.name);
    reportSlugs.add(source);
    const valid = validCountBySource.get(source) ?? 0;
    const rawCount = rawCountBySource.get(source) ?? 0;
    const items = Math.max(0, Math.max(report.items ?? 0, rawCount));
    const invalidItems = Math.max(0, items - valid);
    const status = h10SourceStatus({
      ok: report.ok,
      items,
      error: report.error,
      invalidItems,
    });
    sourceHealth.push({
      source,
      displayName: report.name,
      status,
      items,
      invalidItems,
      latencyMs: Math.max(0, Math.round(report.ms ?? 0)),
      error: report.error?.trim() ? report.error.slice(0, 240) : null,
    });
  }
  for (const [source, rawCount] of rawCountBySource) {
    if (reportSlugs.has(source)) continue;
    const valid = validCountBySource.get(source) ?? 0;
    sourceHealth.push({
      source,
      displayName: source,
      status: h10SourceStatus({
        ok: true,
        items: rawCount,
        invalidItems: Math.max(0, rawCount - valid),
      }),
      items: rawCount,
      invalidItems: Math.max(0, rawCount - valid),
      latencyMs: 0,
      error: null,
    });
  }
  sourceHealth.sort((a, b) => a.displayName.localeCompare(b.displayName));
  const invalidCount = sourceHealth.reduce((sum, health) => sum + health.invalidItems, 0);

  const successful = sourceHealth.filter(
    (health) =>
      health.status === "ok" ||
      health.status === "no_results" ||
      health.status === "partial",
  );
  const failed = sourceHealth.filter((health) => health.status === "failed");
  const notConfigured = sourceHealth.filter((health) => health.status === "not_configured");
  const status: H10PreparedRun["status"] =
    successful.length === 0
      ? "failed"
      : failed.length > 0 || sourceHealth.some((health) => health.status === "partial")
        ? "partial"
        : "ready";

  const notes = [
    `Hidrojen10: ${raw.length} ham satır → ${ingestRows.length} ingest, ` +
      `${observations.length} gözlem, ${products.size} kanonik ürün, ` +
      `${offerByKey.size} kaynak teklifi.`,
    `Kaynak kapsamı: ${sourceHealth.length} kaynak değerlendirildi, ` +
      `${sourceHealth.filter((health) => health.status !== "not_configured").length} çağrıldı, ` +
      `${sourceHealth.filter((health) => health.items > 0).length} satır getirdi.`,
  ];
  if (invalidCount > 0) {
    notes.push(
      `Ürün olmayan/geçersiz ${invalidCount} satır ürün tablosuna yazılmadı; ` +
        `kaynak sağlığında görünüyor.`,
    );
  }
  if (notConfigured.length > 0) {
    notes.push(
      `Yapılandırılmadığı için ölçülmeyen ${notConfigured.length} kaynak: ` +
        `${notConfigured.map((health) => health.displayName).slice(0, 6).join(" · ")}` +
        `${notConfigured.length > 6 ? " …" : ""}.`,
    );
  }
  if (failed.length > 0) {
    notes.push(
      `Hata veren ${failed.length} kaynak: ${failed
        .map((health) => `${health.displayName} (${health.error ?? "hata"})`)
        .slice(0, 5)
        .join("; ")}.`,
    );
  }

  const error =
    status === "failed"
      ? successful.length === 0 && notConfigured.length === sourceHealth.length
        ? "Bu pazarda yapılandırılmış kaynak yok."
        : "Kaynaklar yanıt vermedi."
      : null;

  return {
    products: [...products.values()].sort((a, b) => b.offers.length - a.offers.length),
    observations,
    ingestRows,
    sourceHealth,
    rowCount: observations.length,
    invalidCount,
    status,
    notes,
    error,
  };
}

export function isH10SourceStatus(value: unknown): value is H10SourceStatus {
  return (
    value === "ok" ||
    value === "no_results" ||
    value === "partial" ||
    value === "not_configured" ||
    value === "failed"
  );
}
