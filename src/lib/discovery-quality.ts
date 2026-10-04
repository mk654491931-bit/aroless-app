// ============================================================================
// ÜRÜN KALİTE KATMANI — saf, deterministik (ağ YOK, AI YOK, saat YOK).
//
// Bu katman dört soruyu ÖLÇÜLEBİLİR biçimde yanıtlar:
//
//   1. HAT BOYUNCA DEĞİŞMEYEN KİMLİK   → `productId`            (§24)
//   2. BU ÜRÜNÜN NE KADARI ÖLÇÜLDÜ?    → `dataCompletenessScore` (§11)
//   3. BU KAYNAĞA NE KADAR GÜVENİLİR?  → `sourceConfidence`      (§12)
//   4. HATTA NEREDE KAÇ ÜRÜN ELENDİ?    → `pipelineFunnel`        (§25)
//
// ÜÇÜNDE DE ORTAK KURAL: ÖLÇÜLMEYEN ŞEY TAHMİN EDİLMEZ. Skor düşer, alan
// `null` kalır. Skor "eksik" ile "ölçüp sıfır buldum"u AYIRIR (bu ayrım
// olmadan yüksek puanlı ama kanıtsız ürün, kanıtlı ama eksik ürünü yenebilir).
//
// `productId` NEDEN AYRI: kaynak satır kimliği (`id`) çoğu kaynakta boştur,
// başlık ise iki farklı ürünü birleştirip tek ürünü bölebilir. Kimlik ürünün
// ÖZÜNDEN (model kodu → parmak izi → normalize başlık+marka+satıcı) türetilir ve
// kısa bir hash ile sabitlenir; böylece kazımadan karta kadar DEĞİŞMEZ.
// ============================================================================

import {
  productFingerprint,
  productModelKey,
  type NormalizedProduct,
} from "./product-discovery.types";

/* ------------------------------------------------------- 1. Kalıcı kimlik */

/** Kimliğin okunabilir kısmı — en fazla 48 karakter, log'da insan okur. */
const MAX_SLUG = 48;

/** FNV-1a 32-bit — kısa, çakışmasızca yeterli, `crypto`'ya bağımlı değil. */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 7);
}

/** Başlığı URL/kimlik güvenli slug'a indirger. */
function slugify(value: string): string {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG);
}

/** Ürünün özünden türeyen, hattın tamamında DEĞİŞMEYEN kimlik. */
export type ProductIdentityInput = {
  /** Kaynağın verdiği satır kimliği — varsa en güçlü sinyal. */
  id?: string;
  title: string;
  brand?: string;
  seller?: string;
  url?: string;
};

/**
 * HAT BOYUNCA SABİT ÜRÜN KİMLİĞİ (`productId`).
 *
 * Öncelik: kaynak kimliği → model kodu → parmak izi → normalize başlık.
 *
 * NEDEN KAYNAK KİMLİĞİ EN GÜÇLÜ: iki kaynak aynı ürünü farklı yazdığında
 * (`model kodu` bazen yoktur) kaynak kimliği çoğu zaman ÇARPIŞMAZ; ama kaynak
 * kimliği ürünü değil SATIRI tanır. Bu yüzden kaynak kimliği hash'e girdiği
 * için aynı satır iki koşuda aynı kimliği alır — QStash'ın mükerrer
 * teslimatında ikinci çalıştırma aynı ürünü ikinci kez üretmez (§8).
 */
export function stableProductId(input: ProductIdentityInput): string {
  const title = String(input.title ?? "").trim();
  if (!title) return "";
  const sourceId = String(input.id ?? "").trim();
  const modelKey = productModelKey({ title, brand: input.brand ?? "" });
  const fingerprint = productFingerprint({
    title,
    brand: input.brand ?? "",
    seller: input.seller ?? "",
  });
  // Model kodu varsa en güçlı eşleştirme sinyalidir (bkz. `productModelKey`).
  const core = modelKey || fingerprint || slugify(title);
  const seed = sourceId || fingerprint || slugify(title) || title;
  return `p_${slugify(core)}_${shortHash(seed)}`;
}

/** Normalize edilmiş ürünün kalıcı kimliği. */
export function productIdOf(product: NormalizedProduct): string {
  return (
    stableProductId({
      id: product.id,
      title: product.name,
      brand: product.brand,
      seller: product.seller,
      url: product.url,
    }) || `p_${shortHash(product.fingerprint || product.name)}`
  );
}

/* ------------------------------- 2. Veri bütünlüğü (deterministik %) */

