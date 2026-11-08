// ============================================================================
// GOOGLE SHOPPING — TEK KOORDİNATÖR, YEDEKLİ SAĞLAYICI SEÇİMİ.
//
// NEDEN VAR (Adım 4, API verimliliği): SerpAPI, SearchAPI ve Serper aynı
// Google Shopping verisini satar. Önceden üçü de HER aramada paralel
// çağrılıyordu; aynı 20 satır için üç ayrı kota harcanıyor, sonra `filter`
// katmanı bunları tekilleştiriyordu. Artık:
//   1. En geniş kotalı sağlayıcı (Serper) birincil,
//   2. Sonuç hedefin altındaysa SearchAPI,
//   3. O da yetmezse SerpAPI denenir.
//
// KALİTE KURALI: Geçiş yalnız sonuç ZAYIFSA yapılır. Birincil sağlayıcı
// yeterli sayıda gerçek satır döndürdüğünde yedekler HİÇ çağrılmaz; böylece
// aynı veri için kota üçe katlanmaz. Birincil boş/hatalı dönerse yedek aynı
// aramada devreye girer — yani kota tasarrufu, veri kaybı pahasına değildir.
//
// ÖNBELLEK: Birleşik sonuç `google-shopping:v2` altında 24 saat tutulur.
// Aynı niş + ülke tekrar aranırsa üç sağlayıcıya da 0 istek gider.
// ============================================================================

import type { RawProduct } from "./product-discovery.types";

export type GoogleShoppingProvider = "serper" | "searchapi" | "serpapi";

/**
 * SIRA ÖLÇÜLEN KOTAYA GÖRE:
 *   Serper   → 2.500 tek seferlik kredi (en geniş)
 *   SearchAPI → ücretsiz ~100 arama/ay
 *   SerpAPI   → ücretsiz ~100 arama/ay (iç bütçe 80)
 * Bu sıra, dar kotalı sağlayıcıları yedekte tutar.
 */
export const GOOGLE_SHOPPING_PROVIDER_ORDER: readonly GoogleShoppingProvider[] = [
  "serper",
  "searchapi",
  "serpapi",
];

export const GOOGLE_SHOPPING_PROVIDER_LABELS: Readonly<Record<GoogleShoppingProvider, string>> = {
  serper: "Serper",
  searchapi: "SearchAPI",
  serpapi: "SerpAPI",
};

/** Sağlayıcı başına kabul edilen ortam değişkeni adları. */
const PROVIDER_ENV: Readonly<Record<GoogleShoppingProvider, readonly string[]>> = {
  serper: ["SERPER_API_KEY", "SERPER_KEY", "SERPER_DEV_API_KEY"],
  searchapi: ["SEARCHAPI_KEY", "SEARCHAPI_API_KEY", "SEARCHAPI_IO_KEY"],
  serpapi: ["SERPAPI_KEY", "SERP_API_KEY", "SERPAPI_API_KEY"],
};

/**
 * Bir sağlayıcının yeterli sayılması için gereken BENZERSİZ satır.
 *
 * 20: Google Shopping sayfasının standart sonuç sayısı. Daha azı, sorgu
 * varyantının dar/alakasız olduğunu veya sağlayıcının eksik döndüğünü
 * gösterir; o durumda yedek sağlayıcı kaliteyi tamamlar. Sağlayıcı 20+
 * benzersiz satır verdiyse aynı veriyi ikinci kez satın almak gereksizdir.
 */
export const DEFAULT_GOOGLE_SHOPPING_MIN_ROWS = 20;

/**
 * Eşik: varsayılan 20, `GOOGLE_SHOPPING_MIN_ROWS` ile 1..60 arası.
 * 60 = üç sağlayıcıyı da dene (maksimum kapsam, üç kat kota).
 */
export function googleShoppingMinRows(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number((env["GOOGLE_SHOPPING_MIN_ROWS"] ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_GOOGLE_SHOPPING_MIN_ROWS;
  return Math.min(60, Math.max(1, Math.round(raw)));
}

/** Anahtarın gerçekten tanımlı olup olmadığı (değer okunmaz/yazılmaz). */
export function googleShoppingProviderConfigured(
  provider: GoogleShoppingProvider,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return PROVIDER_ENV[provider].some((name) => (env[name] ?? "").trim() !== "");
}

/** Tanımlı sağlayıcılar, kota genişliğine göre sıralı. */
export function googleShoppingProviderPlan(
  env: Record<string, string | undefined> = process.env,
): GoogleShoppingProvider[] {
  return GOOGLE_SHOPPING_PROVIDER_ORDER.filter((provider) =>
    googleShoppingProviderConfigured(provider, env),
  );
}

/** Bir satırın sağlayıcılar arası tekrar anahtarı — fiyat/görsel değil, ürün. */
function shoppingRowKey(row: RawProduct): string {
  const title = String(row.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (title.length >= 8) return `t:${title}`;
  const url = String(row.url ?? "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return url ? `u:${url}` : "";
}

/**
 * Sağlayıcı satırlarını tek havuza ekler; aynı başlık ikinci kez sayılmaz.
 * Dönen sayı, eklenen YENİ satır sayısıdır (kalite ölçümü için).
 */
export function mergeShoppingRows(
  target: RawProduct[],
  rows: readonly RawProduct[],
): number {
  const seen = new Set(target.map(shoppingRowKey).filter(Boolean));
  let added = 0;
  for (const row of rows) {
    const key = shoppingRowKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    target.push(row);
    added += 1;
  }
  return added;
}

/**
 * Sağlayıcıları SIRAYLA çağırır; yeterli benzersiz satır oluşunca durur.
 *
 * `load` ağ katmanıdır (testte sahte). Hata fırlatan sağlayıcı diğerlerini
 * engellemez: o sağlayıcı atlanır, yedek devam eder. Bu, fail-soft
 * sözleşmesinin koordinatördeki karşılığıdır.
 */
export async function chooseGoogleShoppingRows(
  providers: readonly GoogleShoppingProvider[],
  load: (provider: GoogleShoppingProvider) => Promise<RawProduct[]>,
  opts: { minRows?: number } = {},
): Promise<{ rows: RawProduct[]; used: GoogleShoppingProvider[] }> {
  const minRows = Math.max(
    1,
    Math.floor(opts.minRows ?? DEFAULT_GOOGLE_SHOPPING_MIN_ROWS),
  );
  const rows: RawProduct[] = [];
  const used: GoogleShoppingProvider[] = [];

  for (const provider of providers) {
    used.push(provider);
    try {
      const fetched = await load(provider);
      mergeShoppingRows(rows, fetched);
    } catch {
      // Sağlayıcı hatası yedeklerin çalışmasını engellemez.
    }
    if (rows.length >= minRows) break;
  }

  return { rows, used };
}
