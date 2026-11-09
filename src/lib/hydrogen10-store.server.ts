// ============================================================================
// HIDROJEN10 — KALICI CACHE KATMANI (Supabase service role).
//
// Akış:
//   niş anahtarı → h10_niches (taze mi?) → h10_offers + h10_products
//   miss/bayat → kaynakları çalıştır → h10_runs/h10_source_runs
//                → HER satır h10_ingest_rows (append-only, ham JSON)
//                → ürün satırı h10_observations (append-only)
//                → uygun güncel teklif h10_offers
//                → niş cache zaman damgaları
//
// Tablolar yoksa çökmeyiz: `H10SchemaError` fırlatılır ve arayüz migration
// gerektiğini açıkça söyler. Migration otomatik ÇALIŞTIRILMAZ.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  h10FreshUntil,
  isH10Fresh,
  type H10NicheStatus,
  type H10Observation,
  type H10Offer,
  type H10Product,
  type H10ProductDetailResult,
  type H10RunSummary,
  type H10SearchSuccess,
  type H10SourceHealth,
  type H10SourceStatus,
} from "./hydrogen10";
import { prepareH10Run, type H10PreparedRun } from "./hydrogen10-prepare.server";
import type { RawProduct } from "./product-discovery.types";
import type { SourceReport } from "./product-discovery-sources.server";

// Hidrojen10 tabloları generated `Database` tipinde yok (migration kullanıcı
// tarafından uygulanacak). Service-role istemcisini bu modülde bilinçli olarak
// şemasız kullanıyoruz; tablo/alan adları SQL sözleşmesiyle eşleşir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export class H10SchemaError extends Error {
  readonly code = "H10_SCHEMA_MISSING";

  constructor() {
    super(
      "Hidrojen10 tabloları bulunamadı. `docs/hydrogen10/MIGRATION.sql` dosyasını Supabase SQL editöründe çalıştırın.",
    );
    this.name = "H10SchemaError";
  }
}

export class H10BusyError extends Error {
  readonly code = "H10_BUSY";

  constructor() {
    super("Bu niş için zaten çalışan bir tarama var. Birkaç saniye sonra tekrar deneyin.");
    this.name = "H10BusyError";
  }
}

type DbError = { code?: string; message?: string; details?: string } | null;

export function isH10MissingTable(error: DbError | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /could not find the table|relation .* does not exist|schema cache/i.test(message)
  );
}

function rethrowH10(error: DbError, context: string): never {
  if (isH10MissingTable(error)) throw new H10SchemaError();
  throw new Error(`${context}: ${error?.message ?? "bilinmeyen Supabase hatası"}`);
}

async function db(): Promise<AnyDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AnyDb;
}

/* --------------------------------------------------------------- Okuma */

type NicheRow = {
  id: string;
  canonical_key: string;
  query: string;
  query_normalized: string;
  country: string;
  platform: string;
  currency: string;
  schema_version: number;
  status: H10NicheStatus;
  last_scraped_at: string | null;
  fresh_until: string | null;
  next_refresh_at: string | null;
  row_count: number;
  source_stats: unknown;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type OfferRow = Record<string, unknown>;
type ProductRow = Record<string, unknown>;
type RunRow = Record<string, unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStatus(value: unknown): H10SourceStatus {
  return value === "ok" ||
    value === "no_results" ||
    value === "partial" ||
    value === "not_configured" ||
    value === "failed"
    ? value
    : "failed";
}

export function parseSourceHealth(value: unknown): H10SourceHealth[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      source: asString(item["source"], "unknown"),
      displayName: asString(item["displayName"], asString(item["source"], "unknown")),
      status: asStatus(item["status"]),
      items: asNumber(item["items"]) ?? 0,
      invalidItems: asNumber(item["invalidItems"]) ?? 0,
      latencyMs: asNumber(item["latencyMs"]) ?? 0,
      error: asNullableString(item["error"]),
    }));
}

