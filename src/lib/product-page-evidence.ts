/**
 * ÜRÜN SAYFASI KANITI — saf ayrıştırıcı (ağ YOK, AI YOK).
 *
 * NEDEN VAR (ölçülen boşluk, 2026-11-09): arama/liste sayfası bazı ürünlerde
 * puan ve değerlendirme sayısı vermiyor (ör. Bing Shopping kartı). Kartta
 * "Talep kanıtı —" ve "Puan —" kalıyordu; oysa ürünün KENDİ sayfasında
 * `schema.org/Product` JSON-LD içinde `aggregateRating` olabiliyor.
 *
 * KURAL: yalnız sayfada YAZILI sayı okunur. Puan/değerlendirme yoksa `null`
 * döner; görselden tahmin, yıldız sayısından çıkarım YAPILMAZ.
 */

import { parseMarketplaceHtml } from "./marketplace-jsonld";

export type ProductPageEvidence = {
  rating: number | null;
  ratingCount: number | null;
  /** Kanıtın okunduğu yol: JSON-LD mi, sayfa metni mi? */
  source: "jsonld" | "text" | "none";
};

const EMPTY: ProductPageEvidence = { rating: null, ratingCount: null, source: "none" };

/** "1.234", "1,234", "846" → 1234 / 846. */
function parseCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  // Türkçe/İngilizce binlik ayırıcı: son ayırıcıdan sonra 3 hane varsa binlik.
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  let digits = cleaned;
  if (last >= 0 && cleaned.length - last - 1 === 3) {
    digits = cleaned.replace(/[.,]/g, "");
  } else {
    digits = cleaned.replace(/,/g, ".");
  }
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 0-5 dışındaki puanı kabul etmez (10'luk sistem JSON-LD'de normalize edilir). */
function parseRating(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

/**
 * HTML'den puan ve değerlendirme sayısını çıkarır.
 *
 * SIRA: JSON-LD (standart, en güvenilir) → sayfa metni (Türkçe/İngilizce
 * yaygın kalıplar). JSON-LD varsa metne hiç bakılmaz; böylece sayfadaki
 * "önerilen ürünler" sayıları ana ürünün puanı sanılmaz.
 */
export function extractProductPageEvidence(html: string): ProductPageEvidence {
  const text = String(html ?? "");
  if (!text.trim()) return EMPTY;

  const rows = parseMarketplaceHtml(text, 5);
  for (const row of rows) {
    if (row.rating !== null || row.ratingCount !== null) {
      return {
        rating: row.rating,
        ratingCount: row.ratingCount,
        source: "jsonld",
      };
    }
  }

  // JSON-LD ayrıştırıcısı ürün bulamadıysa sayfanın kendi metnine bak.
  // Yalnız AÇIK puan/değerlendirme kalıpları; çıplak "4.7" sayısı puan sayılmaz.
  const ratingRaw =
    /"ratingValue"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)/i.exec(text)?.[1] ??
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:\/\s*5|üzerinden\s*5|out\s+of\s+5)/i.exec(text)?.[1] ??
    /(?:puan[ıi]?\s*)([0-9]+(?:[.,][0-9]+)?)/i.exec(text)?.[1];
  const countRaw =
    /"(?:ratingCount|reviewCount)"\s*:\s*"?([0-9][0-9.,]*)/i.exec(text)?.[1] ??
    /([0-9][0-9.,]*)\s*(?:değerlendirme|yorum|ratings?|reviews?)\b/i.exec(text)?.[1];

  const rating = parseRating(ratingRaw);
  const ratingCount = parseCount(countRaw);
  if (rating === null && ratingCount === null) return EMPTY;
  return { rating, ratingCount, source: "text" };
}
