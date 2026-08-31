// ============================================================================
// "Product Finder & Consensus Engine" — 3-Agent AI orchestration (server only)
//
//   Agent 3 (Market & Search Engine)  -> live market scan, raw candidates
//   Agent 1 (Product Finder)          -> optimistic growth strategist
//   Agent 2 (Risk & Audit Agent)      -> ruthless e-commerce auditor
//
// Consensus rule: a product survives ONLY IF both agents APPROVE and the
// average of their scores is >= 75.
// ============================================================================
import { callGemini, callGroq, callLovableAI, extractJson } from "./ai.server";
import { CONSENSUS_MIN_AVG, type AgentVerdict, type ConsensusResult } from "./consensus-types";
export { CONSENSUS_MIN_AVG };
export type { AgentVerdict, ConsensusResult };

export type MarketScan = {
  candidates: Array<{
    name: string;
    why_now: string;
    price_band_usd: string;
    supplier_cost_usd: string;
    demand_signal: string;
    channel: string;
  }>;
  market_note: string;
};

// Agent -> preferred key. Both naming styles are accepted; when a key is spent
// callGemini rotates to the next one in the shared pool automatically.
const AGENT3_KEY = () =>
  process.env["GEMINI_API_KEY_3"] ||
  process.env["GEMINI_3_API_KEY"] ||
  process.env["GEMINI_API_KEY"];
const AGENT1_KEY = () =>
  process.env["GEMINI_API_KEY_1"] ||
  process.env["GEMINI_1_API_KEY"] ||
  process.env["GEMINI_API_KEY"];
const AGENT2_KEY = () =>
  process.env["GEMINI_API_KEY_2"] ||
  process.env["GEMINI_2_API_KEY"] ||
  process.env["GEMINI_API_KEY"];

const FLASH = ["gemini-1.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
const PRO = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-flash-latest"];

/** Resilient AI call: Gemini → Lovable AI Gateway → Groq. Never deadlocks. */
async function agentCall(
  prompt: string,
  preferredKey: string | undefined,
  temperature: number,
  grounded: boolean,
  models: string[],
): Promise<string> {
  try {
    return await callGemini(prompt, preferredKey, temperature, grounded, models);
  } catch {
    // Gemini exhausted — try gateway
    try {
      return await callLovableAI(prompt, temperature);
    } catch {
      // Gateway down — try Groq
      try {
        return await callGroq(prompt, temperature);
      } catch {
        throw new Error("All AI providers are temporarily unavailable.");
      }
    }
  }
}

function clamp100(n: unknown, fb = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fb;
}

function toVerdict(raw: Partial<AgentVerdict> | undefined, fallbackSummary: string): AgentVerdict {
  return {
    score: clamp100(raw?.score, 0),
    decision: raw?.decision === "APPROVED" ? "APPROVED" : "REJECTED",
    summary: String(raw?.summary ?? fallbackSummary),
    points: Array.isArray(raw?.points) ? raw!.points.slice(0, 5).map(String) : [],
  };
}

/** AGENT 3 — Market & Search Engine. Scans live demand and extracts raw candidates. */
export async function runMarketAgent(input: {
  query: string;
  platforms: string[];
  budget?: string;
}): Promise<MarketScan> {
  const prompt = `You are AGENT 3 — the MARKET & SEARCH ENGINE of an e-commerce research system.
Scan live market trends, marketplace listings, ad libraries and short-form social buzz.

Query / niche / product: "${input.query}"
Sales channels: ${input.platforms.join(", ") || "any"}
Starting capital: ${input.budget ?? "unspecified"}

Extract RAW product candidates that are real, specific, nameable SKUs currently sold online.
No categories. No invented products. Use real supplier price bands (AliExpress/1688) and real retail bands.

Return ONLY JSON:
{ "candidates": [ { "name": string, "why_now": string (1 sentence demand signal happening right now), "price_band_usd": string, "supplier_cost_usd": string, "demand_signal": string (search/social/marketplace evidence), "channel": string (best sales channel) } ] (6-10 candidates),
  "market_note": string (1 sentence on the overall market condition) }`;
  try {
    const text = await agentCall(prompt, AGENT3_KEY(), 0.6, true, FLASH);
    const parsed = extractJson<MarketScan>(text, { candidates: [], market_note: "" });
    return {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 10) : [],
      market_note: String(parsed.market_note ?? ""),
    };
  } catch {
    return { candidates: [], market_note: "" };
  }
}

/** AGENT 1 — Product Finder. Optimistic strategist defending the product. */
export async function runFinderAgent(context: string): Promise<AgentVerdict> {
  const prompt = `You are AGENT 1 — the PRODUCT FINDER, an optimistic but evidence-driven e-commerce strategist.
Defend why the following product is (or is not) a WINNING PRODUCT. Focus on target-audience appeal, viral hooks,
marketing edges, differentiation and realistic upside. Be specific and numeric. Do not rubber-stamp: if the
opportunity is genuinely weak, REJECT it.

PRODUCT CONTEXT:
${context}

Return ONLY JSON:
{ "score": number 1-100 (your conviction this wins),
  "decision": "APPROVED" | "REJECTED",
  "summary": string (2 sentences: your growth thesis),
  "points": string[3-4] (concrete growth angles: hook, audience, channel, differentiation) }`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await agentCall(prompt, AGENT1_KEY(), 0.8, false, FLASH);
      const raw = extractJson<Partial<AgentVerdict>>(text, {});
      if (raw && (raw.score || raw.summary)) return toVerdict(raw, "No growth thesis returned.");
    } catch {
      /* retry */
    }
  }
  return {
    score: 0,
    decision: "REJECTED",
    summary: "Agent 1 could not evaluate this product.",
    points: [],
  };
}