function mapOffer(row: OfferRow): H10Offer {
  return {
    id: asString(row["id"]),
    source: asString(row["source"]),
    seller: asString(row["seller"]),
    currency: asString(row["currency"], "USD"),
    priceLocalMinor: asNumber(row["price_local_minor"]),
    priceUsd: asNumber(row["price_usd"]),
    fxRate: asNumber(row["fx_rate"]),
    fxAt: asNullableString(row["fx_at"]),
    rating: asNumber(row["rating"]),
    ratingCount: asNumber(row["rating_count"]),
    inStock: asNullableBoolean(row["in_stock"]),
    sourceUrl: asString(row["source_url"]),
    sourceItemId: asNullableString(row["source_item_id"]),
    evidence:
      row["evidence"] === "derived" || row["evidence"] === "estimated"
        ? row["evidence"]
        : "measured",
    observedAt: asString(row["observed_at"], new Date(0).toISOString()),
    firstSeenAt: asString(row["first_seen_at"], new Date(0).toISOString()),
    lastSeenAt: asString(row["last_seen_at"], new Date(0).toISOString()),
  };
}

function buildProducts(products: ProductRow[], offers: OfferRow[]): H10Product[] {
  const byId = new Map<string, ProductRow>();
  for (const product of products) byId.set(asString(product["id"]), product);
  const rows = new Map<string, H10Offer[]>();
  for (const offer of offers) {
    const productId = asString(offer["product_id"]);
    if (!productId) continue;
    const list = rows.get(productId) ?? [];
    list.push(mapOffer(offer));
    rows.set(productId, list);
  }

  const result: H10Product[] = [];
  for (const [productId, productOffers] of rows) {
    const product = byId.get(productId);
    if (!product) continue;
    productOffers.sort((a, b) => {
      const ap = a.priceUsd ?? Number.POSITIVE_INFINITY;
      const bp = b.priceUsd ?? Number.POSITIVE_INFINITY;
      return ap - bp || a.source.localeCompare(b.source);
    });
    const priced = productOffers.filter((offer) => offer.priceUsd !== null);
    const displayOffer = priced.find((offer) => offer.priceLocalMinor !== null) ?? priced[0];
    const ratings = productOffers
      .map((offer) => offer.rating)
      .filter((rating): rating is number => rating !== null);
    const counts = productOffers
      .map((offer) => offer.ratingCount)
      .filter((count): count is number => count !== null);
    const lastSeenTimes = productOffers
      .map((offer) => new Date(offer.lastSeenAt).getTime())
      .filter((time) => Number.isFinite(time));
    const sources = new Set(productOffers.map((offer) => offer.source));
    const inStock = productOffers.some((offer) => offer.inStock === true)
      ? true
      : productOffers.every((offer) => offer.inStock === false)
        ? false
        : null;

    result.push({
      id: productId,
      identityKey: asString(product["identity_key"]),
      fingerprint: asString(product["fingerprint"]),
      gtin: asNullableString(product["gtin"]),
      mpn: asNullableString(product["mpn"]),
      title: asString(product["title"], "Adsız ürün"),
      brand: asString(product["brand"]),
      imageUrl: asString(product["image_url"]),
      category: asString(product["category"]),
      offers: productOffers,
      sourceCount: sources.size,
      bestPriceUsd: priced[0]?.priceUsd ?? null,
      bestPriceLocalMinor: displayOffer?.priceLocalMinor ?? null,
      bestPriceCurrency: displayOffer?.currency ?? "USD",
      bestRating: ratings.length ? Math.max(...ratings) : null,
      bestRatingCount: counts.length ? Math.max(...counts) : null,
      inStock,
      lastSeenAt: lastSeenTimes.length ? new Date(Math.max(...lastSeenTimes)).toISOString() : null,
    });
  }
  return result.sort(
    (a, b) =>
      b.sourceCount - a.sourceCount ||
      new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime() ||
      a.title.localeCompare(b.title),
  );
}

function mapRuns(rows: RunRow[]): H10RunSummary[] {
  return rows.map((row) => ({
    id: asString(row["id"]),
    status:
      row["status"] === "queued" ||
      row["status"] === "running" ||
      row["status"] === "partial" ||
      row["status"] === "failed"
        ? row["status"]
        : "completed",
    triggeredBy: asString(row["triggered_by"], "user"),
    startedAt: asString(row["started_at"], new Date(0).toISOString()),
    finishedAt: asNullableString(row["finished_at"]),
    rowCount: asNumber(row["row_count"]) ?? 0,
    sourceStats: parseSourceHealth(row["source_stats"]),
    error: asNullableString(row["error"]),
  }));
}

