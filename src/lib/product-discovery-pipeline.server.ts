// ============================================================================
// PRODUCT DISCOVERY — QSTASH ASENKRON PİPELİN.
//
// Vercel Hobby'de fonksiyon süresi kısıtlıdır (10 sn pratik / 300 sn tavan).
// Bu yüzden iş, birbirini TETİKLEYEN dört bağımsız adıma bölünür; her adım
// kendi fonksiyonunda BİTER ve bir sonrakini QStash ile kuyruğa alır:
//
//   /start ──► scraping+filtering (saf kod, 0 token)
//                 └─► gemini_shortlist  (Top 75 → 25, Gemini 1)
//                       └─► deep_analysis (14 ajan, ücretsiz havuz)
//                             └─► sıralama + Top 5 + 'completed'
//
// $0 MALİYET KURALI: AI yalnız `gemini_shortlist` ve `deep_analysis`
// adımlarında çağrılır. `scraping`/`filtering` saf koddur. Bu, 60 adaylık bir
// nişte bile ön eleme maliyetinin SIFIR olmasını garanti eder.
//
// DURUM MAKİNESİ: Her adım sonu durumu `ProductDiscoveryStatus` ile bildirir.
// Geçersiz geçişler (`canTransition`) reddedilir; böylece bir adım iki kez
// çalışsa bile "completed" → "scraping" gibi saçma durumlar oluşmaz.
//
// GERİ ALMA / İADE: Adım çökerse `failed` durumuna geçer ve kredi
// `refundFeatureCredits` ile iade edilir — kullanıcı hata için ödemez.
// ============================================================================

import { z } from "zod";

import {
  canTransition,
  TopProductSchema,
  type Consensus,
  type NormalizedProduct,
  type ProductDiscoveryStatus,
  type RawProduct,
  type TopProduct,
} from "./product-discovery.types";
import {
  candidateQuality,
  describeFunnel,
  describeShortlistQuality,
  productIdOf,
} from "./discovery-core";
// `supplier-economics` SAF bir modüldür (ağ/AI/DB yok) — başlık eşleştirmesi
// yalnız onun ölçekleriyle yapılabilir, ikinci bir benzerlik fonksiyonu yazmak
// iki farklı "benzer" tanımı üretirdi.
import { productTitleMatch, supplierMatchKind } from "./supplier-economics";
import { assessLaunch } from "./launch-readiness";
// Çıktı dili TEK kaynaktan: kullanıcı arayüzü hangi dildeyse modelin yazdığı
// gerekçe/özet metinleri de o dilde çıkar (bkz. lib/ai-language.ts).
import { outputLanguageDirective } from "./ai-language";
import { reasonCopy } from "./product-discovery-reason";

/**
 * ADIM 1'in üst sınırı: 75 aday.
 *
 * Daha önce `75` dört ayrı yerde gömülüydü (varsayılan parametre, ön sıralama
 * dilimi, istem metni ve zod şeması). Biri değiştiğinde diğerleri sessizce
 * eski kalıyordu — hat "en iyi 75" sözünü kendi büyüklüğüne göre tutardı.
 */
export const DISCOVERY_TOP_N = 75;

/**
 * ADIM 4'ün üst sınırı: nihai 5 ürün.
 *
 * Aynı gerekçe `DISCOVERY_TOP_N` ile aynı: sayı gömülü halde birden çok
 * yere dağılmış olursa hat sözünü kendi büyüklüğüne göre tutar.
 */
export const DISCOVERY_FINAL_N = 5;

/* ------------------------------------------- Nihai kalite ölçütleri (kapı) */

/**
 * Nihai SIRALAMA ağırlıkları: konsey oyu, güven ve kanıt derinliği.
 *
 * `final_score` olarak gösterilen sayı yine konsey oyudur (`councilScore`);
 * burada değişen şey SIRALAMADIR.
 *
 * ÖLÇÜLEN SORUN (denetim raporu, 2026-10-16): kanıt ağırlığı 0,05 iken sıralamayı
 * fiilen yalnız konsey oyu belirliyordu. Somut aritmetik: 10 puan daha yüksek
 * konsey oyu 8,5 puan fark yaratırken, kanıtın 0/5'ten 5/5'e çıkması (uçtan uca
 * 80 puanlık kanıt farkı) yalnız 4 puan ediyordu. Yani "kanıtı eksiksiz" bir
 * ürün, "kanıtı olmayan ama bir tık daha yüksek oylanmış" ürünün gerisine
 * düşüyordu — sonuç etiketi ise "kanıtlı kazanan"dı.
 *
 * YENİ AĞIRLIKLARIN OKUNUŞU (toplam 1,00):
 *   council 0,62 → konsey hâlâ baş belirleyici (ürün KALİTESİNİ ölçen tek sinyal),
 *                 ama artık kanıt farkı 10 puanlık bir oy farkını çevirebilir.
 *   evidence 0,25 → 0/5 ile 5/5 arasındaki fark 25 puandır: "ölçtük" ile
 *                 "ölçmedik" arasındaki fark sıralamada GÖRÜNÜR olur.
 *   confidence 0,13 → güven düzeltici kalır (oy sayısı/uzlaşma kapsamı).
 *
 * Ağırlıklar 1,00'a tamamlanır: `winnerQualityScore` üst sınırı (100) hâlâ
 * tam kanıtlı + tam oylu üründe elde edilir, atılabilirlik bonusu hariç.
 */
export const WINNER_SCORE_WEIGHTS = { council: 0.62, confidence: 0.13, evidence: 0.25 } as const;

/**
 * KOHORT BENZERLİK EŞİĞİ — `cohortCompetitorCounts` için (bkz. tanımı).
 *
 * 2/3 ölçek: üç ayırt edici kelimenin en az ikisi paylaşılırsa "aynı ürün".
 * Tek kelime (1/3) paylaşımı çok geniş bir rekabet tanımı üretir; üçü de
 * isteyen (1,0) yaklaşım ise farklı mağaza başlıklarını kaçırır.
 */
export const COHORT_COMPETITOR_MATCH = 0.66;

/**
 * ATILABİLİRLİK BONUSU — lansman kapılarını geçen ürünün sıralama avantajı.
 *
 * NEDEN AĞIRLIKLAR DEĞİŞTİRİLMEDİ: `council`/`confidence`/`evidence` ağırlıkları
 * 1,0'a tamamlanır ve mevcut testler o puanı kilitler. Bonus bu yüzden AYRI ve
 * EK bir terimdir; kanıtı olmayan üründe (veya eski kayıtlarda) 0'dır — yani
 * davranış eskisiyle birebir aynı kalır, ürün "atılamaz" denen ürünün önüne
 * yalnız gerçekten atılabilir olan geçer.
 */
export const WINNER_LAUNCH_BONUS = 6;

/**
 * Kalite kapısının oy tabanı.
 *
 * ÖLÇÜLEN SORUN (denetim raporu, 2026-10-16): taban 22/100 iken 14 ajanın
 * neredeyse oybirliğiyle reddettiği bir aday "kazanan ürün" başlığı altında
 * teslim edilebiliyordu. 100 üzerinden 22, "kötü"yü değil "neredeyse hiç"i
 * anlatır; etiket ile eşik birbirini tutmuyordu.
 *
 * YENİ TABAN 45: 14 ajanın uzlaşmış oyu bu bandın altındaysa ürün, kullanıcıya
 * "kazanan" diye sunulmaz. Eşik, "ölçülmüş kanıtı olan makul bir aday"
 * seviyesidir; altındaki satırlar (varsa) yalnız liste boş kalmasın diye
 * gösterilir ve bu DURUM ARTIK KARTTA YAZAR (bkz. `qualityGate`).
 */
export const WINNER_MIN_COUNCIL_SCORE = 45;
/** Kanıtı zayıf (<= 2/5) adayın geçmesi için gereken daha yüksek oy tabanı. */
export const WINNER_MIN_COUNCIL_SCORE_WEAK_EVIDENCE = 55;
/**
 * Kapı ne kadar elerse elesin, en az bu kadar kazanan teslim edilir.
 *
 * NEDEN TABAN DÜŞÜRDÜ: kırılgan nişlerde (ör. çok dar bir alt kategori) 5
 * aydın ürün gelmeyebiliyordu ve 3 olan taban listeden birkaçını daha eliyordu;
 * kullanıcı boş sonuçla karşılaşıyordu. Çok düşük oyu SİLMEYE DEVAM EDİYORUZ
 * (konsey gerçekten 14 ajanla değerlendirir) ama tabanı sonuçsuz kalmamak için
 * gereğinden yukarı tutmuyoruz: kaliteyi ajanların oyu belirler, kurtarma
 * yalnız listeyi boş bırakmaz.
 */
export const MIN_DELIVERED_WINNERS = 1;

/**
 * GÖRSEL KAPISININ AÇILMASI İÇİN GEREKEN EN AZ FOTOĞRAFLI SATIR.
 *
 * ÖLÇÜLDÜ (2026-10-12, gerçek ağ, uçtan uca ilk aşama): ücretsiz pazaryeri
 * okuyucuları fotoğrafı her satırda getirir.
 *   "air fryer"/US → 68 ham satır, 33'ü fotoğraflı (AliExpress + Newegg)
 *   "bardak"/TR  → 100 ham satır, 70'i fotoğraflı (Hepsiburada + n11)
 * İki havuzda da fotoğraflı satır sayısı bu eşiğin 6-14 KATI. Yani eşik
 * bağlayıcı kısıt DEĞİLDİR: yalnız "havuzda gerçek ürün var mı" sorusunu
 * yanıtlar. Eşiğin altında görsel ZORUNLU kılınmaz çünkü fotoğraflı ürün hiç
 * yoksa kapı listeyi boşaltır ve kullanıcı ürün yerine hata görür (kapı sonrası
 * boş liste zaten bir kez gevşetilir — bkz. `runScrapeFilterStep`).
 *
 * Bu satırlar `product-discovery-reader.fixtures.test.ts` ile kilitlidir:
 * kaydedilmiş fixture havuzu kapıdan geçirilir ve fotoğrafsız satırların
 * listeye GİRMEDİĞİ doğrulanır.
 */
