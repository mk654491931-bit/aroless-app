/**
 * Sol menü aktiflik kuralı.
 *
 * NEDEN AYRI: Aynı hub rotasını paylaşan araçlar (finance/growth/listing/
 * sourcing) yalnız hash ile ayrılır. Bu kural yanlış uygulanınca ya aynı
 * gruptaki beş araç birden aktif görünür ya da Dashboard gibi hash'siz
 * sayfalar hiç aktif olmaz. Saf fonksiyon, iki durumu da test edilebilir kılar.
 */
export type SidebarLocation = { pathname: string; hash: string };
export type SidebarTarget = { url: string; hash?: string };

export function isSidebarItemActive(
  item: SidebarTarget,
  location: SidebarLocation,
  index: number,
): boolean {
  if (location.pathname !== item.url) return false;
  const currentHash = location.hash.replace(/^#/, "");
  if (!item.hash) return true;
  // Hub köküne hash'siz gelindiğinde ilk araç varsayılan bölümdür; diğerleri
  // yalnız kendi hash'leriyle aktifleşir.
  return currentHash ? item.hash === currentHash : index === 0;
}
