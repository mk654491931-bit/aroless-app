// ============================================================================
// ÜRÜN KİMLİĞİ — iki yazımın aynı ürün olduğunu kanıtlayan normalize anahtar.
//
// Neden ayrı modül: bu saf fonksiyon hem kazanan hattı (kesişim) hem de
// koşular arası geçmiş performans eşleştirmesi tarafından kullanılıyor. İkinci
// kullanım saf bir sunucu modülü olmayan yerde yaşadığı için ağır pipeline
// modulunu (ve transitif AI yönlendiricisini) içeri sokmadan paylaşabilmesi
// gerekiyor. Tek tanım, iki tüketicı, çelişki yok.
//
// Kural tabanlıdır ve deterministiktir: küçük harf (tr), ı→i, aksan atma,
// alfanümerik olmayanları boşluğa çevirme, boşlukları tekilleştirme.
// ============================================================================

export function normalizeProductIdentity(name: string): string {
  return String(name ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