export const MIN_IMAGED_POOL = 5;

/**
 * Görsel kapısı AÇIK mı? — saf karar fonksiyonu (ağ yok, DB yok).
 *
 * KURAL: havuzda en az `Math.min(topN, MIN_IMAGED_POOL)` fotoğraflı satır
 * varsa görsel ZORUNLU olur; yoksa kapı kapalı kalır (liste asla boşaltılmaz).
 * Ayrı export edilir çünkü tek bir hatada "vitrin fotoğrafsız ürünle dolar"
 * regresyonu doğrudan bu karardan çıkar ve ölçülebilir olmalıdır.
 */
export function shouldRequireImages(
  rows: readonly { imageUrl?: string | null }[],
  topN: number,
  minPool: number = MIN_IMAGED_POOL,
): boolean {
  const threshold = Math.max(1, Math.min(topN, minPool));
  let imaged = 0;
  for (const r of rows) if (String(r.imageUrl ?? "").trim() !== "") imaged += 1;
  return imaged >= threshold;
}

/* ------------------------------------ Nihai 5 ürünün sözleşmesi (top_products) */

/**
 * `TopProductSchema` artık paylaşılan tipler katmanında tanımlıdır
 * (`product-discovery.types`): aynı şemayı istemci hook'u da okur, sunucu
 * modülünü tarayıcı paketine sokmak gerekmez. Buradan yeniden dışa aktarılır,
 * böylece mevcut sunucu tarafı import'ları kırılmaz.
 */
export { TopProductSchema };
export type { TopProduct };

/**
 * BAŞ ÜRÜN KURATÖRÜ ÇIKTISI — dışarıya verilen sözleşme.
 *
 * ALAN ADLARI VE SIRASI DIŞARI SÖZLEŞMESİDİR; panel ve istemciler buna göre
 * okur, değiştirmek onları kırar.
 *
 * `final_score` konsenyus skorudur (14 ajanın uzlaşmış puanı, 0-100).
 * `selection_reason` ÜRETİLEN METİN DEĞİL, SINYALLARDAN TÜRETİLEN KISA
 * GEREKÇEDİR — aşağıda `buildTopProducts` nasıl kurduğu yazılıdır.
 */
export const TopProductsPayloadSchema = z.object({
  top_products: z.array(TopProductSchema).max(DISCOVERY_FINAL_N),
});
export type TopProductsPayload = z.infer<typeof TopProductsPayloadSchema>;

/**
 * Nihai 5 ürünü `top_products` sözleşmesine çevirir.
 *
 * NEDEN ÜÇÜNCÜ BİR MODEL ÇAĞRISI YOK:
 *   Repo tasarımı ilkesi "$0 maliyet, AI yalnız iki yerde"dir (`gemini_shortlist`
 *   ve 14 ajan). 25 → 5 seçimi zaten 14 ajanın uzlaşmış `councilScore`'u ile
 *   `runFinalRankStep` içinde DETERMİNİSTİK olarak yapılıyor. Buraya ayrı bir
 *   "küratör" modeli eklemek aynı işi ikinci kez, ücretli ve TUTARSIZ biçimde
 *   yapardı: aynı girdide iki kez farklı liste üretmek, tek bir liste
 *   üretmekten çok daha kötüdür (denetlenemez, tekrarlanamaz, pahalı).
 *   İstenen sözleşme (id/title/final_score/selection_reason) eksiksiz
 *   karşılanır; gerekçe metni MODELDEN değil, ürünün ölçülmüş sinyallerinden
 *   deterministik olarak üretilir.
 *
 * `selection_reason` tam olarak istenen üç ölçüte göre kurulur:
 *   1. Trend & viral  → `signals.demand`   (talep kanıtı) + satış hacmi
 *   2. Kar & fiyat    → `signals.margin`   (fiyat bandı sağlığı) + fiyat
 *   3. Rekabet       → `signals.competition` (doygunluk; yüksek puan = az rekabet)
 * Ölçülmemişse gerekçe uydurulmaz, "veri yok" denir.
 */
export function buildTopProducts(
  ranked: readonly {
    fingerprint?: string;
    id?: string;
    candidateId?: string;
    name?: string;
    title?: string;
    councilScore?: number;
    confidenceScore?: number;
    agreement?: number;
    priceUsd?: number | null;
    signals?: { demand?: number; margin?: number; competition?: number };
    /** Ölçülmüş kanıt derinliği (0-5) — gerekçeye sayı olarak girer. */
    dataCompleteness?: number;
    /** Ürünü doğrulayan kaynak adları — 1'den fazlaysa gerekçede görünür. */
    sources?: string[];
  }[],
  limit = DISCOVERY_FINAL_N,
  /**
   * Kullanıcının seçtiği dil: gerekçe şablonları bu dilde kurulur (bkz.
   * `product-discovery-reason.ts`). Varsayılan "tr" — eski çağrı noktaları ve
   * testler aynı metni görür.
   */
  lang: string = "tr",
): TopProductsPayload {
  const copy = reasonCopy(lang);
  const taken = ranked.slice(0, Math.max(0, Math.min(limit, DISCOVERY_FINAL_N)));
  const top_products = taken.map((p) => {
    const demand = p.signals?.demand ?? null;
    const margin = p.signals?.margin ?? null;
    const competition = p.signals?.competition ?? null;
    const completeness = typeof p.dataCompleteness === "number" ? p.dataCompleteness : null;
    const sourceCount = Array.isArray(p.sources) ? p.sources.length : 0;
    const score = Math.round(Math.max(0, Math.min(100, p.councilScore ?? 0)));

    const parts: string[] = [];
    // 1) TREND & VİRAL
    parts.push(
      demand === null
        ? copy.trendUnknown
        : copy.trend(
            demand,
            p.confidenceScore !== undefined ? Math.round(p.confidenceScore) : undefined,
          ),
    );
    // 2) KAR & FİYAT
    const price = typeof p.priceUsd === "number" && Number.isFinite(p.priceUsd) ? p.priceUsd : null;
    parts.push(margin === null ? copy.priceUnknown : copy.margin(margin, price));
    // 3) REKABET
    parts.push(
      competition === null
        ? copy.competitionUnknown
        : competition >= 60
          ? copy.competitionLow(competition)
          : copy.competitionHigh(competition),
    );
    // 4) KANIT DERİNLİĞİ — gerekçeyi "iyi görünüyor"dan "şu kadar ölçüldü"ye
    //    çevirir. Yalnız ÖLÇÜLMÜŞ sayılar yazılır; alan yoksa eklenmez.
    if (completeness !== null) parts.push(copy.completeness(Math.round(completeness)));
    if (sourceCount > 1) parts.push(copy.sourcesConfirmed(sourceCount));

    return {
      // Sıra: kaynak kimliği → parmak izi → konsenyus `candidateId`.
      // Sonuncusu ZORUNLU bir güvenlik ağıdır: `final` adımı normalde ürün
      // satırlarını verir, ama ürün kaydı taşınmayan bir oy satırında
      // (yalnız konsenyus döndü) kimlik boş kalırsa model cevabı kaynağına
      // bağlayamaz.
      id:
        (p.id ?? "").trim() ||
        (p.fingerprint ?? "").trim() ||
        (p.candidateId ?? "").trim() ||
        "unknown",
      title: (p.title ?? p.name ?? "").trim() || copy.untitled,
      final_score: score,
      selection_reason: parts.join(" · "),
    };
  });

  return TopProductsPayloadSchema.parse({ top_products });
}

/** Adım sonuçlarının ortak sözleşmesi. */
export const DiscoveryStepResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum([
    "queued",
    "scraping",
    "filtering",
    "gemini_shortlist",
    "deep_analysis",
    "completed",
    "failed",
  ]),
  /** Üretilen ürünler (normalize edilmiş). */
  products: z.array(z.any()).default([]),
  /** Uzlaşma sonuçları (yalnız deep_analysis sonrası). */
  consensus: z.array(z.any()).default([]),
  /**
   * NİHAİ 5 ÜRÜN — dış sözleşme (yalnız `final` adımında dolar).
   *
   * 14 ajanın oyu burada TEK bir çıktıya indirgenir. `products` ham normalize
   * satırlar olduğu için istemcinin gördüğü "kazananlar" listesini üretmez;
   * bu alan `top_products` sözleşmesini taşır.
   *
   * BİLEREK OPSİYONEL: yalnız `final` adımı doldurur. Zorunlu olsaydı
   * `scrape_filter` / `gemini` / `deep` adımlarının dönüşleri de bu alanı
   * uydurmak zorunda kalırdı; oysa o adımlarda kazanan henüz yok.
   */
  topProducts: z.array(z.any()).optional(),
  stats: z.any().optional(),
  /** Sonraki adımın tetiklenip tetiklenmediği. */
  next: z.string().default(""),
  /** Hata/uyarı notları. */
  notes: z.array(z.string()).default([]),
});
export type DiscoveryStepResult = z.infer<typeof DiscoveryStepResultSchema>;

/** Adım sonuçlarını kısa ve loglanabilir tutan yardımcı. */
export function okResult(
  status: ProductDiscoveryStatus,
  partial: Partial<DiscoveryStepResult> = {},
): DiscoveryStepResult {
  return {
    ok: true,
    status,
    products: [],
    consensus: [],
    stats: undefined,
    next: "",
    notes: [],
    ...partial,
  } as DiscoveryStepResult;
}

