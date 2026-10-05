// ============================================================================
// SERPAPI — GOOGLE SHOPPING ÜRÜN KAYNAĞI (anahtar varsa devreye girer).
//
// NEDEN VAR (ölçüm, 2026-10-03): anahtarsız ürün-fiyatı kanallarının hepsi
// tıkandı. Bu sandbox IP'sinden canlı denendi ve ÖLÇÜLDÜ:
//   • MercadoLibre herkese açık arama ucu → HTTP 403 (tüm pazarlar)
//   • Google Books → HTTP 429
//   • Bing Shopping → HTTP 200 ama 0 kart (JS ile çiziliyor)
//   • DuckDuckGo → bot-guard, 0 sonuç
// SerpAPI'nin `google_shopping` motoru aynı veriyi STRUCTURED JSON olarak
// verir: gerçek mağaza fiyatı, yıldız puanı, değerlendirme sayısı, ürün
// görseli ve ülke/seçim parametresi. Yani "global" olmanın en ucuz yolu.
//
// DÜRÜSTLÜK:
//   * Anahtar yoksa AĞ ÇAĞRISI YAPILMAZ, kaynak 0 satır döner; hat düşmez.
//   * Yanıt bozuksa `null` döner, kart üretilmez.
//   * Çevrim (ayrıştırma) SAF ve testlidir: `toRawProducts` ağ olmadan
//     gerçek yanıt şekliyle sınanabilir.
//   * Ücretsiz plan aylık sınırlıdır → `allowSerpApiCredit` ile korunur
//     (ayrı kova; ScraperAPI kotasıyla PAYLAŞILMAZ).
// ============================================================================

import type { RawProduct } from "./product-discovery.types";
// NOT: `product-discovery-sources.server` bu dosyayı dinamik olarak import
// eder; buradan da onu statik import etmek ÇEVRİMMLİ bir bağımlılık olurdu.
// Oysa gürültü kapısı zaten fiyat üzerinden uygulanmış durumda: fiyatı
// olmayan kart `extractPrice` ile daha eleniyor.

/** Ortam anahtarı adları — ilk bulunan kullanılır. */
export function serpApiKey(): string {
  const raw =
    process.env.SERPAPI_KEY ?? process.env.SERP_API_KEY ?? process.env.SERPAPI_API_KEY ?? "";
  const key = String(raw).trim();
  return key;
}

export function serpApiConfigured(): boolean {
  return serpApiKey().length > 0;
}

/** SerpAPI'nin Google Shopping sonuç kaydı (yalnız okunan alanlar). */
export type SerpShoppingResult = {
  title?: unknown;
  product_id?: unknown;
  price?: unknown;
  extracted_price?: unknown;
  rating?: unknown;
  rating_count?: unknown;
  reviews?: unknown;
  thumbnail?: unknown;
  source?: unknown;
  merchant?: unknown;
  link?: unknown;
  delivery?: unknown;
};

/** SerpAPI ülke kodu → arama dili kodu. */
const HL_BY_COUNTRY: Record<string, string> = {
  TR: "tr",
  US: "en",
  GB: "en",
  DE: "de",
  FR: "fr",
  IT: "it",
  ES: "es",
  NL: "nl",
  PL: "pl",
  SE: "sv",
  BR: "pt",
  MX: "es",
  IN: "en",
  JP: "ja",
};

/**
 * SerpAPI yanıtını ürün satırlarına çevirir — SAF, ağ YOK.
 *
 * ÖLÇÜLEN ALAN DÖNÜŞÜMLERİ:
 *   • fiyat: `extracted_price` öncelikli (sayı), yoksa `price` metninden
 *     sayı çıkarılır. Para birimi `price` sonundaki sembolden okunur.
 *   • puan: `rating` 0-5 (SerpAPI zaten 0-5 verir; 10 üstü gelirse
 *     normalize edilir). `rating_count`/`reviews` → kaç kişi puan vermiş.
 *   • satıcı: `source` (mağaza adı) veya `merchant`.
 */
