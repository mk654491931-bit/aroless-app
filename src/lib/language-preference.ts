/**
 * Dil tercihi kuralları (saf mantık — DOM/ağ yok).
 *
 * Site genelinde dilin nereden geldiğini tek yerde tanımlar: kullanıcı bu
 * cihazda açıkça seçtiyse o kazanır, aksi hâlde hesapta kayıtlı dil uygulanır.
 */

import { isSupportedLang, normalizeLang, type LangCode } from "@/lib/i18n";

/** i18next LanguageDetector'ın localStorage cache anahtarı. */
export const LANGUAGE_STORAGE_KEY = "i18nextLng";

/** Cihazda kayıtlı dil tercihi (yoksa null). */
export function storedLanguagePreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Hesapta kayıtlı dili uygulamak gerekiyorsa o dili, gerekmiyorsa null döner.
 *
 * - Profil dili desteklenmiyorsa → null (mevcut dil korunur).
 * - Cihazda açık bir seçim varsa → null (kullanıcının cihaz kararı ezilmez).
 * - Profil dili zaten aktifse → null.
 */
export function shouldAdoptProfileLanguage(args: {
  profileLanguage?: unknown;
  storedLanguage?: string | null;
  activeLanguage?: unknown;
}): LangCode | null {
  if (!isSupportedLang(args.profileLanguage)) return null;
  if (isSupportedLang(args.storedLanguage)) return null;
  const profile = normalizeLang(args.profileLanguage);
  if (profile === normalizeLang(args.activeLanguage)) return null;
  return profile;
}