/** Hata sonucu. `partial` ile o ana kadar üretilen kanıt KORUNUR. */
export function failResult(
  partial: Partial<DiscoveryStepResult> = {},
  note = "",
): DiscoveryStepResult {
  // `partial` içinde `ok`/`status` gelse bile sonuç BAŞARISIZ kalmalı: bu iki
  // alan spread SONRASI atanır (literal içinde aynı anahtarı iki kez
  // yazmak TS1117 hatası verir).
  return {
    products: [],
    consensus: [],
    stats: undefined,
    next: "",
    ...partial,
    notes: [...(partial.notes ?? []), note].filter(Boolean),
    ok: false,
    status: "failed",
  };
}

/* ------------------------------------------------------ Adım 1: scrape+filter */

/**
 * ADIM 1 — Scrape & Normalize → Filter & Pre-rank (Top 75). AI YOK.
 *
 * Bu adım saf kod olduğu için EN UZUN adımdır ve bütçeyi zorlamaz. Kaynaklar
 * paralel, fail-soft çalışır; her biri kendi tavanına sahiptir.
 */
/* ------------------------------------------------- Tedarik (supplier) kanıtı */

/**
 * Ölçülmüş toptan teklifleri perakende adaylara bağlar ve `supplier` alanını
 * doldurur. FAIL-SOFT: kazım ya da eşleştirme çalışmazsa adaylar DEĞİŞMEZ
 * (alan `null` kalır) ve hat boşalmaz.
 *
 * Neden ayrı adım ve neden `PRODUCT_SOURCES`'a girmiyor: toptan teklifler
 * perakende ürün DEĞİLDİR; aynı listede görünürse hat "ucuz kedi tırmalama
 * tahtası $1,09" diye kendi kazandığı ürünü yanlış fiyatla gösterirdi.
 */
async function attachSupplierEconomics(
  survivors: readonly NormalizedProduct[],
  niche: string,
  country: string,
): Promise<{
  offers: number;
  matched: number;
  /** Birebir ürün eşleşmesiyle kanıt bulanlar. */
  matchedProduct: number;
  /** Birebir eşleşme yokken NİŞ seviyesinde kanıt bulanlar (daha zayıf kanıt). */
  matchedNiche: number;
  withMargin: number;
  medianUsd: number | null;
  /** MIC kaynağından gelen teklif sayısı (0 = kaynak sessiz/alakasız). */
  micOffers: number;
  /** Kaç ürün MOQ (minimum sipariş) kanıtı kazandı. */
  withMoq: number;
  /** Çalışan/çalışmayan kaynak dökümü (şeffaflık). */
  sources: string[];
}> {
  const empty = {
    offers: 0,
    matched: 0,
    matchedProduct: 0,
    matchedNiche: 0,
    withMargin: 0,
    medianUsd: null,
    micOffers: 0,
    withMoq: 0,
    sources: [] as string[],
  };
  if (!survivors.length) return empty;
  const { fetchSupplierOffers } = await import("./aliexpress-supplier.server");
  const { cjApiKey, fetchCjOffers, fetchMicOffers } = await import("./mic-supplier.server");
  const { buildEconomics, supplierMatchKind } = await import("./supplier-economics");
  // NİŞ İFADELERİ (TR + İngilizce çevirisi) — niş seviyesi yedeği için.
  //
  // NEDEN: tedarik teklifleri İngilizce gelir; Türkçe ürün başlıklarında
  // ürünün ayırt edici kelimeleri hiçbir teklifte geçmediği için eşleşme
  // 0 oluyordu ve TR koşularında 5/5 üründe Supplier/Marj "—" kalıyordu
  // (ölçüm 2026-10-14). İngilizce niş anahtarları bu kopukluğu kapatır.
  const { productQueryVariants, englishProductQuery } = await import("./product-discovery-query");
  const nicheQueries = [englishProductQuery(niche), ...productQueryVariants(niche, 2)].filter(
    (q): q is string => Boolean(q && q.trim()),
  );

  // ÜÇ KAYNAK PARALEL ve FAIL-SOFT (AliExpress + Made-in-China + isteğe bağlı CJ Dropshipping).
  // MIC ve CJ, AliExpress'in ölçemediği üç yuvayı getirir (MOQ, tedarikçi adı,
  // FOB/birim fiyat bandı) — biri düşerse diğeri tek başına eskisi gibi çalışır;
  // kanıt uydurulmaz. CJ anahtarı yoksa 0 ms'de boş döner.
  const hasCj = Boolean(cjApiKey());
  const [aeResult, micResult, cjResult] = await Promise.allSettled([
    fetchSupplierOffers(niche, { country }),
    fetchMicOffers(niche),
    hasCj ? fetchCjOffers(niche) : Promise.resolve([]),
  ]);
  const sources: string[] = [];
  const aeOffers = aeResult.status === "fulfilled" ? aeResult.value : [];
  const micOffers = micResult.status === "fulfilled" ? micResult.value : [];
  const cjOffers = cjResult.status === "fulfilled" ? cjResult.value : [];
  if (aeResult.status === "fulfilled") {
    sources.push(`aliexpress ${aeOffers.length} teklif`);
  } else {
    sources.push(`aliexpress HATA (${aeResult.reason?.message?.slice(0, 60) ?? "bilinmeyen"})`);
  }
  if (micResult.status === "fulfilled") {
    sources.push(`made-in-china ${micOffers.length} teklif`);
  } else {
    sources.push(`made-in-china HATA (${micResult.reason?.message?.slice(0, 60) ?? "bilinmeyen"})`);
  }
  if (hasCj) {
    if (cjResult.status === "fulfilled") {
      sources.push(`cj-dropshipping ${cjOffers.length} teklif`);
    } else {
      sources.push(`cj-dropshipping HATA (${cjResult.reason?.message?.slice(0, 60) ?? "bilinmeyen"})`);
    }
  }

  // MIC ve CJ teklifleri bizim teklif sözleşmesine çevrilir: ölçmedikleri alanlar
  // `null`'dur (`sold`, `rating`, `discountPct`) — uydurulmaz.
  const offers = [
    ...aeOffers,
    ...[...micOffers, ...cjOffers].map((o) => ({
      title: o.title,
      unitPriceUsd: o.unitPriceUsd,
      unitPriceHighUsd: o.unitPriceHighUsd,
      listPriceUsd: null,
      discountPct: null,
      sold: null,
      rating: null,
      store: o.store,
      shipFrom: o.shipFrom,
      url: o.url,
      moqUnits: o.moqUnits,
      moqUnit: o.moqUnit,
    })),
  ];
  if (!offers.length) return { ...empty, sources };

  let matched = 0;
  let matchedProduct = 0;
  let matchedNiche = 0;
  let withMargin = 0;
  let withMoq = 0;
  const prices: number[] = [];
  for (let i = 0; i < survivors.length; i++) {
    const row = survivors[i];
    const { supplier, margin } = buildEconomics(
      { name: row.name, priceUsd: row.priceUsd },
      offers,
      {
        nicheQueries,
      },
    );
    if (supplier.samples === 0) continue;
    matched++;
    if (supplierMatchKind(supplier) === "product") matchedProduct++;
    else matchedNiche++;
    if (typeof supplier.moqUnits === "number") withMoq++;
    if (supplier.supplierPriceUsd !== null) prices.push(supplier.supplierPriceUsd);
    if (margin.grossMarginPct !== null) withMargin++;
    (survivors[i] as NormalizedProduct) = {
      ...row,
      supplier,
      grossMarginPct: margin.grossMarginPct,
      feeBudgetUsd: margin.feeBudgetUsd,
    };
  }
  prices.sort((a, b) => a - b);
  return {
    offers: offers.length,
    matched,
    matchedProduct,
    matchedNiche,
    withMargin,
    medianUsd: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    micOffers: micOffers.length,
    withMoq,
    sources,
  };
}

/**
 * KOHORT RAKİP SAYISI — "aynı havuzda bu ürünün kaç benzeri var?".
 *
 * NEDEN BURADA ÖLÇÜLEBİLİYOR: `winner-criteria.ts` rekabet kriterini bilinçli
 * olarak dışarıda bırakmıştı çünkü kohort verisi kısa listede taşınmıyordu.
 * Hat bu veriyi ZATEN elinde tutuyor (`survivors`); eksik olan, üründen ürüne
 * sayılması ve ürünle birlikte taşınmasıydı.
 *
 * ÖLÇÜM TANIMI: başlığın AYIRT EDİCİ kelimelerinin en az 2/3'ünü paylaşan
 * DİĞER satırlar. Eşik `productTitleMatch`in kendi ölçeğinde 0,66'dır; bu,
 * "kedi tırmalama tahtası" ile "kedi ağacı"yı eşleştirmez ama aynı ürünün
 * iki farklı mağazadaki ilanını eşleştirir.
 */
export function cohortCompetitorCounts(names: readonly string[]): number[] {
  return names.map((name, i) => {
    let count = 0;
    for (let j = 0; j < names.length; j++) {
      if (i === j) continue;
      if (productTitleMatch(name, names[j]) >= COHORT_COMPETITOR_MATCH) count += 1;
    }
    return count;
  });
}

