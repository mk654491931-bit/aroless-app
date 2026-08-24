import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, jsonError, readJsonBody } from "@/lib/api-guard.server";
import type { HybridScore } from "@/lib/consensus-types";

/**
 * Deep analysis for a single Predictive Trends product.
 * All four engines work together on the same product:
 *   AI 1 (Groq)      — market demand & competition  (55% of hybrid score)
 *   AI 2 (Gemini 1)  — margin & logistics           (45% of hybrid score)
 *   AI 3 (Gemini 2)  — country cross-match fallback
 *   AI 4 (Gemini 3)  — card copy + final Turkish co-pilot commentary
 * Enriched with free external data: Google Trends + AliExpress sourcing.
 */

export type TrendAnalysis = {
  name: string;
  country: string;
  hybrid: HybridScore;
  sourcing: {
    supplier_price_usd: number;
    shipping_usd: number;
    source: string;
    sample_title: string;
  };
  trends: { yearly: number[]; monthly: number[]; momentum_pct: number; source: string };
  verdict: string;
  ai_comment: string;
  action_plan: string[];
  risks: string[];
  pricing: { suggested_retail_usd: number; margin_pct: number };
};

const cache = new Map<string, { at: number; data: TrendAnalysis }>();
const TTL = 60 * 60 * 1000;

async function build(input: {
  name: string;
  keyword: string;
  country: string;
  category: string;
  peak_month: string;
  spike_window: string;
  why: string;
  marketplace: string;
  audience: string;
  competition: string;
  score: number;
}): Promise<TrendAnalysis> {
  const { scoreProductForCountry, runCountryCrossMatch } =
    await import("@/lib/hybrid-scoring.server");
  const { getGoogleTrends, getSourcingEstimate } = await import("@/lib/market-data.server");
  const { callGemini, extractJson } = await import("@/lib/ai.server");

  const assumedRetail = 49;
  const [trends, sourcing] = await Promise.all([
    getGoogleTrends(input.keyword || input.name, input.country),
    getSourcingEstimate(input.keyword || input.name, assumedRetail),
  ]);

  const productContext = [
    `Product: ${input.name}`,
    `Search keyword: ${input.keyword}`,
    `Category: ${input.category} | Channel: ${input.marketplace}`,
    `Target country: ${input.country}`,
    `Seasonality: peak month ${input.peak_month}, spike window ${input.spike_window}`,
    `Seasonal reasoning: ${input.why}`,
    `Audience: ${input.audience} | Reported competition: ${input.competition}`,
    `Google Trends momentum: ${trends.momentum_pct}% (source: ${trends.source})`,
    `12-month interest series: ${trends.yearly.join(",")}`,
    `Live supplier cost: $${sourcing.supplier_price_usd} + $${sourcing.shipping_usd} shipping (source: ${sourcing.source})`,
  ].join("\n");

  const hybrid = await scoreProductForCountry(productContext, input.country);
  if (hybrid.calculated_score < 65) {
    Object.assign(hybrid, await runCountryCrossMatch(productContext, input.country));
  }

  const landed = sourcing.supplier_price_usd + sourcing.shipping_usd;
  const suggested = Math.max(landed * 2.6, landed + 12);
  const marginPct = Math.round(((suggested - landed) / suggested) * 100);

  const synthPrompt = `You are AI 4 — the CO-PILOT that merges the verdicts of three other analysts into one Turkish briefing for a dropshipper.

PRODUCT & LIVE DATA:
${productContext}

ANALYST OUTPUTS:
- AI 1 (demand, weight 55%): score ${hybrid.ai_1_score}/100, local competition ${hybrid.local_competition_level}. ${hybrid.market_note ?? ""}
- AI 2 (margin & logistics, weight 45%): score ${hybrid.ai_2_score}/100, ~${hybrid.estimated_shipping_days} days delivery. ${hybrid.logistics_note ?? ""}
- Hybrid score: ${hybrid.calculated_score}/100
${hybrid.alt_country_name ? `- AI 3 (cross-match): better market = ${hybrid.alt_country_name}. ${hybrid.alt_country_note ?? ""}` : ""}
- Suggested retail $${suggested.toFixed(2)} vs landed cost $${landed.toFixed(2)} (margin ${marginPct}%).

Return ONLY JSON (all text in Turkish):
{"verdict": string (max 90 chars, net karar: gir / bekle / geç),
 "ai_comment": string (3-5 cümlelik, üç analistin görüşünü harmanlayan yorum; çelişkileri açıkça belirt),
 "action_plan": string[4] (bu ürünü bu ülkede satmak için sıralı somut adımlar, tarih/sezon farkındalıklı),
 "risks": string[3] (gerçekçi riskler)}`;

  const key3 =
    process.env["GEMINI_API_KEY_3"] ||
    process.env["GEMINI_3_API_KEY"] ||
    process.env["GEMINI_API_KEY"];
  let synth: Record<string, unknown> = {};
  try {
    const text = await callGemini(synthPrompt, key3, 0.6, false, [
      "gemini-flash-latest",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ]);
    synth = extractJson<Record<string, unknown>>(text, {});
  } catch {
    /* fall through to defaults */
  }

  const arr = (v: unknown, n: number) =>
    Array.isArray(v) ? v.slice(0, n).map((x) => String(x)) : [];

  return {
    name: input.name,
    country: input.country,
    hybrid,
    sourcing,
    trends: {
      yearly: trends.yearly,
      monthly: trends.monthly,
      momentum_pct: trends.momentum_pct,
      source: trends.source,
    },
    verdict: String(
      synth["verdict"] ??
        (hybrid.calculated_score >= 70 ? "Girilebilir fırsat" : "Temkinli yaklaş"),
    ).slice(0, 120),
    ai_comment: String(synth["ai_comment"] ?? hybrid.tooltip ?? "").slice(0, 1200),
    action_plan: arr(synth["action_plan"], 5),
    risks: arr(synth["risks"], 4),
    pricing: { suggested_retail_usd: Math.round(suggested * 100) / 100, margin_pct: marginPct },
  };
}

export const Route = createFileRoute("/api/public/trend-analysis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardAuthed(request, "trend-analysis", 20, 60);
        if ("response" in guard) return guard.response;
        try {
          const body = await readJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");
          const name = String(body["name"] ?? "")
            .trim()
            .slice(0, 120);
          if (!name) return jsonError(400, "Ürün adı gerekli.");
          const input = {
            name,
            keyword: String(body["keyword"] ?? name).slice(0, 90),
            country: String(body["country"] ?? "GLOBAL")
              .toUpperCase()
              .slice(0, 8),
            category: String(body["category"] ?? "").slice(0, 80),
            peak_month: String(body["peak_month"] ?? "").slice(0, 20),
            spike_window: String(body["spike_window"] ?? "").slice(0, 40),
            why: String(body["why"] ?? "").slice(0, 400),
            marketplace: String(body["marketplace"] ?? "").slice(0, 40),
            audience: String(body["audience"] ?? "").slice(0, 160),
            competition: String(body["competition"] ?? "Medium").slice(0, 12),
            score: Number(body["score"]) || 0,
          };
          const ck = `${input.country}|${input.name}`;
          const hit = cache.get(ck);
          if (hit && Date.now() - hit.at < TTL) {
            return Response.json(hit.data);
          }
          const data = await build(input);
          cache.set(ck, { at: Date.now(), data });
          return Response.json(data);
        } catch (e) {
          return jsonError(500, "Analiz tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
