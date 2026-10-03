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
  type TopProduct,
} from "./product-discovery.types";

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
 * burada değişen şey SIRALAMADIR. Eşit konsey oyunda daha güvenilir ve daha
 * çok ölçülmüş kanıt taşıyan ürün öne geçer. Kanıt ağırlığı bilerek küçüktür:
 * "çok alanı dolu" tek başına iyi ürün demek değildir, ama eşitlikte kazananı
 * belirleyebilmelidir.
 */
export const WINNER_SCORE_WEIGHTS = { council: 0.85, confidence: 0.1, evidence: 0.05 } as const;

/** Bu oyun altındaki aday, kanıtı da zayıfsa "kazanan" olarak sunulmaz. */
export const WINNER_MIN_COUNCIL_SCORE = 22;
/** Kanıtı zayıf (<= 2/5) adayın geçmesi için gereken daha yüksek oy tabanı. */
export const WINNER_MIN_COUNCIL_SCORE_WEAK_EVIDENCE = 33;
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
): TopProductsPayload {
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
        ? "Trend kanıtı yok (ölçülmedi)"
        : `Trend gücü ${demand}/100${p.confidenceScore !== undefined ? ` · güven ${Math.round(p.confidenceScore)}` : ""}`,
    );
    // 2) KAR & FİYAT
    const price = typeof p.priceUsd === "number" && Number.isFinite(p.priceUsd) ? p.priceUsd : null;
    parts.push(
      margin === null
        ? "Fiyat bandı ölçülmedi"
        : `Marj skoru ${margin}/100${price === null ? "" : ` · fiyat $${price}`}`,
    );
    // 3) REKABET
    parts.push(
      competition === null
        ? "Rekabet ölçülmedi"
        : competition >= 60
          ? `Rekabet düşük (${competition}/100) — doygunluk yok`
          : `Rekabet yüksek (${competition}/100) — niş doymuş`,
    );
    // 4) KANIT DERİNLİĞİ — gerekçeyi "iyi görünüyor"dan "şu kadar ölçüldü"ye
    //    çevirir. Yalnız ÖLÇÜLMÜŞ sayılar yazılır; alan yoksa eklenmez.
    if (completeness !== null) parts.push(`Kanıt ${Math.round(completeness)}/5 dolu`);
    if (sourceCount > 1) parts.push(`${sourceCount} kaynak doğruladı`);

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
      title: (p.title ?? p.name ?? "").trim() || "İsimsiz ürün",
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
  const { buildShortlist, salvageShortlist } = await import("./product-discovery-shortlist.server");

  // 1) Kaynaklar (fail-soft, paralel, kaynak başına tavan — dilime kırpılır).
  const { products: raw, reports } = await runSources(niche, undefined, {
    capMs: opts.sourceCapMs,
    // GLOBAL SaaS: kaynaklar hedef ülkenin YEREL pazaryerine bakar
    // (bkz. `MARKETPLACES_BY_COUNTRY`). Ülke boşsa kaynaklar kendi
    // varsayılanına döner — eski davranış korunur.
    country,
  });

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
  // GÖRSEL KAPI NEDEN KAPALI — canlıda açmak hatı boşaltırdı:
  // `requireImage` varsayılan olarak `true` gelir, ama HİÇBİR kaynak
  // `imageUrl` üretmiyor (kazıyıcılar fotoğrafı değil ürün sayfasını
  // getiriyor). Kapı açık kalsaydı 75 ürünün TAMAMI elenir ve Gemini
  // aşamasına boş liste giderdi. Kaynaklar görsel alanını doldurmaya başladığında
  // bu değer `true`'ya çevrilebilir; o ana kadar ölçülmemiş görsel nedeniyle
  // ürün kaybetmek, hattı çalıştırmaktan daha kötüdür.
  const built = buildShortlist(raw, {
    limit: topN,
    context: { nicheMomentumPct, nicheEngagement },
    perSource,
    requireImage: false,
  });
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

  const notes: string[] = [
    `İlk aşama (saf kod): ${stats.inputCount} ham satır → ${survivors.length} ürün ` +
      `(${Buffer.byteLength(JSON.stringify(products), "utf8")} bayt, 7 alan).`,
  ];
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
    notes,
  };
}

/* ---------------------------------------------- Adım 2: Gemini shortlist (25) */

