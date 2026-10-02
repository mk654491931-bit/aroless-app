/**
 * Ürün sorgusu hazırlığı — "ürün kartlarında neden hiç veri yok?" sorusunun cevabı.
 *
 * ÖLÇÜLEN GERÇEK (canlı ağ, 2026-10-02, niş = "LED masa lambası"):
 *
 *   itunes             ok      0 satır
 *   marketplace-price  HATA    0 satır   "no marketplace listings"
 *   bing-shopping      ok      0 satır
 *   openfoodfacts      ok      0 satır
 *   wikipedia-demand   ok      0 satır
 *   …
 *   web-reviews        ok  10 satır     ← bunlar ÜRÜN DEĞİL, haber/madde
 *   github             ok      5 satır     ← bunlar da ÜRÜN DEĞİL
 *
 * Yani bir ürün kaynağından **tek bir satır** gelmiyor; sonuç listesini
 * dolduran şey ürün olmayan satırlardı. Kırılan iki yer:
 *
 *   1. DİL: ABD/Avrupa pazaryerleri Türkçe sorguyu anlamıyor. Aynı kod
 *      İngilizce "led desk lamp" ile 2 gerçek fiyatlı ilan döndürüyor.
 *      Bu modül, sorguyu **deterministik** olarak ürün aramasına uygun hale
 *      getirir (eklenti soyma + sözlük). Ağ, anahtar veya model çağrısı
 *      gerektirmez; milisaniyeler sürer ve hat bütçesine ek yük bindirmez.
 *
 *   2. ÜRÜN ŞEKLİ: Ansiklopedi maddesi de "bir kaynak bana şunu döndürdü"
 *      diye listeye giriyor. `looksLikeProductRow` bu tür satırları ayırır;
 *      onlar kanıt olarak kalır ama ÜRÜN kartı olmaz.
 */

/* --------------------------------------------------------------- Türkçe çekim */

/**
 * Türkçe ekler — ASCII'ye indirilmiş HALDE.
 *
 * "lambası" → "lamba", "telefonları" → "telefon". Ürün adlarındaki ekleri
 * temizlemeden sözlükteki karşılık bulunamaz.
 *
 * SIRA ÖNEMLİ: en uzun ek önce denenir, çünkü "-ları" hem "-lar" hem "-ı"
 * içerir; kısa ek önce denense "telefonları" → "telefon" yerine "telefoni"
 * gibi bozuk kökler kalır (ölçüldü: bu hata ilk yazımda vardı).
 *
 * EKLER ASCII YAZILIR: eşleştirme `asciiFold()` SONRASI yapıldığı için "ı"
 * içeren bir ek ("ları") indirgenmiş metinde ("lari") hiç eşleşmezdi.
 */
const SUFFIXES = [
  "larin",
  "lerin",
  "lari",
  "leri",
  "lar",
  "ler",
  "nin",
  "nun",
  "da",
  "de",
  "ta",
  "te",
  "si",
  "su",
  "i",
  "u",
  "a",
  "e",
];

/** Türkçe harfleri ASCII'ye indirger: "lambası" → "lambasi". */
export function asciiFold(value: string): string {
  const map: Record<string, string> = {
    ç: "c",
    ğ: "g",
    ı: "i",
    İ: "i",
    ö: "o",
    ş: "s",
    ü: "u",
  };
  return String(value ?? "")
    .toLowerCase()
    .replace(/[çğıİöşü]/g, (ch) => map[ch] ?? ch);
}

/** Sonundaki Türkçe ekleri atar (yukarıdaki sırayla, en uzun ek önce). */
export function stripTurkishAffixes(token: string): string {
  let out = asciiFold(token).trim();
  for (const suffix of SUFFIXES) {
    if (out.length > suffix.length + 2 && out.endsWith(suffix)) {
      return out.slice(0, -suffix.length);
    }
  }
  return out;
}

/* --------------------------------------------------- Sözlük (TR → EN ürün) */