async function readNicheByKey(admin: AnyDb, canonicalKey: string): Promise<NicheRow | null> {
  const { data, error } = await admin
    .from("h10_niches")
    .select("*")
    .eq("canonical_key", canonicalKey)
    .maybeSingle();
  if (error) rethrowH10(error, "Hidrojen10 niş okunamadı");
  return (data as NicheRow | null) ?? null;
}

export async function findH10Niche(canonicalKey: string): Promise<NicheRow | null> {
  return readNicheByKey(await db(), canonicalKey);
}

export type H10ReadOptions = {
  dataSource: "db" | "live";
  refreshing?: boolean;
  message?: string | null;
  notes?: string[];
};

/**
 * Niş + güncel teklifleri arayüze hazır biçimde okur.
 * DB'de teklif yoksa boş liste döner; sahte ürün üretmez.
 */
export async function readH10Payload(
  niche: NicheRow,
  options: H10ReadOptions,
): Promise<H10SearchSuccess> {
  const admin = await db();
  const { data: offerData, error: offerError } = await admin
    .from("h10_offers")
    .select("*")
    .eq("niche_id", niche.id)
    .limit(5000);
  if (offerError) rethrowH10(offerError, "Hidrojen10 teklifleri okunamadı");
  const offers = (offerData ?? []) as OfferRow[];

  const productIds = [...new Set(offers.map((offer) => asString(offer["product_id"])))].filter(
    Boolean,
  );
  let productRows: ProductRow[] = [];
  if (productIds.length) {
    // UUID listesini tek URL'e sığdırmamak için parçalı oku.
    for (let i = 0; i < productIds.length; i += 150) {
      const chunk = productIds.slice(i, i + 150);
      const { data: chunkData, error: productError } = await admin
        .from("h10_products")
        .select("*")
        .in("id", chunk);
      if (productError) rethrowH10(productError, "Hidrojen10 ürünleri okunamadı");
      productRows = productRows.concat((chunkData ?? []) as ProductRow[]);
    }
  }
  const products = buildProducts(productRows, offers);

  const { data: runData, error: runError } = await admin
    .from("h10_runs")
    .select("*")
    .eq("niche_id", niche.id)
    .order("created_at", { ascending: false })
    .limit(8);
  if (runError) rethrowH10(runError, "Hidrojen10 run geçmişi okunamadı");
  const recentRuns = mapRuns((runData ?? []) as RunRow[]);
  const sourceHealth = parseSourceHealth(niche.source_stats);
  const freshUntil = niche.fresh_until ?? h10FreshUntil(niche.last_scraped_at);

  const notes = [...(options.notes ?? [])];
  notes.push(
    products.length
      ? `${products.length} kanonik ürün, ${offers.length} kaynak teklifi DB'den okundu.`
      : "DB'de bu niş için henüz ürün teklifi yok.",
  );
  if (niche.last_error) notes.push(`Son tarama hatası: ${niche.last_error}`);

  return {
    ok: true,
    nicheId: niche.id,
    canonicalKey: niche.canonical_key,
    query: niche.query,
    country: niche.country,
    platform: niche.platform,
    currency: niche.currency,
    dataSource: options.dataSource,
    stale: !isH10Fresh(freshUntil),
    refreshing: options.refreshing ?? false,
    status: niche.status,
    lastScrapedAt: niche.last_scraped_at,
    freshUntil,
    nextRefreshAt: niche.next_refresh_at,
    rowCount: niche.row_count,
    productCount: products.length,
    products,
    sourceHealth,
    recentRuns,
    notes,
    message: options.message ?? null,
  };
}

/* --------------------------------------------------------------- Yazma */

export type H10ScrapeInput = {
  canonicalKey: string;
  query: string;
  queryNormalized: string;
  country: string;
  platform: string;
  currency: string;
  raw: readonly RawProduct[];
  reports: readonly SourceReport[];
  triggeredBy: "user" | "stale_refresh" | "manual" | "cron" | "watchlist";
  now?: Date;
};