/**
 * Puanlanan alanlar ve ağırlıkları.
 *
 * Ağırlıklar "bu alan olmasa ürün kartı kullanılamaz" ilkesine göre seçildi:
 * başlık ve kaynak adresi olmayan satır bir satırdır, ürün değildir; görsel ve
 * fiyat olmayan satır ise ticari olarak değerlendirilemez.
 *
 * NEDEN `description`/`notes` YOK: bunlar kaynakta serbest metin olduğu için
 * "ölçüldü" sayılamaz — bir satır 500 karakterlik haber metni taşıyor diye
 * kanıtı güçlü olmaz.
 */
export const COMPLETENESS_FIELDS = [
  { key: "title", weight: 3, label: "Başlık" },
  { key: "sourceUrl", weight: 3, label: "Kaynak adresi" },
  { key: "price", weight: 3, label: "Fiyat" },
  { key: "currency", weight: 1, label: "Para birimi" },
  { key: "rating", weight: 2, label: "Puan" },
  { key: "reviewCount", weight: 2, label: "Değerlendirme sayısı" },
  { key: "image", weight: 2, label: "Ürün görseli" },
  { key: "availability", weight: 1, label: "Stok" },
  { key: "brand", weight: 1, label: "Marka" },
  { key: "category", weight: 1, label: "Kategori" },
] as const;

export type CompletenessFieldKey = (typeof COMPLETENESS_FIELDS)[number]["key"];

export type CompletenessInput = {
  title?: string | null;
  url?: string | null;
  priceUsd?: number | null;
  /** Para birimi ölçüldü mü. Fiyat varsa para birimi de ölçülmüş sayılır. */
  currencyMeasured?: boolean;
  rating?: number | null;
  ratingCount?: number | null;
  imageUrl?: string | null;
  /** Görsel doğrulanmış mı — `false` ise "ölçüldü ama ürüne ait değil". */
  imageVerified?: boolean;
  inStock?: boolean | null;
  brand?: string | null;
  category?: string | null;
};

export type CompletenessResult = {
  /** 0-100. Eksik alan düşürür; ASLA doldurulmaz. */
  score: number;
  /** Ölçülmüş alan sayısı / toplam. */
  measured: number;
  total: number;
  /** Eksik alanların ETİKETLERİ — panel "bu puan neden düşük?" diye gösterir. */
  missing: string[];
};

function measuredField(input: CompletenessInput, key: CompletenessFieldKey): boolean {
  switch (key) {
    case "title":
      return String(input.title ?? "").trim().length > 0;
    case "sourceUrl":
      return /^https?:\/\//i.test(String(input.url ?? "").trim());
    case "price":
      return (
        typeof input.priceUsd === "number" && Number.isFinite(input.priceUsd) && input.priceUsd > 0
      );
    case "currency":
      // Fiyat ölçüldüyse para birimi de ölçülmüştür; ayrı alan ölçülmediyse
      // "ölçtük ve sıfır" demek değildir, bu yüzden fiyatla birlikte sayılır.
      return input.currencyMeasured === true || measuredField(input, "price");
    case "rating":
      return typeof input.rating === "number" && Number.isFinite(input.rating);
    case "reviewCount":
      return typeof input.ratingCount === "number" && Number.isFinite(input.ratingCount);
    case "image":
      // Yalnız DOĞRULANMIŞ görsel sayılır: adresi olan ama ürüne ait olduğu
      // kanıtlanmayan görsel, kanıt değil; olmayandan iyidir ama sayılmaz.
      return input.imageVerified === true && String(input.imageUrl ?? "").trim().length > 0;
    case "availability":
      return typeof input.inStock === "boolean";
    case "brand":
      return String(input.brand ?? "").trim().length > 0;
    case "category":
      return String(input.category ?? "").trim().length > 0;
  }
}

/**
 * Deterministic veri bütünlüğü skoru (0-100).
 *
 * Örnek çıktı: `{ score: 95, measured: 19, total: 19, missing: [] }` ya da
 * `{ score: 43, measured: 8, total: 19, missing: ["Fiyat", "Ürün görseli"] }`.
 */
export function dataCompletenessScore(input: CompletenessInput): CompletenessResult {
  let earned = 0;
  let possible = 0;
  const missing: string[] = [];
  let measured = 0;
  for (const field of COMPLETENESS_FIELDS) {
    possible += field.weight;
    if (measuredField(input, field.key)) {
      earned += field.weight;
      measured++;
    } else {
      missing.push(field.label);
    }
  }
  return {
    score: possible > 0 ? Math.round((earned / possible) * 100) : 0,
    measured,
    total: COMPLETENESS_FIELDS.length,
    missing,
  };
}

