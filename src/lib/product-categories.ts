/**
 * Ürün kategorileri — TEK kaynak.
 *
 * NEDEN VAR: Onboarding sihirbazı Türkçe etiketlerle çalışıyordu
 * ("Ev & Yaşam") ama Ürün Bulucu'nun kategori filtresi İngilizce anahtarlar
 * bekliyor ("Home"). Onboarding sonucu bu yüzden arama filtresine hiç
 * oturmuyor, seçim sessizce "Any" oluyordu.
 *
 * KURAL: Buraya yalnızca Ürün Bulucu filtresinin kabul ettiği anahtarlar
 * girer. Görünen etiketler ayrı tutulur (bkz. onboarding-wizard.tsx), böylece
 * saklanan değer her zaman kanonik kalır.
 */
export const PRODUCT_CATEGORIES = [
  "Beauty",
  "Fitness",
  "Home",
  "Tech",
  "Pets",
  "Fashion",
  "Kids",
  "Outdoor",
  "Kitchen",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}