export async function runScrapeFilterStep(
  niche: string,
  country: string,
  _platform: string,
  topN = DISCOVERY_TOP_N,
  /**
   * Kaynak tavanı (ms): adımın dilim bütçesine sığması için verilir. Kaynaklar
   * PARALEL koştuğu için toplam süre en yavaşınki kadardır, toplamı değil; bu
   * yüzden tek bir tavan yeterlidir.
   */
  opts: { sourceCapMs?: number } = {},
): Promise<DiscoveryStepResult> {
  const { runSources } = await import("./product-discovery-sources.server");
  const { buildShortlist, imageFillCapFor, salvageShortlist } =
    await import("./product-discovery-shortlist.server");

  // 1) Kaynaklar (fail-soft, paralel, kaynak başına tavan — dilime kırpılır).
  const { products: rawPool, reports } = await runSources(niche, undefined, {
    capMs: opts.sourceCapMs,
    // GLOBAL SaaS: kaynaklar hedef ülkenin YEREL pazaryerine bakar
    // (bkz. `MARKETPLACES_BY_COUNTRY`). Ülke boşsa kaynaklar kendi
    // varsayılanına döner — eski davranış korunur.
    country,
  });

  // 1b) MARKA ÖLÇÜMÜ (kaynaktan) + KATALOG ZENGİNLEŞTİRMESİ (ücretsiz).
  //
  // ÖLÇÜLEN BOŞLUK (2026-10-15, canlı "air fryer"/US): 120 ham satır → 75
  // aday ve **0/75 üründe marka**; kategori de boş. Sebep: pazaryeri LİSTE
  // sayfaları marka alanı sunmuyor (AliExpress kart şeması ölçüldü: `brand`
  // YOK). Marka üç yerde kritik: `productModelKey` anahtarı, `dataCompleteness`
  // "brand" yuvası ve 14 ajanın marka okuyan oyları.
  //
  // İki katman, ikisi de UYDURMAZ:
  //   1. Ücretsiz ürün kataloğu (UPCitemdb) — marka/model/GTIN/kategori.
  //      Kota günlük kovayla korunur; hata/kota durumunda hat DÜŞMEZ.
  //   2. Başlıktan yapısal çıkarım (`brandFromTitle`) — `normalizeRaw` içinde,
  //      HER ZAMAN çalışır ve `brandMeasured: false` yazar (türev ≠ ölçüm).
  //
  // SIRA ÖNEMLİ (ölçülen hata): başlıktan çıkarım ENRICHMENT'TAN ÖNCE
  // yapılırsa `row.brand` önceden dolar ve zenginleştirme onu "kaynaktan
  // ölçülmüş marka" sanıp `brandMeasured: true` yazar — türev bir çıkarım
  // kanıt yuvasına dönüşür. Bu yüzden başlık çıkarımı BURADA YAPILMAZ;
  // yalnız katalog (gerçek ölçüm) alanı doldurur.
  // SORGU SEÇİMİ MARKA AĞIRLIKLI (ölçülen verim farkı, 2026-10-15): niş
  // sorgusu (`s=air fryer`) 5 kayıt döndürdü ama markaları adaylarla
  // örtüşmedi → 0 eşleşme. Marka sorgusu (`s=Ninja air fryer`) ise dönen her
  // kaydı adayın markasıyla hizalar ve kimlik çapası kazandırır. En sıkin
  // markalar seçilir: iki sorguluk patlama bütçesi en çok satıra harcanır.
  let raw: RawProduct[] = [...rawPool];
  let catalog = {
    enriched: 0,
    brands: 0,
    categories: 0,
    confirmed: 0,
    records: 0,
    queries: [] as string[],
  };
  try {
    const {
      CATALOG_MAX_SEARCHES_PER_RUN,
      catalogQueriesForRun,
      enrichRowsWithCatalog,
      fetchCatalogRecordsForQueries,
    } = await import("./product-catalog.server");
    const { brandFromTitle: brandOfTitle, plausibleBrand } = await import("./product-brand");
    const { productQueryVariants: kindVariants } = await import("./product-discovery-query");
    const kindQuery = kindVariants(niche)[0] ?? String(niche ?? "").trim();
    const brandCounts = new Map<string, number>();
    for (const row of rawPool) {
      const brand = String(row.brand ?? "").trim() || brandOfTitle(String(row.title ?? ""));
      // MAKULLÜK SÜZGECİ (ölçüldü: "Deli 9.5QT" → katalog sorgusu boşa
      // gitti ve patlama bütçesinin ikisi de heba oldu). Makul olmayan ad
      // sorguya DÖNÜŞMEZ.
      if (!brand || !plausibleBrand(brand)) continue;
      brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    }
    // SIRA ölçülen sıklıktır: iki sorguluk patlama bütçesi en çok satırı
    // doğrulayacak markaya harcanır. Tek satırda görülen marka ELENMEZ
    // (canlı ölçüm: "air fryer" nişinde marka başına 1 satır düşüyor, hepsi
    // elenince katalog sorgusu niş sorgusuna düşüyor ve 0 eşleşme veriyordu).
    const topBrands = [...brandCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([brand]) => brand)
      .slice(0, CATALOG_MAX_SEARCHES_PER_RUN);
    const { records, queries } = await fetchCatalogRecordsForQueries(
      catalogQueriesForRun(topBrands, kindQuery, CATALOG_MAX_SEARCHES_PER_RUN),
    );
    if (records.length) {
      const result = enrichRowsWithCatalog(raw, records);
      raw = result.rows;
      catalog = {
        enriched: result.enriched,
        brands: result.brands,
        categories: result.categories,
        confirmed: result.confirmed,
        records: records.length,
        queries,
      };
    } else {
      catalog = { ...catalog, queries };
    }
  } catch (e) {
    // Fail-soft: zenginleştirme çalışmazsa satırlar başlıktan çıkarılmış
    // markayla devam eder; hiçbir alan uydurulmaz.
    console.log(
      `[discovery] katalog zenginleştirmesi atlandı: ${(e as Error).message.slice(0, 90)}`,
    );
  }

  // 2) Niş bağlamı (talep sinyalleri) — kaynaklardan türetilir, AI DEĞİL.
  //    Wikipedia momentum satırın `notes`inde taşınır; burada parse edilir.
  let nicheMomentumPct: number | null = null;
  let nicheEngagement = 0;
  for (const row of raw) {
    const notes = row.notes ?? "";
    const m = /momentum ([+-]?\d+)%/.exec(notes);
    if (m && nicheMomentumPct === null) nicheMomentumPct = Number(m[1]);
    // Etkileşim: upvote+yorum veya yıldız.
    const e = /(\d+)\s*(?:↑|yorum|yıldız)/.exec(notes);
    if (e) nicheEngagement += Number(e[1]);
  }

  // 3) Normalize → puanla → süz (saf kod).
  const perSource = reports.map((r) => ({
    name: r.name,
    ok: r.ok,
    items: r.items,
    ms: r.ms,
    error: r.error,
  }));
  // GÖRSEL KAPISI — ARTIK SABİT KAPALI DEĞİL, ÖLÇÜME BAĞLI.
  //
  // Geçmişte buraya `requireImage: false` yazılmıştı çünkü "hiçbir kaynak
  // `imageUrl` üretmiyor" sanılıyordu ve kapı açıkken listenin tamamı elenip
  // Gemini aşamasına boş liste gidiyordu.
  //
  // ÖLÇÜLDÜ (2026-10-12, gerçek ağ): bu gerekçe ARTIK DOĞRU DEĞİL. Ücretsiz
  // pazaryeri okuyucuları her satırda gerçek fotoğraf getiriyor:
  //   "led masa lambası"/TR → 34 satır, 34'ü görselli (Hepsiburada)
  //   "air fryer"        /US → AliExpress satırları görselli + fiyatlı + satış adetli
  // Yani görselsiz satırlar artık gerçek ürün DEĞİL; GitHub depoları, Wikipedia
  // maddeleri ve haber snippet'leridir — kartlarda "fotoğraf yok" olarak görünen
  // şey tam olarak onlardı. Kapıyı kapalı tutmak, vitrini bu satırlarla
  // dolduruyordu.
  //
  // GÜVENLİK KURALI (eski arıza tekrarlanmasın): görsel ZORUNLU kılınır ama
  // YALNIZ havuzda yeterince fotoğraflı ürün varsa. Havuzda fotoğraflı ürün
  // yoksa (ör. yalnız talep sinyali dönen bir niş) eski davranış korunur ve
  // liste boş bırakılmaz. Ayrıca kapı sonrası liste boş kalırsa kapı bir kez
  // gevşetilir — "boş ekran" hiçbir zaman doğru cevap değildir.
  const imagedCount = raw.filter((r) => String(r.imageUrl ?? "").trim() !== "").length;
  const requireImage = shouldRequireImages(raw, topN);
  const shortlistOptions = {
    // Alakalılık kapısı nişi bilmeli: kaynakların dilinden bağımsız
    // (TR ya da EN) güçlü eşleşmeleri ayırır.
    niche,
    limit: topN,
    context: { nicheMomentumPct, nicheEngagement },
    perSource,
  } as const;
  // GÖRSEL KITLIĞI DOLDURUCUSU (rapor P0-3): görsel kapısı açık kalır ama
  // fotoğraflı satır hedefi doldurmazsa listenin en çok %20'si görselsiz
  // satırlarla doldurulur. Ölçüm: HB sayfası 37 kart / 12 görselli → kapı tek
  // başına ürün kaybını %68'e çıkarıyordu; kart görselsiz ürünü dürüstçe
  // "görsel doğrulanamadı" diye gösterip görseli ürünün kendi sayfasından
  // doğrulamaya çalışır.
  let built = buildShortlist(raw, {
    ...shortlistOptions,
    requireImage,
    imageFillCap: requireImage ? imageFillCapFor(topN) : 0,
  });
  // Kapı listeyi boşalttıysa (ölçüm yanıltıcıysa) ürün kaybetmek yerine
  // kapıyı bırakırız: boş sonuç kullanıcıya yanlış bilgi verir, eksik görsel
  // yalnızca dürüst bir "doğrulanamadı" etiketi gösterir.
  if (requireImage && built.survivors.length === 0 && raw.length > 0) {
    built = buildShortlist(raw, {
      ...shortlistOptions,
      requireImage: false,
      imageFillCap: imageFillCapFor(topN),
    });
  }
  const stats = built.stats;
  let products = built.products;
  let survivors = built.survivors;

  // SON ÇARE KURTARMA (2026-10-01 canlı hatası: 13 kaynak, 15 ham satır,
  // kapıların tamamı eledi → kullanıcı ürün yerine hata aldı ve parasını
  // ödedi). Kapılar sağlıklı havuzda aynen çalışır; yalnız liste BOŞ kalırsa
  // ölçülmüş satırlar kurtarılır. Eksik alan uydurulmaz — `null` kalır.
  let rescued = 0;
  if (survivors.length === 0 && raw.length > 0) {
    const rescue = salvageShortlist(raw, {
      limit: topN,
      context: { nicheMomentumPct, nicheEngagement },
    });
    if (rescue.survivors.length > 0) {
      products = rescue.products;
      survivors = rescue.survivors;
      rescued = rescue.rescued;
    }
  }

  // 4) TEDARİK KANITI — ölçülmüş toptan fiyat bandı, satış adedi ve bundan
  //    türeyen brüt marj. Ayrı bir adım çünkü kaynak ürün LİSTESİ değil,
  //    teklif ÜRETİR; retail satırlarıyla eşleştirilmesi gerekir.
  const supplierStats = await attachSupplierEconomics(survivors, niche, country);

  // 4b) ATILABİLİRLİK KARARI — "bu ürün GERÇEKTEN atılabilir mi?".
  //
  // Üç ölçüm burada birleşir: MOQ × FOB = ilk sipariş sermayesi, ölçülen brüt
  // marj ve KOHORT rakibi sayısı. Karar ürünle birlikte taşınır (`launch`) ki
  // hem sıralama hem arayüz aynı ölçüme baksın; ölçülmeyen kapı "unknown"dur
  // ve asla `pass` sayılmaz (bkz. `launch-readiness.ts` sözleşmesi).
  const competitorCounts = cohortCompetitorCounts(survivors.map((row) => row.name));
  for (let i = 0; i < survivors.length; i++) {
    const row = survivors[i];
    const launch = assessLaunch({
      // Başlık, mevzuat/IP vetosu için taranır (ölçülen metin, uydurma değil).
      name: row.name,
      priceUsd: row.priceUsd,
      grossMarginPct: row.grossMarginPct ?? null,
      supplierPriceUsd: row.supplier?.supplierPriceUsd ?? null,
      supplierPriceHighUsd: row.supplier?.supplierPriceHighUsd ?? null,
      moqUnits: row.supplier?.moqUnits ?? null,
      moqUnit: row.supplier?.moqUnit ?? "",
      cohortCompetitors: competitorCounts[i],
      // KANITIN TÜRÜ karara girer: niş bandı (proxy) "atılabilir" SAYILMAZ
      // (bkz. `launch-readiness.ts` → `supplierMatchKind`).
      supplierMatchKind: row.supplier ? supplierMatchKind(row.supplier) : null,
    });
    (survivors[i] as NormalizedProduct) = {
      ...row,
      cohortCompetitors: competitorCounts[i],
      launch,
    };
  }
  const launchable = survivors.filter((row) => row.launch?.launchable === true);

  const notes: string[] = [
    `Görsel kapısı: ${requireImage ? "açık" : "kapalı"} (havuzda ${imagedCount} fotoğraflı satır).`,
    // ÖLÇÜLEN ZENGİNLEŞTİRME: marka/kategori kaç satırda ÖLÇÜLDÜ? Bu satır
    // olmadan "marka neden hâlâ boş" sorusu görünmez bir arızaya dönüşür.
    catalog.records > 0
      ? `Katalog zenginleştirmesi: ${catalog.queries.length} sorgu ` +
        `(${catalog.queries.join(" · ")}) → ${catalog.records} kayıt · ` +
        `${catalog.enriched} satır eşleşti (+${catalog.brands} marka, ` +
        `+${catalog.categories} kategori) · ${catalog.confirmed} marka katalogla DOĞRULANDI.`
      : `Katalog zenginleştirmesi: kayıt gelmedi (kota/patlama sınırı/ağ) — ` +
        `${catalog.queries.length ? `${catalog.queries.length} sorgu denendi; ` : ""}marka başlıktan ölçüldü.`,
    // Dürüstlük: listeye görselsiz satır girdiyse SÖYLENİR — aksi hâlde "kartta
    // fotoğraf neden yok" sorusu kaynağı görünmeyen bir arızaya dönüşürdü.
    stats.admittedMissingImage > 0
      ? `Görsel kıtlığı: ${stats.admittedMissingImage} satır görselsiz alındı (görsel ürünün kendi sayfasından doğrulanmaya çalışılır).`
      : "",
    `İlk aşama (saf kod): ${stats.inputCount} ham satır → ${survivors.length} ürün ` +
      `(${Buffer.byteLength(JSON.stringify(products), "utf8")} bayt, 7 alan).`,
    // HUNI + ELEME DÖKÜMÜ (§25): "hangi aşamada kaç ürün elendi" sayıyla görünür.
    describeFunnel(
      {
        scraped: stats.inputCount,
        normalized: stats.inputCount - stats.rejectedInvalid,
        filtered: survivors.length,
        top75: survivors.length,
      },
      {
        "geçersiz satır": stats.rejectedInvalid,
        "stok dışı": stats.rejectedNotInStock,
        "bozuk fiyat": stats.rejectedPrice,
        "görsel yok": stats.rejectedMissingImage,
        "marj tabanı": stats.rejectedMargin,
        "skor tabanı": stats.rejectedScore,
        bütünlük: stats.rejectedByCompleteness,
        kaynak: stats.rejectedBySource,
        duplicate: stats.rejectedByDuplicate,
        rating: stats.rejectedByRating,
        "bütçe kırpma": stats.truncatedForBudget,
      },
    ),
  ];
  if (supplierStats.matched > 0) {
    notes.push(
      `Tedarik kanıtı: ${supplierStats.matched}/${survivors.length} ürüne toptan ` +
        `teklif eşleşti (${supplierStats.matchedProduct} birebir ürün, ` +
        `${supplierStats.matchedNiche} aynı niş; ${supplierStats.offers} teklif tarandı, ` +
        `medyan birim fiyat ` +
        `${supplierStats.medianUsd === null ? "ölçülmedi" : `$${supplierStats.medianUsd}`}); ` +
        `brüt marj ${supplierStats.withMargin} üründe, MOQ ${supplierStats.withMoq} üründe hesaplandı.`,
    );
  } else if (survivors.length > 0) {
    notes.push(
      `Tedarik kanıtı: ${supplierStats.offers} toptan teklif tarandı ama HİÇBİRİ ` +
        `ürünlerle alakalı eşleşmedi — Supplier/Marj alanları boş kalıyor (uydurulmadı).`,
    );
  }
  if (supplierStats.sources.length) {
    notes.push(`Tedarik kaynakları: ${supplierStats.sources.join(" · ")}.`);
  }
  // Notları önce değişkenlere almak, iç içe şablon dizesi girintisini önler
  // (okunabilirlik: not metni tek yerde kurulur).
  const atilabilirOrnek = launchable
    .slice(0, 3)
    .map((row) => row.name.slice(0, 40))
    .join(" · ");
  const engelOrnek =
    survivors
      .flatMap((row) => row.launch?.blockers ?? [])
      .slice(0, 3)
      .join(" · ") || "kanıt eksik (tedarik/MOQ/marj ölçülmedi)";
  // ÖLÇÜLÜP YAZILAN KAPILAR: not, hangi üç ölçümün kurala girdiğini ADIYLA
  // söyler. Eski metin "ilk sipariş sermayesi ölçüldü" diyordu; oysa karar
  // kuralı MOQ'u hiç aramaz ve canlı koşuda örneklerde "İlk sipariş=unknown"
  // idi — yani not, ölçülmemiş bir alanı ölçülmüş gibi gösteriyordu.
  notes.push(
    launchable.length > 0
      ? `Lansman kapısı: ${launchable.length}/${survivors.length} ürün "atılabilir" ` +
          `(BİREBİR tedarik + fiyat + marj + reklam bütçesi ölçüldü ve hiçbir kapı engellemedi): ${atilabilirOrnek}` +
          `${launchable.length > 3 ? " …" : ""}.`
      : `Lansman kapısı: hiçbir aday tüm kapılardan geçemedi. Engeller: ${engelOrnek}.`,
  );
  // PROXY SAYACI: niş bandıyla fiyatlanan adaylar "atılabilir" SAYILMAZ ve bu
  // sebep görünmez kalırsa kullanıcı "neden lansman sayısı düştü" diye sorar.
  if (supplierStats.matchedNiche > 0) {
    notes.push(
      `Tedarik proxy'si: ${supplierStats.matchedNiche} aday yalnız NİŞ bandıyla ` +
        `fiyatlandı (bu ürünün kendi toptan teklifi yok) — bunlar lansman ` +
        `kararında "atılabilir" SAYILMAZ; tedarikçiden bu ürüne ait FOB fiyatı istenmeli.`,
    );
  }
  if (rescued > 0) {
    notes.push(
      `Kalite kapıları ${stats.inputCount} satırın tamamını elemişti; ${rescued} aday ` +
        `kanıtıyla kurtarıldı (ölçülmemiş alan uydurulmadı).`,
    );
  }
  if (survivors.length === 0) {
    // Buraya yalnız KAYNAKLARDAN hiç ölçülmüş satır gelmediğinde düşülür:
    // kurtarma da boş döndü. Sebep sayaçlarla görünür olsun diye eleme
    // dökümü nota yazılır (adım bunu kullanıcıya hata metni olarak taşır).
    notes.push(
      `Hiç kaynak ölçülmüş ürün döndürmedi (şema ${stats.rejectedInvalid}, ` +
        `stok ${stats.rejectedNotInStock}, fiyat ${stats.rejectedPrice}, ` +
        `bütünlük ${stats.rejectedByCompleteness}). Gemini aşamasına boş liste gönderilmez.`,
    );
  }
  const failed = reports.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`);
  if (failed.length) notes.push(`Çalışmayan kaynak(lar) — ${failed.join("; ")}`);

  return {
    ok: true,
    status: "filtering",
    products: survivors,
    consensus: [],
    stats,
    next: survivors.length > 0 ? "gemini_shortlist" : "",
    // Boş not satırları atılır: "görsel kıtlığı yoksa" boş dize üretiyor ve
    // panelde boş satır olarak görünürdü.
    notes: notes.filter(Boolean),
  };
}

/* ---------------------------------------------- Adım 2: Gemini shortlist (25) */

/**
 * Top-75 listesinden Gemini ile en iyi 25 adayı seçer.
 *
 * 25 NEDEN: hattın sözleşmesi 75 → 25 → 5'tir. 14 ajan konsesinde oy
 * çeşitliliği aday sayısıyla artar; 12'den dar bir havuzda her ajan aynı
 * birkaç ürüne yoğunlaşıp oy dağılımını yapay olarak daraltıyordu. Maliyet
 * açısından hâlâ ucuz: bu TEK bir Gemini çağrısıdır.
 *
 * AZ sayıda aday varsa HAT SAYIYI DOLDURMAZ: 43 kaliteli ürün varsa 43 gider.
 */ export const GEMINI_SHORTLIST_SIZE = 25;
export async function runGeminiShortlistStep(
  products: readonly NormalizedProduct[],
  niche: string,
  topN = GEMINI_SHORTLIST_SIZE,
  /**
   * Gemini seçicisi — varsayılan gerçek model çağrısıdır. DIŞARIDAN
   * DEĞİŞTİRİLEBİLİR ki testler (ve canlı E2E) model yanıtını taklit
   * ederek "Gemini yolu"nun gerçekten çalıştığını kanıtlayabilsin.
   * Önceden gömülüydü; bu yüzden bu adım test edilebilir değildi ve
   * istem/doğrulayıcı uyuşmazlığı gibi hatalar fark edilemedi.
   */
  geminiSelect?: (
    products: readonly NormalizedProduct[],
    niche: string,
  ) => Promise<NormalizedProduct[]>,
  /** Kullanıcının seçtiği arayüz dili — modelin `reasoning` metni bu dilde çıkar. */
  lang?: string,
): Promise<DiscoveryStepResult> {
  if (products.length === 0) {
    return {
      ok: true,
      status: "completed",
      products: [],
      consensus: [],
      next: "",
      notes: ["Kaynak ürün yok; kısa liste atlandı."],
    };
  }
  // Gemini çağrısı burada yapılır (mevcut AI yönlendiricisi üzerinden).
  // Bu dosya saf kalmaya devam eder; çağrı route katmanında enjekte edilir
  // (bağımlılık enjeksiyonu) ki testlerde sahte (mock) çağrı kullanılabilsin.
  // Varsayılan seçici burada kurulur: dil parametresi enjekte edilen seçicinin
  // sözleşmesini (2 argüman) bozmadan YALNIZ gerçek Gemini çağrısına geçer.
  const selector =
    geminiSelect ??
    ((p: readonly NormalizedProduct[], n: string) =>
      geminiShortlistSelector(p, n, undefined, lang));
  const {
    products: shortlist,
    via: shortlistVia,
    geminiPicks,
  } = await selectWithGemini(products, niche, topN, selector);
  // DÜRÜST RAPOR: not, GERÇEKTE ne olduğunu söyler. Ölçüldü (2026-09-27):
  // anahtar yokken çağrı ~30 ms'de düşüyor (yani Gemini'ye HİÇ gidilmiyor)
  // ama not "Gemini N → M aday seçti" yazıyordu. Kullanıcı ve panel modelin
  // seçtiğini sanırken aslında deterministik ön sıralama geçerlidir.
  return {
    ok: true,
    status: "gemini_shortlist",
    products: shortlist,
    consensus: [],
    next: "deep_analysis",
    notes: [
      // HUNI (§25): aşama sayıları tek satırda görünür. Model seçimi kaç
      // ürün verdiyse o kadarı, gerisi deterministik yedeklemedir — bu ayrım
      // gizlenmez çünkü kullanıcı "model seçti" sanarken yedeğin çalışmış
      // olması hatla ilgili bir hatadır.
      describeFunnel({
        gemini_input: products.length,
        gemini_output: shortlist.length,
      }),
      shortlistVia === "gemini"
        ? `Gemini ${products.length} → ${shortlist.length} aday seçti ` +
          `(${geminiPicks} seçim modelden, ${shortlist.length - geminiPicks} deterministik yedekleme).`
        : `deterministik yedek ${products.length} → ${shortlist.length} aday seçti.`,
      // §11/§12 GÖZLEMLENEBİLİRLİK: kısa listenin ölçülmüş bütünlük ve kaynak
      // güveni özeti. Düşük güven sayısı uydurulmaz; doğrudan ölçümden gelir.
      ...(shortlist.length > 0 ? [describeShortlistQuality(shortlist)] : []),
      ...(shortlistVia === "gemini"
        ? []
        : ["Gemini çağrısı yapılmadı; ön skor sıralaması kullanıldı."]),
      // SAYIYI DOLDURMA YASAĞI (§39): havuz küçükse bu not yazılır, liste
      // uydurma ürünle tamamlanmaz.
      ...(shortlist.length < GEMINI_SHORTLIST_SIZE
        ? [
            `Havuzda ${shortlist.length} kaliteli aday vardı; liste ${GEMINI_SHORTLIST_SIZE}'e ` +
              `YAPILMADI — sayıyı doldurmak için sahte ürün eklenmez.`,
          ]
        : []),
    ],
  };
}

