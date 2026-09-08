// ============================================================================
// "Product Finder & Consensus Engine" — 3-Agent AI orchestration (server only)
//
//   Agent 3 (Market & Search Engine)  -> live market scan, raw candidates
//   Agent 1 (Product Finder)          -> optimistic growth strategist
//   Agent 2 (Risk & Audit Agent)      -> ruthless e-commerce auditor
//   Agent 4 (Independent Verifier)    -> different model family, fresh verdict
//
// Consensus rule: a product survives ONLY IF every participating agent
// APPROVES and the average of their scores is >= CONSENSUS_MIN_AVG.
//
// Provider selection and the consensus rule live in agent-orchestration.ts so
// they are bounded and testable. Every attempt is time-limited: before, the
// fallback chain awaited each provider indefinitely, so a provider that
// stopped answering mid-stream stalled the whole run and the fallbacks below
// it were never reached.
// ============================================================================
import { callGemini, callGroq, callLovableAI, extractJson } from "./ai.server";
import { CONSENSUS_MIN_AVG, type AgentVerdict, type ConsensusResult } from "./consensus-types";
import {
  consensusDecision,
  describeFailure,
  runWithFallback,
  safeSink,
  type AgentEventSink,
  type AgentStage,
} from "./agent-orchestration";
export { CONSENSUS_MIN_AVG };
export type { AgentVerdict, ConsensusResult };
export type { AgentEvent, AgentEventSink } from "./agent-orchestration";

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

