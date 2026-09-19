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

export type SwrResult<T> = { data: T | null; status: SwrStatus };

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

function startRefresh<T>(opts: SwrOptions<T>): Promise<T> {
  const running = inflight.get(opts.key) as Promise<T> | undefined;
  if (running) return running;

  const isValid = opts.isValid ?? passThrough;
  const p = opts
    .build()
    .then((value) => {
      // Boş/geçersiz sonucu önbelleğe yazmayız; yoksa bir sonraki istek
      // "taze" sanıp boş liste gösterirdi.
      if (isValid(value)) {
        entries.set(opts.key, { data: value, at: Date.now() });
        prune(opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
      }
      return value;
    })
    .finally(() => {
      inflight.delete(opts.key);
    });

  inflight.set(opts.key, p);
  // Arka planda biten tazeleme hatası isteği düşürmesin (log yeterli).
  p.catch((e) => console.error(`[swr] ${opts.key} tazeleme hatası`, e));
  return p;
}

/**
 * Önbellekten yanıt üretir; bayat veride arka plan tazelemesi başlatır.
 * `data: null` + `status: "warming"` → istemci kısa süre sonra tekrar sormalı.
 */
export async function serveStaleWhileRevalidate<T>(opts: SwrOptions<T>): Promise<SwrResult<T>> {
  const env = opts.env ?? process.env;
  const isValid = opts.isValid ?? passThrough;

  const cached = entries.get(opts.key) as Entry<T> | undefined;
  const usable = cached && isValid(cached.data) ? cached : undefined;
  const age = usable ? Date.now() - usable.at : Number.POSITIVE_INFINITY;

  if (usable && age < opts.freshMs) return { data: usable.data, status: "ready" };

  const refresh = startRefresh(opts);

  // Elimizde bayat ama kullanılabilir veri varsa beklemeden onu dön; taze veri
  // arka planda hazırlanır.
  if (usable) return { data: usable.data, status: "stale" };

  const waitMs = Math.min(opts.waitMs ?? swrWaitMs(env), swrWaitMs(env));
  const outcome = await withDeadlineOutcome(refresh, waitMs);
  if (outcome.kind === "value") {
    // Üretim bitti: veri kullanılabilirse hazır, değilse (ör. boş liste) istemci
    // yine "hazırlanıyor" görüp tekrar sorsun. Bu bir HATA değildir.
    return isValid(outcome.value)
      ? { data: outcome.value, status: "ready" }
      : { data: null, status: "warming" };
  }
  // Hâlâ sürüyorsa `warming`; bitti ve hata verdişse `failed` (çağıran gerçek
  // hata döndürebilsin, sonsuz "hazırlanıyor" olmasın).
  if (outcome.kind === "pending") return { data: null, status: "warming" };
  return { data: null, status: "failed" };
}
