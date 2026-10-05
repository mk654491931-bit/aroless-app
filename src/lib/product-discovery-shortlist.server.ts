// ============================================================================
// İLK AŞAMA FİLTRELEME — SADELESTİRILMIŞ JSON KISA LİSTESİ  (AI YOK, $0).
//
// Bu dosya, kazınmış ham satırlardan LLM'e GÖNDERİLECEK son JSON'u üretir.
// `product-discovery-filter.server.ts` "hangi ürünler geçerli?" sorusunu
// yanıtlar (puanlama, tekilleştirme, kaynak süzgeci); bu dosya "LLM'e ne
// gönderiyoruz?" sorusunu yanıtlar. İkisi BİRLİKTE ilk aşamadır:
//
//   ham satırlar → TEMİZLE (şema + kapılar) → puanla → süz → SADELESTİR
//                                                    ↓
//                                        7 alanlık JSON, en çok 75 ürün
//
// NEDEN AYRI BİR KATMAN (var olanı kopyalamak yerine):
//   • Sorumluluk ayrımı: eleme kuralları tek yerde (`…-filter.server.ts`),
//     sözleşme (hangi alanlar dışarı çıkar) burada. Kural değişirse ikisi
//     birlikte değişir; sözleşme değişirse sadece bu dosya değişir.
//   • Token bütçesi bir ÜRÜN ÖZELLİĞİ değil, bir HAT ÖZELLİĞİ'dir: 75 ürünün
//     7 alana indirgenmesi olmadan istek bağlamı token tavanını zorlar. Bütçe
//     burada ölçülür ve aşılırsa kuyruğun SONUNDAN kırpılır (sıralama bozulmaz).
//   • Alan adları dışarıya karşı SÖZLEŞMEDİR: `snake_case` ve sabit sıra,
//     çünkü bu JSON doğrudan model istemine gömülür ve model cevabı bu
//     adlarla eşleştirir. Kırpmak/eklemek model prompt'unu sessizce bozar.
//
// DÜRÜSTLÜK KURALI (dosyanın en önemli kısmı):
//   Ölçülmemiş alan UYDURULMAZ — `price`, `rating`, `reviews_count` ve
//   `sales_volume` ölçülmediyse `null` döner. Sıfır yazmak "ölçtük ve sıfır
//   bulduk" anlamına gelirdi; bu da modele "bu ürün satmıyor" diye YANLIŞ
//   bilgi verir. Sıralama yine de çalışır: eksik alan `signals` içinde nötr
//   (50) karşılığına düşer ve `dataCompleteness` cezasıyla aşağı çekilir.
//
//   Bu kural bir KAPI değildir. Ölçülmemiş fiyat, talep kanıtı taşıyan bir
//   adayı elemek için gerekçe DEĞİLDİR — yalnız bozuk fiyatı (0/negatif/
//   NaN) eleriz. Bkz. `cleanRawRows` içindeki FİYAT KAPI.
// ============================================================================

import { z } from "zod";

import {
  filterAndPreRank,
  mergeDuplicates,
  normalizeRaw,
  scoreDeterministically,
  type DemandContext,
} from "./product-discovery-filter.server";
import { productIdOf } from "./discovery-core";
import {
  RawProductSchema,
  type FilterStats,
  type NormalizedProduct,
  type RawProduct,
} from "./product-discovery.types";
import {
  DIGITAL_ONLY_SOURCES,
  isSellableProductRow,
  isStrongProductMatch,
  looksLikeMediaRelease,
} from "./product-discovery-query";

/* ------------------------------------------------------------- Sözleşme */

/** LLM'e giden kısa listenin üst sınırı. Hattın anlaşması: 75. */
export const LLM_SHORTLIST_LIMIT = 75;

/**
 * Ham bayt bütçesi (UTF-8). 75 ürün × 7 alan normalde ~14 KB'tır; bu tavan
 * başlıkların şişmesi (uzun SEO başlıkları) halinde listeyi sessizce
 * bağlam penceresinden taşırmaz.
 */
export const LLM_SHORTLIST_MAX_BYTES = 24_000;

/** Marj (fiyat bandı sağlığı) tabanı — `signals.margin` 0-100. */
export const DEFAULT_MIN_MARGIN_SCORE = 30;
/** Deterministic ön skor tabanı — 0-100. */
export const DEFAULT_MIN_PRE_SCORE = 0;

