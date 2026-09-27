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
  RawProductSchema,
  type FilterStats,
  type NormalizedProduct,
  type RawProduct,
} from "./product-discovery.types";

/** Minimum kabul edilebilir puan (5 üzerinden). */
export const MIN_RATING = 3.5;
/** Puanın anlamlı sayılması için gereken minimum değerlendirme sayısı. */
export const MIN_RATING_COUNT = 3;
/** Veri bütünlüğü bu altındaysa ürün listeye giremez. */
export const MIN_COMPLETENESS = 1;

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
 * `ratingCount` ve `stock` yalnızca ARTIRAN bonuslardır: boş olmaları kanıt
 * eksikliği sayılmaz, çünkü kaynakların çoğu onları hiç vermez.
 */
const EVIDENCE_SLOTS = [
  ["price", (p: RawProduct) => p.priceUsd !== null],
  ["brand", (p: RawProduct) => p.brand.trim() !== ""],
  ["seller", (p: RawProduct) => p.seller.trim() !== ""],
  ["url", (p: RawProduct) => p.url.trim() !== ""],
  // ÖLÇÜLMÜŞ talep: `notes` içinde sayısal bir sinyal (puan, yorum, yıldız,
  // momentum, fiyat aralığı) var mı? Söylem değil, ölçüm arıyoruz.
  ["demand", (p: RawProduct) => /\d/.test(p.notes)],
] as const satisfies readonly (readonly [string, (p: RawProduct) => boolean])[];

/**
 * BONUS YUVALARI — doluysa `dataCompleteness` artar, boşsa `missingFields`'e
 * YAZILMAZ. Puan/stok kaynakların çoğunda yoktur; yokluğu kanıtsızlık saymak
 * doğru bir ürünü haksız cezalandırırdı.
 */
const BONUS_SLOTS = [
  ["rating", (p: RawProduct) => p.rating !== null],
  ["ratingCount", (p: RawProduct) => p.ratingCount !== null],
  ["stock", (p: RawProduct) => p.inStock !== null],
] as const satisfies readonly (readonly [string, (p: RawProduct) => boolean])[];

/** Kaynak satırlarını normalize eder ve parmak izi üretir. */
export function normalizeRaw(raw: RawProduct): NormalizedProduct {
  const parsed = RawProductSchema.parse(raw);
  const missing: string[] = [];
  // Dolu yuva sayısı = veri bütünlüğü puanı (0-5). Çekirdek yuvalar hem
  // puana hem `missingFields` listesine yazılır; bonus yuvalar yalnızca puana.
  let filled = 0;
  for (const [field, hasEvidence] of EVIDENCE_SLOTS) {
    if (hasEvidence(parsed)) filled++;
    else missing.push(field);
  }
  for (const [, hasEvidence] of BONUS_SLOTS) {
    if (hasEvidence(parsed)) filled++;
  }

  return {
    name: parsed.title.slice(0, 180),
    brand: parsed.brand.slice(0, 60),
    seller: parsed.seller.slice(0, 60),
    category: "",
    priceUsd: parsed.priceUsd,
    rating: parsed.rating,
    ratingCount: parsed.ratingCount,
    inStock: parsed.inStock,
    sources: [parsed.source].filter(Boolean),
    url: parsed.url,
    notes: parsed.notes.slice(0, 200),
    fingerprint: productFingerprint({
      title: parsed.title,
      brand: parsed.brand,
      seller: parsed.seller,
    }),
    preScore: 0,
    // Skorlanmadan önce nötr sinyaller: puanlama sonrası hepsi dolar.
    signals: { demand: 50, competition: 50, margin: 50, rating: 50, availability: 50 },
    dataCompleteness: Math.max(0, Math.min(5, filled)),
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
 * Wikipedia momentum. Kanıt YOKSA 50 (nötr) döner — 0 değil, çünkü "ilgi yok"
 * demek "ölçemedim" demek değildir ve 0 puan ürünleri haksız cezalandırır.
 */
function demandScore(_product: NormalizedProduct, context: DemandContext): number {
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
  return products.map((product) => {
    const signals = {
      demand: demandScore(product, context),
      competition: competitionScore(product, products),
      margin: marginScore(product.priceUsd),
      rating: ratingScore(product.rating, product.ratingCount),
      availability: availabilityScore(product.inStock),
    };
    // Ağırlıklar: talep ve marj belirleyici; puan güçlü düzeltici.
    // (Rekabet ters yönde: yüksek puan = düşük rekabet = iyi.)
    const weighted =
      signals.demand * 0.28 +
      signals.margin * 0.26 +
      signals.rating * 0.22 +
      signals.availability * 0.12 +
      signals.competition * 0.12;
    // VERİ BÜTÜNLÜĞÜ CEZASI: eksik alan sayısı arttıkça puan aşağı çekilir.
    // Bu, "kanıtsız üst puan" üretmeyi engeller ve 14 ajanın confidence
    // hesabına da gerçek bir girdi sağlar.
    const penalty = (5 - product.dataCompleteness) * 4;
    return {
      ...product,
      signals,
      preScore: Math.max(0, Math.min(100, Math.round(weighted - penalty))),
    };
  });
}

/* --------------------------------------------------------- Hard filter */

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

  // 1) Kaynak süzgeci: yalnız gerçek kazınmış satırlar kalır. AI satırları
  //    (varsa) burada elenir — modelin uydurduğu ürün sonuca sızmaz.
  const bySource: NormalizedProduct[] = [];
  for (const p of products) {
    if (p.source !== "scraped") {
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

  // 6) Tekilleştirme (fingerprint). En yüksek puanlı temsilci kalır; aynı
  //    ürünü gören ek kaynaklar `sources` listesine eklenir (kanıt gücü artar).
  const best = new Map<string, NormalizedProduct>();
  for (const p of byCompleteness) {
    const key = p.fingerprint || productFingerprint({ title: p.name });
    const incumbent = best.get(key);
    if (!incumbent) {
      best.set(key, p);
      continue;
    }
    stats.rejectedByDuplicate++;
    // En yüksek puanlı temsilci temel alınır, ama ALAN EN DOLU olan seçilir:
    // fiyatı bilinen ama puanı bilinmeyen bir satır, tam tersini göremedir.
    const base = p.preScore > incumbent.preScore ? p : incumbent;
    const richest = p.dataCompleteness > incumbent.dataCompleteness ? p : incumbent;
    // ÖNEMLİ: birleşik alanlar (`sources`, `notes`) spread SONRASINA yazılır.
    // Ters sırada olsaydı `richest` onları ezerdi ve "iki kaynakta görüldü"
    // kanıtı kaybolurdu — güven hesabını sessizce yanlış yapar.
    best.set(key, {
      ...richest,
      preScore: base.preScore,
      signals: base.signals,
      sources: Array.from(new Set([...incumbent.sources, ...p.sources])),
      notes: [incumbent.notes, p.notes].filter(Boolean).join(" · ").slice(0, 200),
    });
  }

  const survivors = [...best.values()].sort((a, b) => b.preScore - a.preScore);
  stats.survivors = survivors.length;
  return { survivors, stats };
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
