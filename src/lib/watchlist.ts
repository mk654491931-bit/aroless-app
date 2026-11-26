/**
 * KAYDET / İZLE LİSTESİ — modül başına tarayıcıda tutulan kimlik listesi.
 *
 * Viral Ads ve Trend Radar'da "sonra bak" akışı yoktu; kullanıcı sekmeyi
 * kapatınca ilginç reklam/trend kayboluyordu. Sunucuya kişisel veri
 * göndermeden, yalnız kimlikleri saklar. Bozuk/eski JSON arayüzü kırmaz.
 */

const PREFIX = "aroless:watchlist:v1:";
const MAX_ITEMS = 80;

export function watchlistStorageKey(scope: string): string {
  return `${PREFIX}${String(scope ?? "")
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 40)}`;
}

/** Dışarıdan gelen JSON'u güvenli kimlik listesine çevirir. */
export function normalizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(
    0,
    MAX_ITEMS,
  );
}

/** Tek kimliği ekler/çıkarır; en son eklenen başa gelir. */
export function toggleWatchlist(ids: readonly string[], id: string): string[] {
  const key = String(id ?? "").trim();
  if (!key) return [...ids];
  return ids.includes(key) ? ids.filter((item) => item !== key) : [key, ...ids].slice(0, MAX_ITEMS);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWatchlist(scope: string): string[] {
  const store = storage();
  if (!store) return [];
  try {
    return normalizeWatchlist(JSON.parse(store.getItem(watchlistStorageKey(scope)) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeWatchlist(scope: string, ids: readonly string[]): string[] {
  const clean = normalizeWatchlist(ids);
  const store = storage();
  if (store) {
    try {
      store.setItem(watchlistStorageKey(scope), JSON.stringify(clean));
    } catch {
      /* kota/gizli mod: bellek içi devam */
    }
  }
  return clean;
}
