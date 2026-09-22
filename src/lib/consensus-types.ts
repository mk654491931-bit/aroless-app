// Client-safe types for the 3-Agent "Product Finder & Consensus Engine".
export const CONSENSUS_MIN_AVG = 75;

export type AgentVerdict = {
  score: number;
  decision: "APPROVED" | "REJECTED";
  summary: string;
  points: string[];
};

export type ConsensusResult = {
  approved: boolean;
  average_score: number;
  agent1: AgentVerdict;
  agent2: AgentVerdict;
  /** Agent 4 — independent Groq verifier (absent if Groq is unavailable). */
  agent4?: AgentVerdict;
  profit_margin_pct: number;
  competition_level: "Low" | "Medium" | "High";
  risk_flags: string[];
};

/** Compact 14'lü AI Konsey verdict attached to a product in the finder. */
export type CouncilSummary = {
  velora_score: number;
  verdict: string;
  director_engine: string;
  executive_report: string;
  teams: {
    team: "market" | "finance" | "marketing" | "operations" | "compliance" | "creative";
    title: string;
    score: number;
    engine: string;
    summary: string;
    /** Hakem modelin puanı ve motoru (14'lü konseyin 2. üyesi). */
    review_score?: number;
    reviewer_engine?: string;
    review_note?: string;
    confidence?: number;
    weight?: number;
  }[];
  action_plan: string[];
  risks: string[];
  cache_hit: boolean;
  /** Bağımsız denetçi (14. üye). */
  auditor_engine?: string;
  auditor_score?: number;
  auditor_note?: string;
  /** Rapor güveni ve konsey içi fikir ayrılığı. */
  confidence?: number;
  disagreement?: number;
  data_coverage?: number;
  kill_criteria?: string[];
  /**
   * Karne hangi profilde üretildi. `enrich` ürün bulucunun İÇİNDEN çağrılan
   * karnedir ve artık 14 ajanın tamamını koşar (6 ekip + 6 hakem + müdür +
   * denetçi); yalnızca bütçe darsa bazı aşamalar atlanır ve bu durum
   * `skipped_stages` ile dürüstçe bildirilir. Eski kayıtlarda bulunmaz.
   */
  depth?: "full" | "fast" | "enrich";
  /** Süre bütçesine sığmadığı için atlanan aşamalar (boşsa tam hat koştu). */
  skipped_stages?: string[];
};

/** Bir karne özetinde fiilen kaç ajan çağrısının koştuğunun dürüst dökümü. */
export type CouncilAgentSummary = {
  /** Kaç ajan çağrısı fiilen koştu (0-14). */
  agentCalls: number;
  /** Ekranda gösterilecek dürüst etiket. */
  label: string;
  /** 14 ajanın tamamı koştu mu? */
  full: boolean;
  /** Çıktısı olan hakem sayısı (0-6). */
  reviewerCount: number;
  /** Bağımsız denetçi (14. ajan) koştu mu? */
  hasAuditor: boolean;
};

/**
 * Karnenin KAÇ ajanla koştuğunu dürüstçe özetler.
 *
 * Konsey 14 üyeden oluşur: 6 uzman üretici ekip + 6 hakem + müdür + bağımsız
 * denetçi. Süre bütçesi darsa hakem turu ve/veya denetçi atlanabilir. Bu
 * fonksiyon `depth` etiketine GÜVENMEZ (o alan eski kayıtlarda yanıltıcı) ve
 * fiili çıktıya bakar: hakem notu/motoru olan ekip sayısı + denetçi puanı.
 * Böylece arayüz "6 uzman ekip" ile "14 ajan" arasındaki farkı yanlış
 * gösteremez.
 */
