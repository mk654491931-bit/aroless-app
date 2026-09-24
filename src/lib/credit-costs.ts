/**
 * AI JETON FİYATLANDIRMASI — TEK KAYNAK.
 *
 * NEDEN GEREKLİ: Bu üründe tükenmesi en kolay kaynak AI kotasıdır ve her AI
 * çağrısı ya para (sağlayıcı kotası) ya da kullanıcının aylık hakkını harcar.
 * Önceden yalnızca ÜRÜN BULUCU ve KONSEY jeton düşüyordu; 22 araç, 14 ajanlı
 * Velora hattı ve trend analizi **tamamen ücretsiz** çalışıyordu — yani:
 *  1. sunucu maliyeti karşılıksız kalıyordu,
 *  2. aynı kullanıcı sınırsız kullanıp anahtar havuzunu yakabiliyordu,
 *  3. "jeton" kavramı arayüzde görünse de gerçekte tükenmiyordu (güven kaybı).
 *
 * KURAL: Bir AI isteği gerçekten yapıldığında jeton düşer. Önbellekten dönen
 * yanıt (aynı girdi, aynı dil) JETON HARCAMAZ — kullanıcı bunu arayüzde görür.
 *
 * FİYAT POLİTİKASI (bilinçli olarak sade):
 *  - Derinlik farkı jetonla değil PAKET KOTALARIYLA ölçülür (`plans.ts`:
 *    toolRuns / councilRuns / radarScans). Bu yüzden tek tıklamalık her AI işi
 *    1 jetondur — arayüzde, veritabanında ve burada aynı sayı konuşulur.
 *  - TEK İSTİSNA `consensus`: bir tıklamada 4 bağımsız motor + sentez koşar,
 *    yani 2 jeton. Arayüz bunu "4 motor · 2 jeton" diye açıkça yazar.
 */

import type { ToolId } from "./tools-prompts.server";

export type AiCreditFeature =
  | `tool:${ToolId}`
  | "council"
  | "agent-pipeline"
  | "trend-analysis"
  | "radar-scan";

/**
 * Araç başına jeton. `satisfies Record<ToolId, number>` kasıtlıdır: yeni bir
 * araç eklenip burada fiyatı tanımlanmazsa **derleme hata verir** — sessizce
 * bedava kalan araç, bu mimaride en pahalı hatadır.
 */
export const TOOL_CREDIT_COSTS = {
  // --- standart (çok motorlu hibrit + sentez) ---
  "supplier-negotiator": 1,
  "offer-analyzer": 1,
  "legitimacy-detector": 1,
  "review-spec-sheet": 1,
  "reverse-cost": 1,
  "landed-cost": 1,
  "capital-planner": 1,
  "desi-optimizer": 1,
  "milestone-shield": 1,
  "bundle-booster": 1,
  "lead-time": 1,
  "arbitrage-matrix": 1,
  "ad-hook-extractor": 1,
  "listing-seo": 1,
  "listing-visual": 1,
  "review-sentiment": 1,
  "price-strategy": 1,
  "news": 1,
  "hs-classifier": 1,
  "compliance-check": 1,
  "competitor-intel": 1,
  // --- ağır: 4 motor BAĞIMSIZ puanlar + karşılaştırma ---
  consensus: 2,
} satisfies Record<ToolId, number>;

/** Araç dışı AI işlerinin jeton maliyeti. */
export const AI_CREDIT_COSTS = {
  /**
   * 14 ajanlı fazlı Velora konseyi (retriever + 14 ajan + kanıt taraması).
   * `council.functions.ts`'teki canlı düşme ve arayüz rozetiyle AYNI olmalıdır.
   */
  council: 1,
  /** Tek blok halinde koşan aynı 14 ajanlı hat (QStash'sız hızlı yol). */
  agentPipeline: 1,
  /** Derin ürün analizi: 4 motor + canlı trend/kaynak verisi. */
  trendAnalysis: 1,
  /** Trend radar taraması (kazıma / derin yorum / ürün brifi). */
  radarScan: 1,
} as const;

/** Bilinmeyen/eksik araç için güvenli varsayılan (bedava bırakmaz). */
export const DEFAULT_TOOL_CREDIT_COST = 1;

export function toolCreditCost(tool: string): number {
  const cost = (TOOL_CREDIT_COSTS as Record<string, number>)[tool];
  return Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : DEFAULT_TOOL_CREDIT_COST;
}

/** İşin jeton maliyeti (araç adı veya AI özelliğinden). */
export function featureCreditCost(feature: AiCreditFeature): number {
  if (feature.startsWith("tool:")) return toolCreditCost(feature.slice(5));
  switch (feature) {
    case "council":
      return AI_CREDIT_COSTS.council;
    case "agent-pipeline":
      return AI_CREDIT_COSTS.agentPipeline;
    case "trend-analysis":
      return AI_CREDIT_COSTS.trendAnalysis;
    default:
      return AI_CREDIT_COSTS.radarScan;
  }
}

/** Arayüzde gösterilecek kısa etiket: "3 kredi". */
export function creditCostLabel(amount: number): string {
  const n = Math.max(0, Math.floor(amount));
  return `${n} kredi`;
}
