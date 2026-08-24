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
};

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