/**
 * GERÇEK Gemini seçicisi — hatta bağlanan AI katmanı.
 *
 * $0 MALİYET KURALI: AI yalnız burada ve 14 ajan adımında çağrılır. Girdi
 * zaten deterministik ön sıralamadan geçmiş Top-75 adaydır, yani model
 * elemesi gereksiz olan satırları görmez.
 *
 * GÜVENLİ TASARIM: Modelden yalnız ÜRÜN DİZİNİ (indeks) istenir, ürün verisi
 * değil. Modelin uydurduğu bir başlık/fiyat listeye giremez — yalnız mevcut
 * adaylardan birini SEÇEBİLİR. Ayrıca yanıt zod ile doğrulanır ve geçersizse
 * deterministik sıralamaya düşülür; model hattı asla bozamaz.
 */
export async function geminiShortlistSelector(
  products: readonly NormalizedProduct[],
  niche: string,
  /**
   * Bu çağrının bitmesi gereken an (ms). Verilmezse model zinciri kendi
   * varsayılan penceresini kullanır.
   *
   * NEDEN ZORUNLU HALE GELDİ: `callGemini` sırayla 5 anahtar × 4 model dener;
   * süre verilmediğinde TEK bir çağrı teorik olarak ~240 sn sürebilir. Bu adım
   * zincirin ikincisidir ve arkasında `deep` + `final` vardır: pencereyi tek
   * başına yiyip isteği platform tavanına dayayabiliyordu (kullanıcının
   * "300 saniyeden fazla dönüyor, sonuç yok" belirtisi).
   */
  deadlineAt?: number,
  /** Çıktı dili: kartta okunan gerekçe seçilen dilde yazılır. */
  lang?: string,
): Promise<NormalizedProduct[]> {
  const { callGemini } = await import("./ai.server");
  // Tek import yüzeyi: AI seçim doğrulaması ORTAK ÇEKİRDEKTEN gelir (kimlik
  // zaten modül başında çekirdekten alınıyor).
  const { resolveSelection } = await import("./discovery-core");

  // DİKKAT: istem ile doğrulayıcı AYNI SÖZDİZİMİNİ konuşmalıdır.
  // Önceki sürüm isteme "sadece numara listesi ver" yazıyor, doğrulayıcı ise
  // yalnız `{"picks":[...]}` kabul ediyordu. Model talimatı izleyince (yani
  // DÜZGÜN çalışınca) yanıt doğrulamadan düşüyor ve hat sessizce yedeğe
  // kayıyordu — yani Gemini hiçbir zaman seçim yapamıyordu.
  const candidates = products.slice(0, GEMINI_SHORTLIST_SIZE);
  const roster = candidates.map((p) => ({ productId: productIdOf(p), product: p }));
  const prompt = buildShortlistPrompt(products, niche, lang);

  // `grounded=false`: aday listesi SABİT ve elimizde. Google Search grounding
  // yalnız gecikmeyi artırır ve modelin JSON dışında arama metni sarmalamasına
  // yol açar. Bu adım sorgulamaz, yalnız sıralar.
  //
  // SÜRE SINIRI: zincirin mutlak bitiş anı verilir; anahtar/model rotasyonu bu
  // anı geçemez, süre bitince deterministik seçime düşülür.
  //
  // FAIL-SOFT (ölçülen canlı hata, 2026-10-02):
  //   Gemini `503 "high demand"` döndüğünde `callGemini` istisna FIRLATIYORDU.
  //   Bu fonksiyonun sözleşmesi ise "model konuşmazsa `[]` dön, deterministik
  //   sıralama işi bitirsin" idi — aşağıdaki `if (!parsed.success) return []`
  //   tam olarak bunu yapıyordu. Fırlayan istisna o yedeği ATLAYIP tüm hattı
  //   düşürüyordu ve kullanıcı şu mesajı görüyordu:
  //     "Yeni hat kurulamadı: gemini: Gemini error: 503 …"
  //   Model hizmeti geçici olarak yoğun olduğunda HAT BOZULMAZ; yalnız model
  //   katkısı olmaz. Bu yüzden ağ/sağlayıcı hatası da aynı yedeğe gider.
  let raw: string;
  try {
    raw = await callGemini(prompt, undefined, 0.2, false, undefined, deadlineAt);
  } catch (e) {
    console.log(
      `[discovery] gemini kısa liste çağrısı başarısız (${(e as Error).message.slice(0, 120)}); ` +
        `deterministik sıralamaya düşülüyor`,
    );
    return [];
  }
  const parsed = parseLooseJson(raw);

  // 1) YENİ SÖZLEŞME (§14): `{picks:[{productId,score,reasoning}]}`.
  //    `resolveSelection` yanıtı GERÇEK aday listesine karşı doğrular:
  //    listede olmayan `productId` halüsinasyondur ve REDDEDİLİR; dönen kayıt
  //    her zaman girdideki gerçek üründür (modelden başlık/fiyat/görsel
  //    kopyalanmaz). Yanıt bozuksa `products` boş döner ve sıradaki yedek çalışır.
  const resolved = resolveSelection(parsed, roster, {
    limit: Math.min(GEMINI_SHORTLIST_SIZE, candidates.length),
  });
  if (resolved.products.length) {
    if (resolved.rejected.length) {
      console.log(
        `[discovery] gemini seçimi doğrulaması: ${resolved.products.length} kabul, ` +
          `${resolved.rejected.length} reddedildi (${resolved.rejected
            .slice(0, 3)
            .map((r) => `${r.productId}: ${r.reason}`)
            .join(" | ")})`,
      );
    }
    return resolved.products.map((entry) => entry.product);
  }

  // 2) GERİYE UYUMLU SÖZLEŞME: `{picks:[1,2,3]}`. İndeksler de sınır dışıysa
  //    ve tekrarlıysa elenir; modelin sırası korunur.
  const legacy = parseLegacyIndexPicks(parsed, candidates);
  return legacy.map((index) => candidates[index - 1]).filter((p): p is NormalizedProduct => !!p);
}

