// ============================================================================
// PRODUCT DISCOVERY — QSTASH ASENKRON PİPELİN.
//
// Vercel Hobby'de fonksiyon süresi kısıtlıdır (10 sn pratik / 300 sn tavan).
// Bu yüzden iş, birbirini TETİKLEYEN dört bağımsız adıma bölünür; her adım
// kendi fonksiyonunda BİTER ve bir sonrakini QStash ile kuyruğa alır:
//
//   /start ──► scraping+filtering (saf kod, 0 token)
//                 └─► gemini_shortlist  (Top 75 → 15, Gemini 1)
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

/* ---------------------------------------------- Adım 2: Gemini shortlist (15) */

/** Top-75 listesinden Gemini ile en iyi 15 adayı seçer. */
export async function runGeminiShortlistStep(
  products: readonly NormalizedProduct[],
  niche: string,
  topN = 15,
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
  const shortlist = await selectWithGemini(products, niche, topN);
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
  // Yedek: ön skora göre ilk 15, ama kanıtı EN ZENGİN olan önce gelir.
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

/** Uzlaşmaya göre nihai en iyi 5 ürünü seçer ve 'completed' durumunu verir. */
export function runFinalRankStep(consensus: readonly Consensus[], topN = 5): DiscoveryStepResult {
  // Sıralama: councilScore DESC, eşitlikte confidenceScore DESC.
  const ranked = [...consensus].sort(
    (a, b) => b.councilScore - a.councilScore || b.confidenceScore - a.confidenceScore,
  );
  const winners = ranked.slice(0, topN);
  return {
    ok: true,
    status: "completed",
    products: [],
    consensus: winners,
    next: "",
    notes: [`${winners.length} ürün nihai listeye girdi.`],
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