/**
 * LLM'e giden ÜRÜN. Alan adları ve SIRASI sözleşmedir.
 *
 * `id` her zaman doludur: kaynak kimlik vermediyse parmak izinden türetilir,
 * çünkü modelin cevabındaki ürünü kaynağına bağlayan tek alan bu.
 */
export const LlmShortlistProductSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /**
   * Fiyat ÖLÇÜLMEDİYSE `null` — asla 0 yazılmaz.
   *
   * `rating`/`reviews_count`/`sales_volume` ile aynı sözleşme: 0 "ölçtük ve
   * sıfır bulduk" demektir, `null` "hiç ölçemedik" demektir. Kaynakların
   * çoğu fiyat vermez (`github` satmaz, `web-reviews` yalnız snippet'te `$`
   * görürse çıkarır) ve bu satırlar alt katman `filterAndPreRank` ile
   * bilinçli olarak geçirilir — bkz. `cleanRawRows` içindeki FİYAT KAPI.
   */
  price: z.number().finite().positive().nullable(),
  category: z.string(),
  rating: z.number().min(0).max(5).nullable(),
  reviews_count: z.number().int().min(0).nullable(),
  sales_volume: z.number().int().min(0).nullable(),
});
export type LlmShortlistProduct = z.infer<typeof LlmShortlistProductSchema>;

/**
 * Kısa listenin tamamı: en çok 75 ürün, hepsi şemaya uygun.
 * Dışarıdan gelen ham JSON'u doğrulamak için de kullanılabilir.
 */
export const LlmShortlistSchema = z.array(LlmShortlistProductSchema).max(LLM_SHORTLIST_LIMIT);

/** Sadece aranan alan adları — `Object.keys` sırası bu sözleşmedir. */
export const SHORTLIST_FIELDS = [
  "id",
  "title",
  "price",
  "category",
  "rating",
  "reviews_count",
  "sales_volume",
] as const;

/* ------------------------------------------------------------ İstatistik */

/**
 * Eleme sayacı. `FilterStats` alanları KORUNUR (aynı gerekçe sayacı) ve
 * kısa listeye özgü kapılar eklenir — hangi satır neden düştü görülebilir.
 */
export type ShortlistStats = FilterStats & {
  /** Şemaya hiç uymayan satır (boş başlık, NaN puan, 0 fiyat…). */
  rejectedInvalid: number;
  /** `in_stock: false` olduğu BİLİNEN satır (bu katmanın kendi kapısı). */
  rejectedNotInStock: number;
  /** Fiyatı olmayan / geçersiz satır. */
  rejectedPrice: number;
  /** Görsel URL'si olmayan satır. */
  rejectedMissingImage: number;
  /** Marj tabanının altında kalan satır. */
  rejectedMargin: number;
  /** Ön skor tabanının altında kalan satır. */
  rejectedScore: number;
  /** Ham bayt bütçesi için sondan kırpılan satır. */
  truncatedForBudget: number;
  /** Üretilen JSON'un ham bayt uzunluğu. */
  bytes: number;
};

/* ------------------------------------------------------------- Ayarlar */

export type ShortlistOptions = {
  /** En fazla kaç ürün. Varsayılan 75. */
  limit?: number;
  /** `signals.margin` tabanı (0-100). */
  minMarginScore?: number;
  /** `preScore` tabanı (0-100). */
  minPreScore?: number;
  /** Görsel URL'si olmayan satırı ele. Varsayılan: evet. */
  requireImage?: boolean;
  /** Ham bayt bütçesi. */
  maxBytes?: number;
  /** Talep bağlamı — `filterAndPreRank` ile aynı. */
  context?: DemandContext;
  /** Kaynak bazlı eleme dökümü — hat paneline aynen iletilir. */
  perSource?: FilterStats["perSource"];
  /**
   * Aranan niş. Alakalılık kapısı bununla çalışır; verilmezse kapı kapalı
   * kalır (mevcut davranış) — yani hat yanlışlıkla boşalmaz.
   */
  niche?: string;
};

/* ---------------------------------------------------------------- Yardım */

