// ============================================================================
// PRODUCT DISCOVERY — TİPLER, ŞEMALAR, PARMAK İZİ.
//
// Bu katman SAF'tır: ağ çağrısı yapmaz, veritabanına dokunmaz, AI çağırmaz.
// Kazıma → filtreleme → Gemini → 14 ajan → sıralama zincirinin her adımı
// bu tipleri konuşur; böylece adımlar birbirinden bağımsız test edilebilir.
//
// TASARIM KURALI — $0 MALİYET:
//   AI yalnız İKİ yerde çağrılır: `gemini_shortlist` (Top 75 → 15) ve
//   `deep_analysis` (14 ajan). Ön filtreleme ve ön sıralama TAMAMEN
//   deterministiktir; 60 adaydan 15'e inerken model hiç devreye girmez.
//
// DÜRÜSTLÜK KURALI:
//   Ölçülmemiş alan `null`/boş kalır ve puanlamada nötr (50) karşılığına
//   düşer. Sıfır "ölçtük ve sıfır bulduk" anlamına gelmez; bu yüzden
//   `unknown` sayacı ayrı tutulur ve confidence hesabında kullanılır.
// ============================================================================

import { z } from "zod";

/* ------------------------------------------------------------- Raw product */

/** Bir kaynaktan GELEN, henüz normalize edilmemiş ham satır. */
export const RawProductSchema = z.object({
  /** Kaynağın verdiği ham başlık. */
  title: z.string().min(1),
  /** Marka adı (boş olabilir — uydurulmaz). */
  brand: z.string().default(""),
  /** Satıcı / mağaza adı. */
  seller: z.string().default(""),
  /** Fiyat (USD). `null` = fiyat bilgisi yok. */
  priceUsd: z.number().nullable().default(null),
  /** 0-5 puanlı kullanıcı puanı. `null` = ölçülmedi. */
  rating: z.number().min(0).max(5).nullable().default(null),
  /** Kaç kişi puan vermiş. `null` = ölçülmedi. */
  ratingCount: z.number().int().min(0).nullable().default(null),
  /** Stokta mı? `null` = bilinmiyor. */
  inStock: z.boolean().nullable().default(null),
  /** Bu satırı hangi kaynak üretti (hata ayıklama + çeşitlilik ölçümü). */
  source: z.string().default(""),
  /** Satırın kanıt adresi (varsa) — ajan "kanıtı gör" diyebilir. */
  url: z.string().default(""),
  /** Serbest metin: nişe özgü ham sinyal (şikâyet, hype, trend notu…). */
  notes: z.string().default(""),
  /**
   * KAÇ KİŞİ BU ÜRÜNÜ GÖRDÜ (90 günlük pencere). `null` = ölçülmedi.
   *
   * Neden ayrı alan, `notes` içinde bırakmadık: talep puanı bu sayıya BAKAR.
   * Metinden geri ayrıştırmak kırılgan olurdu (aynı sayı "1K+", "1,204"
   * veya "842" olarak yazılabilir). Kaynak sayıyı ölçer, biz karşılaştırırız.
   *
   * SADECE Aynı koşu içinde karşılaştırılır: 1K görüntülenme bir air fryer
   * için güçlü, bir drone için zayıf sinyaldir. Mutlak değer değil, kohort
   * içi sıra anlamlıdır.
   */
  viewed90d: z.number().int().min(0).nullable().default(null),

  /**
   * KAYNAK SATIRININ KENDİ KİMLİĞİ. Boş olabilir — çoğu kaynak vermez.
   * Verildiğinde `gemini_shortlist` yamasına geri izlenebilir adres olarak
   * taşınır; verilmezse kısa liste üretirken parmak izinden türetilir.
   */
  id: z.string().default(""),
  /**
   * MAĞAZANIN VERDİĞİ KATEGORİ ("Elektronik > Küçük Ev Aletleri"). Boş olabilir.
   * ÖNEMLİ: bu alan kanıt YUVASI DEĞİLDİR (bkz. `EVIDENCE_SLOTS`), çünkü
   * kategorisi olmayan ama satan bir ürün de ölçülmüş bir üründür.
   */
  category: z.string().default(""),
  /**
   * ÜRÜN GÖRSELİ URL'Sİ. Boş olabilir (`default("")`), ama ilk aşama kalite
   * kapısı (`product-discovery-shortlist.server.ts`) görselsiz satırı eler:
   * görseli olmayan ürün vitrinde boş kutu olarak görünür.
   */
  imageUrl: z.string().default(""),
  /**
   * SATIŞ ADEDİ (dönemsel hacim). `null` = ölçülmedi.
   * `viewed90d` "kaç kişi gördü"yse bu "kaçı aldı"dır; ikisi karıştırılmaz.
   */
  salesVolume: z.number().int().min(0).nullable().default(null),
});
/**
 * Kaynakların döndürdüğü HAM şekil.
 *
 * BILEREK `z.input` (çıktı değil): bir kaynak yalnız gerçekten ölçebildiği
 * alanları yazmalıdır. Çıkı tipi (`z.infer`) kullanılsaydı her kaynak
 * `viewed90d: null` gibi on alanı da yazmak zorunda kalırdı — ölçmediğini
 * yazmak zorunda olmak, ölçtüğünü sandırma riskini artırır.
 * Varsayılanları `RawProductSchema.parse()` doldurur.
 */