/**
 * Günlük dilde en çok aranan ürün kelimeleri.
 *
 * KAPSAM BİLEREK SINIRLI: bu genel bir çeviri sözlüğü DEĞİLDİR. Amaç yalnızca
 * "TR sorgusu → TR pazaryeri (yok) → EN pazaryeri (var)" köprüsünü kurmak.
 * Kelime bulunamazsa kökü olduğu gibi (ASCII'ye inmiş haliyle) bırakırız;
 * yanlış çeviri, doğru olmayan bir ürün kümesinden daha kötüdür.
 */
const PRODUCT_WORD_EN: Record<string, string> = {
  // aydınlatma
  lamba: "lamp",
  lambasi: "lamp",
  masa: "desk",
  isik: "light",
  aydinlatma: "lighting",
  ampul: "bulb",
  // teknoloji
  telefon: "phone",
  akilli: "smart",
  bilgisayar: "laptop",
  dizustu: "laptop",
  tablet: "tablet",
  saat: "watch",
  kolye: "earbuds",
  kulaklik: "headphones",
  hoparlor: "speaker",
  kamera: "camera",
  klipser: "trimmer",
  sarj: "charger",
  kablo: "cable",
  klavye: "keyboard",
  fare: "mouse",
  monitor: "monitor",
  yazici: "printer",
  // ev aletleri
  robot: "robot",
  supurge: "vacuum",
  klima: "air conditioner",
  buzdolabi: "refrigerator",
  firin: "oven",
  mikrodalga: "microwave",
  blender: "blender",
  kahve: "coffee",
  cay: "tea",
  tost: "toaster",
  // kişisel bakım
  sac: "hair",
  sampuan: "shampoo",
  krem: "cream",
  serum: "serum",
  parfum: "perfume",
  maske: "mask",
  // giyim / aksesuar
  ayakkabi: "shoe",
  bot: "boot",
  canta: "bag",
  elbise: "dress",
  gomlek: "shirt",
  pantolon: "pants",
  saatlik: "watch",
  // spor / outdoor
  bisiklet: "bike",
  kayak: "paddle",
  egzersiz: "fitness",
  // ofis / okul
  kalem: "pen",
  defter: "notebook",
  kitap: "book",
  // Çekimli HALLER de yazılıdır: "kitabı" → "kitap" dönüşümü ek soyma ile
  // YAPILAMAZ (Türkçede ünsüz değişimi var: kitap → kitab-ı). Ölçülen hata:
  // "matematik kitabı" → "matematik kitab" (sözlükteki "kitap" kaçırılıyor).
  kitab: "book",
  kitablar: "book",
  tel: "phone",
  // gıda
  vitamin: "vitamin",
  protein: "protein",
  sakiz: "gum",
  kahveMakinesi: "coffee maker",
};

/**
 * Sözlükteki İngilizce karşılık; yoksa ASCII'ye inmiş kök.
 *
 * SIRA ÖNEMLİ: önce DÜZGÜN kelime, sonra kök. Aksi hâlde "kitabı" → "kitab"
 * çıkar ve `kitap` sözlük girdisi kaçırılır (ölçülen hata).
 */
function toProductWord(root: string): string {
  const direct = PRODUCT_WORD_EN[root];
  if (direct) return direct;
  const stripped = stripTurkishAffixes(root);
  return PRODUCT_WORD_EN[stripped] ?? stripped;
}

/* ------------------------------------------------------------ Sorgu üretimi */