/** Başlıktan kısa, kararlı bir slug (yalnız `id` geri düşüşü için). */
/**
 * Ürünün kimliği — HAT BOYUNCA SABİT (§24).
 *
 * `shortlistId` artık kendi kimliğini ÜRETMEZ; ortak çekirdeğin `productIdOf`
 * fonksiyonuna devreder. Böylece kısa listede modele gösterilen kimlik ile
 * nihai sıralamada kullanılan kimlik AYNI olur — eskiden burada kaynak `id` →
 * parmak izi → slug sırası vardı ve kimlik tüketiciden tüketiciye değişebiliyordu.
 * `productIdOf` asla boş dönmez, `min(1)` şeması böylece garanti altındadır.
 */
function shortlistId(p: NormalizedProduct): string {
  return productIdOf(p);
}

/* ----------------------------------------------------------------- Adım 1 */

/**
 * Ham satırları TEMİZLENMİŞ ve DOĞRULANMIŞ satırlara indirger.
 *
 * İki tür kirlilik vardır ve İKİSİ DE elenir:
 *   1) Şemaya uymayan satır (boş başlık, 5 üstü puan, negatif fiyat): `parse`
 *      hata verir → `rejectedInvalid`.
 *   2) Şemaya uyan ama İŞ KURALLARINA uymayan satır: `inStock === false`,
 *      geçersiz fiyat, (isteğe bağlı) görsel yok.
 *
 * `safeParse` kullanılır, `parse` değil: TEK bozuk satır tüm koşuyu
 * patlatmamalıdır. Bu, kaydedilmemiş ham veriyle çalışmanın tek dürüst
 * yoludur — hatalı satırı at, geri kalanını işle.
 */
function cleanRawRows(
  raw: readonly RawProduct[],
  requireImage: boolean,
  stats: Pick<
    ShortlistStats,
    "rejectedInvalid" | "rejectedNotInStock" | "rejectedPrice" | "rejectedMissingImage"
  >,
): RawProduct[] {
  const clean: RawProduct[] = [];
  for (const row of raw) {
    const parsed = RawProductSchema.safeParse(row);
    if (!parsed.success) {
      stats.rejectedInvalid++;
      continue;
    }
    // Başlık yalnız boşluktan ibaretse şema `min(1)`'i geçer ama ürün değildir.
    if (parsed.data.title.trim() === "") {
      stats.rejectedInvalid++;
      continue;
    }
    // STOK KAPI: yalnız BİLİEN "stokta yok" elenir. `null` (bilinmiyor) kalır,
    // çünkü çoğu kaynak stok vermez ve `null`'ı "stok yok" saymak kanıtsız
    // ürün elerdi.
    if (parsed.data.inStock === false) {
      stats.rejectedNotInStock++;
      continue;
    }
    // FİYAT KAPI — YALNIZ GEÇERSİZ FİYATI eler, `null`'ı DEĞİL.
    //
    // Bu kapı bir süre `priceUsd === null` satırlarını da eliyordu ve hattı
    // canlıda boşaltıyordu (2026-10-01, "LED masa lambası": 13 kaynak 15 satır
    // döndürdü, 15'i de burada öldü, kullanıcı ürün alamadan iş "başarısız"
    // oldu). İki ayrı sebeple yanlıştı:
    //
    //   1. SÖZLEŞME ÇELİŞİSİ: alt katman `filterAndPreRank` `null` fiyatı
    //      bilinçli olarak GEÇİRİR — "fiyatı olmayan aday talep sinyaliyse
    //      Gemini aşamasında fiyat araştırılabilir" (bkz. …-filter.server.ts
    //      adım 4). Kısa liste bu kararı eziyordu.
    //   2. KAYNAKLAR BİLEREK FİYAT VERMİYOR: `github` satmaz (nişin ekosistem
    //      büyüklüğünü ölçer), `web-reviews` yalnız snippet'te `$` görürse fiyat
    //      çıkarır — arama sonucu metninde fiyat OLMAMAK normaldir. Bu
    //      kaynakların satırları kanıt (url + talep sinyali) taşımasına rağmen
    //      eleniyordu; yani "doğrulanabilir ürün yok" deniyordu.
    //
    // Bu, dosyanın DÜRÜSTLÜK KURALI ile de çelişiyordu: ölçülmemiş alan 0
    // yazılmaz, `null` döner. 0 yazmak "ölçtük ve sıfır bulduk" anlamına
    // gelirdi.
    //
    // Kalan koruma: fiyat VARSA geçerli olmalı. 0/negatif/NaN ölçüm değil,
    // bozuk veridir (parse kaynağında patlamış olabilir) → elenir.
    if (
      parsed.data.priceUsd !== null &&
      (!Number.isFinite(parsed.data.priceUsd) || parsed.data.priceUsd <= 0)
    ) {
      stats.rejectedPrice++;
      continue;
    }
    // GÖRSEL KAPI: görselsiz ürün vitrinde boş kutu olarak görünür ve modele
    // "görseli ne?" diye sorulduğunda cevap üretmek zorunda kalır.
    if (requireImage && parsed.data.imageUrl.trim() === "") {
      stats.rejectedMissingImage++;
      continue;
    }
    clean.push(parsed.data);
  }
  return clean;
}