export type RawProduct = z.input<typeof RawProductSchema>;

/** `RawProductSchema.parse()` sonrası, varsayılanları DOLMUŞ ham satır. */
export type ParsedRawProduct = z.infer<typeof RawProductSchema>;

/* ------------------------------------------------------- NormalizedProduct */

/**
 * Tüm kaynakların ORTAK diline indirgenmiş ürün.
 *
 * `source` alanı "bu satır gerçekten ölçüldü mü" ayrımını taşır: `scraped`
 * olan satırda fiyat/puan gerçek bir sayfadan gelmiştir. AI üreten satırlar
 * (`ai`) bilinçli olarak AYRI işaretlenir ve kalite kapısından geçemez —
 * böylece modelin uydurduğu bir ürün sonuç listesine sızmaz.
 */
export const NormalizedProductSchema = z.object({
  /** Kaynak başlığından türetilmiş temiz ad. */
  name: z.string().min(1),
  brand: z.string().default(""),
  seller: z.string().default(""),
  category: z.string().default(""),

  priceUsd: z.number().nullable().default(null),
  rating: z.number().min(0).max(5).nullable().default(null),
  ratingCount: z.number().int().min(0).nullable().default(null),
  inStock: z.boolean().nullable().default(null),

  /** Bu ürünü hangi kaynak(lar) buldu — çakışma tespiti için. */
  sources: z.array(z.string()).default([]),
  url: z.string().default(""),
  notes: z.string().default(""),
  /** 90 günlük görüntülenme (ölçüldüyse). `signals.demand` bunu kullanır. */
  viewed90d: z.number().int().min(0).nullable().default(null),

  /** Kaynak satırının kimliği (yoksa kısa listede parmak izinden türetilir). */
  id: z.string().default(""),
  /** Ürün görseli URL'si — ilk aşama kalite kapısı bunu zorunlu tutar. */
  imageUrl: z.string().default(""),
  /** Satış adedi (ölçüldüyse). `null` = ölçülmedi. */
  salesVolume: z.number().int().min(0).nullable().default(null),

  /**
   * Tekilleştirme anahtarı: normalize başlık + marka + satıcı.
   * Aynı `fingerprint` = aynı ürün (farklı yazım/boşluk/aksan/büyük harf).
   */
  fingerprint: z.string(),

  /**
   * Deterministic ön skor (0-100). AI YOK — saf kural tabanlı.
   * Bileşenler `signals` içinde ayrı ayrı saklanır ki panel gerekçe gösterebilsin.
   */
  preScore: z.number().min(0).max(100).default(0),
  /** Skorun hangi kanıta dayandığı (eksik alanlar burada görünür). */
  signals: z
    .object({
      demand: z.number().min(0).max(100).default(50),
      competition: z.number().min(0).max(100).default(50),
      margin: z.number().min(0).max(100).default(50),
      rating: z.number().min(0).max(100).default(50),
      availability: z.number().min(0).max(100).default(50),
    })
    .default({
      demand: 50,
      competition: 50,
      margin: 50,
      rating: 50,
      availability: 50,
    }),
  /**
   * Kaç zorunlu alan GERÇEKTEN ölçüldü (0-5). Eksik veri cezası buradan
   * uygulanır: 5/5 ölçülmüş ürün, 1/5 ölçülmüş üründen daha güvenilirdir.
   */
  dataCompleteness: z.number().min(0).max(5).default(0),
  /** Ölçülmemiş alan adları — panelde "bu puan neden emin değil" gösterir. */
  missingFields: z.array(z.string()).default([]),

  source: z.enum(["scraped", "ai"]).default("scraped"),
});
export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