export type H10ScrapeResult = {
  nicheId: string;
  runId: string;
  prepared: H10PreparedRun;
};

async function ensureNiche(
  admin: AnyDb,
  input: Pick<
    H10ScrapeInput,
    "canonicalKey" | "query" | "queryNormalized" | "country" | "platform" | "currency"
  >,
): Promise<string> {
  const { data, error } = await admin
    .from("h10_niches")
    .upsert(
      {
        canonical_key: input.canonicalKey,
        query: input.query,
        query_normalized: input.queryNormalized,
        country: input.country,
        platform: input.platform,
        currency: input.currency,
        schema_version: 1,
      },
      { onConflict: "canonical_key" },
    )
    .select("id")
    .single();
  if (error) rethrowH10(error, "Hidrojen10 nişi oluşturulamadı");
  const id = asString((data as Record<string, unknown> | null)?.["id"]);
  if (!id) throw new Error("Hidrojen10 niş kimliği alınamadı");
  return id;
}

function changesOffer(previous: OfferRow | undefined, next: Record<string, unknown>): boolean {
  if (!previous) return true;
  const fields: [string, string][] = [
    ["price_usd", "price_usd"],
    ["price_local_minor", "price_local_minor"],
    ["rating", "rating"],
    ["rating_count", "rating_count"],
    ["in_stock", "in_stock"],
  ];
  for (const [left, right] of fields) {
    const before = previous[left];
    const after = next[right];
    if (left === "in_stock") {
      // Üç durumlu boolean: false → null da bir değişimdir.
      if (before !== after) return true;
      continue;
    }
    if (asNumber(before) !== asNumber(after)) return true;
  }
  return false;
}

