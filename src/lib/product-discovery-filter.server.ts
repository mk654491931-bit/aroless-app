// ============================================================================
// DETERMINISTIC HARD FILTER + KURAL TABANLI ÖN SKORLAMA  (AI YOK, $0).
//
// Bu dosya 60 adayı 75'e (veya ne kadar varsa ona) indirirken TÜM kararı
// saf kodla verir. Model çağrısı YALNIZCA bu adımdan SONRA, `gemini_shortlist`
// aşamasında başlar. Böylece:
//
//   • Maliyet: 100 adaylık bir nişte 0 token harcanır (en pahalı kısım atlanır).
//   • Sürdürülebilirlik: filtre kuralları test edilebilir, denetlenebilir.
//   • Dürüstlük: elenen ürün SAYILIR ve gerekçesi loglanır; "60 üründen 3 tane
//     buldum" ile "60 üründen 3 tane kaldı" birbirine karışmaz.
//
// KURALLAR (hepsi deterministik, hepsi açıklanabilir):
//   • rating < 3.5 ve EN AZ 3 değerlendirme varsa ele   (tek yıldız tek ses = gürültü)
//   • inStock === false ise ele                        (gerçekten bilinen satış dışı)
//   • fiyat <= 0 veya fiyat bilinmiyor + kaynak fiyat taşımıyorsa ele (marj hesaplanamaz)
//   • aynı fingerprint → tek ürün                       (en yüksek puanlı kazanır)
//   • veri bütünlüğü çok düşükse ele                   (puan uydurulamaz)
//
// ÖNEMLİ: `inStock === null` "bilinmiyor" demektir ve ELEMEZ. Çünkü çoğu
// kaynak stok bilgisi vermez; `null`'ı "stok yok" saymak, kanıtsız ürün
// eleyip sonuç listesini boşaltırdı.
// ============================================================================

import {
  productFingerprint,
  productModelKey,
  RawProductSchema,
  type FilterStats,
  type NormalizedProduct,
  type ParsedRawProduct,
  type RawProduct,
} from "./product-discovery.types";
import { brandFromTitle } from "./product-brand";
import { inferProductCategory } from "./product-categories";
import { normalizeGtin } from "./product-identity";
import { isNonProductSource } from "./product-discovery-query";

/** Minimum kabul edilebilir puan (5 üzerinden). */
export const MIN_RATING = 3.5;
/** Puanın anlamlı sayılması için gereken minimum değerlendirme sayısı. */
export const MIN_RATING_COUNT = 3;
/** Veri bütünlüğü bu altındaysa ürün listeye giremez. */
export const MIN_COMPLETENESS = 1;
/** Ticari kanıt kapısının devreye girmesi için gereken en az gerçek ürün satırı. */
export const MIN_COMMERCE_POOL = 5;

/**
 * Kanıt yuvalarının okuduğu alanlar. `ParsedRawProduct` de `NormalizedProduct`
 * de bu şekle uyar; böylece bütünlük puanı HEM ham satırda HEM normalize
 * edilmiş satırda AYNI fonksiyonla hesaplanır (iki formül → iki farklı puan).
 */
export type EvidenceShape = Pick<
  ParsedRawProduct,
  | "priceUsd"
  | "brand"
  | "seller"
  | "url"
  | "notes"
  | "rating"
  | "ratingCount"
  | "inStock"
  | "imageUrl"
  | "salesVolume"
  | "viewed90d"
> & {
  /**
   * Marka bağımsız bir kaynaktan mı ÖLÇÜLDÜ (yoksa başlıktan mı çıkarıldı)?
   * `undefined` = ham satır (kaynağın verdiği marka ölçümdür) → `true` sayılır.
   */
  brandMeasured?: boolean;
};

