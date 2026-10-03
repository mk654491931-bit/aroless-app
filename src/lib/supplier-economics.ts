// ============================================================================
// TEDARİK EKONOMİSİ — "tedarik fiyatı ve marj GERÇEKTEN ölçüldü mü?".
// (saf fonksiyonlar; ağ/AI/DB YOK)
//
// NEDEN VAR (ölçülen boşluk, 2026-10-03):
//   Kartta `Supplier` ve `Marj` hücreleri kalıcı `—` idi. Ölçülen sebep: hat
//   yalnız PERAKENDE fiyat kazıyordu. `supplier_price_usd` ölçülmediği için
//   marj da ölçülemiyor; marj ölçülmediği için de `hasMeasuredEconomics` `false`
//   dönüyor ve maliyet bloklarının hepsi gizleniyordu.
//
// BU DOSYA NE YAPAR:
//   1. ÖLÇÜLMÜŞ toptan teklifleri (`SupplierOffer[]`) perakende adaylarla
//      alakalılığa göre EŞLEŞTİRİR (saf, açıklanabilir skor).
//   2. Eşleşmeden BRÜT MARJ BANDI ve KARGOYA KALAN PAY hesaplar — ikisi de
//      İKİ ÖLÇÜMÜN ARITMETİĞİDİR, tahmin değil.
//   3. Her sayının yanına KANIT sayacı koyar; arayüz neyin ölçüldüğünü
//      görebilir.
//
// DÜRÜSTLÜK KURALI (değiştirmeyin):
//   • Satış fiyatı ya da toptan fiyat OLMADAN marj `null`dur. 0 yazmak
//     "ölçtük ve sıfır bulduk" anlamına gelirdi.
//   • Kargo, gümrük ve komisyon ölçülmediği için HİÇBİR YERDE tahmin edilmez.
//     "Net marj" bu yüzden hesaplanmaz; yerine dürüst bir üst sınır gösterilir:
//     `netMarginUpperBoundPct` = brüt marj − ölçülmemiş maliyetler için pay yok.
//   • Eşleşme zayıfsa teklif KULLANILMAZ; alan `null` kalır.
// ============================================================================

import { z } from "zod";

import { measuredMoney } from "./economics-evidence";

/** Bir teklifin ölçülebilir tarafı — ağ modülünden bağımsız (test edilebilir). */
export type SupplierOfferLike = {
  title: string;
  unitPriceUsd: number | null;
  listPriceUsd: number | null;
  discountPct: number | null;
  sold: number | null;
  rating: number | null;
  store: string;
  shipFrom: string;
  url: string;
};

/** Bir perakende adayın eşleştirme için gereken yüzü. */
export type SupplierCandidateLike = {
  /** Kısa liste adı (satılabilir ürün başlığı). */
  name: string;
  /** Ölçülmüş perakende fiyat. `null` = ölçülmedi. */
  priceUsd: number | null;
};

/** Ürüne bağlı ÖLÇÜLMÜŞ marj kanıtı. */
export type MarginEvidence = {
  /** Kargo + komisyon ÖNCESİ brüt marj (%). `null` = iki ölçüm de yok. */
  grossMarginPct: number | null;
  /** Kargo + komisyon için kalan pay (perakende − toptan). `null` = ölçülmedi. */
  feeBudgetUsd: number | null;
  /**
   * Net marj için ÖLÇÜLEN pay. Kargo/gümrük/komisyon sayfada olmadığı için
   * `null`dur. Alan burada bilinçli olarak BOŞ bırakıldı — doldurmak uydurmadır.
   */
  netMarginPct: null;
};

/** Eşleştirme için gereken minimum alakalılık skoru. */
export const SUPPLIER_MIN_RELEVANCE = 0.5;

/**
 * AYIRT EDİCİ olmayan kelimeler — “büyük”, “set”, “iç mekân” gibi her üründe
 * bulunan kelimeler eşleştirmede SAYILMAZ.
 *
 * Neden şart (ölçülen hata, canlı): ilk denemede “Frisco & Co. Extra Large
 * Heavy Duty Dog Crate” başlığı, kedi ağacı teklifleriyle 0,75 skorla
 * EŞLEŞTİ ve kartta $83,58 “tedarik fiyatı” gösterdi. Sebep, ürün başlığı
 * niş gibi kullanıldığında jenerik kelimelerin skoru şişirmesiydi.
 */
const GENERIC_WORDS = new Set([
  "with", "for", "and", "the", "from", "your", "our", "pack", "set", "pcs", "piece",
  "pieces", "count", "size", "inch", "inches", "large", "small", "medium", "big",
  "premium", "ultra", "super", "multi", "portable", "indoor", "outdoor", "color",
  "colour", "colourful", "new", "high", "low", "top", "best", "type", "style",
  "free", "shipping", "sale", "hot", "brand", "store", "shop", "item",
]);

