// ============================================================================
// KEŞİF HATTI "HANGİ HAT ÇALIŞIYOR" BİLDİRİMİ.
//
// NEDEN AYRI BİR DEPO (ve neden context değil): bekleme modalı, ürün arama
// sayfasının çok büyük bir dosyasında çağrılıyor ve o dosyaya yeni bir prop
// zinciri eklemek pratikte kırılgan (dosya her derlemede yeniden üretilen
// rotaları ve yüzlerce çağrıyı içeriyor). Oysa bu bilgi tek bir soruya
// cevap veriyor: "şu an yeni hat mı koşuyor?" — cevap yalnız arama kancasında
// doğuyor, yalnız modalde okunuyor. Arada tek satırlık bir yayın/abone
// bağı bu kadar veri taşımak için doğru maliyettir.
//
// NEDEN `useSyncExternalStore`: React'in abonelik sözleşmesini kendi
// elimizle bozmadan (elle `useState` + `useEffect` + temizlik yerine)
// sağlar. Değer global bir bayrak olduğu için sunucu tarafında
// `getServerSnapshot` SABİT `false` döner: ilk boyama sunucuda da tutarlıdır
// ve hydration uyuşmazlığı oluşmaz.
// ============================================================================

/** Yeni 4 adımlı hat şu an koşuyor mu? */
let active = false;

const listeners = new Set<() => void>();

/**
 * Hat durumunu yazar. Arama kancası bunu, hat kurulduğunda ve bittiğinde
 * çağırır. Değer değişmediyse bildirim yapılmaz — gereksiz render olmasın.
 */
export function setDiscoveryPipelineActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Abonelik kurar; döndürülen fonksiyon aboneliği kaldırır. */
export function subscribeDiscoveryPipeline(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Abonelikten bağımsız anlık okuma (`useSyncExternalStore` snapshot'ı). */
export function isDiscoveryPipelineActive(): boolean {
  return active;
}
