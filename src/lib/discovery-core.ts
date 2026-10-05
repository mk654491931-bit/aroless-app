// ============================================================================
// ÜRÜN KEŞİF ÇEKİRDEĞİ — ORTAK, SAF KATMAN (ağ YOK, AI YOK, saat YOK).
//
// NEDEN AYRI BİR "CORE": kalite/doğrulama sözleşmeleri (kimlik, bütünlük,
// kaynak güveni, AI seçim doğrulaması, görsel doğrulama) hattın BİRDEN ÇOK
// tüketicisi tarafından kullanılır — hat adımları, 14 ajan adaptörü, kısa
// liste, nihai sıralama ve arayüz. Bu sözleşmeler dağınık kaldığı sürece her
// tüketici kendi kopyasını üretiyor ve iki tüketici aynı ürüne farklı kimlik
// ya da farklı güven verebiliyordu.
//
// ÇEKİRDEK TEK KAYNAKTIR:
//   • `discovery-quality`          → kimlik (§24), bütünlük (§11), güven (§12), huni (§25)
//   • `discovery-ai-selection`     → AI seçiminin doğrulanması (§14/§20), ajan koruması (§18)
//   • `product-image-verification` → görsel doğrulama (HTTP 200 ≠ ürün görseli)
//
// ALTIN KURAL (hepsi aynı): ÖLÇÜLMEYEN ŞEY TAHMİN EDİLMEZ. Eksik alan `null`
// kalır, skor düşer, kimlik türetilir. Hiçbir tüketici bu kuralı gevşetemez.
//
// BU DOSYA SAF KALIR: `.server` bağımlılığı yoktur; birim testleri ağsız ve
// veritabanısız koşar.
// ============================================================================

import {
  dataCompletenessScore,
  productCompleteness,
  sourceConfidence,
  stableProductId,
} from "./discovery-quality";
import type { NormalizedProduct } from "./product-discovery.types";

// ---- Tek import yüzeyi: saf sözleşmelerin tamamı buradan yeniden dışa verilir.
export * from "./discovery-quality";
export * from "./discovery-ai-selection";
export * from "./product-image-verification";

/* ------------------------------------------------------ 1. Ölçülmüş kalite */

/**
 * Bir adayın ÖLÇÜLMÜŞ kalite sinyalleri (0-100) — AI YOK, ağ YOK.
 *
 * İki ayrı soruyu ayırır (§11/§12):
 *   • `completeness` — "bu ürünün ne kadarı ölçüldü?" (alan varlığı)
 *   • `confidence`   — "bu satıra ne kadar güvenilir?" (kaynak + kanıt + ölçüm)
 *
 * İkisi de YALNIZ gerçek veriye dayanır; eksik alan tahminle DOLDURULMAZ,
 * yalnız skoru düşürür. `confidence` deterministik bir gösterge ve yeniden
 * sıralama ölçütüdür — ürün verisi DEĞİLDİR.
 */
export type ProductQuality = { completeness: number; confidence: number };

export function candidateQuality(product: NormalizedProduct): ProductQuality {
  const completeness = productCompleteness(product).score;
  const confidence = sourceConfidence({
    origin: product.source,
    url: product.url,
    sourceCount: product.sources.length,
    completenessScore: completeness,
  });
  return { completeness, confidence };
}

/** Güvenin "düşük" sayıldığı eşik — özet ve panel aynı sayıyı paylaşır. */
export const LOW_CONFIDENCE_FLOOR = 40;

/**
 * Ölçülmüş kalite satırlarının TEK satırlık, loglanabilir özeti (§11/§12).
 *
 * "Kaç ürün var" demez; "ne kadar kanıtlı" der. Düşük güven satırları sayıyla
 * görünür, çünkü az kanıtlı bir adayı öne çıkarmak kaliteyi düşürür.
 */