/**
 * ÇEKİRDEK KANIT YUVALARI (5).
 *
 * Eski model (`MEASURABLE = 4` + `__demand_bonus__`) iki yönde bozuktu:
 *   • Payda sabit 4'tü, oysa "ticari olarak ölçülebilen alan" listesi kaynaktan
 *     kaynağa değişiyor; `name` zaten şemada `min(1)` olduğu halde sayılmıyordu.
 *   • `demand` bir "bonus" gibi muamele görüyordu: talep kanıtı OLAN satır 4
 *     eksik alanla birlikte 1 puan alıyor, olmayan satır 0 alıyordu. Yani
 *     Hacker News / Reddit / Wikipedia gibi ürün SATMAYAN ama talep ÖLÇEN
 *     kaynaklar, kanıtsız satırlarla aynı sınıfta kalıyordu.
 *
 * Yeni model: kanıt, o alanı DOLDURAN kaynaktan gelir. Beş çekirdek yuva
 * (price, brand, seller, url, demand) birlikte 0-5 ölçeğini verir. `rating`,
 * `stock` ve `image` yalnızca ARTIRAN bonuslardır: boş olmaları kanıt
 * eksikliği sayılmaz, çünkü kaynakların çoğu onları hiç vermez.
 *
 * `ratingCount` BONUS LİSTESİNDEN ÇIKARILDI: aynı sayı hem `demand` çekirdek
 * yuvasını dolduruyor hem bonus sayılıyordu, yani TEK bir ölçüm iki kanıt gibi
 * görünüyordu. Tek sayı, tek yuva.
 *
 * İKİ YUVA DÜZELTİLDİ (2026-10-15, ölçülmüş yanlış beyan):
 *   • `demand` eskiden `/\d/.test(notes)` idi — notes içinde HERHANGİ bir rakam
 *     (fiyat metni, tarih damgası) "ölçülmüş talep" sayılıyordu. Bu, aynı
 *     kavramı iki modülde iki farklı tanımlıyordu: `discovery-quality`
 *     "serbest metin ölçüm değildir" derken burada fiyat metni talep kanıtı
 *     oluyordu. Artık yalnız ÖLÇÜLMÜŞ sayısal talep alanları sayılır:
 *     satış adedi, 90 günlük görüntülenme ya da değerlendirme sayısı.
 *   • `image` artık çekirdek bir BONUS yuvasıdır: kazıma görseli ZORUNLU
 *     tutuyor (`requireImage`) ve 75/75 satır görselli geliyor, yani "ürün
 *     görseli ölçüldü" bilgisi bütünlük puanına girmelidir. Eskiden girmediği
 *     için vitrinin en görünür kanıtı skorlanmıyordu.
 */
const EVIDENCE_SLOTS = [
  ["price", (p: EvidenceShape) => p.priceUsd !== null],
  // MARKA YUVASI: yalnız BAĞIMSIZ ölçüm sayılır. Başlıktan çıkarılan marka
  // (brandMeasured=false) bu yuvayı DOLDURMAZ — başlık zaten sayılıyor ve
  // aynı metinden ikinci bir yuva türetmek "ölçtük" iddiasını şişirirdi.
  [
    "brand",
    (p: EvidenceShape) => p.brand.trim() !== "" && (p.brandMeasured ?? true),
  ],
  ["seller", (p: EvidenceShape) => p.seller.trim() !== ""],
  ["url", (p: EvidenceShape) => p.url.trim() !== ""],
  // ÖLÇÜLMÜŞ talep: SAYISAL talep alanlarından biri gerçekten ölçüldü mü?
  [
    "demand",
    (p: EvidenceShape) =>
      (typeof p.salesVolume === "number" && p.salesVolume > 0) ||
      (typeof p.viewed90d === "number" && p.viewed90d > 0) ||
      (typeof p.ratingCount === "number" && p.ratingCount > 0),
  ],
] as const satisfies readonly (readonly [string, (p: EvidenceShape) => boolean])[];

/**
 * BONUS YUVALARI — doluysa `dataCompleteness` artar, boşsa `missingFields`'e
 * YAZILMAZ. Puan/stok kaynakların çoğunda yoktur; yokluğu kanıtsızlık saymak
 * doğru bir ürünü haksız cezalandırırdı.
 */
const BONUS_SLOTS = [
  ["rating", (p: EvidenceShape) => p.rating !== null],
  ["stock", (p: EvidenceShape) => p.inStock !== null],
  ["image", (p: EvidenceShape) => String(p.imageUrl ?? "").trim() !== ""],
] as const satisfies readonly (readonly [string, (p: EvidenceShape) => boolean])[];

/**
 * Veri bütünlüğü (0-5) ve eksik alan adları — TEK kaynak.
 *
 * Çekirdek yuvalar hem puana hem `missingFields` listesine yazılır; bonus
 * yuvalar (puan/stok) yalnızca puana. Bu ayrım sayesinde "ölçülmedi" ile
 * "ölçtük ve sıfır" karışmaz.
 */
