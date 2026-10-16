// ============================================================================
// MARKA ÇIKARIMI — ÖLÇÜLEN KANITTAN, UYDURMADAN (saf; ağ/AI/DB YOK).
//
// ÖLÇÜLEN BOŞLUK (2026-10-15, canlı koşu "air fryer"/US, `runSources`):
//   tr-reader 18 · aliexpress-reader 23 · otto 12 · flipkart 35 · web-reviews 11
//   → 120 ham satır, filtre sonrası 75 aday ve **0/75 üründe marka**.
//
// NEDEN KAYNAKLAR VERMİYOR: liste sayfaları markayı ayrı bir alanda sunmuyor.
// AliExpress kart şeması ölçüldü (60 kart): `brand` alanı YOK. Hepsiburada/n11
// satırlarında da marka alanı yok. Ama başlığın KENDİSİ markayı taşıyor ve o
// metin gerçekten ölçülmüş bir sayfadan gelir.
//
// MARKA NEDEN KRİTİK (üç yerde birden):
//   1. `productModelKey` marka olmadan hiç anahtar üretmez → aynı ürünün iki
//      mağaza yazımı TEK ürün sayılmaz ve nihai listeye iki kez girebilir.
//   2. `evidenceCompleteness` "brand" yuvasını boş bırakır → `dataCompleteness`
//      düşer, `evidencePenalty` puanı aşağı çeker.
//   3. 14 ajanın CFO/strateji oyları markayı hiç göremez.
//
// KURAL — UYDURMA YASAK (bu dosyanın tamamı):
//   • YALNIZ yapısal olarak marka olduğu ANLAŞILAN öbek döner.
//   • Anlaşılmıyorsa `""` döner. Boş marka, yanlış markadan iyidir: yanlış
//     marka `productModelKey`i çökertir ve İKİ FARKLI ÜRÜNÜ birleştirir.
// ============================================================================

/**
 * MARKA OLAMAYACAK kelimeler — jenerik, ürün cinsi, tanıtım sıfatı, pazar yeri.
 *
 * ÖLÇÜLEN GEREKÇE: "Large Capacity Air Fryer…" başlığının ilk kelimesi
 * "Large"dır ve naive bir "ilk kelime markadır" kuralı marka olarak "Large"
 * yazardı; "Frisco & Co. Extra Large Heavy Duty Dog Crate" hatası bu sınıfın
 * kanıtıdır (yanlış eşleşme → kartta sahte tedarik fiyatı).
 */
const NOT_A_BRAND = new Set([
  // jenerik / tanıtım
  "the",
  "a",
  "an",
  "new",
  "hot",
  "best",
  "top",
  "premium",
  "ultra",
  "super",
  "multi",
  "large",
  "small",
  "medium",
  "big",
  "mini",
  "extra",
  "heavy",
  "light",
  "pro",
  "max",
  "plus",
  "deluxe",
  "classic",
  "modern",
  "smart",
  "portable",
  "electric",
  "digital",
  "automatic",
  "adjustable",
  "foldable",
  "rechargeable",
  "wireless",
  "stainless",
  "steel",
  "plastic",
  "set",
  "pack",
  "pcs",
  "piece",
  "pieces",
  "count",
  "size",
  "color",
  "colour",
  "free",
  "shipping",
  "sale",
  "deal",
  "deals",
  "gift",
  "gifts",
  "home",
  "kitchen",
  "office",
  "outdoor",
  "indoor",
  "travel",
  "garden",
  "car",
  "auto",
  // ÜRÜN TANIMLAYICI SIFATLAR (ölçülen yanlış markalar): canlı koşuda başlık
  // çıkarımı "Chinese" ve "Convection"i marka sandı ve katalog sorguları
  // ("Chinese air fryer") bosa gitti. Marka, ürünü TARİF EDEN kelime değildir.
  "convection",
  "conventional",
  "manual",
  "commercial",
  "industrial",
  "professional",
  "household",
  "nonstick",
  "non",
  "stick",
  "oil",
  "double",
  "single",
  "triple",
  "round",
  "square",
  "rectangular",
  "vertical",
  "horizontal",
  "cordless",
  "silent",
  "quiet",
  "fast",
  "quick",
  "easy",
  "simple",
  "duty",
  "capacity",
  "liter",
  "litre",
  "quart",
  "watt",
  "watts",
  "volt",
  "volts",
  "inch",
  "cm",
  "mm",
  "x",
  // MİLLİYET/köken: marka adı DEĞİL, ürünü tarif eder
  "chinese",
  "japanese",
  "korean",
  "german",
  "italian",
  "french",
  "spanish",
  "indian",
  "turkish",
  "american",
  "european",
  "asian",
  "african",
  "australian",
  "canadian",
  "mexican",
  "thai",
  "vietnamese",
  // pazar yeri / kanal (ürünün markası DEĞİL)
  "amazon",
  "ebay",
  "walmart",
  "target",
  "etsy",
  "alibaba",
  "aliexpress",
  "shopify",
  "hepsiburada",
  "trendyol",
  "n11",
  "flipkart",
  "rakuten",
  "otto",
  "newegg",
  "bestbuy",
  "google",
  "bing",
  "temu",
  "shein",
  // medya / kanal sözcükleri
  "review",
  "reviews",
  "guide",
  "buying",
  "buy",
  "cheap",
  "vs",
  "and",
  "for",
  "with",
  "by",
  "from",
  "your",
  "our",
]);