export function describeQuality(rows: readonly ProductQuality[]): string {
  if (rows.length === 0) return "";
  const mean = (pick: (row: ProductQuality) => number) =>
    Math.round(rows.reduce((sum, row) => sum + pick(row), 0) / rows.length);
  const lowConfidence = rows.filter((row) => row.confidence < LOW_CONFIDENCE_FLOOR).length;
  return (
    `Kalite (§11/§12): ortalama bütünlük ${mean((r) => r.completeness)}/100 · ` +
    `ortalama kaynak güveni ${mean((r) => r.confidence)}/100` +
    (lowConfidence > 0 ? ` · ${lowConfidence} aday ${LOW_CONFIDENCE_FLOOR}/100 altı güvende` : "") +
    "."
  );
}

/** Normalize ürün kısa listesinin ölçülmüş kalite özeti. */
export function describeShortlistQuality(products: readonly NormalizedProduct[]): string {
  return describeQuality(products.map(candidateQuality));
}

/* ------------------------------- 2. Hat boyunca değişmeyen kimlik (§24) */

export type ProductIdentityKeyInput = {
  /** Tekilleştirme parmak izi (varsa en hızlı yol; hesaplanmışsa kullanılır). */
  fingerprint?: string | null;
  id?: string;
  name: string;
  brand?: string;
  seller?: string;
  url?: string;
};

/**
 * HAT BOYUNCA SABİT ADAY ANAHTARI — konsey, kısa liste ve nihai sıralama
 * AYNI anahtarı kullanır.
 *
 * Sıra: hazır parmak izi → `stableProductId`. Boş parmak izinde eski kod
 * `P{index}` yazıyordu; bu, sıra değişince kimliğin de değişmesi demekti ve
 * iki tüketici aynı ürünü farklı anahtarla arıyordu. Burada anahtar ürünün
 * ÖZÜNDEN türer, sıradan bağımsızdır ve ASLA boş dönmez.
 */
export function productIdentityKey(p: ProductIdentityKeyInput): string {
  const fingerprint = String(p.fingerprint ?? "").trim();
  if (fingerprint) return fingerprint;
  return stableProductId({
    id: p.id,
    title: p.name,
    brand: p.brand,
    seller: p.seller,
    url: p.url,
  });
}

/* --------------------------- 3. Düz (normalize edilmemiş) satır kalitesi */

/**
 * Normalize edilmemiş, düz bir ürün satırı için ölçülmüş kalite.
 *
 * Neden gerekli: eski/kardeş hatlar ürünü `NormalizedProduct` değil düz bir
 * kayıt olarak taşır (ör. `source_url` + `selling_price_usd`). Kalite
 * sözleşmesinin bu satırlarda da AYNI olması için alanlar burada açıkça
 * verilir; ölçülmeyen alan `null` bırakılır ve skoru düşürür — uydurulmaz.
 */
export type FlatProductQualityInput = {
  name: string;
  url?: string | null;
  priceUsd?: number | null;
  rating?: number | null;
  ratingCount?: number | null;
  imageUrl?: string | null;
  /** Görsel ürüne ait olduğu DOĞRULANDI mı. Varsayılan: adres varsa true. */
  imageVerified?: boolean;
  inStock?: boolean | null;
  brand?: string | null;
  category?: string | null;
  /** `scraped` = ölçülmüş satır; `ai` = modelin ürettiği satır (güven 0). */
  source?: "scraped" | "ai";
  sourceCount?: number;
};

export function qualityOfFlatProduct(input: FlatProductQualityInput): ProductQuality {
  const imageUrl = String(input.imageUrl ?? "").trim();
  const completeness = dataCompletenessScore({
    title: input.name,
    url: input.url,
    priceUsd: input.priceUsd,
    rating: input.rating,
    ratingCount: input.ratingCount,
    imageUrl,
    imageVerified: input.imageVerified ?? imageUrl.length > 0,
    inStock: input.inStock,
    brand: input.brand,
    category: input.category,
  }).score;
  const confidence = sourceConfidence({
    origin: input.source,
    url: input.url,
    sourceCount: input.sourceCount,
    completenessScore: completeness,
  });
  return { completeness, confidence };
}