export function evidenceCompleteness(p: EvidenceShape): {
  dataCompleteness: number;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  let filled = 0;
  for (const [field, hasEvidence] of EVIDENCE_SLOTS) {
    if (hasEvidence(p)) filled++;
    else missingFields.push(field);
  }
  for (const [, hasEvidence] of BONUS_SLOTS) {
    if (hasEvidence(p)) filled++;
  }
  return { dataCompleteness: Math.max(0, Math.min(5, filled)), missingFields };
}

/**
 * Ağırlıklı sinyal toplamı (0-100 taban).
 *
 * TEK kaynak olması kritiktir: tekilleştirmede birleşen ürünün puanı da bu
 * formülden geçer. Kopyalansaydı aynı kanıt iki farklı puan üretebilirdi.
 */
export function signalWeightedScore(signals: NormalizedProduct["signals"]): number {
  return (
    signals.demand * 0.28 +
    signals.margin * 0.26 +
    signals.rating * 0.22 +
    signals.availability * 0.12 +
    signals.competition * 0.12
  );
}

/** Eksik kanıt cezası: 5/5 → 0 puan, 0/5 → 20 puan. */
export function evidencePenalty(dataCompleteness: number): number {
  const filled = Math.max(0, Math.min(5, dataCompleteness));
  return (5 - filled) * 4;
}

/** Kaynak satırlarını normalize eder ve parmak izi üretir. */
export function normalizeRaw(raw: RawProduct): NormalizedProduct {
  const parsed = RawProductSchema.parse(raw);
  // MARKA — kaynak vermediyse BAŞLIKTAN ölçülür (`brandFromTitle`).
  //
  // ÖLÇÜLEN BOŞLUK (2026-10-15): 75/75 adayda marka boştu; sebebi pazaryeri
  // LİSTE sayfalarının marka alanı sunmaması. Marka `productModelKey`in
  // girdisidir: markasız üründe anahtar hiç üretilmez, aynı ürünün iki mağaza
  // yazımı iki AYRI ürün sayılır ve nihai 5'lik listeye iki kez girebilir.
  // Çıkarım UYDURMA DEĞİLDİR: yalnız yapısal olarak marka olduğu anlaşılan
  // öbek döner, aksi hâlde `""` kalır (bkz. `product-brand.ts`).
  const declaredBrand = parsed.brand.trim();
  const brand = declaredBrand || brandFromTitle(parsed.title);
  // MARKA ÖLÇÜLDÜ MÜ: kaynağın/kataloğun verdiği marka ölçümdür
  // (`brandMeasured: true`), başlıktan çıkarılan marka TÜREVDİR (false) ve
  // kanıt yuvasını doldurmaz — kartta yine gösterilir.
  const brandMeasured = declaredBrand !== "" && parsed.brandMeasured;
  // KATEGORİ: kaynak ya da katalog verdiyse o kullanılır; boşsa başlıktaki
  // somut ürün cinsi kelimelerinden Google Product Taxonomy yolu çıkarılır.
  // Kategori `EVIDENCE_SLOTS` içinde değildir, yani bütünlük puanını şişirmez.
  const declaredCategory = parsed.category.trim();
  const category = declaredCategory || inferProductCategory(parsed.title);
  // Dolu yuva sayısı = veri bütünlüğü puanı (0-5). Marka yuvası yalnız
  // BAĞIMSIZ ölçümle dolar (`brandMeasured`).
  const { dataCompleteness, missingFields: missing } = evidenceCompleteness({
    ...parsed,
    brand,
    brandMeasured,
  });

  return {
    name: parsed.title.slice(0, 180),
    brand: brand.slice(0, 60),
    brandMeasured,
    seller: parsed.seller.slice(0, 60),
    category: category.slice(0, 80),
    priceUsd: parsed.priceUsd,
    rating: parsed.rating,
    ratingCount: parsed.ratingCount,
    inStock: parsed.inStock,
    sources: [parsed.source].filter(Boolean),
    url: parsed.url,
    notes: parsed.notes.slice(0, 200),
    viewed90d: parsed.viewed90d,
    id: parsed.id.slice(0, 120),
    // Görsel URL'si uzunluk sınırı: sınır aşan URL kırpılır ama boşsa kapı
    // onu eler (bkz. `product-discovery-shortlist.server.ts`).
    imageUrl: parsed.imageUrl.trim().slice(0, 500),
    salesVolume: parsed.salesVolume,
    gtin: normalizeGtin(parsed.gtin),
    mpn: parsed.mpn.trim().slice(0, 60),
    fingerprint: productFingerprint({
      title: parsed.title,
      brand: parsed.brand,
      seller: parsed.seller,
    }),
    preScore: 0,
    // Skorlanmadan önce nötr sinyaller: puanlama sonrası hepsi dolar.
    signals: { demand: 50, competition: 50, margin: 50, rating: 50, availability: 50 },
    dataCompleteness,
    missingFields: missing,
    source: "scraped",
  };
}