export function councilAgentSummary(council: CouncilSummary): CouncilAgentSummary {
  const teams = Array.isArray(council.teams) ? council.teams : [];
  const reviewerCount = teams.filter(
    (t) =>
      typeof t.reviewer_engine === "string" &&
      t.reviewer_engine.trim() !== "" &&
      t.reviewer_engine !== "-",
  ).length;
  const hasDirector =
    typeof council.director_engine === "string" &&
    council.director_engine.trim() !== "" &&
    council.director_engine !== "unavailable";
  const hasAuditor = typeof council.auditor_score === "number" && council.auditor_score > 0;
  const agentCalls = teams.length + reviewerCount + (hasDirector ? 1 : 0) + (hasAuditor ? 1 : 0);
  const full = teams.length > 0 && reviewerCount === teams.length && hasDirector && hasAuditor;
  const label = full
    ? `14 ajan: ${teams.length} ekip + ${reviewerCount} hakem + Müdür + Denetçi`
    : `${agentCalls} ajan koştu: ${teams.length} ekip + ${reviewerCount} hakem${
        hasDirector ? " + Müdür" : ""
      }${hasAuditor ? " + Denetçi" : ""}`;
  return { agentCalls, label, full, reviewerCount, hasAuditor };
}

/** Local competition level, localized for the UI. */
export type LocalCompetition = "Düşük" | "Orta" | "Yüksek";

/**
 * Hybrid 4-API score for a single product in a single target country.
 * Calculated_Score = (ai_1_score * 0.55) + (ai_2_score * 0.45)
 */
export type HybridScore = {
  target_country: string;
  /** Groq — market demand & competition analyst (weight 55%). */
  ai_1_score: number;
  local_competition_level: LocalCompetition;
  market_note?: string;
  /** Gemini 1 — profit margin & logistics analyst (weight 45%). */
  ai_2_score: number;
  estimated_shipping_days: number;
  logistics_note?: string;
  /** Weighted result. */
  calculated_score: number;
  /** Gemini 3 — localized tooltip / card summary. */
  tooltip?: string;
  badge_note?: string;
  /** Gemini 2 — country cross-match fallback. */
  alt_country_code?: string;
  alt_country_name?: string;
  alt_country_note?: string;
};

export const HYBRID_WEIGHT_AI1 = 0.55;
export const HYBRID_WEIGHT_AI2 = 0.45;
export const HYBRID_DEFAULT_MIN_SCORE = 65;
export const HYBRID_RELAXED_MIN_SCORE = 50;

/**
 * ORTAK KARAR (joint decision) — ürün bulucunun ANALİZ HATTI puanı ile 14'lü AI
 * Konsey karnesinin birleşimi. Saf fonksiyon: sunucu ve istemci aynı sonucu
 * verir, ek AI çağrısı yoktur.
 *
 * Bulucu hattı iki bağımsız sinyal üretir:
 *  - analiz puanı (`analysis`): hibrit pazarlama+lojistik puanı ve/veya 4 ajanlı
 *    fikir birliği ortalaması — hattın KENDİ kararı,
 *  - konsey puanı (`council`): 14 ajanın (6 ekip + 6 hakem + müdür + denetçi)
 *    ağırlıklı Aroless skoru.
 * İkisi de varsa karar EŞİT ortaklıktır (analiz %50 / konsey %50): konsey bir
 * veto değildir, ortak karar verir. Yalnızca biri varsa o karar geçerlidir.
 * Geçersiz (0 / NaN / negatif) puan "yok" sayılır.
 */
export function combineJointScores(input: {
  analysisScore?: number | null;
  councilScore?: number | null;
}): {
  score: number;
  source: "joint" | "analysis" | "council" | "none";
  analysisWeight: number;
  councilWeight: number;
} {
  const norm = (value: number | null | undefined): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  };
  const analysis = norm(input.analysisScore);
  const council = norm(input.councilScore);
  if (analysis === null && council === null) {
    return { score: 0, source: "none", analysisWeight: 0, councilWeight: 0 };
  }
  if (analysis === null) {
    return { score: council!, source: "council", analysisWeight: 0, councilWeight: 1 };
  }
  if (council === null) {
    return { score: analysis, source: "analysis", analysisWeight: 1, councilWeight: 0 };
  }
  return {
    score: Math.round(analysis * 0.5 + council * 0.5),
    source: "joint",
    analysisWeight: 0.5,
    councilWeight: 0.5,
  };
}

export function hybridBadge(score: number): { label: string; cls: string } {
  if (score >= 85)
    return {
      label: "Altın Fırsat",
      cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    };
  if (score >= 70)
    return { label: "Yüksek Potansiyel", cls: "border-sky-500/40 bg-sky-500/15 text-sky-300" };
  return { label: "İncelemeye Değer", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300" };
}