/** Normalize üründen bütünlük skoru (doğrulanmış görsel alanı dışarıdan verilir). */
export function productCompleteness(
  product: NormalizedProduct,
  options: { imageVerified?: boolean; currencyMeasured?: boolean } = {},
): CompletenessResult {
  return dataCompletenessScore({
    title: product.name,
    url: product.url,
    priceUsd: product.priceUsd,
    currencyMeasured: options.currencyMeasured ?? typeof product.priceUsd === "number",
    rating: product.rating,
    ratingCount: product.ratingCount,
    imageUrl: product.imageUrl,
    imageVerified: options.imageVerified ?? product.imageUrl.trim().length > 0,
    inStock: product.inStock,
    brand: product.brand,
    category: product.category,
  });
}

/* ------------------------------------------- 3. Kaynak güveni (0-100) */

/**
 * Kaynak güven bileşenleri — hepsi ÖLÇÜLMÜŞ sinyalden türetilir.
 *
 * `scraped` olmayan satır (modelin ürettiği satır) güven puanı ALAMAZ:
 * kaynak güveni "bu satır gerçekten bir sayfadan mı geldi" sorusunun cevabıdır.
 */
export const SOURCE_CONFIDENCE_WEIGHTS = {
  /** Satır gerçek bir kaynaktan mı (AI üretimi değil). */
  origin: 0.3,
  /** Kaynak adresi gerçek bir ürün sayfası mı. */
  evidenceUrl: 0.2,
  /** Kaç bağımsız kaynak aynı ürünü buldu. */
  corroboration: 0.2,
  /** Ölçülmüş alan derinliği. */
  completeness: 0.3,
} as const;

export type SourceConfidenceInput = {
  /** `scraped` = ölçülmüş satır; `ai` = modelin ürettiği satır. */
  origin?: "scraped" | "ai";
  url?: string | null;
  /** Bu ürünü bulan kaynak sayısı (çakışma tespiti sonrası). */
  sourceCount?: number;
  /** `dataCompletenessScore(...).score` (0-100). */
  completenessScore?: number;
};

/**
 * Deterministik kaynak güven skoru (0-100).
 *
 * Ölçülmemiş bileşen 0 değil NÖTR katkı verir; böylece eksik veri "kötü
 * kaynak" gibi görünmez, "kanıtı az" gibi görünür.
 */
export function sourceConfidence(input: SourceConfidenceInput): number {
  const w = SOURCE_CONFIDENCE_WEIGHTS;
  // AI üretimi satır: güven 0. AI satırı kanıt değildir.
  if (input.origin === "ai") return 0;

  const origin = 1;
  const evidenceUrl = /^https?:\/\//i.test(String(input.url ?? "").trim()) ? 1 : 0;
  const count = Math.max(0, Number(input.sourceCount ?? 0));
  // Tek kaynak 0.4, iki kaynak 0.7, üç+ 1.0 — doğrusal değil, hızlı artar:
  // ikinci bağımsız kaynak kanıtı en çok artıran eklemedir.
  const corroboration = count <= 0 ? 0 : count === 1 ? 0.4 : count === 2 ? 0.7 : 1;
  const completeness = Math.max(0, Math.min(100, Number(input.completenessScore ?? 0))) / 100;

  const score =
    (origin * w.origin +
      evidenceUrl * w.evidenceUrl +
      corroboration * w.corroboration +
      completeness * w.completeness) *
    100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/* -------------------------------------- 4. Huni (funnel) gözlemlenebilirliği */

/** Hattın aşamaları — sıra sözleşmedir. */
export const PIPELINE_STAGES = [
  "scraped",
  "normalized",
  "validated",
  "filtered",
  "top75",
  "gemini_input",
  "gemini_output",
  "council_input",
  "final",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineFunnel = Record<PipelineStage, number>;

/** Her aşama 0 olan boş huni. */
export function emptyFunnel(): PipelineFunnel {
  return PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage] = 0;
    return acc;
  }, {} as PipelineFunnel);
}

/**
 * Huni ilerlemesini tek satırlık, loglanabilir metne çevirir.
 *
 * Amaç: "hangi aşamada kaç ürün elendi" sorusu TAHMİNLE değil, sayıyla
 * yanıtlansın. Eleme dökümü `rejections` ile birlikte verilir.
 */
export function describeFunnel(
  funnel: Partial<PipelineFunnel>,
  rejections: Record<string, number> = {},
): string {
  const parts = PIPELINE_STAGES.filter((stage) => typeof funnel[stage] === "number").map(
    (stage) => `${stage.toUpperCase()}: ${funnel[stage]}`,
  );
  const dropped = Object.entries(rejections)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}: ${count}`);
  return dropped.length
    ? `${parts.join(" → ")} · eleme { ${dropped.join(", ")} }`
    : parts.join(" → ");
}

/** Sayıyı güvenli biçimde artırır (`undefined`/`NaN` 0 kabul edilir). */
export function bumpCount(value: unknown, delta = 1): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(n + delta));
}