/* --------------------------------------------------- Kural tabanlı skorlama */

/** Puanı 0-1 aralığına sıkıştırır. */
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Talep sinyali (0-100).
 *
 * Ölçülebilir kanıt: niş etkileşim yoğunluğu (upvote+yorum), GitHub yıldız,
 * Wikipedia momentum VE perakendede 90 günlük görüntülenme. Kanıt YOKSA 50
 * (nötr) döner — 0 değil, çünkü "ilgi yok" demek "ölçemedim" demek değildir
 * ve 0 puan ürünleri haksız cezalandırır.
 *
 * `viewedMax` aynı koşudaki EN YÜKSEK görüntülenmedir. Görüntülenme ancak
 * kohort içinde anlamlıdır (1K bir air fryer için güçlü, bir drone için
 * zayıf sinyaldir), bu yüzden mutlak değere değil kohorttaki oranına bakılır.
 * Hiçbir ürün ölçülmediyse `viewedMax` 0 gelir ve bu sinyal HİÇ devreye
 * girmez — mevcut davranış bozulmaz.
 */
function demandScore(
  product: NormalizedProduct,
  context: DemandContext,
  viewedMax: number,
): number {
  const signals: number[] = [];
  // Wikipedia momentum en güçlü talep göstergesidir.
  if (context.nicheMomentumPct !== null) {
    // -%50 → 0, 0% → 50, +%100 → 100 (doğrusal, ölçülen değere göre).
    signals.push(50 + Math.max(-50, Math.min(100, context.nicheMomentumPct)));
  }
  // Etkileşim yoğunluğu: nişe özel toplam konuşma hacmi.
  if (context.nicheEngagement > 0) {
    signals.push(50 + clamp01(context.nicheEngagement / 400) * 50 - 25);
  }
  // PERAKENDE TALEBİ: kaç kişi ürünü gerçekten GÖRDÜ (90 gün). Söylem değil,
  // ölçüm. Kohorttaki en yükseğe göre oranlanır: en çok görüntülenen → 100,
  // yarısı → 50, yok denecek kadar az → 25.
  if (product.viewed90d !== null && viewedMax > 0) {
    signals.push(50 + clamp01(product.viewed90d / viewedMax) * 50 - 25);
  }
  return signals.length ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length) : 50;
}

/**
 * Rekabet sinyali (0-100) — DÜŞÜK rekabet = YÜKSEK puan.
 *
 * Aynı fingerprint'in kaç KAYNAKTA göründüğü rekabet göstergesidir: bir
 * ürün 5 farklı yerde listeleniyorsa o niş doygun (saturate) demektir.
 */
function competitionScore(product: NormalizedProduct, all: readonly NormalizedProduct[]): number {
  const sameSeller = all.filter((p) => p.seller === product.seller && p.seller).length;
  // 10+ benzer ürün = yüksek doygunluk → düşük puan.
  return Math.round(100 - clamp01(sameSeller / 12) * 55);
}

/**
 * Marj sinyali (0-100) — FİYAT BİLMİYORSA NÖTR.
 *
 * Tedarik maliyeti bu aşamada bilinmez (CFO ajanının işi); ölçülebilen tek
 * şey fiyat bandının sağlığıdır: çok ucuz ($2 altı) kargo/iyade riski,
 * çok pahalı ($500 üstü) yüksek stok riski taşır.
 */
function marginScore(priceUsd: number | null): number {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return 50;
  if (priceUsd < 2) return 30; // kargo maliyeti ürün fiyatını yutar
  if (priceUsd > 500) return 40; // yüksek stok bağlayan sermaye
  if (priceUsd < 8) return 60;
  if (priceUsd > 150) return 55;
  return 80; // tatlı bant: 8-150 arası en verimli e-ticaret aralığı
}

