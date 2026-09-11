// ============================================================================
// Product Discovery — immediate DB push (Supabase / Postgres)
//
// Products are persisted one at a time, the moment the scanner produces them,
// so a long scan is never lost to a gateway timeout. Every write is best-effort:
// a failed DB push is reported back to the caller (and streamed as an
// `error` frame) but never aborts the scan or the SSE stream.
// ============================================================================

import type { StreamedProduct } from "./product-stream.shared";

export type ProductInsert = {
  user_id: string;
  title: string;
  category: string | null;
  cost_price: number;
  selling_price: number;
  target_country: string;
  trend_score: number;
  competition_level: "Low" | "Medium" | "High";
  profit_margin: number;
  viral_probability_90d: number;
  health_score: number;
  sellability_verdict: "Highly Sellable" | "Moderate Risk" | "Do Not Sell";
  status_message: string | null;
};

export type ProductStoreMeta = {
  /** `null` for anonymous callers — the product is streamed but not stored. */
  userId: string | null;
  targetCountry: string;
};

export type PersistOutcome = {
  saved: boolean;
  rowId?: string;
  error?: string;
  /** Set when the write was intentionally skipped (e.g. anonymous caller). */
  skipped?: "unauthenticated";
};

/** Minimal structural view of the Supabase client this module needs. */
export type ProductStoreClient = {
  from(table: string): {
    insert(values: ProductInsert[]): {
      select(columns: string): { single(): Promise<InsertResult> };
    };
  };
};

type InsertResult = {
  data: { id?: string } | null;
  error: { message: string } | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

/** Extracts the first real number out of a human-written money string. */
export function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const match = String(value).match(/[\d,.]+/);
  if (!match) return 0;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function verdictFor(product: StreamedProduct): ProductInsert["sellability_verdict"] {
  if (product.margin_pct >= 35 && product.score >= 70) return "Highly Sellable";
  if (product.margin_pct < 10 || product.score < 40) return "Do Not Sell";
  return "Moderate Risk";
}

/** Pure mapping from a streamed product to the `products` table row. */
export function toProductInsert(product: StreamedProduct, meta: ProductStoreMeta): ProductInsert {
  return {
    user_id: meta.userId ?? "",
    title: product.name.slice(0, 200),
    category: null,
    cost_price: parseMoney(product.supplier_cost_usd),
    selling_price: parseMoney(product.retail_price_usd),
    target_country: product.country || meta.targetCountry || "GLOBAL",
    trend_score: clamp(product.score, 0, 100),
    competition_level: product.competition,
    profit_margin: clamp(product.margin_pct, -100, 100),
    viral_probability_90d: clamp(product.score, 0, 100),
    health_score: clamp(product.score, 0, 100),
    sellability_verdict: verdictFor(product),
    status_message: product.why_now.slice(0, 240) || null,
  };
}

/**
 * Persists one product immediately. Never throws — the caller streams the
 * returned outcome so the UI can show exactly which items were stored.
 */
export async function persistStreamedProduct(
  product: StreamedProduct,
  meta: ProductStoreMeta,
  client?: ProductStoreClient,
): Promise<PersistOutcome> {
  if (!meta.userId) return { saved: false, skipped: "unauthenticated" };

  try {
    const store =
      client ??
      ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as
        ProductStoreClient | undefined);
    if (!store) return { saved: false, error: "storage_unavailable" };

    const { data, error } = await store
      .from("products")
      .insert([toProductInsert(product, meta)])
      .select("id")
      .single();

    if (error) {
      console.error("[product-store] insert failed", error.message);
      return { saved: false, error: error.message };
    }
    return { saved: true, ...(data?.id ? { rowId: data.id } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[product-store] insert threw", message);
    return { saved: false, error: message };
  }
}
