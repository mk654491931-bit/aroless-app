// ============================================================================
// VELORA NİŞ SİNYALLERİ — ajanlar devreye girmeden ÖNCE toplanan kanıt.
//
// Bu dosya SAF'tır: ağ çağrısı yapmaz, sunucuya bağımlı değildir, test edilebilir.
// Kazımayı yapan sunucu tarafı `velora-niche-scrape.server.ts` bu tipleri doldurur;
// orkestratör ve ajan istemleri yalnızca buradaki sözleşmeyi tanır.
//
// NEDEN AYRI BİR KATMAN: 14 ajanın hepsi aynı anda, aynı kanıtı okuyarak
// puan vermelidir. Kazıma sonucu dağınık metin blokları hâlinde kalsaydı her ajan
// farklı bir şey görürdü. Burada kanıt ÖLÇÜLEBİLİR alanlara ayrılır ve her ajan
// kendi uzmanlığına düşen dilimi alır (`velora-agent-focus.ts`).
//
// DÜRÜSTLÜK KURALLARI (değiştirilmez):
//   1. Hiçbir sayı uydurulmaz. Alan yoksa `null`/boş dizi kalır.
//   2. Her kaynak `active` ya da `error` olarak RAPORLANIR; sessizce düşmez.
//   3. "Tahmini" fiyat (sourcing fallback) ile "canlı" fiyat aynı alanda
//      karıştırılmaz: `supplierPrice.live=false` ise ajan bunu görür.
//   4. Satış verisi iddiası yoktur — buradaki her şey TALEP/REKABET/ARZ sinyali.
// ============================================================================

import { z } from "zod";

/** Bir kaynağın kazıma sonucu — panelde ve ajan isteminde dürüstçe görünür. */
export const NicheSourceStatusSchema = z.object({
  /** Kaynağın insan-okunur adı. */
  name: z.string().min(1),
  /** Kaynak yanıt verdi mi? Yanıt vermediyse `error` ve `items: 0`. */
  status: z.enum(["active", "error"]),
  /** Bu kaynaktan kaç satır geldi (ölçülen sayı). */
  items: z.number().int().min(0),
  /** Kısa hata notu (yalnız `error` durumunda anlamlı). */
  detail: z.string().default(""),
});
export type NicheSourceStatus = z.infer<typeof NicheSourceStatusSchema>;

/** Reddit tüketici sinyali — fiyat değil, TALEP ve ŞİKAYET kanıtı. */
export const RedditSignalSchema = z.object({
  title: z.string(),
  subreddit: z.string(),
  score: z.number().default(0),
  comments: z.number().default(0),
  url: z.string().default(""),
  /** Bu başlık bir şikâyet/uyarı mı? Kural tabanlı (kelime eşleşmesi). */
  complaint: z.boolean().default(false),
});
export type RedditSignal = z.infer<typeof RedditSignalSchema>;

/** Canlı piyasa fiyat örneği (DuckDuckGo → marketplace sonuçları). */
export const PriceSampleSchema = z.object({
  platform: z.string(),
  priceUsd: z.number().min(0),
});
export type PriceSample = z.infer<typeof PriceSampleSchema>;

/** Tedarikçi maliyeti (AliExpress kazıması veya dürüstçe `live:false` tahmini). */
export const SupplierPriceSchema = z.object({
  priceUsd: z.number().min(0),
  shippingUsd: z.number().min(0),
  /** `true` yalnızca gerçekten kazınmış bir fiyat döndüğünde. */
  live: z.boolean().default(false),
  sampleTitle: z.string().default(""),
  /** Kaç tedarikçi ilanından medyan alındı (canlı kazımada ölçülen sayı). */
  samples: z.number().int().min(0).default(0),
  /** Fiyatın orijinal para birimi — kur dönüşümü şeffaf olsun diye. */
  currency: z.string().default("USD"),
  /** Ölçülen kur çarpanı (yoksa null; kuruş çarpanı ASLA uydurulmaz). */
  fxRate: z.number().min(0).nullable().default(null),
  /** Kurun geldiği ücretsiz kaynak. */
  fxSource: z.string().default(""),
});
export type SupplierPrice = z.infer<typeof SupplierPriceSchema>;

/** Hacker News (Algolia herkese açık arama) — nişe dair gerçek tartışma. */
export const HackerNewsSignalSchema = z.object({
  title: z.string(),
  points: z.number().default(0),
  comments: z.number().default(0),
  url: z.string().default(""),
});
export type HackerNewsSignal = z.infer<typeof HackerNewsSignalSchema>;

/** Google News RSS başlığı — nişte neden şimdi. */
export const NewsHeadlineSchema = z.object({
  title: z.string(),
  source: z.string().default(""),
  url: z.string().default(""),
});
export type NewsHeadline = z.infer<typeof NewsHeadlineSchema>;

/** GitHub deposu sinyali — nişe yönelik açık kaynak/araç hareketi. */
export const GitHubSignalSchema = z.object({
  fullName: z.string(),
  stars: z.number().default(0),
  description: z.string().default(""),
  topics: z.array(z.string()).default([]),
});
export type GitHubSignal = z.infer<typeof GitHubSignalSchema>;