/* ------------------------------------------------------------ Fingerprint */

/**
 * Parmak izi üreticisi — normalize başlık + marka + satıcı.
 *
 * Neden üçü birden: aynı ürünü iki mağaza satabilir (`seller` farklı) ama
 * aynı ürünün "Air Fryer 5.5L" / "air  fryer  5.5 lt" yazımları aynıdır.
 * Yalnız başlığa bakmak "5L"↔"5 litre" kopyalarını kaçırır, yalnız satıcıya
 * bakmak her ürünü birleştirirdi. Birimleri (lt/l/oz/inch/cm) sadeleştirmek,
 * marka ve satıcıyı da içine almak iki hatanın ortasını bulur.
 */
export function productFingerprint(input: {
  title: string;
  brand?: string;
  seller?: string;
}): string {
  const base = (s: string) =>
    String(s ?? "")
      .toLocaleLowerCase("tr-TR")
      .replace(/ı/g, "i")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");

  // Ölçü birimlerini tek karşılığa indir (5lt / 5 l / 5 litre → 5l).
  const units = (s: string) =>
    s
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(litre|liter|liters|lt|l)\b/g, "$1l")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(inch|inches|in|")\b/g, "$1in")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(cm|centimet(?:er|re)s?)\b/g, "$1cm")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(mm|millimet(?:er|re)s?)\b/g, "$1mm")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(kg|kilogram(?:s|me|lar|ları)?)\b/g, "$1kg")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(g|gram(?:s|me|lar|ları)?)\b/g, "$1g")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(oz|ounce(?:s)?)\b/g, "$1oz")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(w|watts?|watt)\b/g, "$1w")
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(mah)\b/g, "$1mah")
      .replace(/\s+/g, " ")
      .trim();

  return [units(base(input.title)), base(input.brand ?? ""), base(input.seller ?? "")]
    .filter(Boolean)
    .join("|");
}

/**
 * Model kodu anahtarı — `productFingerprint`in YAKALAMADIĞI kopyaları yakalar.
 *
 * Sorun: fingerprint TAM normalize başlığı gömer. Aynı ürünün iki mağaza
 * yazımı farklı olduğunda (canlı ölçüm — "CASABREWS CM5418 Compact Espresso
 * Machine With Milk Frother" / "Casabrews CM5418 20 Bar Espresso Machine And
 * Coffee Maker") iki ayrı ürün sanılır ve NİHAİ 5'LİK LİSTEYE İKİ KEZ GİRER.
 * Gerçek ayırt edici model kodu (CM5418), oysa o iki başlıkta aynı.
 *
 * ÖLÇÜLEN İKİNCİ KAÇIRMA (canlı E2E, "robot vacuum" koşusu): nihai listede
 * "Roborock Q7 L5 … 8,000 Pa" İKİ KEZ göründü. Sebep: model kodu "Q7" ve "L5"
 * olarak İKİ AYRI kelime yazılmış; eski desen `[A-Z]\d{2,6}` yalnız bitişik
 * kodları (CM5418) yakaladığı için 0 kod buldu → anahtar üretilmedi → iki
 * farklı yazımdaki aynı ürün ayrı sayıldı. Artık birbirine bitişik kodlar
 * (boşlık/tireyle ayrılmış) TEK model kodu sayılır: "Q7 L5" → "Q7L5".
 *
 * Kural BİLEREK MUHAFAZAKÂR — yanlış birleştirme, kaçırılan kopyadan çok
 * daha kötüdür (iki farklı ürünü birbirine karıştırır):
 *   • Anahtarda HARFLE başlayan kodlar sayılır (CM5418, L10S, AF100, Q7L5).
 *     Rakamla başlayanlar SAYILMAZ: "8000 PA", "10,000Pa", "20 BAR"
 *     ölçü/spec'tir, model kodu değildir.
 *   • Bitişiklik şartı korunur: "Dreame L10s with S20" iki AYRI koddur
 *     ("with" aralarında kelime var) → belirsiz → eşleştirme yapılmaz.
 *   • Marka boşsa anahtar üretilmez.
 *   • Başlıkta TAM OLARAK bir model kodu yoksa anahtar üretilmez (belirsiz
 *     başlık hiçbir eşleştirmeye giremez).
 */
