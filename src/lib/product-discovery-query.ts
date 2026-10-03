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
  // evde yaşam / hayvan
  kedi: "cat",
  kopek: "dog",
  tavsan: "rabbit",
  balik: "fish",
  akvaryum: "aquarium",
  yuva: "bed",
  tasma: "leash",
  tas: "bowl",
  mama: "food",
  kum: "litter",
  tirmalama: "scratching",
  tirmalamaTahtasi: "scratching board",
  tasmalik: "harness",
  yemlik: "feeder",
  // ev / yaşam
  tahta: "board",
  kutu: "box",
  kapı: "door",
  pencere: "window",
  sandalye: "chair",
  sehpa: "coffee table",
  dolap: "wardrobe",
  raf: "shelf",
  battaniye: "blanket",
  hali: "rug",
  perde: "curtain",
  kilit: "lock",
  cobanpincere: "tongs",
  bardak: "glass",
  kase: "plate",
};

/**
 * Sözlükteki İngilizce karşılık; yoksa ASCII'ye inmiş ÖZGÜN KELİME.
 *
 * SIRA ÖNEMLİ: önce DÜZGÜN kelime, sonra kök. Aksi hâlde "kitabı" → "kitab"
 * çıkar ve `kitap` sözlük girdisi kaçırılır (ölçülen hata).
 *
 * ÖLÇÜLEN HATA (2026-10-03, düzeltildi): eski sürüm son çare olarak KÖKÜ
 * döndürüyordu. Sözlükte olmayan her kelime bu yüzden bozuluyordu:
 *   "kedi tırmalama tahtası" → "ked tirmalam tahta"
 * Pazaryerlerinde aranan da tam olarak budur; yani Türkçe sorgu global
 * pazaryerlerine ÇÖPE gidiyordu ve o nişte 0 ürün dönüyordu.
 * Artık ek soyma YALNIZ sözlükte karşılığı bulunduğunda işe yarar; bulunamazsa
 * kelime ASCII'ye indirilmiş hâliyle olduğu gibi kalır ("kedi tirmalama
 * tahtasi") — yerel pazaryerlerinde hâlâ işe yarayan, bozulmamış biçim.
 */