/* ----------------------------------------------------------------- Adım 2 */

/**
 * TAM İLK AŞAMA: ham satırlar → LLM'e gidecek temiz JSON dizisi.
 *
 * Boru hattı: temizle → puanla → süz (stok/puan/fiyat/tekilleştirme) →
 * marj tabanı → skor tabanı → 7 alana indirge → bütçe kırp.
 *
 * DÖNEN SIRA: `preScore` azalan. Bütçe kırpma SONUNDAN yapılır, böylece
 * listenin başındaki en güçlü ürünler her zaman korunur.
 */
/**
 * Gerçek ÜRÜN satırlarını öne alır.
 *
 * ÖLÇÜLEN GERÇEK (canlı, 2026-10-02, "LED masa lambası"): satır üreten kaynaklar
 * yalnızca `web-reviews` (10) ve `github` (5) idi ve bunlar ürün DEĞİL — haber
 * metinleri ve ansiklopedi maddeleri. Kullanıcı kartlarda "fiyat yok · puan
 * yok" görüyordu çünkü listeye başka bir şey konmamıştı.
 *
 * KURAL: satır listesinde EN AZ BİR gerçek ürün varsa (pazaryeri, fiyatlı
 * haber, uygulama, gıda) yalnız onlar tutulur; talep sinyalleri kanıt olarak
 * zaten `signals.demand` içinde yaşamaya devam eder. Hiç gerçek ürün yoksa
 * liste DÜŞÜRÜLMEZ — talep sinyalleri hatta boş dönerdi.
 *
 * İKİ BASAMAKLI GERİ DÖNÜŞ (ölçülen hata, 2026-10-03: "film önerdi"):
 *   Gerçek ürün satırı yokken liste boşalmaz; ama o zaman medya çıkışları
 *   (film, sezon, albüm) ASLA tercih edilmez — onlar satılabilir ürün
 *   değildir ve kullanıcıya ürün diye sunulamaz. Sıra:
 *     1) gerçek ürün satırları → 2) medya olmayan satırlar → 3) hepsi.
 */
export function preferProductRows(rows: readonly RawProduct[], niche = ""): RawProduct[] {
  const products = rows.filter((row) =>
    isSellableProductRow(row.title, row.source ?? "", {
      priceUsd: row.priceUsd,
      rating: row.rating,
    }),
  );
  if (!products.length) {
    const rest = rows.filter(
      (row) => !DIGITAL_ONLY_SOURCES.has(row.source ?? "") && !looksLikeMediaRelease(row.title),
    );
    return rest.length ? rest : [...rows];
  }
  // İKİNCİ BASAMAK — GÜÇLÜ EŞLEŞME. Ölçülen hata: "analog film" aramasında
  // "The revenge of analog" (bir kitap) 1/2 tokenla geçerken, asıl nişin
  // ürünü geldiğinde o satır listeden çıkmıyordu. Güçlü eşleşme varsa yalnız
  // onlar tutulur.
  //
  // GÜVENLİ YÖN: güçlü eşleşme YOKSA liste boşalmaz — zayıf eşleşmeler
  // korunur. Boş liste, hattın tamamını bozmaktan daha kötüdür.
  const strong = products.filter((row) => isStrongProductMatch(row.title, niche));
  return strong.length ? strong : products;
}