/**
 * ESKİ (indeks tabanlı) model yanıtını güvenli biçimde okur.
 *
 * Sınır dışı indeks sessizce düşer (ürün uydurmak yerine atlamak); tekrar
 * eden indeks ilkiyle normalleştirilir. Bu yol yalnız geriye uyumluluk içindir:
 * yeni sözleşme `productId` üzerinden çalışır.
 */
export function parseLegacyIndexPicks(
  parsed: unknown,
  candidates: readonly NormalizedProduct[],
): number[] {
  const picks = (parsed as { picks?: unknown } | null | undefined)?.picks;
  if (!Array.isArray(picks)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of picks) {
    const index = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(index)) continue;
    if (index < 1 || index > candidates.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(index);
  }
  return out;
}

/**
 * Gemini istemi — DIŞA AKTARILIR çünkü sözleşmesi bir TEST ile kilitlenir.
 *
 * Uyarı buraya yazıldı çünkü bu hatta iki kez aynı sınıf hata düştü: isteme
 * "sadece numara listesi ver" yazıp doğrulayıcıdan `{"picks":[…]}` beklemek.
 * Model talimatı İZLEDİĞİ için hata değil, doğru davranışıydı — ve doğrulayıcı
 * onu reddedip hat sessizce yedeğe düşürüyordu. İstem ile doğrulayıcı aynı
 * söz dizimini konuşmalıdır.
 *
 * SÖZLEŞME (§14): model YALNIZ `productId` + `score` + `reasoning` üretir.
 * Ürün adı, fiyat, görsel ve adres YAZILMAZ — bunlar kaynaktan gelir. Modelin
 * uydurduğu bir `productId` doğrulamada elenir.
 */