/**
 * Top-75 listesinden Gemini ile en iyi 25 adayı seçer.
 *
 * 25 NEDEN (ve neden 15 değil): 14 ajan konsesinde oy çeşitliliği, aday
 * sayısıyla artar — 15 adayda her ajan aynı 15 ürüne yoğunlaşıp oy
 * dağılımını yapay biçimde daraltıyordu. 25 aday, Top-5 seçimi için hem
 * yeterli çeşitlilik hem de maliyet açısından hâlâ ucuz (TEK Gemini çağrısı).
 */export const GEMINI_SHORTLIST_SIZE = 12;
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
  geminiSelect: (
    products: readonly NormalizedProduct[],
    niche: string,
  ) => Promise<NormalizedProduct[]> = geminiShortlistSelector,
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
  const {
    products: shortlist,
    via: shortlistVia,
    geminiPicks,
  } = await selectWithGemini(products, niche, topN, geminiSelect);
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
      shortlistVia === "gemini"
        ? `Gemini ${products.length} → ${shortlist.length} aday seçti ` +
          `(${geminiPicks} seçim modelden, ${shortlist.length - geminiPicks} deterministik yedekleme).`
        : `deterministik yedek ${products.length} → ${shortlist.length} aday seçti.`,
      ...(shortlistVia === "gemini"
        ? []
        : ["Gemini çağrısı yapılmadı; ön skor sıralaması kullanıldı."]),
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
): Promise<NormalizedProduct[]> {
  const { callGemini } = await import("./ai.server");
  const { z } = await import("zod");

  // DİKKAT: istem ile doğrulayıcı AYNI SÖZDİZİMİNİ konuşmalıdır.
  // Önceki sürüm isteme "sadece numara listesi ver" yazıyor, doğrulayıcı ise
  // yalnız `{"picks":[...]}` kabul ediyordu. Model talimatı izleyince (yani
  // DÜZGÜN çalışınca) yanıt doğrulamadan düşüyor ve hat sessizce yedeğe
  // kayıyordu — yani Gemini hiçbir zaman seçim yapamıyordu.
  const prompt = buildShortlistPrompt(products, niche);

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
  const Parsed = z.object({
    picks: z.array(z.number().int().min(1).max(Math.min(products.length, GEMINI_SHORTLIST_SIZE))).min(1).max(12),
  });
  const parsed = Parsed.safeParse(parseLooseJson(raw));
  if (!parsed.success) return [];

  // Geçersiz/tekrar eden indeksler elenir; model sırası korunur.
  const seen = new Set<number>();
  const picked: NormalizedProduct[] = [];
  for (const index of parsed.data.picks) {
    if (seen.has(index)) continue;
    seen.add(index);
    const product = products[index - 1];
    if (product) picked.push(product);
  }
  return picked;
}

/**
 * Gemini istemi — DIŞA AKTARILIR çünkü sözleşmesi bir TEST ile kilitlenir.
 *
 * Uyarı buraya yazıldı çünkü bu hatta iki kez aynı sınıf hata düştü: isteme
 * "sadece numara listesi ver" yazıp doğrulayıcıdan `{"picks":[…]}`
 * beklemek. Model talimatı İZLEDİĞİ için hata değil, doğru davranışıydı —
 * ve doğrulayıcı onu reddedip hat sessizce yedeğe düşürüyordu. İstem ile
 * doğrulayıcı aynı söz dizimini konuşmalıdır.
 */
export function buildShortlistPrompt(
  products: readonly NormalizedProduct[],
  niche: string,
): string {
  const roster = products
    .slice(0, GEMINI_SHORTLIST_SIZE)
    .map((p, i) => `${i + 1}. ${p.name} (ön skor ${p.preScore}, kanıt ${p.dataCompleteness}/5)`)
    .join("\n");
  const want = Math.min(GEMINI_SHORTLIST_SIZE, products.length);
  return [
    `Sen bir e-ticaret ürün seçicisisin. Niş: "${niche}".`,
    `Aşağıdaki ${Math.min(products.length, GEMINI_SHORTLIST_SIZE)} adaydan ticari olarak EN GÜÇLÜ ${want}'ini seç.`,
    "Değerlendirme: talep kanıtı, rekabet doygunluğu, marj potansiyeli, ürün kalitesi.",
    "",
    "YANITINI SADECE geçerli JSON olarak ver, başka hiçbir metin yazma:",
    '{"picks":[1,7,3]}',
    `picks içinde tam olarak ${want} farklı indeks olsun, en güçlüden zayıfa doğru sıralansın.`,
    "",
    roster,
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
  const councilInput = products.slice(0, 12);
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
  product?: { dataCompleteness?: number } | null,
): number {
  const council = Math.max(0, Math.min(100, row.councilScore ?? 0));
  const confidence = Math.max(0, Math.min(100, row.confidenceScore ?? 0));
  const completeness = Math.max(0, Math.min(5, Number(product?.dataCompleteness ?? 0)));
  const evidence = (completeness / 5) * 100;
  return (
    council * WINNER_SCORE_WEIGHTS.council +
    confidence * WINNER_SCORE_WEIGHTS.confidence +
    evidence * WINNER_SCORE_WEIGHTS.evidence
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
  let winners = worthy;
  if (winners.length < floor) {
    // Kalite kapısı çok sert kaldıysa liste boş kalmaz; en az 1 ürün her zaman
    // teslim edilir (varsa). Kurtarma adayları zaten kalite sırasına göre
    // dizilmiş `candidates`ten seçilir, sonra liste YENİDEN SIRALANIR: aksi
    // hâlde kapıdan geçen 5. sıradaki ürün, kurtarılan 1. sıradaki ürünün
    // önüne geçerdi (kapı, sıralamayı değiştirmemeli).
    const rescued = candidates.filter((row) => !worthy.includes(row));
    winners = [...worthy, ...rescued.slice(0, floor - worthy.length)].sort(
      (a, b) => qualityOf(b) - qualityOf(a),
    );
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
        winners.length
          ? winners.reduce((sum, row) => sum + qualityOf(row), 0) / winners.length
          : 0,
      )}).`,
      ...(gatedOut > 0
        ? [
            `${gatedOut} aday kalite kapısına takıldı (kanıtsız/düşük oy)` +
              (rescuedCount > 0
                ? `; ${rescuedCount} tanesi liste boş kalmasın diye geri alındı.`
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