export function productModelKey(input: { title: string; brand?: string }): string {
  const brand = productFingerprint({ title: input.brand ?? "" });
  if (!brand) return "";

  const title = String(input.title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const codes = new Set<string>();
  // BİRİBİRİNE BİTİŞİK kodlar tek model kodu sayılır: "Q7 L5" → "Q7L5".
  // Aralarında kelime varsa biteşiklik bozulur → ayrı kod → belirsiz.
  for (const m of title.matchAll(
    /\b([A-Z]{1,5}\d{1,6}[A-Z]{0,2}(?:[\s-]+[A-Z]{1,5}\d{1,6}[A-Z]{0,2})*)\b/g,
  )) {
    codes.add(m[1].replace(/[^A-Z0-9]/g, ""));
  }
  // 0 kod → belirsiz. 1'den fazla kod → hangisi model kodu belirsiz.
  if (codes.size !== 1) return "";
  return `${brand}|${[...codes][0]}`;
}

/** Başlıktan marka tahmini — UYDURMA YAPMAZ, bilinmiyorsa boş döner. */
export function inferBrand(title: string, known?: readonly string[]): string {
  const t = productFingerprint({ title });
  if (!t) return "";
  for (const brand of known ?? []) {
    const b = productFingerprint({ title: brand });
    if (b && t.startsWith(`${b} `)) return brand;
  }
  // Marka genelde ilk büyük harfli kelimedir; ama emin olamayız → işaretle.
  const first =
    String(title ?? "")
      .trim()
      .split(/\s+/)[0] ?? "";
  return /^[A-Z][A-Za-z0-9]{1,20}$/.test(first) ? first : "";
}

/* -------------------------------------------------------------- Job status */

/**
 * İş durumları — QStash adımları arasında taşınır.
 *
 * `gemini_shortlist` ve `deep_analysis` AI içerir; `filtering` ve
 * `scraping` saf koddur. Bu ayrım, "$0 maliyet kuralı"nın denetlenebilir
 * olmasını sağlar: AI harcaması yalnız bu iki durumda mümkündür.
 */
export const PRODUCT_DISCOVERY_STATUSES = [
  "queued",
  "scraping",
  "filtering",
  "gemini_shortlist",
  "deep_analysis",
  "completed",
  "failed",
] as const;
export type ProductDiscoveryStatus = (typeof PRODUCT_DISCOVERY_STATUSES)[number];

export const ProductDiscoveryStatusSchema = z.enum(PRODUCT_DISCOVERY_STATUSES);

/** Durum geçişleri — istenmeyen sıçramaları ve çift tamamlamayı engeller. */
export const PRODUCT_DISCOVERY_TRANSITIONS: Record<
  ProductDiscoveryStatus,
  readonly ProductDiscoveryStatus[]
> = {
  queued: ["scraping", "failed"],
  // KENDİNE GEÇİŞLER (`scraping → scraping`, `gemini_shortlist →
  // gemini_shortlist`, `deep_analysis → deep_analysis`) YALNIZ KİLİT TAZELEME
  // İÇİNDİR ve ZORUNLUDUR.
  //
  // Ölçülen hata: yarıda ölen bir adım geri alınıp yeniden başlatılıyordu
  // (`running → start`), ama bu geri geçişler durum makinesinde TANIMLI
  // DEĞİLDİ. Sonuç: `canTransition` geri almayı reddediyor, kilit
  // tazelenemiyor ve ölü adım 20 dakikalık watchdog kapanana kadar
  // KURTARILAMIYORDU — kullanıcı "dönüyor ama sonuç yok" görüyordu. Kendine
  // geçiş, kilidi atomik olarak tazeler (`WHERE discovery_status = _from`),
  // durumu İLERLETMEZ ve terminal yazımı yine `finishDiscoveryJob`a bırakır.
  scraping: ["scraping", "filtering", "failed"],
  filtering: ["gemini_shortlist", "failed"],
  gemini_shortlist: ["gemini_shortlist", "deep_analysis", "completed", "failed"],
  // `deep_analysis → deep_analysis` KENDİNE GEÇİŞTİR ve ZORUNLUDUR.
  //
  // Ölçülen hata: `final` adımının hem başlangıç hem çalışma durumu
  // `deep_analysis`'tir (adım satırı `completed` yapmadan önce ayrı bir duruma
  // geçmez). Sahiplenme CAS ile yapıldığı için `canTransition` bu geçişi
  // reddediyor → `final` adımı HİÇ ÇALIŞMIYOR, hep "başka biri koşuyor"
  // sanılıp atlanıyordu. Zincir üç adımda bitiyor, dördüncü adım hiç
  // başlamıyor ve iş `processing`e KALICI takılıyordu. Kullanıcının ekranda
  // "Analiz sunucuda çalışmaya devam ediyor" yazısını YARIM SAAT gördüğü
  // durum tam olarak budur.
  //
  // Neden güvenli: veritabanı RPC'si `WHERE discovery_status = _from` ile
  // çalıştığı için bu geçiş de atomiktir; satır zaten `completed`/`failed`
  // olduysa CAS reddedilir. Sonucun bir kez yazılması ayrıca
  // `finish_discovery_job` tarafından garanti edilir. Yani kendine geçiş
  // zinciri BİTİRMEZ, yalnızca kilidin alınabilmesini sağlar.
  deep_analysis: ["deep_analysis", "completed", "failed"],
  completed: [],
  failed: [],
};

export function canTransition(from: ProductDiscoveryStatus, to: ProductDiscoveryStatus): boolean {
  return PRODUCT_DISCOVERY_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ Job IO */

export const ProductDiscoveryInputSchema = z.object({
  niche: z.string().min(2).max(120),
  country: z.string().min(2).max(4).default("US"),
  platform: z.string().max(40).default("General"),
  /** Kaç ürün istendi (nihai en iyi 5). */
  topN: z.number().int().min(1).max(10).default(5),
});
export type ProductDiscoveryInput = z.infer<typeof ProductDiscoveryInputSchema>;

/** Filtre istatistikleri — panelde "neden bu sayı?" sorusunu yanıtlar. */
export const FilterStatsSchema = z.object({
  inputCount: z.number().int().min(0).default(0),
  rejectedByRating: z.number().int().min(0).default(0),
  rejectedByStock: z.number().int().min(0).default(0),
  rejectedByPrice: z.number().int().min(0).default(0),
  rejectedByDuplicate: z.number().int().min(0).default(0),
  rejectedByCompleteness: z.number().int().min(0).default(0),
  rejectedBySource: z.number().int().min(0).default(0),
  survivors: z.number().int().min(0).default(0),
  /** Kaynak bazlı sağlık — hangi scraper çalıştı, hangisi öldü. */
  perSource: z
    .array(
      z.object({
        name: z.string(),
        ok: z.boolean(),
        items: z.number().int().min(0).default(0),
        ms: z.number().int().min(0).default(0),
        error: z.string().default(""),
      }),
    )
    .default([]),
});
export type FilterStats = z.infer<typeof FilterStatsSchema>;

/** 14 ajanın uzlaşma sonucu. */
export const ConsensusSchema = z.object({
  candidateId: z.string(),
  name: z.string(),
  /** 14 ajanın ortalaması (0-100) — sıralamanın ana ölçütü. */
  councilScore: z.number().min(0).max(100).default(0),
  /** Kaç ajan oy kullandı (0-14). */
  votes: z.number().int().min(0).default(0),
  /** Oy yüzdesi (0-1). */
  coverage: z.number().min(0).max(1).default(0),
  /** Oyların yayılımı: 0 = birlikte, yüksek = bölünmüş. */
  disagreement: z.number().min(0).max(100).default(0),
  /**
   * GÜVEN puanı (0-100): uzlaşma + veri bütünlüğünün bileşimi.
   * Yüksek güven = ajanlar hem birbirine hem kanıta güveniyor.
   */
  confidenceScore: z.number().min(0).max(100).default(0),
  minScore: z.number().min(0).max(100).default(0),
  maxScore: z.number().min(0).max(100).default(0),
  /** Ajanların bıraktığı gerekçeler. */
  evidence: z.array(z.string()).default([]),
});
export type Consensus = z.infer<typeof ConsensusSchema>;

/** QStash adımlarının gövdesi — imza doğrulaması SONRASI parse edilir. */
export const DiscoveryStepPayloadSchema = z.object({
  runId: z.string().min(1),
  userId: z.string().min(1),
  input: ProductDiscoveryInputSchema,
  /** Bu adımın ürettiği geçici çıktı (varsa). */
  batch: z.array(NormalizedProductSchema).default([]),
  /**
   * Uzlaşma sonuçları — `deep` → `final` aktarımı.
   *
   * Neden ayrı alan: uzlaşma kaydı `NormalizedProduct` DEĞİLDİR (agent
   * oyları, güven skoru, kanıt listesi taşır). `batch` içine konmaya
   * çalışılırsa zdo şeması onu eler ve `final` adımı boş listeyle çalışıp
   * sahte bir "nihai sonuç" üretirdi. Ayrı alan hat boyunca taşınacak tek
   * doğru tipi garanti eder.
   */
  consensus: z.array(ConsensusSchema).default([]),
  /** İlerleme yüzdesi (panel/SSE). */
  progress: z.number().min(0).max(100).default(0),
  /**
   * ZİNCİRİN MUTLAK BİTİŞ ANI (epoch ms).
   *
   * `/start`ta BİR KEZ hesaplanır ve her adım gövdesiyle taşınır; `deep` adımı
   * 14 ajanı bu ana kadar konuşturur, yetişmeyen roller deterministiğe düşer.
   * Ölçülen hata: adım yalnız kendi teslimat penceresini bildiği için `deep`
   * zincirin geri kalanına yer bırakmadan ~278 sn kullanabiliyor ve sonuç 300
   * sn'yi aşabiliyordu. ALAN OPSİYONELDİR: eski/elde üretilmiş gövdelerde
   * yoktur ve o durumda adım eski davranışıyla (teslimat penceresi)
   * koşar.
   */
  deadlineAtMs: z.number().int().positive().optional(),
  /** Önceki adımın istatistikleri (şeffaflık). */
  stats: FilterStatsSchema.optional(),
  /** Adım sonundaki durum. */
  status: ProductDiscoveryStatusSchema.default("queued"),
});
export type DiscoveryStepPayload = z.infer<typeof DiscoveryStepPayloadSchema>;

/* ---------------------------------- Nihai 5 ürünün dış sözleşmesi */

/**
 * BAŞ ÜRÜN KURATÖRÜ ÇIKTISI — dışarıya verilen sözleşme.
 *
 * ALAN ADLARI VE SIRASI DIŞARI SÖZLEŞMESİDİR; panel ve istemciler buna göre
 * okur, değiştirmek onları kırar.
 *
 * NEDEN BURADA (paylaşılan tipler katmanı) ve `product-discovery-pipeline`
 * içinde değil: bu şema hem sunucu hattı hem de İSTEMCİ hook'ları tarafından
 * okunur. Sunucu modülünü istemciye import etmek `.server.ts` bağımlılığını
 * tarayıcı paketine sokardı.
 */
export const TopProductSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  final_score: z.number().min(0).max(100),
  selection_reason: z.string().min(1),
});
export type TopProduct = z.infer<typeof TopProductSchema>;