/**
 * ÜRÜN CİNSİ kelimeleri — bunlarla BAŞLAYAN öbek marka olamaz.
 *
 * "Air Fryer XL" başlığında "Air" marka değildir; bu liste o sınıfı keser.
 */
const PRODUCT_KIND_WORDS = new Set([
  "air",
  "fryer",
  "fryers",
  "vacuum",
  "cleaner",
  "robot",
  "lamp",
  "light",
  "lighting",
  "desk",
  "chair",
  "table",
  "desk",
  "lamp",
  "speaker",
  "speakers",
  "headphone",
  "headphones",
  "earbuds",
  "charger",
  "cable",
  "keyboard",
  "mouse",
  "monitor",
  "printer",
  "camera",
  "watch",
  "phone",
  "tablet",
  "laptop",
  "blender",
  "toaster",
  "oven",
  "microwave",
  "kettle",
  "grill",
  "pan",
  "pot",
  "bottle",
  "cup",
  "mug",
  "plate",
  "bowl",
  "box",
  "bag",
  "crate",
  "cage",
  "bed",
  "mat",
  "board",
  "toy",
  "collar",
  "leash",
  "harness",
  "feeder",
  "brush",
  "trimmer",
  "dryer",
  "heater",
  "fan",
  "purifier",
  "humidifier",
  "mower",
  "scooter",
  "bike",
  "tent",
  "backpack",
  "wallet",
  "shoe",
  "shoes",
  "boot",
  "boots",
  "shirt",
  "dress",
  "pants",
  "jacket",
  "sunglasses",
  "cream",
  "serum",
  "shampoo",
  "perfume",
  "mask",
  "vitamin",
  "protein",
  "toy",
  "puzzle",
  "game",
  "book",
  "notebook",
  "pen",
  "tool",
  "tools",
  "screwdriver",
  "drill",
  "hammer",
  "saw",
  "machine",
  "maker",
  "cooker",
  "steamer",
  "container",
  "organizer",
  "holder",
  "stand",
  "mount",
  "rack",
  "shelf",
  "shelves",
  "mirror",
  "clock",
  "curtain",
  "rug",
  "blanket",
  "pillow",
  "cushion",
  "towel",
  "soap",
  "detergent",
  "filter",
  "filters",
  "refill",
  "replacement",
  "accessory",
  "accessories",
  "compatible",
  "universal",
  "generic",
]);

