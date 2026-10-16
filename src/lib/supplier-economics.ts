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
  /**
   * FOB ARALIĞININ ÜST UCU (varsa). Toptan ilanlarda fiyat miktar kademesine
   * göre aralık olarak yazılır (`US$13.00-15.00`); aralığı tek sayıya indirmek
   * sipariş adedine bağlı bir gerçeği "tek fiyat" gibi sunmak olurdu.
   * Aralık yoksa `null`/`undefined`.
   */
  unitPriceHighUsd?: number | null;
  /** Ölçülen minimum sipariş adedi (MOQ). `null`/`undefined` = sayfada yok. */
  moqUnits?: number | null;
  /** MOQ birimi ("pieces", "sets"…). Boş olabilir. */
  moqUnit?: string;
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

/**
 * Eşleştirme için gereken minimum alakalılık skoru — **0,66** (2/3).
 *
 * ÖLÇÜLEN GEREKÇE (2026-10-16, canlı uçtan uca "air fryer"): havuz MIC ile
 * birlikte İKİ KATINA çıktıktan sonra (aliexpress 60 + made-in-china 30 teklif)
 * 0,5 eşiği 30/30 adayı "eşleşti" gösterdi ve kanıta $28,09 satış fiyatlı bir
 * ürüne **$170,85 tedarik**, $43,87 ürüne $49,27 tedarik yazdı. Yani havuz
 * büyüyünce yanlış eşleşme olasılığı da büyüdü; eşik 2/3'e çekildi. Kısa
 * (2 anahtarlı) başlıklarda 1/2 artık GEÇMEZ — eski eşikte geçiyordu.
 */
export const SUPPLIER_MIN_RELEVANCE = 0.66;

/**
 * NİŞ SEVİYESİ eşleşmesinin sabit alakalılığı (birebir ürün eşleşmesi DEĞİL).
 *
 * NEDEN VAR (ölçülen kayıp, 2026-10-14): tedarik teklifleri AliExpress'ten
 * İNGİLİZCE başlıklarla gelir. Türkçe perakende başlıkları ("Bosch MAF240B0
 * Serie 2 Air Fryer Sıcak Hava Fritözü") ile karşılaştırıldığında ürünün
 * AYIRT EDİCİ kelimeleri (fritözü, hazneli, litrelik) hiçbir teklifte geçmez:
 * canlı ölçüm, `hava fritözü`/TR koşusunda **5/5 üründe tedarik hücresi "—"**
 * ve buna bağlı olarak marjın da boş kalmasıydı — halbuki aynı teklif havuzu
 * 60 fiyatlı kart içeriyordu ve niş çevirisi (`englishProductQuery`) "air
 * fryer"dir.
 *
 * Bu yüzden birebir ürün eşleşmesi yoksa teklif havuzu NİŞ seviyesinde
 * denenir. Bu daha zayıf bir kanıttır ve `matchKind` alanı bunu AÇIKÇA
 * taşır; arayüz de "birebir ürün" yerine "aynı nişteki global fiyat bandı"
 * diye etiketler. Uydurma yok: bant yine ÖLÇÜLMÜŞ teklif fiyatlarından kurulur.
 */
export const SUPPLIER_NICHE_RELEVANCE = 0.6;

/** Teklifin bu nişe ait sayılabileceği en az kelime isabeti. */
export function nicheHitFloor(tokenCount: number): number {
  return Math.max(1, Math.ceil(tokenCount / 2));
}

/**
 * Niş ifadelerinden (TR + İngilizce çevirisi) AYIRT EDİCİ anahtar kelimeler.
 *
 * `keyTokens` ile aynı süzgeci kullanır (kısa kelimeler ve jenerik kelimeler
 * atılır) ama SONDAN 3 kelime sınırı YOKTUR: niş ifadesinin tamamı zaten
 * ürünün kendisidir.
 */
