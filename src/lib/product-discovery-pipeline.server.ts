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
  type Consensus,
  type NormalizedProduct,
  type ProductDiscoveryStatus,
} from "./product-discovery.types";

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
  _country: string,
  _platform: string,
  topN = 75,
): Promise<DiscoveryStepResult> {
  const { runSources } = await import("./product-discovery-sources.server");
  const { filterAndPreRank } = await import("./product-discovery-filter.server");

  // 1) Kaynaklar (fail-soft, paralel, kaynak başına tavan).
  const { products: raw, reports } = await runSources(niche);

  // 2) Niş bağlamı (talep sinyalleri) — kaynaklardan türetilir, AI DEĞİL.
  //    Wikipedia momentum satırın `notes`inde taşınır; burada parse edilir.
  let nicheMomentumPct: number | null = null;
  let nicheEngagement = 0;
  for (const row of raw) {
    const m = /momentum ([+-]?\d+)%/.exec(row.notes);
    if (m && nicheMomentumPct === null) nicheMomentumPct = Number(m[1]);
    // Etkileşim: upvote+yorum veya yıldız.
    const e = /(\d+)\s*(?:↑|yorum|yıldız)/.exec(row.notes);
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
  const { survivors, stats } = filterAndPreRank(
    raw,
    { nicheMomentumPct, nicheEngagement },
    perSource,
    topN,
  );

  const notes: string[] = [];
  if (survivors.length === 0) {
    notes.push("Hiç kaynak ürün döndürmedi; Gemini aşamasına boş liste gönderilmez.");
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
 */
export const GEMINI_SHORTLIST_SIZE = 25;

export async function runGeminiShortlistStep(
  products: readonly NormalizedProduct[],
  niche: string,
  topN = GEMINI_SHORTLIST_SIZE,
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
  const shortlist = await selectWithGemini(products, niche, topN, geminiShortlistSelector);
  return {
    ok: true,
    status: "gemini_shortlist",
    products: shortlist,
    consensus: [],
    next: "deep_analysis",
    notes: [`Gemini ${products.length} → ${shortlist.length} aday seçti.`],
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
async function geminiShortlistSelector(
  products: readonly NormalizedProduct[],
  niche: string,
): Promise<NormalizedProduct[]> {
  const { callGemini } = await import("./ai.server");
  const { z } = await import("zod");

  const roster = products
    .slice(0, 75)
    .map((p, i) => `${i + 1}. ${p.name} (ön skor ${p.preScore}, kanıt ${p.dataCompleteness}/5)`)
    .join("\n");

  const prompt = [
    `Sen bir e-ticaret ürün seçicisisin. Niş: "${niche}".`,
    `Aşağıdaki ${Math.min(products.length, 75)} adaydan ticari olarak EN GÜÇLÜ ${GEMINI_SHORTLIST_SIZE}'ini seç.`,
    "Değerlendirme: talep kanıtı, rekabet doygunluğu, marj potansiyeli, ürün kalitesi.",
    "Sadece numara listesi ver, açıklama yazma.",
    "",
    roster,
  ].join("\n");

  const raw = await callGemini(prompt, undefined, 0.2);
  const Parsed = z.object({
    picks: z.array(z.number().int().min(1).max(75)).min(1),
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
): Promise<NormalizedProduct[]> {
  if (geminiSelect) {
    try {
      const selected = await geminiSelect(products, niche);
      if (selected.length) return selected.slice(0, topN);
    } catch {
      // Gemini başarısız → deterministik seçime düş (aşağıda).
    }
  }
  // Yedek: ön skora göre ilk `topN`, ama kanıtı EN ZENGİN olan önce gelir.
  return [...products]
    .sort(
      (a, b) =>
        b.preScore - a.preScore ||
        b.dataCompleteness - a.dataCompleteness ||
        b.sources.length - a.sources.length,
    )
    .slice(0, topN);
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
  const consensus = await runCouncil(products);
  return {
    ok: true,
    status: "deep_analysis",
    products: [...products],
    consensus,
    next: "final",
    notes: [`14 ajan ${products.length} adayı değerlendirdi.`],
  };
}

/* -------------------------------------------------- Adım 4: final rank (Top5) */

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
  // Sıralama: councilScore DESC, eşitlikte confidenceScore DESC.
  const ranked = [...consensus].sort(
    (a, b) => b.councilScore - a.councilScore || b.confidenceScore - a.confidenceScore,
  );
  const winners = ranked.slice(0, topN);
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
      `${winners.length} ürün nihai listeye girdi.`,
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