/** Marka adayında kabul edilen harfler: harf, rakam, `&`, `'`, `.`, `-`. */
const BRAND_TOKEN_RE = /^[\p{L}\p{N}][\p{L}\p{N}&.'’-]*$/u;

/** Açık etiketli marka: "Brand: X", "Marka : X", "Marque - X". */
const LABELLED_BRAND_RE =
  /\b(?:brand|marka|marque|marca|märke|marke)\s*[:-]\s*([\p{L}\p{N}][\p{L}\p{N}&.'’ -]{1,38})/iu;

/**
 * "by X" işaretçisi — KÜÇÜK harfli "by" aranır.
 *
 * Neden küçük harf şartı: "By" ile başlayan büyük harfli öbek genellikle
 * başlığın kendisidir ("By Chef 5-in-1…"), marka işaretçisi değildir.
 * Gerçek kullanım "... Air Fryer by Ninja" biçimindedir.
 */
const BY_BRAND_RE =
  /\bby\s+([\p{Lu}][\p{L}\p{N}&.'’-]{1,20}(?:\s+[\p{Lu}][\p{L}\p{N}&.'’-]{1,20})?)/gu;

/** Model kodu (harfle başlar): "Q7", "CM5418", "L10S", "AF100". */
const MODEL_CODE_RE = /^[A-Z]{1,5}\d{1,6}[A-Z]{0,2}$/;

/** Öbek marka sayılabilir mi — jenerik/ürün cinsi/tanıtım süzgeci. */
function acceptableBrand(candidate: string): string {
  const cleaned = String(candidate ?? "")
    .replace(/\s+/g, " ")
    .replace(/[,;·|].*$/, "")
    .trim()
    .slice(0, 40);
  if (cleaned.length < 2) return "";

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 2) return "";
  if (!tokens.every((t) => BRAND_TOKEN_RE.test(t))) return "";
  // Rakamla başlayan öbek marka değildir ("10L Large…", "8-in-1…").
  if (!/^\p{L}/u.test(tokens[0])) return "";
  // Model kodu tek başına marka değildir.
  if (MODEL_CODE_RE.test(tokens[0])) return "";
  // İKİNCİ kelimede rakam varsa bu öbek marka değil ÖLÇÜ/spec'tir:
  // ölçülen yanlış marka "Deli 9.5QT" idi (canlı koşuda katalog sorgusu da
  // "Deli 9.5QT air fryer" olarak boşa gitti).
  if (tokens.length === 2 && /\d/.test(tokens[1])) return "";

  const lower = tokens.map((t) => t.toLocaleLowerCase("tr-TR"));

  // İkinci kelime ürün cinsi/jenerik ise öbek DEĞİL, yalnız İLK kelime
  // markadır. BU KIRPMA, aşağıdaki reddin ÖNÜNE alınmalıdır: "KitCook Large
  // Air Fryer 8L" başlığında ikinci kelime "Large" jeneriktir ama ilk kelime
  // gerçek bir markadır; kırpma yapılmazsa `NOT_A_BRAND` kontrolü öbeği
  // reddeder ve ölçülmüş marka kaybolur (ölçülen etki: marka doluluğu düşük).
  // Kırpma GEVŞETME DEĞİLDİR: kalan kelime hâlâ tüm süzgeçlerden geçmelidir
  // ("Air Fryer" → "Air" ürün cinsidir → yine boş döner).
  const kept =
    lower.length === 2 && (NOT_A_BRAND.has(lower[1]) || PRODUCT_KIND_WORDS.has(lower[1]))
      ? tokens.slice(0, 1)
      : tokens;
  const keptLower = kept.map((t) => t.toLocaleLowerCase("tr-TR"));

  if (keptLower.some((t) => NOT_A_BRAND.has(t))) return "";
  // Ürün cinsi kelimesiyle başlayan öbek marka değildir ("Air Fryer XL").
  if (PRODUCT_KIND_WORDS.has(keptLower[0])) return "";

  // TAMAMI BÜYÜK HARFLİ ve başlık da büyük harfli bir "afiş" metniyse marka yok.
  const joined = kept.join(" ");
  if (kept.length > 1 && joined === joined.toLocaleUpperCase("tr-TR")) return "";
  // Tek kelime ama tümü büyük ve ürün cinsi de büyük harfle devam ediyorsa da
  // güvenli tarafta kalınır (ör. "AIR FRYER 5L").
  return joined;
}

/**
 * BAŞLIKTAN MARKA — ölçülmüş metinden, uydurmadan.
 *
 * Sıra kanıt gücüne göredir:
 *   1. Açık etiket ("Brand: Ninja")   — kaynak markayı KENDİSİ etiketlemiş.
 *   2. Model kodu öncesi öbek          — "Roborock Q7 L5" → "Roborock".
 *   3. "by X" işaretçisi               — "... Air Fryer by Ninja" → "Ninja".
 *   4. Bilinen marka listesi           — başlık bilinen bir markayla başlıyorsa.
 *   5. Başlığın ilk 1-2 kelimesi       — yalnız jenerik/ürün cinsi süzgecinden
 *      geçerse (ör. "KitCook Large Air Fryer…" → "KitCook").
 *
 * @param known İsteğe bağlı bilinen marka listesi (kaynak ya da UPCitemdb).
 * @returns Marka ya da `""` (bilinmiyor — UYDURULMAZ).
 */
export function brandFromTitle(title: string, known: readonly string[] = []): string {
  const text = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 3) return "";

  // 1) Açık etiket — en güçlü kanıt.
  const labelled = LABELLED_BRAND_RE.exec(text);
  if (labelled) {
    const value = acceptableBrand(labelled[1]);
    if (value) return value;
  }

  // 2) Model kodu ÖNCESİ öbek: "Roborock Q7 L5 …" → "Roborock".
  const words = text.split(/\s+/);
  for (let i = 1; i < Math.min(words.length, 4); i += 1) {
    if (!MODEL_CODE_RE.test(words[i].replace(/[^\p{L}\p{N}]/gu, ""))) continue;
    const value = acceptableBrand(words.slice(0, i).join(" "));
    if (value) return value;
    break;
  }

  // 3) "by X" işaretçisi.
  for (const match of text.matchAll(BY_BRAND_RE)) {
    const value = acceptableBrand(match[1]);
    if (value) return value;
  }

  // 4) Bilinen marka listesi (kaynak/UPCitemdb verirse).
  for (const candidate of known) {
    const brand = acceptableBrand(candidate);
    if (!brand) continue;
    const needle = brand.toLocaleLowerCase("tr-TR");
    if (text.toLocaleLowerCase("tr-TR").startsWith(needle)) return brand;
  }

  // 5) Başlığın ilk öbeği — yalnız süzgeçten geçerse.
  return acceptableBrand(words.slice(0, 2).join(" ")) || "";
}

