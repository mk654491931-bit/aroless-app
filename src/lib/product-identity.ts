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

// ============================================================================
// GTIN / EAN / UPC DOĞRULAMA (GS1 Mod-10) VE ÜLKE ÖNEK TABLOSU (SAF, $0).
//
// NEDEN VAR (denetim + v2 rapor P0):
//   1. Pazaryerleri ve üçüncü taraf kataloglar (JSON-LD, UPCitemdb, mağaza
//      sayfaları) bazen rastgele SKU ya da bozuk rakamları `gtin`/`ean`/`upc`
//      alanına yazar ("1234567890123", "0000000000000").
//   2. Doğrulanmamış barkodu tekilleştirme çapası (`gtin:`) yapmak iki farklı
//      ürünü birleştirme riski taşır; Mod-10 kontrol hanesi (check-digit)
//      sahte/bozuk barkodların %90+'ını anında eler.
//   3. DÜRÜSTLÜK NOTU: matematiksel olarak geçerli (Mod-10 geçen) bir GTIN,
//      GS1 tarafından gerçekten o ürüne tahsis edildiğini GARANTİ ETMEZ —
//      yalnız yapısal olarak geçerli bir barkod olduğunu kanıtlar.
// ============================================================================

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GS1 Mod-10 kontrol hanesi doğrulaması (GTIN-8, GTIN-12/UPC-A, GTIN-13/EAN-13, GTIN-14).
 *
 * Kural: sağdan sola (kontrol hanesi hariç) tek pozisyonlar ×3, çift pozisyonlar ×1;
 * toplam + kontrol hanesi 10'un tam katı olmalıdır. Tümü sıfır olan veya tek
 * rakam tekrarından oluşan ("0000000000000", "1111111111111") dizeler reddedilir.
 */
export function isValidGtin(raw: unknown): boolean {
  const digits = String(raw ?? "")
    .trim()
    .replace(/[\s-]+/g, "");
  if (!/^\d+$/.test(digits)) return false;
  if (!VALID_GTIN_LENGTHS.has(digits.length)) return false;
  // Tümü aynı rakam ("00000000", "9999999999999") gerçek barkod değildir.
  if (/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  // Sağdan başlayarak: son hane (index = len-1) kontrol hanesidir.
  // Kontrol hanesinden hemen önceki hane (sağdan 1.) ×3, yanındaki ×1 ...
  for (let i = 0; i < digits.length - 1; i++) {
    const d = digits.charCodeAt(digits.length - 2 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const check = (10 - (sum % 10)) % 10;
  const last = digits.charCodeAt(digits.length - 1) - 48;
  return check === last;
}

/**
 * Ham barkod dizesini kanonik 13 veya 14 haneli GTIN'e normalize eder.
 *
 * - 12 haneli UPC-A (`012345678905`) → başına `0` eklenerek 13 haneli EAN-13
 *   (`0012345678905`) yapılır ki aynı ürün ABD (UPC-12) ve Avrupa/katalog
 *   (EAN-13) kaynaklarında tek anahtarda birleşsin.
 * - 8, 13 ve 14 haneli geçerli kodlar olduğu gibi korunur.
 * - Geçersizse `""` döner (asla uydurulmaz).
 */
export function normalizeGtin(raw: unknown): string {
  const digits = String(raw ?? "")
    .trim()
    .replace(/[\s-]+/g, "");
  if (!isValidGtin(digits)) return "";
  if (digits.length === 12) return `0${digits}`;
  return digits;
}

/**
 * GS1 3 haneli ülke/bölge öneki (GTIN-13 üzerinden).
 *
 * Yalnız bilgi/şeffaflık amaçlıdır; şirketin barkodu aldığı GS1 organizasyonunu
 * gösterir, ürünün fiziksel üretim ülkesini (Made in …) GARANTİ ETMEZ.
 */
export function gs1PrefixCountry(raw: unknown): string | null {
  const gtin = normalizeGtin(raw);
  if (!gtin) return null;
  const ean13 = gtin.length === 14 && gtin.startsWith("0") ? gtin.slice(1) : gtin;
  if (ean13.length !== 13) return null;
  const p = Number(ean13.slice(0, 3));
  if (!Number.isFinite(p)) return null;
  if (p >= 0 && p <= 139) return "US/CA";
  if (p >= 300 && p <= 379) return "FR";
  if (p >= 400 && p <= 440) return "DE";
  if ((p >= 450 && p <= 459) || (p >= 490 && p <= 499)) return "JP";
  if (p >= 460 && p <= 469) return "RU";
  if (p >= 471 && p <= 471) return "TW";
  if (p >= 480 && p <= 480) return "PH";
  if (p >= 489 && p <= 489) return "HK";
  if (p >= 500 && p <= 509) return "GB";
  if (p >= 520 && p <= 521) return "GR";
  if (p >= 539 && p <= 539) return "IE";
  if (p >= 540 && p <= 549) return "BE/LU";
  if (p >= 560 && p <= 560) return "PT";
  if (p >= 570 && p <= 579) return "DK";
  if (p >= 590 && p <= 590) return "PL";
  if (p >= 599 && p <= 599) return "HU";
  if (p >= 600 && p <= 601) return "ZA";
  if (p >= 619 && p <= 619) return "TN";
  if (p >= 622 && p <= 622) return "EG";
  if (p >= 628 && p <= 628) return "SA";
  if (p >= 629 && p <= 629) return "AE";
  if (p >= 640 && p <= 649) return "FI";
  if (p >= 690 && p <= 699) return "CN";
  if (p >= 700 && p <= 709) return "NO";
  if (p >= 729 && p <= 729) return "IL";
  if (p >= 730 && p <= 739) return "SE";
  if (p >= 750 && p <= 750) return "MX";
  if (p >= 754 && p <= 755) return "CA";
  if (p >= 759 && p <= 759) return "VE";
  if (p >= 760 && p <= 769) return "CH";
  if (p >= 770 && p <= 771) return "CO";
  if (p >= 779 && p <= 779) return "AR";
  if (p >= 789 && p <= 790) return "BR";
  if (p >= 800 && p <= 839) return "IT";
  if (p >= 840 && p <= 849) return "ES";
  if (p >= 868 && p <= 869) return "TR";
  if (p >= 870 && p <= 879) return "NL";
  if (p >= 880 && p <= 880) return "KR";
  if (p >= 885 && p <= 885) return "TH";
  if (p >= 888 && p <= 888) return "SG";
  if (p >= 890 && p <= 890) return "IN";
  if (p >= 893 && p <= 893) return "VN";
  if (p >= 899 && p <= 899) return "ID";
  if (p >= 900 && p <= 919) return "AT";
  if (p >= 930 && p <= 939) return "AU";
  if (p >= 940 && p <= 949) return "NZ";
  if (p >= 955 && p <= 955) return "MY";
  return null;
}