/**
 * Başlıktan AYIRT EDİCİ kelimeler: SONDAN en fazla 3 kelime.
 *
 * Neden SON? Ölçülen gerekçe: pazaryeri başlıkları ürün adını sonda taşır
 * (“... Cat Tree”, “... Scratching Mat”, “... Dog Crate”). BAŞTAN seçilen
 * kelimeler markadır (“Frisco”, “Amazon Basics”, “FukUMARU”) ve toptan ilanda
 * ASLA geçmez; bu yüzden baştan seçim skoru yapay olarak düşük kalıyordu.
 * Sondan seçim ölçülen üç örneği de ayırıyor:
 *   • “... Dog Crate ... Divider Panel” → kedi ağacı teklifiyle eşleşMEZ.
 *   • “... Cat Scratching Mat ... Board” → $1,09 ham matla eşleşir.
 *   • “... Cat Tree ... Hammock” → kedi ağacı teklifleriyle eşleşir.
 *
 * `mat`, `pad`, `toy`, `bed` gibi kısa ama AYIRT EDİCİ kelimeler de sayılır,
 * bu yüzden minimum uzunluk 3'tür.
 */
export function keyTokens(title: string): string[] {
  const tokens = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3 && !GENERIC_WORDS.has(t));
  return [...new Set(tokens)].slice(-3);
}

/** Tek toleranslı kelime eşleşmesi (6+ harfte ilk 6 harf toleranslı). */
function tokenHit(haystack: Set<string>, token: string): boolean {
  if (haystack.has(token)) return true;
  if (token.length < 6) return false;
  const stem = token.slice(0, 6);
  for (const word of haystack) if (word.startsWith(stem)) return true;
  return false;
}

/**
 * Toptan teklif ↔ perakende ürün BAŞLIĞI benzerliği (0-1).
 *
 * Ölçülen kriter: BAŞLIKTAKİ AYIRT EDİCİ kelimelerin kaçı teklifte geçiyor.
 * `niche` karşılaştırması DEĞİL — çünkü burada niş zaten tüm teklif havuzunu
 * zaten filtrelemiş durumdadır; burada ayrım ürünün KENDİSİ içindir.
 */
