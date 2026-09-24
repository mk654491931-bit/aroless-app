/**
 * Isınma/bayat önbelleği (stale-while-revalidate) — herkese açık AI uçlarının
 * 504 üretmemesinin garantisi.
 *
 * Desen (projede `hot-products` uç noktasıyla yerleşmiş olan davranışın
 * paylaşılan hâli):
 *
 *  - **ready**: önbellek taze → beklemeden dön.
 *  - **stale**: önbellek bayat ama kullanılabilir → ESKİ veriyi hemen dön, taze
 *    veri arka planda üretilip önbelleğe yazılır. Kullanıcı asla beklemez.
 *  - **warming**: önbellek boş → taramayı başlat, en fazla `WARM_WAIT_MS`
 *    bekle; yetişmezse `warming` olarak **anında** dön. İstemci birkaç saniye
 *    sonra tekrar sorar ve bu kez önbellekten gerçek veriyi alır.
 *
 * Böylece hiçbir istek platformun kesme süresine dayanmaz: 504 yerine hızlı bir
 * "hazırlanıyor" yanıtı ve ardından gerçek veri gelir.
 */

import {
  interactiveRequestBudgetMs,
  warmingWaitMs,
  withDeadlineOutcome,
} from "@/lib/host-runtime.server";

export type SwrStatus = "ready" | "stale" | "warming" | "failed";

/**
 * `fromCache: true` → bu istek YENİ BİR ÜRETİM BAŞLATMADI: veri önbellekten
 * geldi ya da zaten koşan bir tazelemeyi paylaştı. Jeton tahsil eden uçlar
 * bunu kullanır: önbellekten dönen yanıt ve panelin yoklamaları kredi
 * harcamaz, yalnızca gerçekten AI turu başlatan istek harcar.
 */
export type SwrResult<T> = { data: T | null; status: SwrStatus; fromCache: boolean };

type Entry<T> = { data: T; at: number };

type EnvMap = Record<string, string | undefined>;

export type SwrOptions<T> = {
  /** Önbellek anahtarı (ülke/görünüm vb. dahil tam anahtar). */
  key: string;
  /** Bu süreden yeni veriler doğrudan `ready` döner. */
  freshMs: number;
  /** Veriyi üreten pahalı fonksiyon. */
  build: () => Promise<T>;
  /** Veri "kullanılabilir" mi (ör. liste boşsa önbelleğe yazılmaz). */
  isValid?: (value: T) => boolean;
  /** Soğuk önbellekte istek içinde bekleme süresi (varsayılan `WARM_WAIT_MS`). */
  waitMs?: number;
  /** Map'te tutulacak en fazla kayıt (varsayılan 50). */
  maxEntries?: number;
  env?: EnvMap;
};

const entries = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_MAX_ENTRIES = 50;
const MAX_ENTRIES_HARD_LIMIT = 400;

/** Kalıcı katmanın (Supabase `ai_cache`) anahtar ön eki. */
const PERSIST_PREFIX = "swr:v1:";
/** Kalıcı okuma kısa tutulur: önbellek yüzünden istek gecikmemeli. */
const PERSIST_READ_MS = 2_500;

/**
 * Kalıcı katman testlerde kapatılır.
 *
 * Testler bu modülün BELLEK içi sözleşmesini doğrular (ready/stale/warming);
 * gerçek Supabase'e yazıp okusaydı önceki koşulardan kalan kayıtlar sonucu
 * değiştirir ve süite kararsız hâle gelirdi. Kalıcı katmanın kendisi
 * `ai-cache.server.ts` üzerinden ayrıca kullanılır.
 */
function persistEnabled(env: EnvMap = process.env): boolean {
  if (env["SWR_PERSIST"] === "off") return false;
  return !(env["VITEST"] || env["NODE_ENV"] === "test");
}

/**
 * Bellekte kayıt yokken kalıcı katmandan okur.
 *
 * Neden: sunucusuz çalıştırmada (Vercel) `entries` Map'i örnek başına ve
 * geçicidir. Kalıcı katman olmadan her soğuk örnek pahalı üretimi sıfırdan
 * yapar; kullanıcı ya dakikalarca bekler ya boş/`warming` yanıt alır. Kayıtlı
 * yaş (`at`) korunur, böylece bayat veri "taze" sanılmaz.
 */
async function hydrate<T>(key: string, isValid: (value: T) => boolean): Promise<Entry<T> | null> {
  if (!persistEnabled()) return null;
  try {
    const { cacheGet } = await import("@/lib/ai-cache.server");
    const hit = await cacheGet<Entry<T>>(`${PERSIST_PREFIX}${key}`);
    if (!hit || !isValid(hit.data)) return null;
    return { data: hit.data, at: Number(hit.at) || Date.now() };
  } catch {
    return null;
  }
}

/** Üretilen veriyi kalıcı katmana yazar (en iyi çaba). */
async function persist<T>(key: string, entry: Entry<T>): Promise<void> {
  if (!persistEnabled()) return;
  try {
    const { cacheSet } = await import("@/lib/ai-cache.server");
    await cacheSet(`${PERSIST_PREFIX}${key}`, "swr", entry);
  } catch (e) {
    console.error(`[swr] ${key} kalıcı yazma hatası`, e);
  }
}

function passThrough<T>(value: T): boolean {
  return value !== null && value !== undefined;
}

