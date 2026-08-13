// ============================================================================
// Hybrid 4-API scoring engine (server only)
//
//   AI 1  — Groq            : Market demand & competition analyst   (55%)
//   AI 2  — Gemini API 1    : Profit margin & logistics analyst     (45%)
//   AI 3  — Gemini API 2    : Fallback & country cross-match engine
//   AI 4  — Gemini API 3    : UI tooltip & card summary generator
//
// Deadlock fix: no strict AND gate. Products are ranked by
//   calculated_score = ai_1 * 0.55 + ai_2 * 0.45
// ============================================================================
import { callGemini, callGroq, extractJson, GEMINI_MODELS_LATEST } from "./ai.server";
import { countryName, TARGET_COUNTRIES } from "./countries";
import {
  HYBRID_WEIGHT_AI1,
  HYBRID_WEIGHT_AI2,
  type HybridScore,
  type LocalCompetition,
} from "./consensus-types";

const GEMINI_1 = () => process.env['GEMINI_API_KEY_1'] || process.env['GEMINI_1_API_KEY'] || process.env['GEMINI_API_KEY'];
const GEMINI_2 = () => process.env['GEMINI_API_KEY_2'] || process.env['GEMINI_2_API_KEY'] || process.env['GEMINI_API_KEY'];
const GEMINI_3 = () => process.env['GEMINI_API_KEY_3'] || process.env['GEMINI_3_API_KEY'] || process.env['GEMINI_API_KEY'];
const ALT_CODES = TARGET_COUNTRIES.filter((c) => c.code !== "GLOBAL").map((c) => c.code).join(", ");
const FLASH = GEMINI_MODELS_LATEST;

export function countryLabel(code: string): string {
  return countryName(code);
}


function clamp100(n: unknown, fb = 50): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fb;
}

function normalizeCompetition(v: unknown): LocalCompetition {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("dü") || s.startsWith("low")) return "Düşük";
  if (s.startsWith("yük") || s.startsWith("high")) return "Yüksek";
  return "Orta";
}

/** AI 1 — Groq market demand & competition analyst (weight 55%). */
async function runMarketDemandAI(
  productContext: string,
  country: string,
): Promise<{ ai_1_score: number; local_competition_level: LocalCompetition; market_note: string }> {
  const prompt = `You are AI 1 — the MARKET DEMAND & COMPETITION ANALYST of an e-commerce scoring engine.
Evaluate the product below ONLY for the target market: ${countryLabel(country)}.
Weigh: local search-volume trend, local purchasing power, seasonality right now, and marketplace saturation
in that specific country. Be decisive and country-specific — a product can be strong in one market and weak in another.

PRODUCT:
${productContext}

Return ONLY JSON:
{ "ai_1_score": number 0-100 (demand strength in ${countryLabel(country)}),
  "local_competition_level": "Düşük" | "Orta" | "Yüksek",
  "market_note": string (1 short Turkish sentence about local demand) }`;
  try {
    const text = await callGroq(prompt, 0.3);
    const raw = extractJson<Record<string, unknown>>(text, {});
    return {
      ai_1_score: clamp100(raw["ai_1_score"]),
      local_competition_level: normalizeCompetition(raw["local_competition_level"]),
      market_note: String(raw["market_note"] ?? ""),
    };
  } catch {
    // Groq unavailable — degrade to Gemini so scoring never deadlocks.
    try {
      const text = await callGemini(prompt, GEMINI_1(), 0.4, true, FLASH);
      const raw = extractJson<Record<string, unknown>>(text, {});
      return {
        ai_1_score: clamp100(raw["ai_1_score"]),
        local_competition_level: normalizeCompetition(raw["local_competition_level"]),
        market_note: String(raw["market_note"] ?? ""),
      };
    } catch {
      return { ai_1_score: 50, local_competition_level: "Orta", market_note: "" };
    }
  }
}