export function nicheKeyTokens(queries: readonly string[]): string[] {
  const out = new Set<string>();
  for (const query of queries) {
    for (const token of foldTurkish(String(query ?? ""))
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)) {
      if (token.length >= 3 && !GENERIC_WORDS.has(token)) out.add(token);
    }
  }
  return [...out];
}

/**
 * Türkçe harfleri ASCII karşılığına indirir.
 *
 * NEDEN GEREKLİ: NFKD normalizasyonu "ö/ü/ş/ğ/ç" harflerini ayırır ama
 * NOKTA SIZ i (ı) ve noktalı büyük İ ayrışmaz. Onlar süzgeçte tümden
 * silindiği için "sıcak" → "s cak" olur ve niş anahtarı kaybolurdu — yani
 * Türkçe nişlerde niş seviyesi yedek sessizce çalışmazdı.
 */
function foldTurkish(value: string): string {
  return value
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u");
}

/** Teklif başlığı bu niş anahtarlarının kaçını taşıyor (0-1). */
export function nicheMatch(offerTitle: string, nicheTokens: readonly string[]): number {
  if (!nicheTokens.length) return 0;
  const haystack = new Set(
    foldTurkish(String(offerTitle ?? ""))
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
  const hit = nicheTokens.filter((k) => tokenHit(haystack, k)).length;
  return hit / nicheTokens.length;
}

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
  "with",
  "for",
  "and",
  "the",
  "from",
  "your",
  "our",
  "pack",
  "set",
  "pcs",
  "piece",
  "pieces",
  "count",
  "size",
  "inch",
  "inches",
  "large",
  "small",
  "medium",
  "big",
  "premium",
  "ultra",
  "super",
  "multi",
  "portable",
  "indoor",
  "outdoor",
  "color",
  "colour",
  "colourful",
  "new",
  "high",
  "low",
  "top",
  "best",
  "type",
  "style",
  "free",
  "shipping",
  "sale",
  "hot",
  "brand",
  "store",
  "shop",
  "item",
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
  /**
   * EŞLEŞMENİN TÜRÜ — kanıtın gücünü taşıyan alan.
   *
   *  • `"product"` — teklif başlığı ÜRÜNÜN kendi ayırt edici kelimelerini taşır
   *    (birebir/çok yakın eşleşme).
   *  • `"niche"` — birebir ürün eşleşmesi YOK; teklif AYNI NİŞTEN seçildi
   *    (çok dilli başlıklarda tek çalışan yol). Bant yine ölçülmüş teklif
   *    fiyatlarından kurulur ama "bu ürünün toptan fiyatı" diye sunulmaz.
   *
   * `optional()` BİLEREK: bu alan eklenmeden ÖNCE yazılmış kayıtlar
   * `matchKind` taşımaz. Zorunlu olsaydı zod eski kayıtların `supplier`
   * kanıtını tümden düşürür (üst alan `.catch(null)` ile null olurdu) ve
   * kullanıcı kanıtını kaybederdi.
   */
  matchKind: z.enum(["product", "niche"]).optional().catch(undefined),
  /**
   * FOB ARALIĞININ ÜST UCU — ölçüldüyse dolu, yoksa `null`.
   *
   * NEDEN AYRI ALAN: toptan ilanlarda fiyat "US$13.00-15.00" gibi aralıktır ve
   * alt uç en yüksek miktar kademesine aittir. Tek uç göstermek ya iyimser
   * (alt) ya da haksız (üst) bir maliyet sunardı; ikisi birlikte taşınır.
   */
  supplierPriceHighUsd: z.number().nullable().optional().catch(null),
  /**
   * ÖLÇÜLEN minimum sipariş adedi + birimi. `null` = sayfada yok.
   *
   * `optional()` BİLEREK (`matchKind` ile aynı gerekçe): alan eklenmeden ÖNCE
   * yazılmış kayıtlar bu alanı taşımaz ve zod zorunlu alanla eski kayıtların
   * `supplier` kanıtını tümden düşürürdü.
   */
  moqUnits: z.number().int().min(1).nullable().optional().catch(null),
  moqUnit: z.string().optional().catch(""),
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

/**
 * Kanıtın eşleşme türü — alanı taşımayan eski kayıtlar `"product"` sayılır.
 * (Eski kayıtlarda kanıt yalnız birebir eşleşmeyle üretilebiliyordu.)
 */
export function supplierMatchKind(
  evidence: SupplierEvidence | null | undefined,
): "product" | "niche" {
  return evidence?.matchKind === "niche" ? "niche" : "product";
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
/**
 * EŞİT ALAKALILIKTA "BAŞLATILABİLİRLİK" SIRASI — ölçülen ilk sipariş sermayesi.
 *
 * NEDEN VAR (ölçülen sorun, 2026-10-16): toptan havuzda aynı ürün için birden
 * çok teklif bulunuyor ve eski kod İLK geleni (kaynak sırasına göre) seçiyordu.
 * Ölçülen sonuç: aynı nişte MOQ 10 olan bir tedarikçi varken MOQ 1.000 olan
 * teklif kanıta yazılabiliyordu — yani "ilk sipariş 10.300 dolar" diyordu, oysa
 * ölçülmüş 10 adetlik teklif de masadaydı. Aynı marj bandında, BAŞLATILABİLİR
 * tedarikçiyi göstermek "gerçekten atılabilecek ürün" sorusunun cevabıdır.
 *
 * ÜÇ KADEME (küçük → büyük): bilinen ve tavanın altında · MOQ bilinmiyor ·
 * bilinen ve tavanın üstünde. MOQ'suz teklif (perakende/perakende-benzeri)
 * "minimum sipariş kanıtı yok" demektir; bu, KANITLI yüksek MOQ'dan iyidir.
 */
const STARTABLE_TIER_MAX_USD = 1_500;

function firstOrderUsd(offer: SupplierOfferLike): number | null {
  const unit = measuredMoney(offer.unitPriceUsd);
  const moq = typeof offer.moqUnits === "number" && offer.moqUnits > 0 ? offer.moqUnits : null;
  if (unit === null || moq === null) return null;
  return unit * moq;
}

function startableTier(offer: SupplierOfferLike): number {
  const first = firstOrderUsd(offer);
  if (first === null) return 1; // MOQ kanıtı yok
  return first <= STARTABLE_TIER_MAX_USD ? 0 : 2;
}

/** `true` = `a`, `b`'den DAHA başlatılabilir. */
function moreStartable(a: SupplierOfferLike, b: SupplierOfferLike): boolean {
  const tierA = startableTier(a);
  const tierB = startableTier(b);
  if (tierA !== tierB) return tierA < tierB;
  const firstA = firstOrderUsd(a);
  const firstB = firstOrderUsd(b);
  if (firstA === null || firstB === null) return false;
  return firstA < firstB;
}

/**
 * FİYAT AKIL KONTROLÜ — alış fiyatı satış fiyatının ÜSTÜNDEyse bu teklif
 * "tedarik seçeneği" DEĞİLDİR.
 *
 * NEDEN ÖLÇÜM (canlı hata, 2026-10-16): $28,09'luk bir air fryer adayına
 * $170,85 "tedarik" yazıldı çünkü başlık benzerliği eşiği geçmişti. Marj
 * hesabı `null` döndürdüğü için sayı UYDURULMADI, ama kanıt hücresi yine de
 * yanıltıcıydı: 170 dolar verip 28 dolara satmak bir toptan kanıtı değil,
 * YANLIŞ EŞLEŞME imzasıdır. İki ÖLÇÜLMÜŞ sayı karşılaştırıldığı için bu bir
 * varsayım değil, ölçümün kendi tutarlılık kapısıdır.
 */
function priceSane(candidate: SupplierCandidateLike, offer: SupplierOfferLike): boolean {
  const retail = measuredMoney(candidate.priceUsd);
  const unit = measuredMoney(offer.unitPriceUsd);
  if (retail === null || unit === null) return true; // karşılaştıracak ölçüm yok
  return unit < retail;
}

export function matchSupplierOffer(
  candidate: SupplierCandidateLike,
  offers: readonly SupplierOfferLike[],
): { offer: SupplierOfferLike; relevance: number } | null {
  let best: { offer: SupplierOfferLike; relevance: number } | null = null;
  for (const offer of offers) {
    if (measuredMoney(offer.unitPriceUsd) === null) continue;
    if (!priceSane(candidate, offer)) continue;
    const relevance = productTitleMatch(candidate.name, offer.title);
    if (relevance < SUPPLIER_MIN_RELEVANCE) continue;
    if (!best || relevance > best.relevance) {
      best = { offer, relevance };
      continue;
    }
    // EŞİT alakalılıkta kaynak sırası DEĞİL, başlatılabilirlik kazanır.
    if (relevance === best.relevance && moreStartable(offer, best.offer)) {
      best = { offer, relevance };
    }
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
  /**
   * NİŞ SEVİYESİ YEDEĞİ (opsiyonel): niş ifadeleri (TR + İngilizce çevirisi).
   * Verilmezse davranış eskisiyle BİREBİR aynıdır — birebir eşleşme yoksa
   * kanıt boş kalır, uydurulmaz.
   */
  opts: { nicheQueries?: readonly string[] } = {},
): SupplierEvidence {
  const best = matchSupplierOffer(candidate, offers);

  // BİREBİR ürün eşleşmesi yoksa NİŞ seviyesinde ara (çok dilli başlıklarda
  // tek çalışan yol). Eşleşme türü kanıta YAZILIR ki arayüz gücünü saklamasın.
  if (!best) {
    const tokens = nicheKeyTokens(opts.nicheQueries ?? []);
    const nicheOffers = tokens.length
      ? offers.filter(
          (offer) =>
            measuredMoney(offer.unitPriceUsd) !== null &&
            priceSane(candidate, offer) &&
            nicheMatch(offer.title, tokens) >= nicheHitFloor(tokens.length) / tokens.length,
        )
      : [];
    if (!nicheOffers.length) return emptySupplierEvidence();
    // NİŞ HAVUZUNDA "EN BAŞLATILABİLİR" TEKLİF SEÇİLİR — havuzun İLK teklifi
    // DEĞİL.
    //
    // NEDEN ÖLÇÜM: MOQ ve FOB ARALIĞI teklife ÖZEL alanlardır (havuz medyanı
    // bunları taşımaz) ve eski kod bunları `nicheOffers[0]`ten — yani kaynak
    // sırasına göre rastgele bir tekliften — alıyordu. Ölçülen sonuç: aynı
    // nişte MOQ 10 olan tedarikçi masadayken kanıta MOQ 50/1.000 yazılabiliyor,
    // "ilk sipariş sermayesi" bu ürünün değil o rastgele teklifin rakamı
    // oluyordu. Seçim artık deterministiktir ve kural birebir eşleşmeyle
    // AYNIdır (`moreStartable`): bilinen ve tavanın altında → MOQ bilinmiyor →
    // tavanın üstünde.
    const nicheBest = nicheOffers.reduce((a, b) => (moreStartable(b, a) ? b : a));
    return withMatchKind(buildEvidenceFromPool(nicheOffers, nicheBest), "niche");
  }

  // Bant yalnız EN ALAKALI tekliflerden kurulur. “>= best” yerine TAM EŞİTLİK
  // aranır: yarım eşleşen ürünler (aynı nişten farklı boy/çeşit) bandı
  // düşürürdü. Tam eşleşen yoksa tek en iyi teklif kullanılır ve `samples: 1`
  // ile bandın tek ölçüme dayandığı dürüstçe görünür.
  const aligned = offers.filter(
    (offer) =>
      measuredMoney(offer.unitPriceUsd) !== null &&
      productTitleMatch(candidate.name, offer.title) === best.relevance,
  );
  return withMatchKind(
    buildEvidenceFromPool(aligned.length ? aligned : [best.offer], best.offer),
    "product",
  );
}

/** Kanıt nesnesine eşleşme türünü yazar (tek yerden). */
function withMatchKind(
  evidence: SupplierEvidence,
  matchKind: "product" | "niche",
): SupplierEvidence {
  return { ...evidence, matchKind };
}

/**
 * ÖLÇÜLMÜŞ teklif havuzundan kanıtı kurar (bant + satış + mağaza).
 * Havuzun nasıl seçildiği (birebir ürün / niş) bu fonksiyonun DIŞINDA kalır:
 * böylece iki yol da aynı aritmetiği kullanır ve bant hiçbir yolda uydurulmaz.
 */
function buildEvidenceFromPool(
  pool: readonly SupplierOfferLike[],
  bestOffer: SupplierOfferLike,
): SupplierEvidence {
  const prices = pool
    .map((o) => measuredMoney(o.unitPriceUsd))
    .filter((n): n is number => n !== null);
  const lists = pool
    .map((o) => measuredMoney(o.listPriceUsd))
    .filter((n): n is number => n !== null);
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
    // FOB aralığının üst ucu ve MOQ YALNIZ eşleşen tekliften alınır: havuzun
    // medyanı aralık bilgisi de sipariş eşiği de taşımaz (havuz çok teklifli,
    // MOQ ise teklife özeldir). Ölçülmediyse `null` kalır — 0 uydurulmaz.
    supplierPriceHighUsd: money2(measuredMoney(bestOffer.unitPriceHighUsd)),
    moqUnits:
      typeof bestOffer.moqUnits === "number" && bestOffer.moqUnits > 0
        ? Math.floor(bestOffer.moqUnits)
        : null,
    moqUnit: String(bestOffer.moqUnit ?? "").trim(),
    listPriceUsd: money2(median(lists)),
    discountPct: discounts.length
      ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length)
      : null,
    soldTotal: solds.length ? solds.reduce((a, b) => a + b, 0) : null,
    // MAĞAZA/KARGO: en çok satan teklif önce, ölçüm YOKSA eşleşen teklifin
    // kendi değeri. `??` yeterli DEĞİLDİ: AliExpress'te satış adedi olup mağaza
    // adı boş olan kartlar var (ölçüldü: 60 kartın 10'u) ve o durumda `store`
    // `""` döner, birleşik havuzdaki MIC tedarikçi adı kullanılmadan kaybolurdu.
    store: topSold?.store || bestOffer.store || "",
    shipFrom: topSold?.shipFrom || bestOffer.shipFrom,
    url: bestOffer.url,
  };
}

/**
 * İKİ ÖLÇÜMDEN brüt marj ve kargoya kalan pay.
 *
 * Satış fiyatı ya da toptan fiyat yoksa `null` döner. Toptan fiyat satış
 * fiyatına eşit/üstse marj `null`'dur: "sıfır marj" değil, ÖLÇÜLEN bir
 * durum (zarar) — onu göstermek yerine karar katmanının işine bırakılır.
 */
export function buildMarginEvidence(input: {
  sellUsd: number | null;
  supplierUsd: number | null;
}): MarginEvidence {
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
  /** Niş seviyesi yedeği için niş ifadeleri (bkz. `buildSupplierEvidence`). */
  opts: { nicheQueries?: readonly string[] } = {},
): { supplier: SupplierEvidence; margin: MarginEvidence } {
  const supplier = buildSupplierEvidence(candidate, offers, opts);
  return {
    supplier,
    margin: buildMarginEvidence({
      sellUsd: candidate.priceUsd,
      supplierUsd: supplier.supplierPriceUsd,
    }),
  };
}
