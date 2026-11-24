/**
 * META PIXEL — tarayıcı tarafı (Facebook Pixel).
 *
 * TASARIM KURALLARI:
 *   • Piksel yalnızca "Pazarlama" çerez izni verildiğinde yüklenir. İzin yoksa
 *     `connect.facebook.net` isteği atılmaz ve `fbq` kuyruğu kurulmaz.
 *   • Her olay gönderiminde izin YENİDEN okunur: kullanıcı izni geri çekerse
 *     sonraki olaylar gönderilmez.
 *   • `event_id` verildiğinde Meta aynı olayı sunucu tarafı Conversions API ile
 *     tekilleştirebilir (bkz. `meta-config.ts` → `purchaseEventId`).
 *
 * Not: `noscript` görseli bilinçli olarak YOKTUR. İzin kontrolü yapamadan
 * çalışacağı için pazarlama rızasını delen bir istek üretirdi; ayrıca site
 * JavaScript olmadan çalışmıyor.
 */
import { hasMarketingConsent } from "@/lib/cookie-consent";
import { META_PIXEL_ID } from "@/lib/meta-config";

const PIXEL_SCRIPT_ID = "meta-pixel-fbevents";
const PIXEL_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

export type MetaEventParams = Record<string, string | number | boolean | undefined>;

type FbqFunction = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: FbqFunction;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: FbqFunction;
    _fbq?: FbqFunction;
  }
}

let pixelInitialized = false;

/** `trackMetaEventOnce` anahtarları → sona erme zamanı (ms). */
const onceKeys = new Map<string, number>();
const MAX_ONCE_KEYS = 200;

/**
 * Meta'nın tarayıcıda bıraktığı pazarlama çerezlerini siler.
 *
 * İzin geri çekildiğinde yalnız yeni olayları durdurmak yetmez: daha önce
 * yazılmış `_fbp`/`_fbc` çerezleri de pazarlama verisidir. Script'i geri
 * yüklemek mümkün değildir; ancak bundan sonraki olaylar kapıda durur ve
 * mevcut çerezler temizlenir.
 */
export function clearMetaBrowserCookies(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const host = window.location.hostname;
  const domains = ["", host, `.${host}`];
  for (const name of ["_fbp", "_fbc"]) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/;` + (domain ? ` domain=${domain};` : "");
    }
  }
}

/**
 * Preview/staging'de pikseli tamamen kapatma anahtarı.
 *
 * Production verisini test trafiğiyle kirletmemek için önizleme ortamında
 * `VITE_META_PIXEL_DISABLED=1` verilir. Tanımsızsa piksel normal çalışır.
 */
function pixelDisabled(): boolean {
  try {
    const raw = String(import.meta.env.VITE_META_PIXEL_DISABLED ?? "")
      .trim()
      .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  } catch {
    return false;
  }
}

/** Resmi snippet'teki `fbq` kuyruğunu kurar ve `fbevents.js`'i bir kez yükler. */
function getFbq(): FbqFunction | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (window.fbq) return window.fbq;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  }) as FbqFunction;

  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";

  window.fbq = fbq;
  window._fbq ??= fbq;

  if (!document.getElementById(PIXEL_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = PIXEL_SCRIPT_SRC;
    document.head.appendChild(script);
  }

  return fbq;
}

/** Pikseli başlatır — izin yoksa hiçbir şey yapmaz ve `false` döner. */
export function initMetaPixel(): boolean {
  if (pixelDisabled()) return false;
  if (!hasMarketingConsent()) return false;
  if (pixelInitialized) return true;
  const fbq = getFbq();
  if (!fbq) return false;
  fbq("init", META_PIXEL_ID);
  pixelInitialized = true;
  return true;
}

/**
 * Standart Meta olayı gönder (`PageView`, `CompleteRegistration`,
 * `InitiateCheckout`, `Purchase`, …).
 *
 * `eventId` sunucu tarafıyla ortak tekilleştirme kimliğidir; Meta'ya
 * `{ eventID }` seçeneği olarak gider.
 */
export function trackMetaEvent(
  name: string,
  params?: MetaEventParams,
  eventId?: string | null,
): boolean {
  if (pixelDisabled()) return false;
  if (!hasMarketingConsent()) return false;
  if (!initMetaPixel()) return false;
  const fbq = getFbq();
  if (!fbq) return false;

  const options = eventId ? { eventID: eventId } : undefined;
  if (params && options) fbq("track", name, params, options);
  else if (params) fbq("track", name, params);
  else if (options) fbq("track", name, {}, options);
  else fbq("track", name);
  return true;
}

/**
 * Aynı anahtar için TTL içinde YALNIZ BİR kez gönderir.
 *
 * NEDEN: `CompleteRegistration` başarılı kayıttan sonra iki kez tetiklenebilir
 * (çift submit / yeniden doğrulama yarışı); `ViewContent` ise aynı ürün için
 * hem ürün sayfasında hem derin analiz modalında gönderilebiliyordu. Meta bu
 * olayları ayrı satırlar olarak sayar; gereksiz ikinci olay dönüşüm sayısını
 * şişirir.
 *
 * Anahtar yalnız olay GERÇEKTEN kuyruğa girdiyse yazılır: izin yokken çağrı
 * yapıldı diye sonraki izinli çağrı bastırılmaz.
 *
 * @param ttlMs `Infinity` → anahtar süreç boyunca bir kez (ör. kayıt).
 */
export function trackMetaEventOnce(
  key: string,
  ttlMs: number,
  name: string,
  params?: MetaEventParams,
  eventId?: string | null,
): boolean {
  if (!key) return trackMetaEvent(name, params, eventId);

  const now = Date.now();
  const expiresAt = onceKeys.get(key);
  if (expiresAt !== undefined && expiresAt > now) return false;

  const sent = trackMetaEvent(name, params, eventId);
  if (!sent) return false;

  // Bellek sınırı: süresi geçen anahtarlar temizlenir; hâlâ doluysa en eski
  // anahtar düşürülür. Anahtar sayısı kullanıcı gezintisiyle sınırsız büyümez.
  if (onceKeys.size >= MAX_ONCE_KEYS) {
    for (const [storedKey, storedExpiry] of onceKeys) {
      if (storedExpiry <= now) onceKeys.delete(storedKey);
    }
    if (onceKeys.size >= MAX_ONCE_KEYS) {
      const oldest = onceKeys.keys().next().value;
      if (oldest !== undefined) onceKeys.delete(oldest);
    }
  }

  onceKeys.set(key, ttlMs === Infinity ? Infinity : now + Math.max(0, ttlMs));
  return true;
}