/** AGENT 2 — Risk & Audit Agent. Ruthless auditor cross-examining Agent 1. */
export async function runAuditAgent(
  context: string,
  finder: AgentVerdict,
): Promise<AgentVerdict & { risk_flags: string[] }> {
  const prompt = `You are AGENT 2 — the RISK & AUDIT AGENT, a ruthless e-commerce auditor.
Cross-examine Agent 1's bullish case below. Hunt for supply-chain bottlenecks, ad saturation, margin squeeze,
return rates, IP/patent exposure, compliance and shipping/customs risk, platform policy risk. Be brutally honest.
Only APPROVE if the business case survives your audit.

PRODUCT CONTEXT:
${context}

AGENT 1 CLAIM (score ${finder.score}, ${finder.decision}): ${finder.summary}
AGENT 1 POINTS: ${finder.points.join(" | ") || "(none)"}

Return ONLY JSON:
{ "score": number 1-100 (how sound this is after audit),
  "decision": "APPROVED" | "REJECTED",
  "summary": string (2 sentences: your audit verdict, directly rebutting or conceding Agent 1),
  "points": string[3-4] (the audit findings),
  "risk_flags": string[3] (the top 3 concrete risks, short) }`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await agentCall(prompt, AGENT2_KEY(), 0.4, false, attempt === 0 ? PRO : FLASH);
      const raw = extractJson<Partial<AgentVerdict> & { risk_flags?: string[] }>(text, {});
      if (raw && (raw.score || raw.summary)) {
        const v = toVerdict(raw, "No audit returned.");
        return {
          ...v,
          risk_flags: Array.isArray(raw.risk_flags)
            ? raw.risk_flags.slice(0, 3).map(String)
            : v.points.slice(0, 3),
        };
      }
    } catch {
      /* retry */
    }
  }
  return {
    score: 0,
    decision: "REJECTED",
    summary: "Agent 2 could not audit this product.",
    points: [],
    risk_flags: [],
  };
}

/** AGENT 4 — Independent Verifier, powered by Groq (different model family). */
export async function runVerifierAgent(
  context: string,
  finder: AgentVerdict,
  auditor: AgentVerdict,
): Promise<AgentVerdict | null> {
  const prompt = `You are AGENT 4 — the INDEPENDENT VERIFIER of an e-commerce product research system.
Two other agents already debated this product. You run on a different model family and must give a fresh,
unbiased verdict. Weigh unit economics, real demand durability, and execution feasibility for a small seller.

PRODUCT CONTEXT:
${context}

AGENT 1 (Product Finder) — score ${finder.score}, ${finder.decision}: ${finder.summary}
AGENT 2 (Risk & Audit) — score ${auditor.score}, ${auditor.decision}: ${auditor.summary}

Return ONLY JSON:
{ "score": number 1-100 (your independent conviction),
  "decision": "APPROVED" | "REJECTED",
  "summary": string (2 sentences: your independent verdict and which agent you side with),
  "points": string[3] (the decisive factors) }`;
  try {
    const text = await callGroq(prompt, 0.3);
    const raw = extractJson<Partial<AgentVerdict>>(text, {});
    if (raw && (raw.score || raw.summary)) return toVerdict(raw, "No verification returned.");
  } catch {
    /* Groq unavailable — try Lovable AI gateway */
    try {
      const text = await callLovableAI(prompt, 0.3);
      const raw = extractJson<Partial<AgentVerdict>>(text, {});
      if (raw && (raw.score || raw.summary)) return toVerdict(raw, "No verification returned.");
    } catch {
      /* all providers unavailable — consensus falls back to agents 1 & 2 */
    }
  }
  return null;
}

/** Runs the Agent 1 vs Agent 2 debate, adds Agent 4 verification, applies consensus. */
export async function runConsensus(input: {
  context: string;
  profit_margin_pct?: number;
  competition_level?: "Low" | "Medium" | "High";
}): Promise<ConsensusResult> {
  const agent1 = await runFinderAgent(input.context);
  const audit = await runAuditAgent(input.context, agent1);
  const agent4 = await runVerifierAgent(input.context, agent1, audit);
  const scores = [agent1.score, audit.score, ...(agent4 ? [agent4.score] : [])];
  const average = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  const approved =
    agent1.decision === "APPROVED" &&
    audit.decision === "APPROVED" &&
    (!agent4 || agent4.decision === "APPROVED") &&
    average >= CONSENSUS_MIN_AVG;
  return {
    approved,
    average_score: average,
    agent1,
    agent2: {
      score: audit.score,
      decision: audit.decision,
      summary: audit.summary,
      points: audit.points,
    },
    ...(agent4 ? { agent4 } : {}),
    profit_margin_pct: Number(input.profit_margin_pct ?? 0) || 0,
    competition_level: input.competition_level ?? "Medium",
    risk_flags: audit.risk_flags,
  };
}
