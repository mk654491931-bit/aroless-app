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
//   Ölçülmemiş alan UYDURULMAZ — `rating`, `reviews_count` ve `sales_volume`
//   ölçülmediyse `null` döner. Sıfır yazmak "ölçtük ve sıfır bulduk" anlamına
//   gelirdi; bu da modele "bu ürün satmıyor" diye YANLIŞ bilgi verir.
//   Sıralama yine de çalışır: eksik alan `signals` içinde nötr (50) karşılığına
//   düşer ve `dataCompleteness` cezasıyla aşağı çekilir.
// ============================================================================

import { z } from "zod";

import {
  filterAndPreRank,
  type DemandContext,
} from "./product-discovery-filter.server";
import { RawProductSchema, type FilterStats, type RawProduct } from "./product-discovery.types";

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
  price: z.number().finite().positive(),
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
};

/* ---------------------------------------------------------------- Yardım */

/** Başlıktan kısa, kararlı bir slug (yalnız `id` geri düşüşü için). */
function toSlug(title: string): string {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Ürünün kimliği. Sıra: kaynağın verdiği `id` → parmak izi → başlık slug'ı.
 * Parmak izi neredeyse her zaman doludur (başlık boş değilse); slug yalnız
 * savunma amaçlıdır. `min(1)` şeması yüzünden BOŞ KALMASI engellenir.
 */
function shortlistId(p: { id: string; fingerprint: string; name: string }): string {
  return p.id.trim() || p.fingerprint || toSlug(p.name) || "unknown";
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
    // FİYAT KAPI: fiyat bu aşamada zorunludur — marj, ROI ve "bu satmaz mı"
    // sorularının tamamı fiyattan türer. Eksik fiyat ölçülemez.
    if (parsed.data.priceUsd === null || !Number.isFinite(parsed.data.priceUsd) || parsed.data.priceUsd <= 0) {
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
export function buildShortlist(
  raw: readonly RawProduct[],
  options: ShortlistOptions = {},
): { products: LlmShortlistProduct[]; stats: ShortlistStats } {
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
  const clean = cleanRawRows(raw, requireImage, stats);

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
  const products: LlmShortlistProduct[] = [];
  for (const p of survivors) {
    if (p.signals.margin < minMargin) {
      stats.rejectedMargin++;
      continue;
    }
    if (p.preScore < minPreScore) {
      stats.rejectedScore++;
      continue;
    }
    products.push({
      id: shortlistId(p),
      title: p.name,
      price: p.priceUsd as number, // fiyat kapısı `null`ı eledi
      category: p.category,
      rating: p.rating,
      reviews_count: p.ratingCount,
      sales_volume: p.salesVolume,
    });
  }

  // 4) Ham bayt bütçesi. Sondan kırpılır: `products` zaten puana göre
  //    sıralı, yani en güçlü ürünler başta ve korunur.
  let json = JSON.stringify(products);
  while (products.length > 0 && Buffer.byteLength(json, "utf8") > maxBytes) {
    products.pop();
    stats.truncatedForBudget++;
    json = JSON.stringify(products);
  }

  stats.survivors = products.length;
  stats.bytes = Buffer.byteLength(json, "utf8");
  return { products, stats };
}

/** Kısa listeyi model istemine gömülecek tek satırlık JSON metnine çevirir. */
export function shortlistToPromptJson(products: readonly LlmShortlistProduct[]): string {
  return JSON.stringify(products);
}