const FLASH = ["gemini-1.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
const PRO = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-flash-latest"];

/** Per-provider ceiling for a debating agent. */
export const AGENT_CALL_TIMEOUT_MS = 45_000;
/** The verifier is advisory: if it is slow, the run proceeds without it. */
export const VERIFIER_TIMEOUT_MS = 25_000;

/**
 * Resilient AI call: Gemini → AI gateway → Groq. Never deadlocks.
 *
 * apiKey undefined bırakılır: callGemini havuzdaki 5 Gemini anahtarını
 * (GEMINI_API_KEY_1..5) round-robin kullanır, kotalı anahtarı beklemeye alır.
 *
 * Each provider now gets AGENT_CALL_TIMEOUT_MS, and exhausted providers are
 * logged rather than swallowed, so a run that silently degraded to the
 * third-choice provider is visible in the logs.
 */
async function agentCall(
  prompt: string,
  temperature: number,
  grounded: boolean,
  models: string[],
  stage: AgentStage = "finder",
  emit: AgentEventSink = () => {},
): Promise<string> {
  const result = await runWithFallback<string>(
    [
      {
        name: "gemini",
        call: () => callGemini(prompt, undefined, temperature, grounded, models),
      },
      { name: "gateway", call: () => callLovableAI(prompt, temperature) },
      { name: "groq", call: () => callGroq(prompt, temperature) },
    ],
    {
      timeoutMs: AGENT_CALL_TIMEOUT_MS,
      onFailure: (failure) => {
        console.warn(`[agents] ${stage}: ${failure.name} failed`, describeFailure(failure.error));
        emit({ type: "provider:fallback", stage, at: Date.now(), from: failure.name });
      },
    },
  );

  if (!result.ok) throw new Error("All AI providers are temporarily unavailable.");
  return result.value;
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
export async function runMarketAgent(
  input: {
    query: string;
    platforms: string[];
    budget?: string;
  },
  onEvent?: AgentEventSink,
): Promise<MarketScan> {
  const emit = safeSink(onEvent);
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
  emit({ type: "stage:start", stage: "market", at: Date.now() });
  try {
    const text = await agentCall(prompt, 0.6, true, FLASH, "market", emit);
    const parsed = extractJson<MarketScan>(text, { candidates: [], market_note: "" });
    emit({ type: "stage:done", stage: "market", at: Date.now() });
    return {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 10) : [],
      market_note: String(parsed.market_note ?? ""),
    };
  } catch (error) {
    emit({
      type: "stage:failed",
      stage: "market",
      at: Date.now(),
      reason: describeFailure(error),
    });
    return { candidates: [], market_note: "" };
  }
}

/** AGENT 1 — Product Finder. Optimistic strategist defending the product. */
export async function runFinderAgent(
  context: string,
  onEvent?: AgentEventSink,
): Promise<AgentVerdict> {
  const emit = safeSink(onEvent);
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
  emit({ type: "stage:start", stage: "finder", at: Date.now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await agentCall(prompt, 0.8, false, FLASH, "finder", emit);
      const raw = extractJson<Partial<AgentVerdict>>(text, {});
      if (raw && (raw.score || raw.summary)) {
        emit({ type: "stage:done", stage: "finder", at: Date.now() });
        return toVerdict(raw, "No growth thesis returned.");
      }
    } catch {
      /* retry */
    }
  }
  emit({
    type: "stage:failed",
    stage: "finder",
    at: Date.now(),
    reason: "Agent 1 could not evaluate this product.",
  });
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
  onEvent?: AgentEventSink,
): Promise<AgentVerdict & { risk_flags: string[] }> {
  const emit = safeSink(onEvent);
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
  emit({ type: "stage:start", stage: "audit", at: Date.now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await agentCall(
        prompt,
        0.4,
        false,
        attempt === 0 ? PRO : FLASH,
        "audit",
        emit,
      );
      const raw = extractJson<Partial<AgentVerdict> & { risk_flags?: string[] }>(text, {});
      if (raw && (raw.score || raw.summary)) {
        const v = toVerdict(raw, "No audit returned.");
        emit({ type: "stage:done", stage: "audit", at: Date.now() });
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
  emit({
    type: "stage:failed",
    stage: "audit",
    at: Date.now(),
    reason: "Agent 2 could not audit this product.",
  });
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
  onEvent?: AgentEventSink,
): Promise<AgentVerdict | null> {
  const emit = safeSink(onEvent);
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
  emit({ type: "stage:start", stage: "verify", at: Date.now() });

  // Groq first (different model family = genuinely independent), gateway as a
  // backup. If both are unavailable the consensus falls back to agents 1 & 2.
  const result = await runWithFallback<string>(
    [
      { name: "groq", call: () => callGroq(prompt, 0.3) },
      { name: "gateway", call: () => callLovableAI(prompt, 0.3) },
    ],
    {
      timeoutMs: VERIFIER_TIMEOUT_MS,
      onFailure: (failure) => {
        console.warn("[agents] verify: provider failed", describeFailure(failure.error));
        emit({ type: "provider:fallback", stage: "verify", at: Date.now(), from: failure.name });
      },
    },
  );

  if (result.ok) {
    const raw = extractJson<Partial<AgentVerdict>>(result.value, {});
    if (raw && (raw.score || raw.summary)) {
      emit({ type: "stage:done", stage: "verify", at: Date.now(), provider: result.provider });
      return toVerdict(raw, "No verification returned.");
    }
  }

  emit({
    type: "stage:failed",
    stage: "verify",
    at: Date.now(),
    reason: "Verifier unavailable; consensus uses agents 1 & 2.",
  });
  return null;
}

/**
 * Runs the Agent 1 vs Agent 2 debate, adds Agent 4 verification, applies consensus.
 *
 * The order is sequential on purpose, not by neglect: Agent 2's prompt quotes
 * Agent 1's claim, and Agent 4's prompt quotes both summaries. Running them
 * concurrently would mean changing what each agent actually sees, which is a
 * product decision rather than a refactor.
 */
export async function runConsensus(
  input: {
    context: string;
    profit_margin_pct?: number;
    competition_level?: "Low" | "Medium" | "High";
  },
  onEvent?: AgentEventSink,
): Promise<ConsensusResult> {
  const emit = safeSink(onEvent);
  const agent1 = await runFinderAgent(input.context, emit);
  const audit = await runAuditAgent(input.context, agent1, emit);
  const agent4 = await runVerifierAgent(input.context, agent1, audit, emit);

  const decision = consensusDecision([agent1, audit, agent4], CONSENSUS_MIN_AVG);
  emit({ type: "stage:done", stage: "consensus", at: Date.now() });

  return {
    approved: decision.approved,
    average_score: decision.average_score,
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