/** Türkçe/aksanlı sorguyu ASCII'ye indirip gereksiz kelimeleri atar. */
export function normalizeNiche(niche: string): string {
  return asciiFold(niche)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Sorgunun İngilizce (pazaryeri dostu) karşılığı.
 *
 * Örnekler:
 *   "LED masa lambası"      → "led desk lamp"
 *   "Kablosuz Kulaklık"     → "wireless headphones" ("wireless" sözlükte
 *                              yok, kökü olduğu gibi kalır — kasıtlı)
 *   "air fryer"             → "air fryer" (zaten İngilizce, değişmez)
 *
 * DİZİ SIRA ÖNEMLİ: çeviri sonra yapılır, çünkü ASCII'ye indirmek "ışık" →
 * "isik" yapar ve sözlük "isik" anahtarını tutar.
 */
export function englishProductQuery(niche: string): string {
  const raw = String(niche ?? "")
    .toLowerCase()
    .split(/[^a-z0-9çğıöşüİ]+/i)
    .filter(Boolean);
  if (!raw.length) return "";

  const translated = raw
    .map((word) => {
      // Sözlük kelime biçiminde tutar: "masa lambası" → ["masa", "lambasi"]
      const ascii = asciiFold(word);
      if (PRODUCT_WORD_EN[ascii]) return PRODUCT_WORD_EN[ascii];
      return toProductWord(word);
    })
    .filter(Boolean);

  return [...new Set(translated)].join(" ").trim();
}

/**
 * Ürün kaynaklarının deneneceği sorgu sırası.
 *
 * Sıralama kasıtlı:
 *   1. İngilizce karşılık — pazaryerlerde gerçek ürün bulunan yol.
 *   2. ASCII'ye inmiş özgün sorgu — zaten Latin alfabesiyle yazılmışsa.
 *   3. Özgün sorgu — kaynak kendi dilinde daha iyi sonuç veriyorsa (ör. Open
 *      Food Facts, yerel pazar).
 *
 * Tekrarlar atılır; aynı sorgu iki kez denenmez (kota ve süre israfı).
 */
export function productQueryVariants(niche: string, limit = 2): string[] {
  const original = String(niche ?? "").trim();
  const candidates = [englishProductQuery(original), normalizeNiche(original), original];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sorgu Türkçe mi? (ülke seçimi ve sözlük kullanımı için) */
export function isTurkishQuery(niche: string): boolean {
  return /[çğıöşüİ]/.test(String(niche ?? ""));
}

/* ------------------------------------------------------- "Bu bir ürün mü?" */

/** Bir kaynağın ürün OLMAYAN satır üretip üretmediği — bilinen liste. */
export const NON_PRODUCT_SOURCES = new Set([
  "wikipedia-demand",
  "wikidata",
  "hackernews",
  "reddit-archive",
  "github",
  "google-trends",
  "google-news",
  "web-reviews",
]);

/**
 * Satır gerçek bir ÜRÜN İLANI gibi mi?
 *
 * ÖLÇÜM: "LED masa lambası" aramasında kazanan 5 ürünün 5'i de ansiklopedi
 * maddesiydi ("Light-emitting diode - Wikipedia"). Bunlar talep sinyalidir,
 * satılabilir ürün değildir; fiyatları ve puanları yoktur ve kullanıcıya
 * "ürün" diye sunulması yanlıştır.
 *
 * ÜRÜN OLMA KRİTERİ (sırayla):
 *   1. Ürün kaynağından geliyorsa → üründür (pazaryeri, iTunes, Open Food Facts).
 *   2. Fiyat ya da puan taşıyorsa → üründür (haber metninden fiyat çıkarılmış
 *      olabilir ama en azından ölçülebilir bir alan var).
 *   3. Ansiklopedi/dizin kalıpları taşıyorsa → ürün DEĞİLDİR.
 *   4. Başlığın kendisi bir ürün adı gibi görünüyorsa → üründür.
 */
export function looksLikeProductRow(
  title: string,
  source: string,
  fields: { priceUsd?: number | null; rating?: number | null } = {},
): boolean {
  const text = String(title ?? "").trim();
  if (!text) return false;

  const hasPrice = typeof fields.priceUsd === "number" && fields.priceUsd > 0;
  const hasRating = typeof fields.rating === "number" && fields.rating > 0;
  if (NON_PRODUCT_SOURCES.has(source) && !hasPrice && !hasRating) return false;

  // Ansiklopedi/dizin başlık kalıpları: kaynak zaten ürün olmayan listede
  // değilse bile (ör. web-reviews bir Wikipedia bağlantısını dönmüş olabilir)
  // başlık kesin bir tanım cümlesi ise ürün sayılmaz.
  if (/^(light|what is|definition|history of|guide to|top \d+|best \d+)/i.test(text)) return false;
  if (/\b(wikipedia|encyclopedia|definition of|nedir|ne işe yarar)\b/i.test(text)) return false;

  return true;
}