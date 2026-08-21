/**
 * Tek noktadan ortam algılama.
 *
 * Aynı kod tabanı üç ortamda çalışır:
 *  - `managed`  → Lovable editör/preview veya Lovable publish (köprüler mevcut)
 *  - `local`    → VS Code / localhost / kendi sunucun (bağımlılık yok)
 *  - `unknown`  → sunucu tarafı, henüz host bilgisi yok
 *
 * Dağınık `typeof window` / `LOVABLE_*` kontrolleri yerine buradaki
 * yardımcılar kullanılır.
 */

export type RuntimeHost = "managed" | "local" | "unknown";

const MANAGED_HOST_PATTERN = /(^|\.)lovable(project)?\.(app|dev)$/i;

/** Tarayıcıda mı çalışıyoruz? */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Uygulamanın çalıştığı host tipi (yalnızca tarayıcıda anlamlı). */
export function runtimeHost(): RuntimeHost {
  if (!isBrowser()) return "unknown";
  const host = window.location.hostname;
  if (MANAGED_HOST_PATTERN.test(host)) return "managed";
  return "local";
}

/** Lovable köprüleri (OAuth broker, telemetri) bu ortamda var mı? */
export function isManagedHost(): boolean {
  return runtimeHost() === "managed";
}

/** Yerel geliştirme / kendi sunucun. */
export function isSelfHosted(): boolean {
  return runtimeHost() === "local";
}

/** Origin tabanlı URL üretimi (localhost, preview ve canlı domain otomatik). */
export function appOrigin(): string {
  return isBrowser() ? window.location.origin : "";
}

/** OAuth dönüş adresi — asla sabit domain yazma. */
export function oauthRedirectUrl(path = "/auth/callback"): string {
  return `${appOrigin()}${path}`;
}
