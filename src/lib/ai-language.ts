/**
 * AI ÇIKTISININ DİLİ — tek kaynak.
 *
 * NEDEN VAR: model çağrıları farklı dosyalarda (sol bar araçları, ürün bulucu
 * keşif hattı, doğrulama ajanları) yapılıyor ve her biri kendi dil eşlemesini
 * yazıyordu. Bir çağrıda dil unutulunca kullanıcı arayüzü İspanyolca olmasına
 * rağmen sonuçlar Türkçe/İngilizce geliyordu. Bu modül dil adını ve isteme
 * eklenecek "çıktı dilini" direktifini TEK yerde tanımlar; yeni bir AI çağrısı
 * eklendiğinde tek yapılacak şey `withOutputLanguage` sarmalayıcısıdır.
 *
 * SAF MODÜL: ağ, React ya da sunucu bağımlılığı yok — bu yüzden hem istemci
 * hem sunucu tarafında, testlerde de doğrudan kullanılabilir.
 */

/** Ürünün desteklediği diller (i18n ile aynı küme). */
export const AI_LANGUAGES = ["tr", "en", "es", "de", "fr", "ar"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

/** Modelin anlayacağı İngilizce dil adları. */
const LANGUAGE_NAMES: Record<AiLanguage, string> = {
  tr: "Turkish",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  ar: "Arabic",
};

/**
 * Dil kodunu desteklenen 2 harfli koda indirger.
 * "tr-TR" → "tr"; tanınmayan/boş değer → "en" (İngilizce güvenli varsayılan).
 */
export function normalizeAiLanguage(value: unknown): AiLanguage {
  const code =
    typeof value === "string"
      ? value.trim().toLowerCase().slice(0, 2)
      : "";
  return (AI_LANGUAGES as readonly string[]).includes(code) ? (code as AiLanguage) : "en";
}

/** Modelin istemde göreceği dil adı ("tr" → "Turkish"). */
export function languageName(value: unknown): string {
  return LANGUAGE_NAMES[normalizeAiLanguage(value)];
}

/**
 * İsteme eklenecek çıktı-dili direktifi.
 *
 * @param fields İnsan tarafından okunacak alanların listesi. Varsayılan, sol
 *   bar araçlarının sözleşmesidir (headline/metrics/bullets/document/verdict).
 *   Farklı bir çıktı şekli olan çağrılar (ör. ürün bulucu gerekçeleri) kendi
 *   alan listesini verir; böylece direktif o çağrının sözleşmesiyle çelişmez.
 */
export function outputLanguageDirective(value: unknown, fields?: string): string {
  const name = languageName(value);
  const scope =
    fields ??
    "headline, metrics labels, bullets, table cells, document, risks, actions, assumptions, verdict";
  return `- OUTPUT LANGUAGE: write EVERY human-readable string (${scope}) in ${name}. Keep URLs, numbers, currency codes and brand/product names as they are.`;
}

/** Verilen istemin sonuna çıktı-dili direktifini ekler (tek satır, idempotent değil). */
export function withOutputLanguage(prompt: string, value: unknown, fields?: string): string {
  return `${prompt}\n\n${outputLanguageDirective(value, fields)}`;
}