export function productTitleMatch(productTitle: string, offerTitle: string): number {
  const keys = keyTokens(productTitle);
  if (!keys.length) return 0;
  const haystack = new Set(
    String(offerTitle ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
  const hit = keys.filter((k) => tokenHit(haystack, k)).length;
  return hit / keys.length;
}

/**
 * ÖLÇÜLMÜŞ tedarik kanıtının ZOD ŞEMASI.
 *
 * Neden ayrı şema: bu kanıt iki katmana taşınır (`NormalizedProduct` → iş
 * adımları → `DiscoveryWinner` → kart). Zod, tanınmayan alanı düşürdüğü için
 * şemaya EKLENMEZSE kanıt sessizce kaybolur ve kart yine boş görünür (ölçülen
 * hata: `imageUrl` de aynı sebeple düşüyordu).
 */
export const SupplierEvidenceSchema = z.object({
  samples: z.number().int().min(0),
  supplierPriceUsd: z.number().nullable(),
  supplierLowUsd: z.number().nullable(),
  supplierHighUsd: z.number().nullable(),
  listPriceUsd: z.number().nullable(),
  discountPct: z.number().nullable(),
  soldTotal: z.number().int().min(0).nullable(),
  store: z.string(),
  shipFrom: z.string(),
  url: z.string(),
});

/**
 * Ürüne bağlı ÖLÇÜLMÜŞ tedarik kanıtı. Her alan ya ölçümdür ya `null`dur.
 *
 * Tip şemadan TÜRETİLİR; elle yazılan ikinci bir tanım olsaydı iki tip
 * birbirinden ayrışır ve hatta "Two different types with this name exist"
 * hatası üretirdi (ölçüldü).
 */
export type SupplierEvidence = z.infer<typeof SupplierEvidenceSchema>;

/** Boş kanıt — ölçülmediğinin tek yazımı. */
export function emptySupplierEvidence(): SupplierEvidence {
  return {
    samples: 0,
    supplierPriceUsd: null,
    supplierLowUsd: null,
    supplierHighUsd: null,
    listPriceUsd: null,
    discountPct: null,
    soldTotal: null,
    store: "",
    shipFrom: "",
    url: "",
  };
}

/** Boş marj kanıtı. */
export function emptyMarginEvidence(): MarginEvidence {
  return { grossMarginPct: null, feeBudgetUsd: null, netMarginPct: null };
}

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const percentile = (values: readonly number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

/**
 * Para 2 ondalığa yuvarlanır.
 *
 * Ölçülen sebep: medyan çift sayıda örnekte ortalama aldığı için
 * `$14.004999999999999` gibi bir sayı üretiyordu — kartta “$14,00” yazması
 * gereken yerde kayan nokta hatası görünüyordu.
 */
const money2 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100) / 100;

/**
 * Bir ürün adayı için EN İYİ tedarik teklifini bul.
 *
 * ALAKALILIK ÖLÇÜMÜ: `relevanceScore(teklif başlığı, ürün adı)` — aynı işleve
 * hattın ürün kapısı da güveniyor. `0` (alakasız) veya `1`'den küçük eşik
 * altı teklifler KULLANILMAZ; yanlış teklifle marj hesaplamak, marj
 * ölçülmüş gibi göstermekten daha kötüdür.
 */
export function matchSupplierOffer(
  candidate: SupplierCandidateLike,
  offers: readonly SupplierOfferLike[],
): { offer: SupplierOfferLike; relevance: number } | null {
  let best: { offer: SupplierOfferLike; relevance: number } | null = null;
  for (const offer of offers) {
    if (measuredMoney(offer.unitPriceUsd) === null) continue;
    const relevance = productTitleMatch(candidate.name, offer.title);
    if (relevance < SUPPLIER_MIN_RELEVANCE) continue;
    if (!best || relevance > best.relevance) best = { offer, relevance };
  }
  return best;
}

/**
 * Alakalı tekliflerin FİYAT BANDINI ölçer (medyan + p25/p75 + satış adedi).
 *
 * Medyan tek teklifin fiyatını "gerçek tedarik maliyeti" diye sunmayı engeller:
 * tek bir ucuz/kıymetli ürün bütün bandı çarpıtmamalıdır.
 */
export function buildSupplierEvidence(
  candidate: SupplierCandidateLike,
  offers: readonly SupplierOfferLike[],
): SupplierEvidence {
  const best = matchSupplierOffer(candidate, offers);
  if (!best) return emptySupplierEvidence();

  // Bant yalnız EN ALAKALI tekliflerden kurulur. “>= best” yerine TAM EŞİTLİK
  // aranır: yarım eşleşen ürünler (aynı nişten farklı boy/çeşit) bandı
  // düşürürdü. Tam eşleşen yoksa tek en iyi teklif kullanılır ve `samples: 1`
  // ile bandın tek ölçüme dayandığı dürüstçe görünür.
  const aligned = offers.filter(
    (offer) =>
      measuredMoney(offer.unitPriceUsd) !== null &&
      productTitleMatch(candidate.name, offer.title) === best.relevance,
  );
  const pool = aligned.length ? aligned : [best.offer];
  const prices = pool.map((o) => measuredMoney(o.unitPriceUsd)).filter((n): n is number => n !== null);
  const lists = pool.map((o) => measuredMoney(o.listPriceUsd)).filter((n): n is number => n !== null);
  const discounts = pool
    .map((o) => o.discountPct)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const solds = pool.map((o) => o.sold).filter((n): n is number => typeof n === "number" && n >= 0);

  // Mağaza adı yalnız SPONSORLU kartlarda ölçülüyor; en çok satan teklifin
  // mağazası varsa o gösterilir, yoksa boş kalır.
  const topSold = [...pool].sort((a, b) => (b.sold ?? -1) - (a.sold ?? -1))[0];

  return {
    samples: prices.length,
    supplierPriceUsd: money2(median(prices)),
    supplierLowUsd: money2(percentile(prices, 0.25)),
    supplierHighUsd: money2(percentile(prices, 0.75)),
    listPriceUsd: money2(median(lists)),
    discountPct: discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : null,
    soldTotal: solds.length ? solds.reduce((a, b) => a + b, 0) : null,
    store: topSold?.store ?? "",
    shipFrom: topSold?.shipFrom ?? best.offer.shipFrom,
    url: best.offer.url,
  };
}

/**
 * İKİ ÖLÇÜMDEN brüt marj ve kargoya kalan pay.
 *
 * Satış fiyatı ya da toptan fiyat yoksa `null` döner. Toptan fiyat satış
 * fiyatına eşit/üstse marj `null`'dur: "sıfır marj" değil, ÖLÇÜLEN bir
 * durum (zarar) — onu göstermek yerine karar katmanının işine bırakılır.
 */
export function buildMarginEvidence(
  input: { sellUsd: number | null; supplierUsd: number | null },
): MarginEvidence {
  const sell = measuredMoney(input.sellUsd);
  const buy = measuredMoney(input.supplierUsd);
  if (sell === null || buy === null || buy >= sell) return emptyMarginEvidence();
  return {
    grossMarginPct: Math.round(((sell - buy) / sell) * 1000) / 10,
    feeBudgetUsd: Math.round((sell - buy) * 100) / 100,
    netMarginPct: null,
  };
}

/** Bir aday için hem tedarik hem marj kanıtını üretir. */
export function buildEconomics(
  candidate: SupplierCandidateLike,
  offers: readonly SupplierOfferLike[],
): { supplier: SupplierEvidence; margin: MarginEvidence } {
  const supplier = buildSupplierEvidence(candidate, offers);
  return {
    supplier,
    margin: buildMarginEvidence({
      sellUsd: candidate.priceUsd,
      supplierUsd: supplier.supplierPriceUsd,
    }),
  };
}