export function toRawProducts(
  results: readonly SerpShoppingResult[] | undefined,
  niche: string,
): RawProduct[] {
  const out: RawProduct[] = [];
  const seen = new Set<string>();
  for (const item of results ?? []) {
    const title = String(item?.title ?? "").trim();
    if (!title || title.length < 3) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;

    const price = extractPrice(item);
    if (price === null) continue; // fiyatsız kart kanıt değildir

    const { rating, count } = readRating(item);
    const seller = String(item?.source ?? item?.merchant ?? "").trim();
    const imageUrl = String(item?.thumbnail ?? "").trim();
    const url = String(item?.link ?? "").trim();

    const row: RawProduct = {
      title: title.slice(0, 180),
      brand: "",
      seller: seller || "Google Shopping",
      priceUsd: price.amount,
      rating,
      ratingCount: count,
      // Mağaza listesi stok vermez → bilinmiyor.
      inStock: null,
      source: "serpapi-shopping",
      url,
      imageUrl,
      notes: [
        seller,
        `${price.display}${price.currency ? ` ${price.currency}` : ""}`,
        count ? `${count.toLocaleString("tr-TR")} değerlendirme` : "",
        String(item?.delivery ?? "").trim(),
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    };
    // Başlık nişle alakalı olmalı (aynı kapı diğer kaynaklarda da var).
    const tokens = niche
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
      .slice(0, 4);
    if (tokens.length && !tokens.some((t) => key.includes(t))) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 12) break;
  }
  return out;
}

/** `price` metninden sayı + para birimi çıkarır; sayı yoksa `null`. */
export function extractPrice(item: SerpShoppingResult): {
  amount: number;
  currency: string;
  display: string;
} | null {
  const extracted = Number(item?.extracted_price);
  if (Number.isFinite(extracted) && extracted > 0) {
    return {
      amount: Math.round(extracted * 100) / 100,
      currency: currencyFromText(String(item?.price ?? "")),
      display: String(item?.price ?? extracted),
    };
  }
  const text = String(item?.price ?? "").trim();
  if (!text) return null;
  // "12,99 €", "$12.99", "USD 12.99" → sayı.
  const match = text.replace(/\s/g, "").match(/(\d[\d.,]*)/);
  if (!match) return null;
  const raw = match[1];
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let numeric: string;
  if (lastComma === -1 && lastDot === -1) numeric = raw;
  else if (lastComma > lastDot)
    numeric = `${raw.slice(0, lastComma).replace(/\./g, "")}.${raw.slice(lastComma + 1)}`;
  else numeric = raw.replace(/,/g, "");
  const n = Number(numeric);
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    amount: Math.round(n * 100) / 100,
    currency: currencyFromText(text),
    display: text,
  };
}

function currencyFromText(text: string): string {
  if (/€|\bEUR\b/i.test(text)) return "EUR";
  if (/£|\bGBP\b/i.test(text)) return "GBP";
  if (/\bTRY\b|₺/i.test(text)) return "TRY";
  if (/\bR\$|\bBRL\b/i.test(text)) return "BRL";
  if (/\bJPY\b|¥/i.test(text)) return "JPY";
  if (/\$|\bUSD\b/i.test(text)) return "USD";
  return "";
}

/** Puan + değerlendirme sayısı. Ölçülmemişse `null`. */
export function readRating(item: SerpShoppingResult): {
  rating: number | null;
  count: number | null;
} {
  const value = Number(item?.rating);
  if (!Number.isFinite(value) || value <= 0) return { rating: null, count: null };
  // SerpAPI 0-5 verir; 10'lu sistem gelirse normalize edilir.
  const rating = value > 5 ? Math.round((value / 10) * 5 * 10) / 10 : Math.round(value * 10) / 10;
  const countRaw = Number(item?.rating_count ?? item?.reviews ?? 0);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.round(countRaw) : null;
  return { rating: Math.max(0, Math.min(5, rating)), count };
}

/**
 * SerpAPI'ye tek istek atar. Anahtar yoksa HİÇ ağ çağrısı yapılmaz.
 * Hata fırlatmaz — hata `[]` olur, hat fail-soft devam eder.
 */
export async function serpShoppingSearch(
  query: string,
  country: string,
  timeoutMs = 6_000,
): Promise<SerpShoppingResult[]> {
  const key = serpApiKey();
  if (!key) return [];
  const code =
    String(country ?? "")
      .trim()
      .toUpperCase() || "US";
  const url =
    `https://serpapi.com/search.json?engine=google_shopping&hl=${HL_BY_COUNTRY[code] ?? "en"}` +
    `&gl=${code.toLowerCase()}&num=20&q=${encodeURIComponent(query.slice(0, 90))}&api_key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.log(`[serpapi] HTTP ${res.status}; anahtarsız kaynaklara düşülüyor`);
      return [];
    }
    const json = (await res.json()) as {
      shopping_results?: SerpShoppingResult[];
      error?: string;
    };
    if (json.error) {
      console.log(`[serpapi] hata: ${String(json.error).slice(0, 80)}`);
      return [];
    }
    return json.shopping_results ?? [];
  } catch (e) {
    console.log(`[serpapi] istek başarısız: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}
