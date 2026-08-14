import i18n from "@/lib/i18n";

/** Current UI language code (2 letters), safe on the server. */
export function getUiLang(): string {
  const lng = (typeof window !== "undefined" ? i18n.language : "en") ?? "en";
  return lng.slice(0, 2);
}
