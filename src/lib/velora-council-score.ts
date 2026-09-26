// ============================================================================
// 14 AJAN ORTALAMASI — nihai sıralamanın saf karar katmanı.
//
// KULLANICI İSTEĞİ: "son gelen toplam 14 ajanın bilgilerinin ortalaması alınsın,
// o ortalamaya göre en iyi 5 ürün çıksın". Bu dosya o kuralı TEK YERDE ve SAF
// biçimde uygular: sunucu, istemci ve testler aynı sonucu üretir.
//
// ORTALAMA NEDEN YETERLİ DEĞİL (dürüstlük):
//   1. Katılım (coverage): 3 ajandan gelen 90 puan, 14 ajandan gelen 74'ün
//      ÜSTÜNE ÇIKAMAZ. Çünkü "14 ajan ortalaması" diyebilmek için 14 ajanın
//      konuşması gerekir.
//   2. Uzlaşma (spread): 14 ajanın 7'si 95, 7'si 55 verdiyse ortalama 75'tir
//      ama kimse o üründe fikir birliği yoktur. Yayılım puanı kısar.
//
// Bağımsız analiz hattı kararı BOZMAZ; yalnız eşitlik bozucu (tie-break) ve
// "ajan oyu hiç gelmedi" durumunda tek başına çalışan hat olarak rol alır.
//
// AĞIRLIKLAR AÇIKÇA YAZILIDIR ve toplamı 1'dir — panelde de bu sayılar konuşur.
// ============================================================================

/** Konsey (14 ajan ortalaması) nihai kararın ana eksenidir. */
export const VELORA_COUNCIL_WEIGHT = 0.9;

/** Analiz hattı yalnız eşitlik bozucu + ajan oyu yoksa devreye girer. */
export const VELORA_ANALYSIS_WEIGHT = 1 - VELORA_COUNCIL_WEIGHT;

/** Konsey oyu hiç gelmediyse analiz hattı kararın TAMAMEN kendisidir. */
export const VELORA_ANALYSIS_ONLY_WEIGHT = 0;

/**
 * Katılım tabanlı güven çarpanı: `0.55 + 0.45 × coverage`.
 *
 * coverage = 1 (14/14 oy) → 1.00 · coverage = 0.5 (7/14) → 0.78 ·
 * coverage ≈ 0 → 0.55. Yani az oy alan ürün cezalandırılır ama sıfırlanmaz:
 * "yalnız 2 ajan oyladı" bilgisi kaybolmamalıdır.
 */
export const VELORA_COVERAGE_FLOOR = 0.55;

/**
 * Uzlaşma tabanlı güven çarpanı: `1 − min(spread, 30) / 60`.
 *
 * 14 LLM oyununun doğal yayılımı geniştir; bu yüzden eşikler kasıtlı olarak
 * yumuşaktır. spread 0 → 1.00 · spread 15 → 0.75 · spread ≥ 30 → 0.50.
 */
export const VELORA_SPREAD_PENALTY_CAP = 30;

const clamp = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
};

export type CouncilVerdictInput = {
  /** Ürünü puanlayan ajanların ortalaması (0-100). */
  councilScore: number;
  /** Kaç ajan oy verdi (0-14). */
  votes: number;
  /** Oyların yayılımı (standart sapma). */
  spread: number;
  /** Planlanan ajan sayısı (14). */
  agentCount: number;
  /** Bağımsız analiz hattının ürün puanı (tie-break / yedek hat). */
  analysisScore?: number | null;
};

export type CouncilVerdict = {
  /** Nihai sıralama puanı (0-100). */
  score: number;
  /** Kararın dayandığı hat. */
  source: "council-average" | "analysis-only";
  /** Uygulanan güven çarpanı (coverage × agreement). */
  confidence: number;
  /** Konsey oyu alan ajan oranı (0-1). */
  coverage: number;
  /** Ağırlıklar (toplamı 1). */
  councilWeight: number;
  analysisWeight: number;
};

/**
 * Bir ürünün nihai puanı = 14 ajan ortalaması × güven.
 *
 * Saf fonksiyon: ağ yok, AI çağrısı yok, aynı girdi → aynı çıktı.
 */
export function councilFinalScore(input: CouncilVerdictInput): CouncilVerdict {
  const agentCount = Math.max(1, input.agentCount || 14);
  const votes = Math.max(0, input.votes || 0);
  const coverage = Math.min(1, votes / agentCount);
  const councilScore = clamp(input.councilScore);
  const spread = Math.max(0, Number(input.spread) || 0);
  const analysis =
    input.analysisScore === null || input.analysisScore === undefined
      ? null
      : clamp(input.analysisScore);

  // Hiçbir ajan oy vermediyse ortalamanın YOKTUR: uydurma "50" üretmek yerine
  // karar bağımsız analiz hattına devredilir ve bu durum dürüstçe bildirilir.
  if (votes === 0 || councilScore <= 0) {
    return {
      score: Math.round(analysis ?? 0),
      source: "analysis-only",
      confidence: 0,
      coverage: 0,
      councilWeight: VELORA_ANALYSIS_ONLY_WEIGHT,
      analysisWeight: 1,
    };
  }

  const coverageFactor = VELORA_COVERAGE_FLOOR + (1 - VELORA_COVERAGE_FLOOR) * coverage;
  const spreadFactor = 1 - Math.min(spread, VELORA_SPREAD_PENALTY_CAP) / 60;
  const confidence = Math.round(coverageFactor * spreadFactor * 1000) / 1000;
  const councilWeighted = councilScore * coverageFactor * spreadFactor;
  const score =
    analysis === null
      ? councilWeighted
      : councilWeighted * VELORA_COUNCIL_WEIGHT + analysis * VELORA_ANALYSIS_WEIGHT;

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    source: "council-average",
    confidence,
    coverage: Math.round(coverage * 1000) / 1000,
    councilWeight: VELORA_COUNCIL_WEIGHT,
    analysisWeight: VELORA_ANALYSIS_WEIGHT,
  };
}

/**
 * Sıralama anahtarı — büyükten küçüğe.
 *
 * Öncelik sırası bilinçlidir:
 *   1. Nihai puan (14 ajan ortalaması × güven),
 *   2. Katılım (daha çok ajan oyladıysa önce),
 *   3. Ortalamanın kendisi (eşit puanlı ürünlerde yüksek ortalama önce),
 *   4. Analiz hattı puanı (yalnız eşitlik bozucu),
 *   5. Normalize kimlik — kararlı (deterministik) sıralama için.
 */
export function councilRankKey(input: {
  verdict: CouncilVerdict;
  councilScore: number;
  votes: number;
  analysisScore: number;
  identity: string;
}): string {
  const pad = (n: number, width = 6) =>
    String(Math.max(0, Math.round(n * 1000))).padStart(width, "0");
  return [
    // Ters sıralama için büyük sayıyı küçük sayıya çeviriyoruz.
    pad(100 - input.verdict.score),
    pad(1000 - input.votes),
    pad(100 - input.councilScore),
    pad(100 - input.analysisScore),
    input.identity,
  ].join("|");
}

/** Sıralanacak satırları 14 ajan ortalamasına göre sıralar (saf, yerinde). */
export function sortByCouncilAverage<
  T extends {
    verdict: CouncilVerdict;
    councilScore: number;
    votes: number;
    analysisScore: number;
    identity: string;
  },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => councilRankKey(a).localeCompare(councilRankKey(b)));
}
