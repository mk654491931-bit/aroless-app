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

/**
 * Preview/staging'de pikseli tamamen kapatma anahtarı.
 *
 * Production verisini test trafiğiyle kirletmemek için önizleme ortamında
 * `VITE_META_PIXEL_DISABLED=1` verilir. Tanımsızsa piksel normal çalışır.
 */
function pixelDisabled(): boolean {
  try {
    return String(import.meta.env.VITE_META_PIXEL_DISABLED ?? "") === "1";
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
): void {
  if (pixelDisabled()) return;
  if (!hasMarketingConsent()) return;
  if (!initMetaPixel()) return;
  const fbq = getFbq();
  if (!fbq) return;

  const options = eventId ? { eventID: eventId } : undefined;
  if (params && options) fbq("track", name, params, options);
  else if (params) fbq("track", name, params);
  else if (options) fbq("track", name, {}, options);
  else fbq("track", name);
}