/**
 * Başlıkta marka GEÇİYOR MU — kart rozetleri ve kaynak doğrulaması için.
 *
 * `brandFromTitle` "başlık markayla BAŞLIYOR mu" sorusunu yanıtlar; bu fonksiyon
 * ise "başlığın herhangi bir yerinde bu marka var mı" sorusunu. İkincisi,
 * UPCitemdb gibi bir kaynağın verdiği markayı başlıkla ÇAPRAZ doğrulamak için
 * gerekir: kaynak "Ninja" diyorsa ve başlıkta "Ninja" geçiyorsa eşleşme
 * güvenilirdir.
 */
export function titleMentionsBrand(title: string, brand: string): boolean {
  const needle = String(brand ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR");
  if (needle.length < 3) return false;
  // KELİME SINIRI: "Cosori" ↔ "Cosori'nin" eşleşir ama "Air" ↔ "air fryer"
  // gibi ALT DİZİ kazaları olmaz. Ölçülen hata: katalog kaydının markası
  // "Air" geldiğinde alt dizi kontrolü onu 17 adayın başlığında "buldu" ve
  // o markayı satırlara yazdı (uydurma marka).
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(
    String(title ?? "").toLocaleLowerCase("tr-TR"),
  );
}

/**
 * Bir metin MARKA olarak makul mü — dış kaynakların (ürün kataloğu) marka
 * alanını süzmek için.
 *
 * NEDEN GEREKLİ: katalog kayıtlarının marka alanı bozuk olabiliyor (ölçüldü:
 * `brand: "Air fryer XL"`, `brand: "Air"`). Doğrulanmadan kullanılırsa
 * satırlara uydurma marka yazılır ve `productModelKey` iki FARKLI ürünü
 * birleştirir.
 */
export function plausibleBrand(value: string): boolean {
  return acceptableBrand(value) !== "";
}

/**
 * Marka listesini tekilleştirip normalize eder (kaynak + UPCitemdb birleşimi).
 * Boşlar atılır; sıra korunur (ilk bulunan öncelikli).
 */
export function mergeBrands(...values: readonly (string | null | undefined)[]): string {
  for (const value of values) {
    const brand = acceptableBrand(String(value ?? "")) || String(value ?? "").trim();
    if (brand) return brand.slice(0, 40);
  }
  return "";
}
