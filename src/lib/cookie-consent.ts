/**
 * ÇEREZ TERCİHİ — tek okuma/yazma noktası.
 *
 * Hem çerez banner'ı hem de izne bağlı araçlar (Meta Pixel) buradan okur.
 * Pazarlama izni verilmeden hiçbir pazarlama aracı yüklenmez; bu, banner'ın
 * kullanıcıya verdiği sözün kod karşılığıdır.
 */
import { getBrandedItem, setBrandedItem } from "@/lib/brand-storage";

export const COOKIE_KEY = "aroless_cookie_consent";
/** Tercih kaydedildiğinde tetiklenir; izne bağlı araçlar dinler. */
export const COOKIE_CONSENT_EVENT = "aroless:cookie-consent";

export type CookieConsent = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
};

/** Kayıtlı tercihi oku; hiç karar verilmemişse veya bozuksa `null`. */
export function readCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = getBrandedItem(COOKIE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      essential: true,
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : "",
    };
  } catch {
    return null;
  }
}

/** Pazarlama çerezlerine açık rıza var mı? (Varsayılan: HAYIR.) */
export function hasMarketingConsent(): boolean {
  return readCookieConsent()?.marketing === true;
}

/** Tercihi kalıcı yaz ve kaydedilen değeri döndür. */
export function saveCookieConsent(choice: {
  analytics: boolean;
  marketing: boolean;
}): CookieConsent {
  const value: CookieConsent = {
    essential: true,
    decidedAt: new Date().toISOString(),
    analytics: choice.analytics === true,
    marketing: choice.marketing === true,
  };
  setBrandedItem(COOKIE_KEY, JSON.stringify(value));
  return value;
}