function prune(maxEntries: number): void {
  const limit = Math.min(MAX_ENTRIES_HARD_LIMIT, Math.max(1, maxEntries));
  // Map ekleme sırasını korur: en eski kayıtlar ilk sıradadır.
  while (entries.size > limit) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Veriyi doğrudan önbelleğe yazar (test/ısınma senaryoları). */
export function seedSwrCache<T>(key: string, data: T, at = Date.now()): void {
  entries.set(key, { data, at });
  prune(DEFAULT_MAX_ENTRIES);
}

/** Önbelleği temizler; `prefix` verilirse yalnızca o anahtarlar silinir. */
export function clearSwrCache(prefix?: string): void {
  if (!prefix) {
    entries.clear();
    return;
  }
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** /health için küçük teşhis özeti. */
export function swrCacheStats(): { entries: number; inflight: number } {
  return { entries: entries.size, inflight: inflight.size };
}

/**
 * Soğuk önbellekte istek içinde gerçekten bekleyeceğimiz süre.
 *
 * `WARM_WAIT_MS` ile platformun istek bütçesinin **küçüğüdür**: hiçbir ayar
 * tek bir isteği platform limitinin üzerine çıkaramaz. Böylece "istek 504'e
 * dönmez" garantisi yapılandırmayla bozulamaz.
 */
export function swrWaitMs(env: EnvMap = process.env): number {
  return Math.min(warmingWaitMs(env), interactiveRequestBudgetMs(env));
}

function startRefresh<T>(opts: SwrOptions<T>): { promise: Promise<T>; started: boolean } {
  const running = inflight.get(opts.key) as Promise<T> | undefined;
  // Zaten koşan bir üretim varsa onu PAYLAŞIRIZ: bu istek yeni iş başlatmaz,
  // dolayısıyla jeton tahsil eden uçlar onu ücretsiz sayar (yoksa 4 sn'de bir
  // yoklayan panel aynı analiz için her yoklamada jeton düşerdi).
  if (running) return { promise: running, started: false };

  const isValid = opts.isValid ?? passThrough;
  const p = opts
    .build()
    .then(async (value) => {
      // Boş/geçersiz sonucu önbelleğe yazmayız; yoksa bir sonraki istek
      // "taze" sanıp boş liste gösterirdi.
      if (isValid(value)) {
        const entry = { data: value, at: Date.now() };
        entries.set(opts.key, entry);
        prune(opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
        // Yazma beklenir: istek yenilemeyi bekliyorsa veri kalıcı katmana da
        // inmiş olur ve sunucusuz ortamda bir sonraki istek onu bulur.
        await persist(opts.key, entry);
      }
      return value;
    })
    .finally(() => {
      inflight.delete(opts.key);
    });

  inflight.set(opts.key, p);
  // Arka planda biten tazeleme hatası isteği düşürmesin (log yeterli).
  p.catch((e) => console.error(`[swr] ${opts.key} tazeleme hatası`, e));
  return { promise: p, started: true };
}

/**
 * Önbellekten yanıt üretir; bayat veride arka plan tazelemesi başlatır.
 * `data: null` + `status: "warming"` → istemci kısa süre sonra tekrar sormalı.
 */
export async function serveStaleWhileRevalidate<T>(opts: SwrOptions<T>): Promise<SwrResult<T>> {
  const env = opts.env ?? process.env;
  const isValid = opts.isValid ?? passThrough;

  let cached = entries.get(opts.key) as Entry<T> | undefined;
  if (!cached || !isValid(cached.data)) {
    // Bellekte yok: kalıcı katmana bak (sınırlı süre, isteği geciktirmesin).
    const outcome = await withDeadlineOutcome(hydrate<T>(opts.key, isValid), PERSIST_READ_MS);
    if (outcome.kind === "value" && outcome.value) {
      entries.set(opts.key, outcome.value);
      prune(opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
      cached = outcome.value;
    }
  }
  const usable = cached && isValid(cached.data) ? cached : undefined;
  const age = usable ? Date.now() - usable.at : Number.POSITIVE_INFINITY;

  if (usable && age < opts.freshMs) return { data: usable.data, status: "ready", fromCache: true };

  const refresh = startRefresh(opts);

  // Elimizde bayat ama kullanılabilir veri varsa beklemeden onu dön; taze veri
  // arka planda hazırlanır. Yanıt yine önbellekten geldiği için ücretsizdir.
  if (usable) return { data: usable.data, status: "stale", fromCache: true };

  const waitMs = Math.min(opts.waitMs ?? swrWaitMs(env), swrWaitMs(env));
  const outcome = await withDeadlineOutcome(refresh.promise, waitMs);
  // `started: false` → üretim zaten başka bir istekle koşuyordu; bu istek yeni
  // bir AI turu başlatmadığı için jeton tahsil eden uçlarda ÜCRETSİZDİR.
  const fromCache = !refresh.started;
  if (outcome.kind === "value") {
    // Üretim bitti: veri kullanılabilirse hazır, değilse (ör. boş liste) istemci
    // yine "hazırlanıyor" görüp tekrar sorsun. Bu bir HATA değildir.
    return isValid(outcome.value)
      ? { data: outcome.value, status: "ready", fromCache }
      : { data: null, status: "warming", fromCache };
  }
  // Hâlâ sürüyorsa `warming`; bitti ve hata verdişse `failed` (çağıran gerçek
  // hata döndürebilsin, sonsuz "hazırlanıyor" olmasın).
  if (outcome.kind === "pending") return { data: null, status: "warming", fromCache };
  return { data: null, status: "failed", fromCache };
}