/** Puan sinyali (0-100) — hacim ağırlıklı. Tek yıldız yüksek puan üretmez. */
function ratingScore(rating: number | null, count: number | null): number {
  if (rating === null) return 50;
  // 5 üzerinden 0-100'e çevir.
  const base = clamp01(rating / 5) * 100;
  // Güven katsayısı: 1 değerlendirme %20, 50+ değerlendirme %100.
  const confidence = count === null ? 0.5 : clamp01(count / 50);
  return Math.round(50 + (base - 50) * confidence);
}

/** Bulunabilirlik sinyali (0-100) — bilinmiyorse nötr. */
function availabilityScore(inStock: boolean | null): number {
  if (inStock === null) return 50;
  return inStock ? 85 : 0;
}

export type DemandContext = {
  /** Wikipedia momentum (%). `null` = ölçülemedi. */
  nicheMomentumPct: number | null;
  /** Nişe özel toplam etkileşim (upvote + yorum + yıldız). */
  nicheEngagement: number;
};

/**
 * Tüm ürünleri kural tabanlı puanlar (AI YOK).
 *
 * `signals` her ürün için ayrı ayrı saklanır: panel "neden bu sıralama?"
 * sorusuna kanıtla cevap verebilir, ve 14 ajanın isteminde bu dilim görünür.
 */
export function scoreDeterministically(
  products: readonly NormalizedProduct[],
  context: DemandContext,
): NormalizedProduct[] {
  // Görüntülenme yalnızca aynı koşu içinde karşılaştırılabilir; bu yüzden
  // normalizasyon tabanı burada, TÜM adaylar görüldükten sonra hesaplanır.
  const viewedMax = products.reduce((max, p) => Math.max(max, p.viewed90d ?? 0), 0);
  return products.map((product) => {
    const signals = {
      demand: demandScore(product, context, viewedMax),
      competition: competitionScore(product, products),
      margin: marginScore(product.priceUsd),
      rating: ratingScore(product.rating, product.ratingCount),
      availability: availabilityScore(product.inStock),
    };
    // Ağırlıklar TEK yerde tanımlıdır (`signalWeightedScore`): tekilleştirmede
    // birleşen ürün de aynı formülden geçer, yoksa aynı kanıt iki farklı puan
    // üretirdi. (Rekabet ters yönde: yüksek puan = düşük rekabet = iyi.)
    const weighted = signalWeightedScore(signals);
    // VERİ BÜTÜNLÜĞÜ CEZASI: eksik alan sayısı arttıkça puan aşağı çekilir.
    // Bu, "kanıtsız üst puan" üretmeyi engeller ve 14 ajanın confidence
    // hesabına da gerçek bir girdi sağlar.
    const penalty = evidencePenalty(product.dataCompleteness);
    return {
      ...product,
      signals,
      preScore: Math.max(0, Math.min(100, Math.round(weighted - penalty))),
    };
  });
}

/* --------------------------------------------------------- Hard filter */