export async function persistH10Run(input: H10ScrapeInput): Promise<H10ScrapeResult> {
  const admin = await db();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nicheId = await ensureNiche(admin, input);

  const { data: active, error: activeError } = await admin
    .from("h10_runs")
    .select("id, started_at")
    .eq("niche_id", nicheId)
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (activeError) rethrowH10(activeError, "Aktif Hidrojen10 run'ı okunamadı");
  if (active) {
    const activeRow = active as Record<string, unknown>;
    const startedAt = new Date(asString(activeRow["started_at"])).getTime();
    // Süreç öldürüldüyse (dağıtım/504) run satırı `running` kalabilir. Bu
    // satırı sonsuza kadar kilit sanmak yeni taramayı engeller; 3 dakikadan
    // eski sahipsiz run'ı dürüstçe failed yapıp devam ediyoruz.
    const orphaned = Number.isFinite(startedAt) && now.getTime() - startedAt > 3 * 60_000;
    if (!orphaned) throw new H10BusyError();
    const { error: orphanError } = await admin
      .from("h10_runs")
      .update({ status: "failed", finished_at: nowIso, error: "stale_run_timeout" })
      .eq("id", asString(activeRow["id"]));
    if (orphanError) rethrowH10(orphanError, "Sahipsiz Hidrojen10 run'ı kapatılamadı");
  }

  const { data: runData, error: runError } = await admin
    .from("h10_runs")
    .insert({
      niche_id: nicheId,
      status: "running",
      triggered_by: input.triggeredBy,
      dedupe_key: `${input.canonicalKey}:${input.triggeredBy}:${now.getTime()}`,
      started_at: nowIso,
    })
    .select("id")
    .single();
  if (runError) {
    if (runError.code === "23505") throw new H10BusyError();
    rethrowH10(runError, "Hidrojen10 run'ı açılamadı");
  }
  const runId = asString((runData as Record<string, unknown> | null)?.["id"]);
  if (!runId) throw new Error("Hidrojen10 run kimliği alınamadı");

  // Arayüz "taranıyor" durumunu görebilsin; cache zaman damgaları ancak
  // kaynaklar bittikten sonra ilerler.
  const { error: scanningError } = await admin
    .from("h10_niches")
    .update({ status: "scraping" })
    .eq("id", nicheId);
  if (scanningError) rethrowH10(scanningError, "Hidrojen10 tarama durumu yazılamadı");

  try {
    const prepared = prepareH10Run(
      input.raw,
      input.reports,
      { currency: input.currency, platform: input.platform },
      now,
    );

    // HAM SATIR ARŞİVİ: ürün olmayan/geçersiz satırlar da burada kalır.
    // `h10_observations` yalnız ürünle eşleşen satırları taşır; bu tablo
    // "her kazınan veri" sözleşmesini tamamlar.
    for (let i = 0; i < prepared.ingestRows.length; i += 250) {
      const { error } = await admin.from("h10_ingest_rows").insert(
        prepared.ingestRows.slice(i, i + 250).map((row) => ({
          run_id: runId,
          niche_id: nicheId,
          source: row.source,
          title: row.title,
          source_item_id: row.sourceItemId,
          source_url: row.sourceUrl,
          currency: row.currency,
          price_usd: row.priceUsd,
          eligible: row.eligible,
          rejection_reason: row.rejectionReason,
          raw_hash: row.rawHash,
          raw: row.raw,
          observed_at: row.observedAt,
        })),
      );
      if (error) rethrowH10(error, "Hidrojen10 ham satır arşivi yazılamadı");
    }

    // Kaynak politikaları: yalnız yeni kaynak için varsayılan satır; mevcut
    // politika alanları (cache_allowed/retention) upsert ile EZİLMEZ.
    if (prepared.sourceHealth.length) {
      const { error } = await admin.from("h10_sources").upsert(
        prepared.sourceHealth.map((health) => ({
          source: health.source,
          display_name: health.displayName,
        })),
        { onConflict: "source" },
      );
      if (error) rethrowH10(error, "Hidrojen10 kaynak politikaları yazılamadı");
    }

    const productRows = prepared.products.map((product) => ({
      identity_key: product.identityKey,
      fingerprint: product.fingerprint,
      gtin: product.gtin,
      mpn: product.mpn,
      brand: product.brand,
      title: product.title,
      image_url: product.imageUrl,
      category: product.category,
      last_seen_at: nowIso,
    }));
    let idByIdentity = new Map<string, string>();
    if (productRows.length) {
      const { data, error } = await admin
        .from("h10_products")
        .upsert(productRows, { onConflict: "identity_key" })
        .select("id, identity_key");
      if (error) rethrowH10(error, "Hidrojen10 ürünleri yazılamadı");
      idByIdentity = new Map(
        ((data ?? []) as Record<string, unknown>[]).map((row) => [
          asString(row["identity_key"]),
          asString(row["id"]),
        ]),
      );
    }

    const { data: existingOffers, error: existingError } = await admin
      .from("h10_offers")
      .select(
        "id, product_id, source, price_usd, price_local_minor, rating, rating_count, in_stock",
      )
      .eq("niche_id", nicheId);
    if (existingError) rethrowH10(existingError, "Mevcut Hidrojen10 teklifleri okunamadı");
    const previousByKey = new Map(
      ((existingOffers ?? []) as OfferRow[]).map((offer) => [
        `${asString(offer["product_id"])}\u0000${asString(offer["source"])}`,
        offer,
      ]),
    );

    const observations = prepared.observations
      .map((observation) => {
        const productId = idByIdentity.get(observation.identityKey);
        if (!productId) return null;
        const offerRow = {
          product_id: productId,
          source: observation.source,
          price_usd: observation.priceUsd,
          price_local_minor: observation.priceLocalMinor,
          rating: observation.rating,
          rating_count: observation.ratingCount,
          in_stock: observation.inStock,
        };
        const changed = changesOffer(
          previousByKey.get(`${productId}\u0000${observation.source}`),
          offerRow,
        );
        return {
          run_id: runId,
          niche_id: nicheId,
          product_id: productId,
          source: observation.source,
          seller: observation.seller,
          source_item_id: observation.sourceItemId,
          currency: observation.currency,
          price_local_minor: observation.priceLocalMinor,
          price_usd: observation.priceUsd,
          fx_rate: null,
          fx_at: null,
          rating: observation.rating,
          rating_count: observation.ratingCount,
          in_stock: observation.inStock,
          source_url: observation.sourceUrl,
          evidence: observation.evidence,
          eligible: observation.eligible,
          rejection_reason: observation.rejectionReason,
          changed,
          raw_hash: observation.rawHash,
          observed_at: observation.observedAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (let i = 0; i < observations.length; i += 250) {
      const { error } = await admin.from("h10_observations").insert(observations.slice(i, i + 250));
      if (error) rethrowH10(error, "Hidrojen10 gözlemleri yazılamadı");
    }

    const offerRows = prepared.products.flatMap((product) => {
      const productId = idByIdentity.get(product.identityKey);
      if (!productId) return [];
      // Filtreye takılan (stok yok/düşük puan/kanıtsız) teklifler yalnız
      // gözlem ve ingest arşivinde kalır; "güncel teklif" tablosuna yazılmaz.
      return product.offers
        .filter((offer) => offer.eligible)
        .map((offer) => ({
          niche_id: nicheId,
          product_id: productId,
          source: offer.source,
          seller: offer.seller,
          source_item_id: offer.sourceItemId,
          currency: offer.currency,
          price_local_minor: offer.priceLocalMinor,
          price_usd: offer.priceUsd,
          fx_rate: null,
          fx_at: null,
          rating: offer.rating,
          rating_count: offer.ratingCount,
          in_stock: offer.inStock,
          source_url: offer.sourceUrl,
          evidence: offer.evidence,
          observed_at: offer.observedAt,
          last_seen_at: nowIso,
        }));
    });
    if (offerRows.length) {
      const { error } = await admin
        .from("h10_offers")
        .upsert(offerRows, { onConflict: "niche_id,product_id,source" });
      if (error) rethrowH10(error, "Hidrojen10 teklifleri yazılamadı");
    }

    // Güncel teklif tablosu "şu an görülen"i temsil eder. Kaynağı bu turda
    // tamamlanmış (ok/no_results/partial) ama satırı artık dönmemiş teklifler
    // silinir; gözlem/ingest geçmişi silinmez. Hata veren veya anahtarsız
    // kaynağın eski teklifleri korunur (doküman sözleşmesi).
    const currentOfferKeys = new Set(
      offerRows.map((offer) => `${offer.product_id}\u0000${offer.source}`),
    );
    const definitiveSources = new Set(
      prepared.sourceHealth
        .filter(
          (health) =>
            health.status === "ok" || health.status === "no_results" || health.status === "partial",
        )
        .map((health) => health.source),
    );
    const staleOfferIds = ((existingOffers ?? []) as OfferRow[])
      .filter((offer) => {
        const source = asString(offer["source"]);
        if (!definitiveSources.has(source)) return false;
        const key = `${asString(offer["product_id"])}\u0000${source}`;
        return !currentOfferKeys.has(key);
      })
      .map((offer) => asString(offer["id"]))
      .filter(Boolean);
    for (let i = 0; i < staleOfferIds.length; i += 200) {
      const { error } = await admin
        .from("h10_offers")
        .delete()
        .in("id", staleOfferIds.slice(i, i + 200));
      if (error) rethrowH10(error, "Eski Hidrojen10 teklifleri temizlenemedi");
    }

    if (prepared.sourceHealth.length) {
      const { error } = await admin.from("h10_source_runs").insert(
        prepared.sourceHealth.map((health) => ({
          run_id: runId,
          source: health.source,
          status: health.status,
          items: health.items,
          invalid_items: health.invalidItems,
          latency_ms: health.latencyMs,
          error: health.error,
          started_at: new Date(now.getTime() - health.latencyMs).toISOString(),
          finished_at: nowIso,
        })),
      );
      if (error) rethrowH10(error, "Hidrojen10 kaynak run'ları yazılamadı");
    }

    const runStatus =
      prepared.status === "failed"
        ? "failed"
        : prepared.status === "partial"
          ? "partial"
          : "completed";
    const { error: runUpdateError } = await admin
      .from("h10_runs")
      .update({
        status: runStatus,
        finished_at: nowIso,
        row_count: prepared.rowCount,
        source_stats: prepared.sourceHealth,
        error: prepared.error,
      })
      .eq("id", runId);
    if (runUpdateError) rethrowH10(runUpdateError, "Hidrojen10 run sonucu yazılamadı");

    const nicheUpdate: Record<string, unknown> = {
      source_stats: prepared.sourceHealth,
      last_error: prepared.error,
      status: prepared.status,
    };
    if (prepared.status !== "failed") {
      nicheUpdate["row_count"] = prepared.rowCount;
      nicheUpdate["last_scraped_at"] = nowIso;
      nicheUpdate["fresh_until"] = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      nicheUpdate["next_refresh_at"] = nicheUpdate["fresh_until"];
    }
    const { error: nicheUpdateError } = await admin
      .from("h10_niches")
      .update(nicheUpdate)
      .eq("id", nicheId);
    if (nicheUpdateError) rethrowH10(nicheUpdateError, "Hidrojen10 cache durumu yazılamadı");

    return { nicheId, runId, prepared };
  } catch (error) {
    await admin
      .from("h10_runs")
      .update({
        status: "failed",
        finished_at: nowIso,
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      })
      .eq("id", runId)
      .then(() => undefined);
    await admin
      .from("h10_niches")
      .update({
        status: "failed",
        last_error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      })
      .eq("id", nicheId)
      .then(() => undefined);
    throw error;
  }
}

/* ------------------------------------------------------- Ürün geçmişi */

export async function readH10ProductDetail(
  productId: string,
  nicheId?: string,
): Promise<H10ProductDetailResult> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return { ok: false, code: "not_found", message: "Ürün kimliği geçersiz." };
  }
  const admin = await db();
  const { data: productData, error: productError } = await admin
    .from("h10_products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (productError) rethrowH10(productError, "Ürün okunamadı");
  if (!productData) {
    return { ok: false, code: "not_found", message: "Ürün bulunamadı." };
  }
  const product = productData as ProductRow;

  let offerQuery = admin.from("h10_offers").select("*").eq("product_id", productId);
  if (nicheId) offerQuery = offerQuery.eq("niche_id", nicheId);
  const { data: offerData, error: offerError } = await offerQuery.limit(100);
  if (offerError) rethrowH10(offerError, "Ürün teklifleri okunamadı");
  const offers = ((offerData ?? []) as OfferRow[]).map(mapOffer);

  let historyQuery = admin
    .from("h10_observations")
    .select("*")
    .eq("product_id", productId)
    .gte("observed_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order("observed_at", { ascending: true })
    .limit(500);
  if (nicheId) historyQuery = historyQuery.eq("niche_id", nicheId);
  const { data: historyData, error: historyError } = await historyQuery;
  if (historyError) rethrowH10(historyError, "Ürün geçmişi okunamadı");
  const observations: H10Observation[] = ((historyData ?? []) as OfferRow[]).map((row, index) => ({
    id: asNumber(row["id"]) ?? index,
    source: asString(row["source"]),
    currency: asString(row["currency"], "USD"),
    priceLocalMinor: asNumber(row["price_local_minor"]),
    priceUsd: asNumber(row["price_usd"]),
    rating: asNumber(row["rating"]),
    ratingCount: asNumber(row["rating_count"]),
    inStock: asNullableBoolean(row["in_stock"]),
    observedAt: asString(row["observed_at"], new Date(0).toISOString()),
    eligible: row["eligible"] !== false,
    rejectionReason: asNullableString(row["rejection_reason"]),
    changed: row["changed"] === true,
  }));

  return {
    ok: true,
    product: {
      id: asString(product["id"]),
      identityKey: asString(product["identity_key"]),
      gtin: asNullableString(product["gtin"]),
      mpn: asNullableString(product["mpn"]),
      title: asString(product["title"], "Adsız ürün"),
      brand: asString(product["brand"]),
      imageUrl: asString(product["image_url"]),
      category: asString(product["category"]),
      createdAt: asString(product["created_at"]),
      lastSeenAt: asNullableString(product["last_seen_at"]),
    },
    offers,
    observations,
    rangeDays: 90,
  };
}

export type { NicheRow };