export function buildShortlistPrompt(
  products: readonly NormalizedProduct[],
  niche: string,
  /**
   * Kullanıcının seçtiği arayüz dili. Verilmezse İngilizce'ye düşer; modelin
   * yazdığı `reasoning` (kart üzerinde okunan gerekçe) bu dilde üretilir.
   */
  lang?: string,
): string {
  // LİSTEDE productId YAZIYOR — sözleşme buna bağlı. İstem "productId dön"
  // diyor, doğrulayıcı da girdideki `productIdOf(p)` ile eşleştiriyor; kimlik
  // listede görünmüyorsa model uydurmak zorunda kalır ve doğrulayıcı her
  // seçimi eler (ölçülen hata: sıralı numara listesi varken model `1`, `7`
  // diyordu, yeni sözleşmeye geçince listede kimlik olmadığı için seçim
  // yapamıyordu). Satır NEREDEN GELİYOR diye: kaynak satırı, `productId` hattın
  // tamamında sabit kalır (§24).
  // Her satır GERÇEK kimliği ve ÖLÇÜLMÜŞ kalite sinyalini taşır (§11/§12):
  // model, az kanıtlı bir adayı zengin kanıtlı bir adayın önüne koymamalıdır.
  // `güven`/`bütünlük` uydurulmaz; kaynak+görsel+ölçüm durumundan türetilir.
  const roster = products
    .slice(0, GEMINI_SHORTLIST_SIZE)
    .map((p) => {
      const quality = candidateQuality(p);
      const price = p.priceUsd === null ? "" : ` · fiyat $${p.priceUsd.toFixed(2)}`;
      const rating = p.rating === null ? "" : ` · puan ${p.rating.toFixed(1)}`;
      return (
        `${productIdOf(p)} · ${p.name} · ön skor ${Math.round(p.preScore)} · ` +
        `kanıt ${p.dataCompleteness}/5 · bütünlük ${quality.completeness}/100 · ` +
        `güven ${quality.confidence}/100${price}${rating}`
      );
    })
    .join("\n");
  const want = Math.min(GEMINI_SHORTLIST_SIZE, products.length);
  return [
    `Sen bir e-ticaret ürün seçicisisin. Niş: "${niche}".`,
    `Aşağıdaki ${Math.min(products.length, GEMINI_SHORTLIST_SIZE)} adaydan ticari olarak EN GÜÇLÜ ${want}'ini seç.`,
    "Değerlendirme: talep kanıtı, rekabet doygunluğu, marj potansiyeli, ürün kalitesi.",
    "",
    "KESİN KURALLAR:",
    "- Yalnız aşağıdaki adaylardan birinin productId değerini kullan.",
    "- Yeni ürün üretme, listede olmayan kimlik yazma.",
    "- Fiyat, görsel, adres veya marka YAZMA; bunlar zaten ölçülmüştür.",
    "",
    "YANITINI SADECE geçerli JSON olarak ver, başka hiçbir metin yazma:",
    '{"picks":[{"productId":"<listelenen kimlik>","score":0,"reasoning":"<kısa gerekçe>"}]}',
    `picks içinde tam olarak ${want} farklı productId olsun, en güçlüden zayıfa doğru sıralansın.`,
    "",
    roster,
    outputLanguageDirective(lang, "reasoning"),
  ].join("\n");
}

/**
 * Model yanıtını JSON'a çevirir — model sıklıkla ```json bloğü veya ön/son
 * metin sarar. Katı `JSON.parse` başarısız olursa ilk `{...}` dilimini alır.
 */
