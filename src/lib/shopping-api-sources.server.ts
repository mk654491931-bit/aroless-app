// ============================================================================
// SEARCHAPI + SERPER — GOOGLE SHOPPING VERİSİNİ ÜCRETSİZ KOTAYLA GETİREN İKİ
// EK KAYNAK (anahtar varsa devreye girer, yoksa 0 ms'de boş döner).
//
// NEDEN VAR (ölçülen boşluk): SerpAPI tek başına aylık ~100 aramayla sınırlı ve
// FRESH kurulumlarda tek darboğaz o. Aynı Google Shopping verisini (gerçek
// mağaza fiyatı, yıldız puanı, değerlendirme sayısı, ürün görseli) ücretsiz
// katmanla veren iki servis daha var:
//   • SearchAPI.io  — `engine=google_shopping`, ücretsiz ~100 arama/ay,
//     yanıt şeması SerpAPI ile AYNI (`shopping_results[]`).
//   • Serper.dev    — `POST /shopping`, ücretsiz 2.500 tek seferlik kredi,
//     yanıt şeması `shopping[]` (alan adları farklı: `imageUrl`,
//     `ratingCount`).
//
// ÜÇÜ BİRDEN KULLANILIR, biri diğerinin yerine geçmez: aynı koşuda üç kaynak
// ayrı satır üretir ve `filter` katmanı tekilleştirir (fingerprint/GTIN).
// Böylece SerpAPI kotası dolduğunda ürün araması ölmez.
//
// DÜRÜSTLÜK:
//   • Anahtar yoksa AĞ ÇAĞRISI YAPILMAZ (`scrape` 0 satır döner).
//   • Ayrıştırma SAF ve testlidir (`parseSerperShopping`, `parseSearchApiShopping`);
//     fiyatı okunamayan kart satır ÜRETMEZ — sayı uydurulmaz.
//   • Kotayı SerpAPI ile PAYLAŞMAZLAR: her servis kendi aylık kovasına sahiptir.
// ============================================================================

import type { RawProduct } from "./product-discovery.types";
import { toRawProducts, type SerpShoppingResult } from "./serpapi-shopping.server";

/** SearchAPI.io anahtarı — ilk dolu ad kullanılır. */
export function searchApiKey(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["SEARCHAPI_KEY", "SEARCHAPI_API_KEY", "SEARCHAPI_IO_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** Serper.dev anahtarı — ilk dolu ad kullanılır. */
export function serperKey(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["SERPER_API_KEY", "SERPER_KEY", "SERPER_DEV_API_KEY"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** Ülke kodu → Google arama dili. SerpAPI kaynağıyla aynı tablo. */
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

const langFor = (country: string): string =>
  HL_BY_COUNTRY[String(country ?? "").trim().toUpperCase()] ?? "en";

/**
 * Serper `/shopping` yanıtını ürün satırlarına çevirir — SAF, ağ YOK.
 *
 * ÖLÇÜLEN ALAN EŞLEMESİ (Serper → ortak şema):
 *   `title` → title, `price` → price (metin, "$12.99"),
 *   `rating` → rating (0-5), `ratingCount` → rating_count,
 *   `imageUrl` → thumbnail, `source` → source (mağaza), `link` → link,
 *   `delivery` → delivery.
 *
 * Dönüşüm `toRawProducts`a devredilir: fiyatı okunamayan kart ATILIR,
 * başlık nişle örtüşmüyorsa ATILIR, aynı başlık iki kez sayılmaz.
 */
export function parseSerperShopping(payload: unknown, niche: string): RawProduct[] {
  const shopping = (payload as { shopping?: unknown })?.shopping;
  if (!Array.isArray(shopping)) return [];
  const items: SerpShoppingResult[] = [];
  for (const raw of shopping) {
    const it = (raw ?? {}) as Record<string, unknown>;
    items.push({
      title: it["title"],
      price: it["price"],
      rating: it["rating"],
      rating_count: it["ratingCount"] ?? it["reviews"],
      thumbnail: it["imageUrl"] ?? it["thumbnail"],
      source: it["source"],
      link: it["link"],
      delivery: it["delivery"],
    });
  }
  return toRawProducts(items, niche).map((row) => ({ ...row, source: "serper-shopping" }));
}

/**
 * SearchAPI `google_shopping` yanıtını ürün satırlarına çevirir — SAF, ağ YOK.
 *
 * Şema SerpAPI ile aynıdır (`shopping_results[]`); yalnız `source` etiketi
 * değiştirilir ki koşu raporunda hangi servisin verdiği görünsün.
 */
export function parseSearchApiShopping(payload: unknown, niche: string): RawProduct[] {
  const results = (payload as { shopping_results?: unknown })?.shopping_results;
  if (!Array.isArray(results)) return [];
  return toRawProducts(results as SerpShoppingResult[], niche).map((row) => ({
    ...row,
    source: "searchapi-shopping",
  }));
}

/** SearchAPI.io `google_shopping` araması. Hata fırlatmaz (`[]` döner). */
export async function fetchSearchApiShopping(
  query: string,
  country: string,
  timeoutMs = 6_000,
): Promise<RawProduct[]> {
  const key = searchApiKey();
  if (!key) return [];
  const q = String(query ?? "").trim().slice(0, 90);
  if (!q) return [];
  const code = String(country ?? "").trim().toUpperCase() || "US";
  const url =
    `https://www.searchapi.io/api/v1/search?engine=google_shopping` +
    `&q=${encodeURIComponent(q)}&gl=${code.toLowerCase()}&hl=${langFor(code)}` +
    `&api_key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.log(`[searchapi] HTTP ${res.status}; diğer kaynaklara düşülüyor`);
      return [];
    }
    return parseSearchApiShopping(await res.json().catch(() => null), q);
  } catch (e) {
    console.log(`[searchapi] istek başarısız: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}

/** Serper.dev `/shopping` araması. Hata fırlatmaz (`[]` döner). */
export async function fetchSerperShopping(
  query: string,
  country: string,
  timeoutMs = 6_000,
): Promise<RawProduct[]> {
  const key = serperKey();
  if (!key) return [];
  const q = String(query ?? "").trim().slice(0, 90);
  if (!q) return [];
  const code = String(country ?? "").trim().toUpperCase() || "US";
  try {
    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
        accept: "application/json",
      },
      body: JSON.stringify({
        q,
        gl: code.toLowerCase(),
        hl: langFor(code),
        num: 20,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.log(`[serper] HTTP ${res.status}; diğer kaynaklara düşülüyor`);
      return [];
    }
    return parseSerperShopping(await res.json().catch(() => null), q);
  } catch (e) {
    console.log(`[serper] istek başarısız: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}