/**
 * FAZ 0 — 14 AJANIN GÖRDÜĞÜ ORTAK KAZIMA.
 *
 * Her alan ölçülen bir gerçeği taşır. Alan `null` ise o veri kazınamadı demektir;
 * ajan bu durumda nötr (50) puan vermek zorundadır.
 */
export const NicheSignalsSchema = z.object({
  niche: z.string().default(""),
  country: z.string().default("GLOBAL"),
  platform: z.string().default("General"),
  /** ISO tarih — kanıtın ne zaman toplandığı. */
  collectedAt: z.string().default(""),

  /* --- TALEP ---------------------------------------------------------- */
  /** Google Trends 12 aylık ilgi (0-100). */
  trendSeries: z.array(z.number()).default([]),
  /** Google Trends momentum (%). `null` = ölçülemedi. */
  trendMomentumPct: z.number().nullable().default(null),
  googleRising: z.array(z.string()).default([]),
  tiktok: z.array(z.string()).default([]),
  amazonMovers: z.array(z.string()).default([]),
  reddit: z.array(RedditSignalSchema).default([]),
  hackerNews: z.array(HackerNewsSignalSchema).default([]),

  /* --- FİYAT / ARZ ----------------------------------------------------- */
  /** Gerçek marketplace fiyat örnekleri. */
  priceSamples: z.array(PriceSampleSchema).default([]),
  /** Gözlenen perakende fiyatların medyanı (USD). `null` = ölçülemedi. */
  retailMedianUsd: z.number().nullable().default(null),
  supplier: SupplierPriceSchema.nullable().default(null),

  /* --- REKABET / GÜNDEM ----------------------------------------------- */
  news: z.array(NewsHeadlineSchema).default([]),
  github: z.array(GitHubSignalSchema).default([]),
  /** Trend radarı satırları (`"Kaynak: ad"` biçiminde, tekrarsız). */
  radar: z.array(z.string()).default([]),

  /* --- KALİTE ---------------------------------------------------------- */
  sources: z.array(NicheSourceStatusSchema).default([]),
  /** En az bir kaynak canlı veri döndürdü mü? */
  live: z.boolean().default(false),
});
export type NicheSignals = z.infer<typeof NicheSignalsSchema>;

/** Kazıma hiç çalışmasa bile hat devam eder: boş ama GEÇERLİ kanıt. */
export function emptyNicheSignals(input?: {
  niche?: string;
  country?: string;
  platform?: string;
}): NicheSignals {
  return NicheSignalsSchema.parse({
    ...input,
    collectedAt: new Date().toISOString(),
    live: false,
  });
}

/* -------------------------------------------------------------------------
 * Saf türetmeler — hepsi girdiden hesaplanır, yeni veri uydurmaz.
 * ---------------------------------------------------------------------- */

/** Gözlenen fiyatların medyanı. Fiyat yoksa `null` (0 değil!) döner. */
export function medianPrice(samples: readonly PriceSample[]): number | null {
  const values = samples
    .map((s) => Number(s.priceUsd))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  return Math.round(median * 100) / 100;
}

/** Fiyat örneklerinin yayılımı (min–max aralığı). Fiyat yoksa `null`. */
export function priceSpread(samples: readonly PriceSample[]): {
  min: number;
  max: number;
  ratio: number;
} | null {
  const values = samples.map((s) => Number(s.priceUsd)).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, ratio: min > 0 ? Math.round((max / min) * 100) / 100 : 0 };
}

/**
 * Aynı fiyat bandını gösteren KAÇ farklı satış kanalı var?
 * Kanal çeşitliliği = gözlenen rekabetin alt sınırı (bir kanal = zayıf kanıt).
 */
export function platformCount(samples: readonly PriceSample[]): number {
  return new Set(samples.map((s) => s.platform.trim()).filter(Boolean)).size;
}

/** Reddit şikâyet sayısı — memnuniyetsizlik kanıtı (ürün kalitesi riski). */
export function complaintCount(reddit: readonly RedditSignal[]): number {
  return reddit.filter((r) => r.complaint).length;
}

/** Toplam Reddit ilgi yoğunluğu (upvote + yorum). */
export function redditEngagement(reddit: readonly RedditSignal[]): number {
  return reddit.reduce((sum, r) => sum + (r.score || 0) + (r.comments || 0), 0);
}

/**
 * Kanıt KAPSAMI (0-1): kaç farklı kaynak gerçekten veri döndürdü?
 * Konseyin "yeterince kanıt gördüm" diyebilmesi için gereken asgari düzey.
 */
export function evidenceCoverage(signals: NicheSignals): number {
  const active = signals.sources.filter((s) => s.status === "active" && s.items > 0);
  // 8 farklı kaynak = tam kapsam. Üstü ölçülemez; eksik kalan dürüstçe görünür.
  return Math.min(1, Math.round((active.length / 8) * 100) / 100);
}