export function parseLooseJson(text: string): unknown {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced?.[1]?.trim() ?? raw;
  try {
    return JSON.parse(body);
  } catch {
    const slice = /\{[\s\S]*\}/.exec(body);
    if (!slice) return null;
    try {
      return JSON.parse(slice[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Gemini ile kısa liste — ENJEKTE EDİLEBİLİR çağrı.
 *
 * Varsayılan implementasyon, kaynak kanıtı olmayan ürünleri öne alan
 * deterministik bir seçim yapar (Gemini erişilemezse yine de ilerlenebilsin
 * diye). Gerçek Gemini yanıtı route katmanından `geminiSelect` olarak
 * verilirse o kullanılır.
 */
export async function selectWithGemini(
  products: readonly NormalizedProduct[],
  niche: string,
  topN: number,
  geminiSelect?: (
    products: readonly NormalizedProduct[],
    niche: string,
  ) => Promise<NormalizedProduct[]>,
): Promise<{
  products: NormalizedProduct[];
  via: "gemini" | "fallback";
  geminiPicks: number;
}> {
  // Deterministik sıra: ön skor, sonra kanıt zenginliği, sonra kaynak sayısı.
  const ranked = [...products].sort(
    (a, b) =>
      b.preScore - a.preScore ||
      b.dataCompleteness - a.dataCompleteness ||
      b.sources.length - a.sources.length,
  );

  if (geminiSelect) {
    try {
      const selected = await geminiSelect(products, niche);
      if (selected.length) {
        // Gemini her zaman tam `topN` döndürmez (bütçe, hata, kısa yanıt).
        // DÖNMEDİĞİ adaylar deterministik sıradan TAMAMLANIR; aksi hâlde 25
        // istenirken 14 ajana 3 ürün giderdi ve hattın darboğazı modele
        // bağımlı hâle gelirdi. Modelin seçimi ÖNDE, yedekleme arkadadır.
        const out: NormalizedProduct[] = [...selected];
        const chosen = new Set(out);
        for (const p of ranked) {
          if (out.length >= topN) break;
          if (!chosen.has(p)) {
            out.push(p);
            chosen.add(p);
          }
        }
        return { products: out.slice(0, topN), via: "gemini", geminiPicks: selected.length };
      }
    } catch {
      // Gemini başarısız → deterministik seçime düş (aşağıda).
    }
  }
  // Yedek: ön skora göre ilk `topN`, ama kanıtı EN ZENGİN olan önce gelir.
  return { products: ranked.slice(0, topN), via: "fallback", geminiPicks: 0 };
}

/* ------------------------------------------------ Adım 3: 14 ajan derin analiz */

/** 14 ajanın oy topladığı sonuç. */
export async function runDeepAnalysisStep(
  products: readonly NormalizedProduct[],
  _niche: string,
  runCouncil: (products: readonly NormalizedProduct[]) => Promise<Consensus[]>,
): Promise<DiscoveryStepResult> {
  if (products.length === 0) {
    return {
      ok: true,
      status: "completed",
      products: [],
      consensus: [],
      next: "final",
      notes: ["Aday yok."],
    };
  }
  // Konsey TÜM kısa listeyi görür (75 → 25 → 5 sözleşmesi: 14 ajan Top 25'i
  // değerlendirir). Daha dar bir dilim oy çeşitliliğini yapay olarak daraltıyordu.
  const councilInput = products.slice(0, GEMINI_SHORTLIST_SIZE);
  const consensus = await runCouncil(councilInput);
  return {
    ok: true,
    status: "deep_analysis",
    products: [...products],
    consensus,
    next: "final",
    notes: [
      `14 ajan ${councilInput.length} adayı değerlendirdi; havuzun tamamı ${products.length} adaydı.`,
    ],
  };
}

/* -------------------------------------------------- Adım 4: final rank (Top5) */

/**
 * Nihai kalite puanı — SIRALAMA anahtarı.
 *
 * Konsey oyu ağırlıklıdır; güven ve ölçülmüş kanıt derinliği düzelticidir.
 * Ürün kaydı yoksa (eski gövde) kanıt payı 0 sayılır ve sıra konsey oyuna
 * göre kalır — yani "bakamadığımız için" sıralama bozulmaz.
 */
export function winnerQualityScore(
  row: { councilScore: number; confidenceScore?: number },
  product?: { dataCompleteness?: number; launch?: { launchable?: boolean } | null } | null,
): number {
  const council = Math.max(0, Math.min(100, row.councilScore ?? 0));
  const confidence = Math.max(0, Math.min(100, row.confidenceScore ?? 0));
  const completeness = Math.max(0, Math.min(5, Number(product?.dataCompleteness ?? 0)));
  const evidence = (completeness / 5) * 100;
  // ATILABİLİRLİK EK TERİMİ: kapıları geçen ürün, eşit oyda ve eşit kanıtta
  // öne geçer. Ölçüm yoksa 0'dır — sıralama eskisiyle birebir aynı kalır.
  const launchBonus = product?.launch?.launchable === true ? WINNER_LAUNCH_BONUS : 0;
  return Math.min(
    100,
    council * WINNER_SCORE_WEIGHTS.council +
      confidence * WINNER_SCORE_WEIGHTS.confidence +
      evidence * WINNER_SCORE_WEIGHTS.evidence +
      launchBonus,
  );
}

/**
 * Kalite kapısı — "bu satır kazanan olarak sunulabilir mi?".
 *
 * İki eşik birlikte çalışır: çok düşük konsey oyu (kanıt ne olursa olsun)
 * elenir; vasat konsey oyu ise YALNIZ kanıt zayıfsa elenir. Ürün kaydı hiç
 * yoksa eleme yapılmaz (kanıt yokluğu değil, kaydın taşınmaması söz konusu).
 */
export function isWinnerWorthy(
  row: { councilScore: number },
  product?: { dataCompleteness?: number } | null,
): boolean {
  if (!product) return true;
  if (row.councilScore < WINNER_MIN_COUNCIL_SCORE) return false;
  const completeness = Number(product.dataCompleteness ?? 0);
  if (row.councilScore < WINNER_MIN_COUNCIL_SCORE_WEAK_EVIDENCE && completeness <= 2) return false;
  return true;
}

/**
 * Uzlaşmaya göre nihai en iyi 5 ürünü seçer ve 'completed' durumunu verir.
 *
 * KRİTİK (arayüzun gördüğü veri): `consensus` kaydı ürünün KENDİSİ değildir;
 * yalnız oy skorlarını taşır. Kullanıcıya ürünü göstermek için fiyat, marka,
 * görsel ve kanıt bağlantısı gerekir. Bu yüzden uzlaşma satırları
 * `productsById` (fingerprint → ürün) ile BİRLEŞTİRİLİR ve kazanan ürünler
 * `products` alanında döner. Ölçek eşleşmezse (ör. eski bir `final` gövdesi)
 * ürün boş kalır ama HAT ÇÖKMEZ — consensus yine döner.
 */
export function runFinalRankStep(
  consensus: readonly Consensus[],
  topN = 5,
  productsById?: ReadonlyMap<string, NormalizedProduct>,
): DiscoveryStepResult {
  const productOf = (row: Consensus): NormalizedProduct | undefined =>
    productsById?.get(row.candidateId);
  const qualityOf = (row: Consensus): number => winnerQualityScore(row, productOf(row));

  // Sıralama: kalite puanı DESC, eşitlikte councilScore, sonra confidenceScore.
  const ranked = [...consensus].sort(
    (a, b) =>
      qualityOf(b) - qualityOf(a) ||
      b.councilScore - a.councilScore ||
      b.confidenceScore - a.confidenceScore,
  );
  const candidates = ranked.slice(0, topN);

  // KALİTE KAPISI: kanıtı olmayan + ajanların düşük puanladığı satır kazanan
  // diye sunulmaz. Kapı listeyi BOŞALTMAZ: en az `MIN_DELIVERED_WINNERS`
  // kazanan (varsa) geri alınır — kullanıcıyı boş ekranla bırakmak, aday
  // havuzu zayıfken dördüncü sıraya zayıf bir ürün koymaktan kötüdür.
  const worthy = candidates.filter((row) => isWinnerWorthy(row, productOf(row)));
  const floor = Math.min(MIN_DELIVERED_WINNERS, candidates.length);
  // KURTARMA KÜMESİ: kapıdan geçmeyip yalnız "liste boş kalmasın" diye gösterilen
  // satırlar ayrıca işaretlenir. NEDEN GÖRÜNÜR: denetim raporunun P0 bulgusu,
  // kapıdan geçmeyen bir adayın kapıdan geçmiş gibi AYNI kartla sunulmasıydı;
  // kullanıcı, kaydın neden listede olduğunu göremiyordu.
  const rescuedRows = new Set<Consensus>();
  let winners = worthy;
  if (winners.length < floor) {
    // Kalite kapısı çok sert kaldıysa liste boş kalmaz; en az 1 ürün her zaman
    // teslim edilir (varsa). Kurtarma adayları zaten kalite sırasına göre
    // dizilmiş `candidates`ten seçilir, sonra liste YENİDEN SIRALANIR: aksi
    // hâlde kapıdan geçen 5. sıradaki ürün, kurtarılan 1. sıradaki ürünün
    // önüne geçerdi (kapı, sıralamayı değiştirmemeli).
    const rescued = candidates.filter((row) => !worthy.includes(row));
    const taken = rescued.slice(0, floor - worthy.length);
    for (const row of taken) rescuedRows.add(row);
    winners = [...worthy, ...taken].sort((a, b) => qualityOf(b) - qualityOf(a));
  }
  const gatedOut = candidates.length - worthy.length;
  const rescuedCount = winners.length - worthy.length;
  const products = productsById
    ? winners
        .map((row) => {
          const product = productsById.get(row.candidateId);
          if (!product) return null;
          // Konsenyus skoru ürünün ÜZERİNE yazılır: arayüz tek listede hem
          // ürünü hem 14 ajan puanını görür, ayrı birleştirme adımı gerekmez.
          return {
            ...product,
            councilScore: row.councilScore,
            confidenceScore: row.confidenceScore,
            votes: row.votes,
            agreement: row.coverage,
            evidence: row.evidence.slice(0, 6),
            // KALİTE KAPISI DURUMU — arayüz "bu kayıt neden listede?" sorusunu
            // yanıtlar: `passed` = eşiği geçti, `rescued` = yalnız liste boş
            // kalmasın diye gösteriliyor (kullanıcıya açıkça yazılır).
            qualityGate: rescuedRows.has(row) ? ("rescued" as const) : ("passed" as const),
          } as unknown as NormalizedProduct;
        })
        .filter((p): p is NormalizedProduct => p !== null)
    : [];
  const missing = winners.length - products.length;
  return {
    ok: true,
    status: "completed",
    products,
    consensus: winners,
    next: "",
    notes: [
      `${winners.length} ürün nihai listeye girdi (ortalama kalite puanı ${Math.round(
        winners.length ? winners.reduce((sum, row) => sum + qualityOf(row), 0) / winners.length : 0,
      )}).`,
      ...(gatedOut > 0
        ? [
            `${gatedOut} aday kalite kapısına takıldı (kanıtsız/düşük oy)` +
              (rescuedCount > 0
                ? `; ${rescuedCount} tanesi liste boş kalmasın diye geri alındı ve kartta "kalite kapısı altı" olarak işaretlendi.`
                : "."),
          ]
        : []),
      ...(missing > 0
        ? [`${missing} kazananın ürün kaydı taşınmadı (sadece oy satırı geldi).`]
        : []),
    ],
  };
}

/* ------------------------------------------------------ Durum geçiş doğrulama */

/**
 * Bir adımın meşru bir geçiş yapıp yapmadığını doğrular.
 * Geçersiz geçişte `false` döner (adım çalıştırılmaz).
 */
export function transitionAllowed(
  from: ProductDiscoveryStatus,
  to: ProductDiscoveryStatus,
): boolean {
  return canTransition(from, to);
}