export function buildShortlist(
  raw: readonly RawProduct[],
  options: ShortlistOptions = {},
): { products: LlmShortlistProduct[]; survivors: NormalizedProduct[]; stats: ShortlistStats } {
  const limit = Math.max(0, Math.min(options.limit ?? LLM_SHORTLIST_LIMIT, LLM_SHORTLIST_LIMIT));
  const minMargin = options.minMarginScore ?? DEFAULT_MIN_MARGIN_SCORE;
  const minPreScore = options.minPreScore ?? DEFAULT_MIN_PRE_SCORE;
  const maxBytes = options.maxBytes ?? LLM_SHORTLIST_MAX_BYTES;
  const requireImage = options.requireImage ?? true;

  const stats = {
    inputCount: raw.length,
    rejectedInvalid: 0,
    rejectedNotInStock: 0,
    rejectedPrice: 0,
    rejectedMissingImage: 0,
    rejectedMargin: 0,
    rejectedScore: 0,
    truncatedForBudget: 0,
    bytes: 0,
    rejectedByRating: 0,
    rejectedByStock: 0,
    rejectedByPrice: 0,
    rejectedByDuplicate: 0,
    rejectedByCompleteness: 0,
    rejectedBySource: 0,
    survivors: 0,
    perSource: options.perSource ?? [],
  };

  // 1) Temizle.
  const clean = preferProductRows(cleanRawRows(raw, requireImage, stats), options.niche ?? "");

  // 2) Puanla + süz + sırala. Üst sınırı `limit` verilir: 75'ten fazlası
  //    hiçbir zaman üretilmez, token bütçesi zaten burada kesiliyor.
  const { survivors, stats: filterStats } = filterAndPreRank(
    clean,
    options.context ?? { nicheMomentumPct: null, nicheEngagement: 0 },
    options.perSource ?? [],
    limit,
  );
  stats.rejectedByRating = filterStats.rejectedByRating;
  stats.rejectedByStock = filterStats.rejectedByStock;
  stats.rejectedByPrice = filterStats.rejectedByPrice;
  stats.rejectedByDuplicate = filterStats.rejectedByDuplicate;
  stats.rejectedByCompleteness = filterStats.rejectedByCompleteness;
  stats.rejectedBySource = filterStats.rejectedBySource;
  stats.perSource = filterStats.perSource;

  // 3) Marj + ön skor tabanları, sonra SADELESTİRME.
  //    `survivors` paralel dizi olarak tutulur: hat bir sonraki aşamada
  //    (Gemini → 14 ajan) SADELESTİRILMIŞ satırları değil, parmak izi ve
  //    sinyal dosyası taşıyan TAM ürünleri gerektirir. İkisi aynı sırayı ve
  //    aynı kapıları paylaşır, bu yüzden `products[i]` her zaman
  //    `survivors[i]`nin sadeleştirilmiş hâlidir.
  const products: LlmShortlistProduct[] = [];
  const kept: NormalizedProduct[] = [];
  for (const p of survivors) {
    if (p.signals.margin < minMargin) {
      stats.rejectedMargin++;
      continue;
    }
    if (p.preScore < minPreScore) {
      stats.rejectedScore++;
      continue;
    }
    // Sözleşme dönüşümü tek yardımcıda: kurtarma yolu da AYNI 7 alanı üretir.
    products.push(toLlmProduct(p));
    kept.push(p);
  }

  // 4) Ham bayt bütçesi. Sondan kırpılır: `products` zaten puana göre
  //    sıralı, yani en güçlü ürünler başta ve korunur.
  let json = JSON.stringify(products);
  while (products.length > 0 && Buffer.byteLength(json, "utf8") > maxBytes) {
    products.pop();
    kept.pop();
    stats.truncatedForBudget++;
    json = JSON.stringify(products);
  }

  stats.survivors = products.length;
  stats.bytes = Buffer.byteLength(json, "utf8");
  return { products, survivors: kept, stats };
}

/* ------------------------------------------------ Kurtarma (son çare) */

/**
 * Normalize ürünü LLM sözleşmesine (7 alan) indirger.
 *
 * KAPI YOKTUR, yalnız dönüşüm: hangi satırın geçeceğine karar veren yer
 * `buildShortlist`/`salvageShortlist`tir. Bu ayrım sayesinde iki yol da
 * AYNI alan adlarını ve sırasını üretir — model istemi bozulmaz.
 */