/** Kanıt yeterli mi? Ajanların "unverified" demesinin eşiği. */
export const VELORA_MIN_EVIDENCE_COVERAGE = 0.25;

/** Kanıt zayıfsa ajanların nötr puan vermesi gerektiğinden önce uyarı satırı. */
export function evidenceWarning(signals: NicheSignals): string {
  const coverage = evidenceCoverage(signals);
  if (coverage >= VELORA_MIN_EVIDENCE_COVERAGE) return "";
  return `EVIDENCE THIN: only ${signals.sources.filter((s) => s.status === "active").length} source(s) returned data (coverage ${coverage.toFixed(2)} < ${VELORA_MIN_EVIDENCE_COVERAGE}). Score conservatively and say "unverified" wherever you cannot ground a claim.`;
}

/* -------------------------------------------------------------------------
 * Prompt metni — ortak blok (her ajanın göreceği taban kanıt).
 * ---------------------------------------------------------------------- */

const clip = (value: string, max: number): string => value.slice(0, max);
const pct = (value: number | null): string =>
  value === null ? "ÖLÇÜLEMEDİ" : `${value > 0 ? "+" : ""}${value}%`;

/** Ortak kanıtın prompta giren Hali. Kısa tutulur; uzmanlık dilimi ayrıdır. */
export function nicheSignalsBlock(signals: NicheSignals): string {
  const lines: string[] = [
    `NICHE: ${signals.niche} | TARGET: ${signals.country} | CHANNEL: ${signals.platform} | COLLECTED: ${signals.collectedAt.slice(0, 16).replace("T", " ")} UTC`,
    `DEMAND — Google Trends momentum: ${pct(signals.trendMomentumPct)}; 12-month interest: ${signals.trendSeries.slice(-12).join(",") || "n/a"}`,
  ];
  if (signals.googleRising.length)
    lines.push(`RISING QUERIES: ${signals.googleRising.slice(0, 8).join(" | ")}`);
  if (signals.tiktok.length) lines.push(`TIKTOK TREND: ${signals.tiktok.slice(0, 8).join(" | ")}`);
  if (signals.amazonMovers.length)
    lines.push(`AMAZON MOVERS & SHAKERS: ${signals.amazonMovers.slice(0, 8).join(" | ")}`);
  if (signals.reddit.length) {
    lines.push(
      `CONSUMER SIGNALS (${complaintCount(signals.reddit)} complaint / ${signals.reddit.length} total):\n${signals.reddit
        .slice(0, 6)
        .map(
          (r) =>
            `- r/${r.subreddit} [${r.score}▲ ${r.comments}c${r.complaint ? " ⚠ complaint" : ""}]: ${clip(r.title, 140)}`,
        )
        .join("\n")}`,
    );
  }
  if (signals.hackerNews.length)
    lines.push(
      `BUILDER/TECH DISCUSSION:\n${signals.hackerNews
        .slice(0, 5)
        .map((h) => `- [${h.points}p ${h.comments}c] ${clip(h.title, 140)}`)
        .join("\n")}`,
    );
  if (signals.priceSamples.length) {
    lines.push(
      `OBSERVED RETAIL PRICES (${platformCount(signals.priceSamples)} channel(s), median $${signals.retailMedianUsd ?? "n/a"}): ${signals.priceSamples
        .slice(0, 8)
        .map((p) => `${p.platform} $${p.priceUsd}`)
        .join(" | ")}`,
    );
  } else {
    lines.push("OBSERVED RETAIL PRICES: none captured — do NOT invent price data.");
  }
  if (signals.supplier) {
    lines.push(
      `SOURCING: supplier $${signals.supplier.priceUsd} + shipping $${signals.supplier.shippingUsd} (${signals.supplier.live ? "LIVE scraped" : "ESTIMATE, not scraped — treat as uncertain"})`,
    );
  } else {
    lines.push("SOURCING: no supplier price captured — do NOT invent cost data.");
  }
  if (signals.news.length)
    lines.push(
      `NEWS (why-now context):\n${signals.news
        .slice(0, 5)
        .map((n) => `- ${clip(n.title, 150)}${n.source ? ` (${n.source})` : ""}`)
        .join("\n")}`,
    );
  if (signals.github.length)
    lines.push(
      `OPEN-SOURCE ACTIVITY:\n${signals.github
        .slice(0, 4)
        .map((g) => `- ${g.fullName} (${g.stars}★): ${clip(g.description, 110)}`)
        .join("\n")}`,
    );
  if (signals.radar.length)
    lines.push(`TREND RADAR (all sources): ${signals.radar.slice(0, 10).join(" | ")}`);
  const active = signals.sources.filter((s) => s.status === "active").length;
  const failed = signals.sources.filter((s) => s.status === "error");
  lines.push(
    `EVIDENCE COVERAGE: ${active}/${signals.sources.length} sources active${
      failed.length ? `; unavailable: ${failed.map((f) => f.name).join(", ")}` : ""
    }`,
  );
  const warning = evidenceWarning(signals);
  if (warning) lines.push(warning);
  return lines.join("\n");
}