function toProductWord(root: string): string {
  const direct = PRODUCT_WORD_EN[root];
  if (direct) return direct;
  const stripped = stripTurkishAffixes(root);
  return PRODUCT_WORD_EN[stripped] ?? asciiFold(root);
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

/* ------------------------------------------------------- "Bu bir oyun mu?" */

/**
 * Niş OYUN mu? Yalnız Steam kaynağı için gerekir.
 *
 * NEDEN VAR (ölçüm, 2026-10-02): Steam bir OYUN mağazasıdır. Sorgu varyantı
 * makinesi "LED masa lambası" → "led desk lamp" çevirdiği için, Steam'de
 * bulunan "Desk Lamp Deluxe" adlı bir OYUN nişle eşleşiyor ve gerçek bir
 * fiziksel ürün aramasına oyun kartı sızıyordu.
 *
 * KURAL — BİLEREK DAR: yalnız nişin kendisinde oyun sözcüğü varsa true.
 * "oyun" kelimesi geçmeyen bir nişte Steam HİÇ ÇAĞRILMAZ. Bu, oyun
 * olmayan nişlerde yanlış-negatifi (oyun ürünü kaçırılır) kabul eder;
 * tersi — fiziksel ürüne oyun sokmak — vitrini bozan ve daha kötü bir
 * hatadır. Bu yüzden güvenli yön seçilmiştir.
 *
 * Kapsam TR + EN: niş Türkçe ("coşku oyunu") ya da İngilizce
 * ("strategy game") olabilir; ikisi de ASCII'ye indirilerek bakılır.
 */
const GAME_WORDS = new Set([
  "oyun",
  "oyunlar",
  "game",
  "games",
  "gaming",
  "steam",
  "rpg",
  "fps",
]);

/**
 * Niş OYUN mu? Yalnız Steam kaynağı için gerekir.
 *
 * KURAL — BİLEREK DAR: nişin KÖKünde oyun sözcüğü yoksa false. Böylece
 * "LED masa lambası" Steam'i hiç çağırmaz. Bu, oyun ürünü kaçırma riskini
 * kabul eder; tersi — fiziksel ürün aramasına oyun sokmak — vitrini bozan
 * ve daha kötü bir hatadır.
 *
 * Türkçe ekler `stripTurkishAffixes` ile soyulur: "oyunu", "oyunları",
 * "oyunların" hepsi "oyun" köküne iner, hepsi eşleşir.
 *
 * DİKKAT (ölçülen hata): Türkçe ek soyma İngilizce kelimelere UYGULANMAZ.
 * `stripTurkishAffixes("game")` → `"gam"` döner, yani "strategy game" hiç
 * eşleşmezdi. Bu yüzden her token İKİ biçimde denenir: olduğu gibi (İngilizce)
 * ve ekleri soyulmuş olarak (Türkçe).
 */
export function isGameNiche(niche: string): boolean {
  const tokens = String(niche ?? "")
    .split(/[^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]+/)
    .map((w) => asciiFold(w))
    .filter(Boolean);
  return tokens.some(
    (token) => GAME_WORDS.has(token) || GAME_WORDS.has(stripTurkishAffixes(token)),
  );
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
 * KATALOĞU TAMAMEN DİJİTAL LİSANS olan kaynaklar — hiçbir zaman satılabilir
 * ürün üretemezler.
 *
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı: "film önerdi resmen"): `itunes`
 * kaynağı, nişte "film" kelimesi geçtiği için (`isMediaNiche`) film/dizi/müzik
 * kayıtlarını ÜRÜN olarak kabul ediyordu. Kullanıcı bir niş aradı, kartlarda
 * film çıktı. Sebep iki katmanlıydı ve ikisi de burada kapatılıyor:
 *
 *   1. iTunes Store TEK ÇEŞİT mal satar: dijital lisans (film, dizi, şarkı,
 *      sesli kitap, uygulama, e-kitap). Bunların hiçbiri yeniden satılamaz,
 *      tedarik edilemez ve marjı yoktur — "kazandıran ürün" olamazlar.
 *      Apple satıcı hesabı zaten lisans yeniden satımına izin vermez.
 *   2. "Film" kelimesi geçen HER niş medya nişi değildir: "analog film",
 *      "film endüstriyel kamera", "35mm film" fiziksel ürün nişleridir.
 *      Kelimeye bakarak medya serbest bırakmak bu hatayı üretti.
 *
 * Bu yüzden kural "niş medya mı?" değil, "satır yeniden satılabilir fiziksel
 * ürün mü?" olmalıdır.
 */
export const DIGITAL_ONLY_SOURCES = new Set(["itunes"]);

/**
 * Başlığın kendisi bir medya çıkışı gibi mi görünüyor? (film, sezon, albüm…)
 *
 * BİLEREK ÇOK DAR: yalnız yapısal kalıplar yakalanır (sezon/bölüm numarası,
 * Blu-Ray/DVD, soundtrack, collector's edition). Belirsiz işaretler KAPSAM
 * DIŞIDIR ve gerekçesi ölçülmüştür:
 *
 *   • "4K" / "UHD" → "Sony 4K UHD TV (2019)" da yakalar, oysa o bir TELEVİZYON.
 *   • "(2010)" → "Canon EOS (2010)" da yakalar, oysa o bir FOTOĞRAF MAKİNESİ.
 *   • "film" kelimesi → "Kodak Portra 400 Film 36mm" de yakalar, oysa o bir
 *     GERÇEK ÜRÜN (ve tam olarak aranan şey).
 *
 * Bu yüzden belirsiz başlıklar KAYNAK kapısına bırakılır (`DIGITAL_ONLY_SOURCES`):
 * iTunes'tan gelen "Inception (2010)" kaynağı sayesinde elenir, başlığına
 * bakılarak değil.
 */
export function looksLikeMediaRelease(title: string): boolean {
  const text = String(title ?? "").toLowerCase();
  return /\b(season\s*\d|episode\s*\d|blu[\s-]?ray|dvd|soundtrack|vol\.?\s*\d|collector'?s edition)\b/.test(
    text,
  );
}

/**
 * NİŞ ALAKALILIK PUANI (0-1) — DİL BAĞIMSIZ.
 *
 * ÖLÇÜLEN HATA (2026-10-03, "kedi tırmalama tahtası" / "LED masa lambası"):
 *   • "analog film" → "The revenge of analog" (bir KİTAP, ürün değil) 1/2 eşleşti
 *     ve nişin ürünü sanıldı.
 *   • "LED masa lambası" → "Brightech Libra LED desk lamp" (GERÇEK ve EN İYİ
 *     ürün) TÜRKÇE tokenlarla 0/2 eşleşti; çünkü başlık İngilizce.
 *
 * Yani tek dille puanlamak iki yönde de yanlış: alakasızı geçiriyor,
 * en iyiyi düşürüyor. Bu yüzden puan, nişin ÖZGÜN tokenları ile İngilizce ürün
 * karşılığının tokenları arasında **DAN YÜKSEĞİ** alınır.
 *
 * @returns 0 (hiç eşleşme) … 1 (tüm tokenlar eşleşti)
 */
export function relevanceScore(title: string, niche: string): number {
  const text = String(title ?? "").toLowerCase();
  if (!text) return 0;
  const original = nicheTokensOf(niche);
  const translated = nicheTokensOf(englishProductQuery(niche));
  let best = 0;
  for (const tokens of [original, translated]) {
    if (!tokens.length) continue;
    const hit = tokens.filter((t) => matchesToken(text, t)).length;
    best = Math.max(best, hit / tokens.length);
  }
  return Math.round(best * 100) / 100;
}

/**
 * Token eşleşmesi — KÖK TOLERANSLI.
 *
 * ÖLÇÜLEN HATA: sözlük `tırmalama` → "scratcher" çeviriyordu ama gerçek ürün
 * başlığı "cat SCRATCHING board" diyor; kelime biçim farkı yüzünden güçlü
 * eşleşme sayılmıyordu. Aynı sorun İngilizcede de var ("lamp" ↔ "lamps").
 *
 * Güvenli kural: yalnız 6+ harfli tokenlarda ilk 6 harf (kök) aranır. Kısa
 * tokenlarda kök aramak yanlış eşleşme üretirdi ("board" → "bo" her yerde).
 */
function matchesToken(text: string, token: string): boolean {
  if (text.includes(token)) return true;
  return token.length >= 6 && text.includes(token.slice(0, 6));
}

/**
 * "GÜÇLÜ" eşleşme eşiği: tokenların TAMAMI eşleşmeli.
 *
 * NEDEN 0,5 DEĞİL: iki tokenlı bir nişte 1/2 eşleşme "analog film" →
 * "The revenge of analog" hatasını bırakır. Tam eşleşme hem o hatayı
 * kesiyor hem de riskli değil: kaynak zaten en az bir eşleşme arıyor, bu
 * ek kapı YALNIZ zayıf eşleşmeleri düşürüyor.
 */
export function isStrongProductMatch(title: string, niche: string): boolean {
  return relevanceScore(title, niche) >= 1;
}

/** NİŞten alakalılık için kullanılan tokenlar (4+ harf). */
function nicheTokensOf(niche: string): string[] {
  return String(niche ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 4);
}

/**
 * Bu satır YENİDEN SATILABİLİR bir ürün mü?
 *
 * İki kapı birlikte: dijital lisans kataloğu elenir, medya çıkışı başlığı elenir.
 * Kaynak bazlı kapı (dijital katalog) her zaman güçlüdür; başlık kapısı ise
 * YALNIZ yapısal medya kalıplarında çalışır (bkz. `looksLikeMediaRelease`).
 */
export function isSellableProductRow(
  title: string,
  source: string,
  fields: { priceUsd?: number | null; rating?: number | null } = {},
): boolean {
  if (DIGITAL_ONLY_SOURCES.has(source)) return false;
  if (looksLikeMediaRelease(title)) return false;
  return looksLikeProductRow(title, source, fields);
}

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
  // Dijital lisans kataloğu: fiyatı ve puanı olsa bile ÜRÜN DEĞİLDİR
  // (yeniden satılamaz, tedarik edilemez). Ölçülen hata: "film önerdi".
  if (DIGITAL_ONLY_SOURCES.has(source)) return false;
  if (NON_PRODUCT_SOURCES.has(source) && !hasPrice && !hasRating) return false;
  if (looksLikeMediaRelease(text)) return false;

  // Ansiklopedi/dizin başlık kalıpları: kaynak zaten ürün olmayan listede
  // değilse bile (ör. web-reviews bir Wikipedia bağlantısını dönmüş olabilir)
  // başlık kesin bir tanım cümlesi ise ürün sayılmaz.
  if (/^(light|what is|definition|history of|guide to|top \d+|best \d+)/i.test(text)) return false;
  if (/\b(wikipedia|encyclopedia|definition of|nedir|ne işe yarar)\b/i.test(text)) return false;

  return true;
}