/** AI 2 — Gemini API 1, profit margin & logistics analyst (weight 45%). */
async function runLogisticsAI(
  productContext: string,
  country: string,
): Promise<{ ai_2_score: number; estimated_shipping_days: number; logistics_note: string }> {
  const prompt = `You are AI 2 — the PROFIT MARGIN & LOGISTICS ANALYST of an e-commerce scoring engine.
Evaluate the product below ONLY for shipping and selling into: ${countryLabel(country)}.
Weigh: shipping feasibility from typical Asian suppliers, cross-border VAT/tax impact, import duties,
customs/compliance friction, and typical realistic delivery timeframes to that country, and how all of that
affects the net margin.

PRODUCT:
${productContext}

Return ONLY JSON:
{ "ai_2_score": number 0-100 (margin + logistics soundness for ${countryLabel(country)}),
  "estimated_shipping_days": number (typical door-to-door delivery days),
  "logistics_note": string (1 short Turkish sentence on tax/shipping impact) }`;
  try {
    const text = await callGemini(prompt, GEMINI_1(), 0.4, false, FLASH);
    const raw = extractJson<Record<string, unknown>>(text, {});
    const days = Number(raw["estimated_shipping_days"]);
    return {
      ai_2_score: clamp100(raw["ai_2_score"]),
      estimated_shipping_days: Number.isFinite(days) ? Math.max(1, Math.min(90, Math.round(days))) : 12,
      logistics_note: String(raw["logistics_note"] ?? ""),
    };
  } catch {
    return { ai_2_score: 50, estimated_shipping_days: 12, logistics_note: "" };
  }
}

/** AI 3 — Gemini API 2, country cross-match engine (fallback scenario B). */
export async function runCountryCrossMatch(
  productContext: string,
  country: string,
): Promise<{ alt_country_code?: string; alt_country_name?: string; alt_country_note?: string }> {
  const prompt = `You are AI 3 — the COUNTRY CROSS-MATCH ENGINE.
The product below scored poorly for the target market ${countryLabel(country)}.
Identify ONE alternative country (from: ${ALT_CODES}) where this product currently has clearly
higher demand and better unit economics.

PRODUCT:
${productContext}

Return ONLY JSON:
{ "alt_country_code": one of ${ALT_CODES},
  "alt_country_name": string (country name in Turkish, e.g. "Almanya"),
  "alt_country_note": string (1 short Turkish sentence why that market is stronger) }`;
  try {
    const text = await callGemini(prompt, GEMINI_2(), 0.5, true, FLASH);
    const raw = extractJson<Record<string, unknown>>(text, {});
    const code = String(raw["alt_country_code"] ?? "").toUpperCase();
    if (!code || code === country.toUpperCase()) return {};
    return {
      alt_country_code: code,
      alt_country_name: String(raw["alt_country_name"] ?? countryLabel(code)),
      alt_country_note: String(raw["alt_country_note"] ?? ""),
    };
  } catch {
    return {};
  }
}

/** AI 4 — Gemini API 3, localized tooltip & card summary generator. */
async function runTooltipAI(
  productContext: string,
  country: string,
  score: number,
): Promise<{ tooltip: string; badge_note: string }> {
  const prompt = `You are AI 4 — the UI COPY GENERATOR of an e-commerce dashboard (Turkish interface).
Write short localized card copy for the product below, targeting ${countryLabel(country)} with hybrid score ${score}/100.

PRODUCT:
${productContext}

Return ONLY JSON:
{ "tooltip": string (max 140 chars, Turkish, why this product fits/doesn't fit this market),
  "badge_note": string (max 40 chars, Turkish, a punchy card sub-label) }`;
  try {
    const text = await callGemini(prompt, GEMINI_3(), 0.7, false, FLASH);
    const raw = extractJson<Record<string, unknown>>(text, {});
    return {
      tooltip: String(raw["tooltip"] ?? "").slice(0, 200),
      badge_note: String(raw["badge_note"] ?? "").slice(0, 60),
    };
  } catch {
    return { tooltip: "", badge_note: "" };
  }
}

/** Runs AI 1 + AI 2 in parallel, applies the weighted formula, adds AI 4 copy. */
export async function scoreProductForCountry(
  productContext: string,
  country: string,
): Promise<HybridScore> {
  const [market, logistics] = await Promise.all([
    runMarketDemandAI(productContext, country),
    runLogisticsAI(productContext, country),
  ]);
  const calculated = Math.round(
    market.ai_1_score * HYBRID_WEIGHT_AI1 + logistics.ai_2_score * HYBRID_WEIGHT_AI2,
  );
  const copy = await runTooltipAI(productContext, country, calculated);
  return {
    target_country: (country || "GLOBAL").toUpperCase(),
    ai_1_score: market.ai_1_score,
    local_competition_level: market.local_competition_level,
    market_note: market.market_note,
    ai_2_score: logistics.ai_2_score,
    estimated_shipping_days: logistics.estimated_shipping_days,
    logistics_note: logistics.logistics_note,
    calculated_score: calculated,
    tooltip: copy.tooltip,
    badge_note: copy.badge_note,
  };
}