/** Bir ürünün tüm tekilleştirme anahtarları (GTIN + model kodu + fingerprint). */
function dedupKeys(p: NormalizedProduct): string[] {
  const keys: string[] = [];
  // 1) Küresel barkod (GTIN) — en güçlü çapa; farklı mağaza/başlık yazımlarını
  //    sıfır yanlış-pozitifle birleştirir (GS1 Mod-10 doğrulanmış).
  const gtin = normalizeGtin(p.gtin);
  if (gtin) keys.push(`g:${gtin}`);
  const fp = p.fingerprint || productFingerprint({ title: p.name });
  if (fp) keys.push(`f:${fp}`);
  const mk = productModelKey({ title: p.name, brand: p.brand });
  if (mk) keys.push(`m:${mk}`);
  // MPN + marka kombinasyonu da model anahtarı gibi davranır.
  const brandNorm = productFingerprint({ title: p.brand ?? "" });
  const mpnNorm = String(p.mpn ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (brandNorm && mpnNorm.length >= 4) keys.push(`mpn:${brandNorm}|${mpnNorm}`);
  // Hiç anahtar üretilemeyen satır (boş başlık) tek başına geçsin.
  return keys.length > 0 ? keys : [`x:${p.name}`];
}

/**
 * Sert eleme — AI YOK, saf kural.
 *
 * Her eleme GEREKÇESİYLE sayılır (istatistik döner). `all` içindeki
 * fingerprint çoğulları da elenir: en yüksek puanlı temsilci kalır, diğerleri
 * "duplicate" olarak sayılır.
 */
export function applyHardFilter(
  products: readonly NormalizedProduct[],
  perSource: FilterStats["perSource"] = [],
): { survivors: NormalizedProduct[]; stats: FilterStats } {
  const stats: FilterStats = {
    inputCount: products.length,
    rejectedByRating: 0,
    rejectedByStock: 0,
    rejectedByPrice: 0,
    rejectedByDuplicate: 0,
    rejectedByCompleteness: 0,
    rejectedBySource: 0,
    survivors: 0,
    perSource,
  };

  // 1) Kaynak süzgeci: yalnız gerçek kazınmış ÜRÜN satırları kalır.
  //
  // İki ayrı eleme, ikisi de "aday havuzu" içindir (satırlar kanıt olarak
  // yaşamaya devam eder — talep sinyalleri `notes`ten okunur):
  //   a) `source !== "scraped"` → modelin uydurduğu satır sonuca sızmaz.
  //   b) ÜRÜN OLMAYAN kaynak (Wikipedia, GitHub, Hacker News, Reddit arşivi,
  //      haber, trend, Wikidata) → ansiklopedi maddesi/repo/haber "ürün" diye
  //      listelenmez.
  //
  // (b) ÖLÇÜLEN GEREKÇE (2026-10-15, canlı "air fryer"/US): 120 ham satırın
  // 31'i bu kaynaklardan geliyordu (hackernews 8, github 8, web-reviews 11,
  // wikipedia 2, wikidata 1, google-news 1) ve aşağıdaki ticari kanıt kapısı
  // bunları yalnız "havuzda ≥5 ticari satır varsa" eliyordu. Fiyat/puan
  // taşıyan bir Wikipedia satırı (ör. bir fiyatın haber metnine gömülmesi)
  // kapıyı ATLAYIP ürün kartı olabiliyordu. Artık kaynak düzeyinde kesin:
  // bu kaynaklar CANDIDATE üretmez.
  const bySource: NormalizedProduct[] = [];
  for (const p of products) {
    if (p.source !== "scraped") {
      stats.rejectedBySource++;
      continue;
    }
    if (p.sources.some((name) => isNonProductSource(name))) {
      stats.rejectedBySource++;
      continue;
    }
    bySource.push(p);
  }

  // 2) Puan elemesi (yalnız anlamlı hacim varsa — tek yıldız gürültüdür).
  const byRating: NormalizedProduct[] = [];
  for (const p of bySource) {
    const hasVolume = (p.ratingCount ?? 0) >= MIN_RATING_COUNT;
    if (p.rating !== null && hasVolume && p.rating < MIN_RATING) {
      stats.rejectedByRating++;
      continue;
    }
    byRating.push(p);
  }

  // 3) Stok elemesi — YALNIZCA bilinen "stokta yok" elenir. `null` (bilinmiyor)
  //    kalır, çünkü çoğu kaynak stok vermez.
  const byStock: NormalizedProduct[] = [];
  for (const p of byRating) {
    if (p.inStock === false) {
      stats.rejectedByStock++;
      continue;
    }
    byStock.push(p);
  }

  // 4) Fiyat elemesi — yalnız GEÇERSİZ fiyat (0/negatif/NaN). `null` fiyat
  //    elenmez; fiyatı olmayan aday (talep sinyali olan) Gemini aşamasında
  //    fiyat araştırılabilir. Ancak fiyat taşıyan bir kaynakta `null` fiyat
  //    geçersizdir (parse başarısız olmuş demektir).
  const priceBearing = byStock.some((p) => p.priceUsd !== null);
  const byPrice: NormalizedProduct[] = [];
  for (const p of byStock) {
    if (p.priceUsd !== null && (!Number.isFinite(p.priceUsd) || p.priceUsd <= 0)) {
      stats.rejectedByPrice++;
      continue;
    }
    if (p.priceUsd === null && priceBearing) {
      // Bu kaynak fiyat taşıyabiliyor; bu satır taşımadı → şüpheli.
      // Ama tam elemek yerine BÜTÜNLÜK cezası uygulanır (aşağıda).
    }
    byPrice.push(p);
  }

  // 5) Veri bütünlüğü elemesi — fiyat, puan, stok, hacim, fiyat. En az 1'i
  //    ölçülmüş olmalı; hiçbiri yoksa puan uydurulmadan sıralanamaz.
  const byCompleteness: NormalizedProduct[] = [];
  for (const p of byPrice) {
    if (p.dataCompleteness < MIN_COMPLETENESS) {
      stats.rejectedByCompleteness++;
      continue;
    }
    byCompleteness.push(p);
  }

  // 5b) TİCARİ KANIT KAPISI — "saçma rakamlar"ın kök nedeni.
  //    Ölçülen (2026-10-12, "bardak"/TR): GitHub depoları, Hacker News
  //    başlıkları, haber/Wikipedia sinyal satırları "ürün" gibi Top-75'e
  //    giriyor ve EN ÜSTE çıkıyordu. Bunlar nişin TALEP BAĞLAMIdır, satılabilir
  //    ürün değildir. Havuzda yeterince gerçek ticari satır (fiyat veya
  //    hacimli puan) varsa, ticari kanıtı olmayan her satır elenir.
  //    Ticari satır azsa (anahtarsız/dijital niş) eski davranış korunur.
  const hasCommerce = (p: NormalizedProduct) =>
    p.priceUsd !== null ||
    (p.rating !== null && (p.ratingCount ?? 0) > 0) ||
    (p.salesVolume ?? 0) > 0;
  const commerceCount = byCompleteness.filter(hasCommerce).length;
  if (commerceCount >= MIN_COMMERCE_POOL) {
    for (let i = byCompleteness.length - 1; i >= 0; i -= 1) {
      if (!hasCommerce(byCompleteness[i])) {
        stats.rejectedByCompleteness++;
        byCompleteness.splice(i, 1);
      }
    }
  }

  // 6) Tekilleştirme. İKİ anahtar kullanılır:
  //      `f:<fingerprint>` → tam normalize başlık aynı (aynı kaynaktan iki kez)
  //      `m:<modelKey>`    → marka + model kodu aynı, BAŞLIK FARKLI
  //    İkincisi olmadan aynı ürün iki farklı yazımla nihai listeye iki kez
  //    giriyordu (canlı ölçüm: espresso CM5418). `productModelKey` yalnız
  //    tek model kodu bulunan markalı ürünlerde anahtar ürettiği için yanlış
  //    birleştirme riski düşük kalır.
  //    En yüksek puanlı temsilci kalır; aynı ürünü gören ek kaynaklar `sources`
  //    listesine eklenir (kanıt gücü artar).
  const best = new Map<string, NormalizedProduct>();
  for (const p of byCompleteness) {
    const keys = dedupKeys(p);
    const hit = keys.find((k) => best.has(k));
    if (hit === undefined) {
      for (const k of keys) best.set(k, p);
      continue;
    }
    stats.rejectedByDuplicate++;
    const incumbent = best.get(hit) as NormalizedProduct;
    // En yüksek puanlı temsilci TEMEL alınır (sinyalleri ondan gelir), ama
    // alanlar düzeyinde birleştirme yapılır: aşağıdaki `mergeDuplicates`
    // satırlardan BİRİNDE ölçülmüş her alanı kurtarır. Kanıt artışı ürünü
    // 14 ajana daha güçlü tanıtır ve `dataCompleteness` cezasını düşürür.
    const merged = mergeDuplicates(incumbent, p);
    // Birleşen ürünün TÜM anahtarları yeni temsilciye yönelmelidir; aksi
    // hâlde diğer anahtarı eski nesneyi gösterir ve kopya listede kalır.
    for (const [k, v] of best) if (v === incumbent) best.set(k, merged);
    for (const k of keys) best.set(k, merged);
  }

  const survivors = [...new Set(best.values())].sort((a, b) => b.preScore - a.preScore);
  stats.survivors = survivors.length;
  return { survivors, stats };
}

/** Boş/`null` bir alanı karşı satırdan doldurur (ölçülmüş kanıt kaybolmaz). */
function fillString(primary: string, fallback: string): string {
  return primary.trim() !== "" ? primary : fallback;
}

/** `null` bir ölçümü karşı satırdan doldurur. Sıfır "ölçülmüş" sayılır. */
function fillNullable<T>(primary: T | null, fallback: T | null): T | null {
  return primary === null || primary === undefined ? (fallback ?? null) : primary;
}

/**
 * Aynı ürünün iki satırını TEK kanıt satırında birleştirir.
 *
 * NEDEN ALAN DÜZEYİNDE: eski birleştirme "en dolu satırı seç, gerisini at"
 * diyordu. Bir mağaza fiyatı, diğeri puanı verdiğinde temsilci YALNIZ birini
 * taşıyor, diğer ölçüm sessizce kayboluyordu. Kayıp kanıt doğrudan kaliteye
 * yazıyor: `dataCompleteness` düşük kalıyor, 14 ajan daha az ölçüyle
 * konuşuyor ve nihai 5'lik liste daha zayıf ürünlerle doluyordu.
 *
 * KURAL: ölçülmüş bir alan ASLA ezilmez; yalnız boş/`null` olan doldurulur.
 * `sources` ve `notes` birleşir (kanıt gücü artar). Puan, birleşmiş kanıtın
 * tamamı üzerinden YENİDEN hesaplanır — böylece kazanan temsilcinin skoru
 * gerçekten taşıdığı kanıtı yansıtır.
 */
export function mergeDuplicates(a: NormalizedProduct, b: NormalizedProduct): NormalizedProduct {
  // Sinyaller daha yüksek ön skorlu satırdan gelir: sinyaller KOHT içinde
  // hesaplandığı için ikisinin karışımı anlamsız olurdu.
  const base = b.preScore > a.preScore ? b : a;
  const richest = b.dataCompleteness > a.dataCompleteness ? b : a;
  // Karşı satır: eksik alanlar YALNIZ buradan doldurulur.
  const other = richest === b ? a : b;

  const merged: NormalizedProduct = {
    ...richest,
    brand: fillString(richest.brand, other.brand),
    seller: fillString(richest.seller, other.seller),
    category: fillString(richest.category, other.category),
    url: fillString(richest.url, other.url),
    imageUrl: fillString(richest.imageUrl, other.imageUrl),
    id: fillString(richest.id, other.id),
    gtin: fillString(richest.gtin ?? "", other.gtin ?? ""),
    mpn: fillString(richest.mpn ?? "", other.mpn ?? ""),
    priceUsd: fillNullable(richest.priceUsd, other.priceUsd),
    rating: fillNullable(richest.rating, other.rating),
    ratingCount: fillNullable(richest.ratingCount, other.ratingCount),
    inStock: fillNullable(richest.inStock, other.inStock),
    salesVolume: fillNullable(richest.salesVolume, other.salesVolume),
    viewed90d: fillNullable(richest.viewed90d, other.viewed90d),
    signals: base.signals,
    // Birleşik alanlar spread SONRASINA yazılır; ters sırada `richest` onları
    // ezerdi ve "iki kaynakta görüldü" kanıtı kaybolurdu.
    // Marka kanıtı İKİ satırdan birinde bağımsız ölçüldüyse ölçülmüş sayılır.
    brandMeasured: Boolean(richest.brandMeasured || other.brandMeasured),
    sources: Array.from(new Set([...a.sources, ...b.sources])),
    notes: Array.from(new Set([a.notes, b.notes].filter(Boolean)))
      .join(" · ")
      .slice(0, 200),
  };

  // Bütünlük ve puan, BİRLEŞMİŞ kanıt üzerinden yeniden hesaplanır.
  const { dataCompleteness, missingFields } = evidenceCompleteness(merged);
  const preScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(signalWeightedScore(base.signals) - evidencePenalty(dataCompleteness)),
    ),
  );
  return { ...merged, dataCompleteness, missingFields, preScore };
}

/**
 * Tam adım: normalize → puanla → süz. AI YOK.
 *
 * Gemini'ye gidecek Top-75 listesi burada üretilir.
 */
export function filterAndPreRank(
  raw: readonly RawProduct[],
  context: DemandContext,
  perSource: FilterStats["perSource"] = [],
  topN = 75,
): { survivors: NormalizedProduct[]; stats: FilterStats } {
  const normalized = raw.map(normalizeRaw);
  const scored = scoreDeterministically(normalized, context);
  const { survivors, stats } = applyHardFilter(scored, perSource);
  return { survivors: survivors.slice(0, topN), stats };
}
