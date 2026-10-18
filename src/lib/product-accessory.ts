// ============================================================================
// AKSESUAR / YEDEK PARÇA KAPISI — "bu satır satılabilir bir ÜRÜN mü, yoksa
// başka bir ürünün aksesuarı mı?"
//
// NEDEN VAR (ölçülen kirlilik): Ürün Bulucu bir NİŞ arıyor ("air fryer",
// "robot vacuum") ama pazaryeri listeleri aynı kelimelerle AKSESUAR satıyor:
//   • "Silicone Case for Ninja AF101 Air Fryer"
//   • "Replacement Filter for Roborock Q7 / S7"
//   • "Screen Protector for …", "Sticker for …", "Dust Cover for …"
// Bu satırlar fiyat + görsel + puan taşıdığı için mevcut kapıların hepsini
// GEÇİYOR ve nihai 5'lik listede "kazanan ürün" olarak görünüyor. Oysa
// kullanıcı aksesuar değil, aksesuarın TAKILDIĞI ürünü arıyor: bir kılıfın
// tedarik/marj/lansman analizi anlamsızdır.
//
// TASARIM KURALI — ÜÇ KORUMA, çünkü yanlış eleme gerçek ürün kaybettirir:
//   1. NİŞ KAPISI: nişin KENDİSİ aksesuar ise (kullanıcı zaten "phone case"
//      arıyor) kapı TAMAMEN kapanır. Aksi hâlde "case for iPhone" aramasının
//      bütün satırları elenir ve sonuç boş kalırdı.
//   2. HAVUZ KAPISI: aksesuar olmayan yeterli sayıda ticari satır yoksa hiçbir
//      şey elenmez (fail-open). Az veriyle "hepsini budamak" boş vitrin demek.
//   3. DAR DESEN: yalnız YAPISAL aksesuar kalıpları sayılır. "for" kelimesi
//      tek başına yetmez — "Air Fryer for 2 People" gerçek bir üründür.
//      Bu yüzden kalıplar `<aksesuar türü> for …` biçimindedir.
//
// DÜRÜSTLÜK: bu modül bir ÜRÜN OLMA ölçütü değil, bir SINIFLANDIRMAdır.
// Elenen satırlar kanıt olarak yaşamaya devam eder (talep/pazar bağlamı);
// yalnız "satılabilir ürün adayı" olmaktan çıkar ve sayacı artırır
// (`rejectedByAccessory`) — yani "neden bu satır listede yok?" cevaplanabilir.
// ============================================================================

/** Aksesuar türü + bağlaç kalıbı. SIRA ÖNEMLİ DEĞİL; hepsi tam eşleşir. */
const ACCESSORY_PATTERNS: readonly RegExp[] = [
  // Yedek parça / sarf malzeme
  /\breplacement\b/,
  /\bspare\s+parts?\b/,
  /\brefills?\b/,
  /\bfilter\s+for\b/,
  /\bfilters?\s+(?:set\s+)?for\b/,
  /\bblades?\s+for\b/,
  /\bbrushes?\s+for\b/,
  /\bmop\s+pads?\b/,
  /\bvacuum\s+bags?\b/,
  // Kılıf / kapak / koruyucu
  /\b(?:silicone|carry|hard|protective|leather|clear)\s+case\b/,
  /\bcase\s+for\b/,
  /\bcover\s+for\b/,
  /\bdust\s+cover\b/,
  /\bsleeve\s+for\b/,
  /\bskin\s+for\b/,
  /\bscreen\s+protector\b/,
  // Bağlantı / montaj aksesuarı
  /\b(?:stand|mount|holder|bracket|strap|band|charger|cable|adapter)\s+for\b/,
  /\bcompatible\s+with\b/,
  // Basılı/dijital yan ürün
  /\b(?:user\s+)?manual\b/,
  /\binstruction\s+(?:book|manual|guide)\b/,
  /\bstickers?\b/,
  /\bdecals?\b/,
];

/**
 * NİŞİN KENDİSİ aksesuar/parça kategorisi mi?
 *
 * Eşleşirse kapı TAMAMEN kapanır: kullanıcı "phone case" veya "vacuum filter"
 * arıyorsa bu satırlar onun ÜRÜNÜDÜR, aksesuarı değil.
 */
const ACCESSORY_NICHE_RE =
  /\b(case|cases|cover|covers|aksesuar|accessor(?:y|ies)|filter|filters|refill|refills|spare|replacement|parts?|cable|cables|charger|chargers|strap|straps|mount|mounts|stand|stands|holder|holders|protector|protectors|sticker|stickers|decals?|manual|manuals)\b/i;

/** Niş aksesuar kategorisi mi — kapıyı kapatmak için. */
export function isAccessoryNiche(niche: string): boolean {
  return ACCESSORY_NICHE_RE.test(String(niche ?? ""));
}

/**
 * Başlık aksesuar/yedek parça mı? Yalnız YAPISAL kalıplara bakar.
 *
 * @returns `true` → satır satılabilir ürün adayı DEĞİL.
 */
export function looksLikeAccessory(title: string): boolean {
  const text = String(title ?? "").toLowerCase();
  if (!text.trim()) return false;
  return ACCESSORY_PATTERNS.some((re) => re.test(text));
}

/**
 * Bu satır aksesuar olarak ELENMELİ mi — niş ve havuz korumalarıyla birlikte.
 *
 * @param title     Ürün başlığı.
 * @param niche     Arama nişi (niş aksesuar kategorisiyse kapı kapanır).
 * @param poolSize  Havuzdaki AKSESUAR OLMAYAN ticari satır sayısı.
 * @param minPool   Bu sayının altında eleme YAPILMAZ (varsayılan 6).
 */
export function shouldRejectAccessory(
  title: string,
  niche: string,
  poolSize: number,
  minPool = 6,
): boolean {
  if (isAccessoryNiche(niche)) return false; // koruma 1 — nişin kendisi aksesuar
  if (poolSize < minPool) return false; // koruma 2 — fail-open
  return looksLikeAccessory(title); // koruma 3 — dar desen
}