function toLlmProduct(p: NormalizedProduct): LlmShortlistProduct {
  return {
    id: shortlistId(p),
    title: p.name,
    // Fiyat kapısı GEÇERSİZ olanı eledi; ölçülmemiş olan `null` olarak
    // korunur (DÜRÜSTLÜK KURALI) ve alt katmanla aynı sözleşmedir.
    price: p.priceUsd,
    category: p.category,
    rating: p.rating,
    reviews_count: p.ratingCount,
    sales_volume: p.salesVolume,
  };
}

/**
 * İLK AŞAMA HER ŞEYİ ELEDİĞİNDE HATTI BOŞ BIRAKMAYAN KURTARMA.
 *
 * NEDEN VAR (ölçülen olgu, 2026-10-01): kaynaklar satır döndürdü (13 kaynak,
 * 15 ham satır) ama kapıların tamamı eledi ve kullanıcı 5 ürün yerine
 * "Hiç kaynak doğrulanabilir ürün döndürmedi" hatası aldı — hem de parasını
 * ödeyerek. Hat "ürün yok" demek yerine ÖLÇÜLMÜŞ satırı sunmak zorundadır:
 * eksik alanlar zaten `null` kalır (dürüstlük kuralı) ve 14 ajan karneyi yine
 * verir. Kalite kapıları sağlıklı havuzlarda aynen çalışmaya devam eder.
 *
 * NELER KORUNUR (kurtarma "kapıları kapatmak" DEĞİLDİR):
 *   • şema: başlığı boş, puanı/sayısı aralık dışı satır yine elenir;
 *   • `inStock === false` yine elenir (gerçekten satışta değil);
 *   • GEÇERSİZ fiyat (0/negatif/NaN) yine elenir;
 *   • hiçbir ölçümü olmayan satır (fiyat, marka, satıcı, url, notta sayı:
 *     hiçbiri) elenir — kanıtsız satırı "ürün" diye sunmak uydurmak olurdu.
 *
 * Geriye kalan adaylar AYNI deterministik formülle puanlanır, tekilleştirilir
 * ve en güçlü `limit` tanesi döner.
 */
export function salvageShortlist(
  raw: readonly RawProduct[],
  options: { limit?: number; context?: DemandContext } = {},
): { products: LlmShortlistProduct[]; survivors: NormalizedProduct[]; rescued: number } {
  const limit = Math.max(0, Math.min(options.limit ?? LLM_SHORTLIST_LIMIT, LLM_SHORTLIST_LIMIT));
  const context = options.context ?? { nicheMomentumPct: null, nicheEngagement: 0 };

  const rows: RawProduct[] = [];
  for (const row of raw) {
    const parsed = RawProductSchema.safeParse(row);
    if (!parsed.success) continue;
    if (parsed.data.title.trim() === "") continue;
    if (parsed.data.inStock === false) continue;
    if (
      parsed.data.priceUsd !== null &&
      (!Number.isFinite(parsed.data.priceUsd) || parsed.data.priceUsd <= 0)
    ) {
      continue;
    }
    // KANIT KURALI: hiçbir yuva dolu değilse bu satır "ölçülmüş ürün" değildir.
    const hasEvidence =
      parsed.data.priceUsd !== null ||
      parsed.data.brand.trim() !== "" ||
      parsed.data.seller.trim() !== "" ||
      parsed.data.url.trim() !== "" ||
      /\d/.test(parsed.data.notes);
    if (!hasEvidence) continue;
    rows.push(parsed.data);
  }

  const scored = scoreDeterministically(
    rows.map((row) => normalizeRaw(row)),
    context,
  );
  // Tekilleştirme normal yolla AYNI kuraldır (parmak izi); en dolu temsilci
  // kalır ve ölçülmüş alanlar kaybolmaz (`mergeDuplicates`).
  const best = new Map<string, NormalizedProduct>();
  for (const p of scored) {
    const key = p.fingerprint || p.name.toLocaleLowerCase("tr-TR");
    const incumbent = best.get(key);
    best.set(key, incumbent ? mergeDuplicates(incumbent, p) : p);
  }
  const survivors = [...best.values()].sort((a, b) => b.preScore - a.preScore).slice(0, limit);
  return { products: survivors.map(toLlmProduct), survivors, rescued: survivors.length };
}

/** Kısa listeyi model istemine gömülecek tek satırlık JSON metnine çevirir. */
export function shortlistToPromptJson(products: readonly LlmShortlistProduct[]): string {
  return JSON.stringify(products);
}
