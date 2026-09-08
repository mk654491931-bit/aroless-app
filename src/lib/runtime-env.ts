/**
 * Tek noktadan ortam algılama.
 *
 * Aynı kod tabanı üç ortamda çalışır:
 *  - `managed`  → platformun atadığı dagıtım/preview domaini (*.vercel.app)
 *  - `local`    → VS Code / localhost / kendi domainin (ör. aroless.tech)
 *  - `unknown`  → sunucu tarafı, henüz host bilgisi yok
 *
 * Dağınık `typeof window` kontrolleri yerine buradaki yardımcılar kullanılır.
 *
 * Not: "managed" eskiden "lovable domaininde çalışıyoruz" anlamına geliyordu.
 * Dağıtım artık yalnızca Vercel olduğu için o kontrol her zaman false dönüyordu;
 * bugün ayrım "geçici preview URL'i mi, kalıcı domain mi" üzerinden yapılır.
 */

export type RuntimeHost = "managed" | "local" | "unknown";

/** Vercel'in atadığı dağıtım domainleri: proje.vercel.app, dal-hash.vercel.app. */
const MANAGED_HOST_PATTERN = /(^|\.)vercel\.app$/i;

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

/** Platformun atadığı geçici dağıtım domaininde miyiz? */
export function isManagedHost(): boolean {
  return runtimeHost() === "managed";
}

/** Yerel geliştirme veya kendi kalıcı domainin. */
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
