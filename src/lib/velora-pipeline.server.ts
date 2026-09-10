import { z } from "zod";
import {
  DEEP_CHAIN,
  executeAgentWithFallback,
  parseAgentJson,
  type AgentRunLog,
} from "./ai-router.server";
import { createAgentBus, type AgentBusObserver } from "./agent-bus.server";
import {
  COUNCIL_AGENTS,
  emitDebugLog,
  makeDebugLog,
  relaxSearchQuery,
  runStrictCouncilChain,
  type CouncilDebugLog,
} from "./council-chain.server";

export const PipelineInputSchema = z.object({
  userQuery: z.string().trim().min(2).max(2000),
  country: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(60).optional(),
  language: z.string().max(10).default("tr"),
});
export type PipelineInput = z.infer<typeof PipelineInputSchema>;

export const ProductSchema = z.object({
  name: z.string(),
  category: z.string().default(""),
  priceRange: z.string().default(""),
  estimatedMarginPct: z.number().default(0),
  demandScore: z.number().min(0).max(100).default(0),
  competitionScore: z.number().min(0).max(100).default(0),
  sentiment: z.string().default(""),
  whyNow: z.string().default(""),
  risks: z.array(z.string()).default([]),
  councilScore: z.number().min(0).max(100).default(50),
  councilDecision: z.string().default("NEUTRAL"),
});
export type Product = z.infer<typeof ProductSchema>;

export const PipelineOutputSchema = z.object({
  topProducts: z.array(ProductSchema).max(5),
  executiveSummary: z.string(),
  metrics: z.object({
    totalLatencyMs: z.number(),
    agentCount: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    providerHits: z.record(z.string(), z.number()),
    tierLatencyMs: z.record(z.string(), z.number()),
    logs: z.array(
      z.object({
        agent: z.string(),
        provider: z.string(),
        attempts: z.number(),
        latencyMs: z.number(),
        ok: z.boolean(),
        error: z.string().optional(),
      }),
    ),
    councilLogs: z.array(
      z.object({
        step: z.string(),
        input: z.string(),
        output: z.string(),
        item_count: z.number(),
        status: z.enum(["SUCCESS", "EMPTY", "FALLBACK_TRIGGERED"]),
      }),
    ),
    councilAverage: z.number().min(0).max(100),
    productFingerprint: z.number().min(0).max(100),
    finalScore: z.number().min(0).max(100),
    listed: z.boolean(),
    councilOutputs: z.string(),
    retrieverAttempts: z.number().int().min(0),
  }),
});
export type PipelineOutput = z.infer<typeof PipelineOutputSchema>;

type RetrieverCandidate = {
  name: string;
  category?: string;
  priceRange?: string;
  estimatedMarginPct?: number;
  demandScore?: number;
  competitionScore?: number;
  sentiment?: string;
  whyNow?: string;
  risks?: string[];
  [key: string]: unknown;
};

function normalizeRetrieverCandidates(raw: unknown): RetrieverCandidate[] {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { candidates?: unknown[] })
      : {};
  if (!Array.isArray(source.candidates)) return [];
  return source.candidates
    .flatMap((item): RetrieverCandidate[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const name = String(value.name ?? value.title ?? "").trim();
      if (!name) return [];
      return [
        {
          ...value,
          name: name.slice(0, 180),
          category: String(value.category ?? "").slice(0, 80),
          priceRange: String(value.priceRange ?? value.price_band_usd ?? "").slice(0, 80),
          estimatedMarginPct: Number.isFinite(Number(value.estimatedMarginPct))
            ? Number(value.estimatedMarginPct)
            : 0,
          demandScore: Number.isFinite(Number(value.demandScore)) ? Number(value.demandScore) : 50,
          competitionScore: Number.isFinite(Number(value.competitionScore))
            ? Number(value.competitionScore)
            : 50,
          sentiment: String(value.sentiment ?? "").slice(0, 240),
          whyNow: String(value.whyNow ?? value.why_now ?? "").slice(0, 400),
          risks: Array.isArray(value.risks) ? value.risks.slice(0, 5).map(String) : [],
        },
      ];
    })
    .slice(0, 12);
}

function retrieverPrompt(input: PipelineInput, query: string): string {
  return `You are the Product Retriever for Aroless. Search broadly for real, specific, nameable products related to the query.

QUERY: ${query}
COUNTRY: ${input.country ?? "GLOBAL"}
PLATFORM: ${input.platform ?? "any"}

Do not require every filter to match. Prefer broad keyword/semantic matches and return the three strongest alternatives even when the exact query has no result. Never return markdown. Return ONLY JSON:
{"candidates":[{"name":string,"category":string,"priceRange":string,"estimatedMarginPct":number,"demandScore":number 0-100,"competitionScore":number 0-100,"sentiment":string,"whyNow":string,"risks":string[]}],"search_note":string}`;
}

type AgentBusEmitter = Pick<ReturnType<typeof createAgentBus>, "emit">;

async function retrieveCandidates(
  input: PipelineInput,
  logs: AgentRunLog[],
  councilLogs: CouncilDebugLog[],
  bus?: AgentBusEmitter,
  traceId?: string,
): Promise<{ candidates: RetrieverCandidate[]; attempts: number }> {
  const queries = relaxSearchQuery(input.userQuery);
  let attempts = 0;
  const collected: RetrieverCandidate[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    attempts++;
    const agent = `Product Retriever (${attempts})`;
    const agentStart = Date.now();
    bus?.emit("agent:start", { traceId: traceId ?? "", agent, tier: 1 });
    let result;
    try {
      result = await executeAgentWithFallback(agent, retrieverPrompt(input, query), DEEP_CHAIN, {
        temperature: 0.35,
        retries: 2,
      });
    } catch (error) {
      bus?.emit("agent:error", {
        traceId: traceId ?? "",
        agent,
        error: error instanceof Error ? error.message : String(error),
      });
      bus?.emit("agent:complete", {
        traceId: traceId ?? "",
        agent,
        ok: false,
        ms: Date.now() - agentStart,
      });
      throw error;
    }
    logs.push(result.log);
    bus?.emit("agent:complete", {
      traceId: traceId ?? "",
      agent,
      ok: result.log.ok,
      ms: Date.now() - agentStart,
    });
    const parsed = parseAgentJson<{ candidates?: unknown[] }>(result.text, {});
    const candidates = normalizeRetrieverCandidates(parsed);
    for (const candidate of candidates) {
      const identity = candidate.name.toLocaleLowerCase("tr-TR");
      if (!seen.has(identity)) {
        seen.add(identity);
        collected.push(candidate);
      }
    }
    const status = candidates.length
      ? "SUCCESS"
      : attempts < queries.length
        ? "FALLBACK_TRIGGERED"
        : "EMPTY";
    const debug = makeDebugLog(
      "Product Retriever",
      { query, attempt: attempts },
      parsed,
      candidates.length,
      status,
    );
    councilLogs.push(debug);
    emitDebugLog(debug);
    if (collected.length >= 3) break;
  }

  const queryLabel = input.userQuery.trim();
  const fallbackNames = [
    queryLabel,
    `${queryLabel} için taşınabilir alternatif`,
    `${queryLabel} için premium alternatif`,
  ];
  const fallbackAlternatives = fallbackNames.slice(1).map((name) => ({
    name,
    category: "Broad match",
    priceRange: "",
    estimatedMarginPct: 0,
    demandScore: 50,
    competitionScore: 50,
    sentiment: "Neutral fallback; manual validation required.",
    whyNow: "Alternative retained for manual validation after broad query relaxation.",
    risks: ["Live evidence unavailable"],
  }));

  if (collected.length) {
    const merged = [...collected];
    for (const candidate of fallbackAlternatives) {
      if (merged.length >= 3) break;
      const identity = candidate.name.toLocaleLowerCase("tr-TR");
      if (!seen.has(identity)) {
        seen.add(identity);
        merged.push(candidate);
      }
    }
    const debug = makeDebugLog(
      "Product Retriever",
      { queries, attempts, collected: collected.length },
      merged.slice(0, 3),
      Math.min(3, merged.length),
      merged.length > collected.length ? "FALLBACK_TRIGGERED" : "SUCCESS",
    );
    councilLogs.push(debug);
    emitDebugLog(debug);
    return { candidates: merged.slice(0, 12), attempts };
  }

  const fallbackCandidates: RetrieverCandidate[] = fallbackNames.map((name, index) => ({
    name,
    category: "Broad match",
    priceRange: "",
    estimatedMarginPct: 0,
    demandScore: 50,
    competitionScore: 50,
    sentiment: "Neutral fallback; manual validation required.",
    whyNow:
      index === 0
        ? "Exact live match unavailable; retained as the closest query candidate."
        : "Alternative retained for manual validation after broad query relaxation.",
    risks: ["Live evidence unavailable"],
  }));
  const debug = makeDebugLog(
    "Product Retriever",
    { queries, attempts },
    fallbackCandidates,
    fallbackCandidates.length,
    "FALLBACK_TRIGGERED",
  );
  councilLogs.push(debug);
  emitDebugLog(debug);
  return { candidates: fallbackCandidates, attempts };
}

function toPipelineProducts(
  candidates: RetrieverCandidate[],
  finalScore: number,
  councilAverage: number,
  listed: boolean,
): Product[] {
  return candidates.slice(0, 5).map((candidate) =>
    ProductSchema.parse({
      name: candidate.name,
      category: candidate.category ?? "",
      priceRange: candidate.priceRange ?? "",
      estimatedMarginPct: Number(candidate.estimatedMarginPct ?? 0),
      demandScore: Math.max(0, Math.min(100, Number(candidate.demandScore ?? 50))),
      competitionScore: Math.max(0, Math.min(100, Number(candidate.competitionScore ?? 50))),
      sentiment: candidate.sentiment ?? "",
      whyNow: candidate.whyNow ?? "",
      risks: candidate.risks ?? [],
      councilScore: finalScore,
      councilDecision: listed ? "LISTED" : `REVIEW_${councilAverage}`,
    }),
  );
}

/** 14 agents receive the prior JSON state sequentially; no member can erase it. */
export async function runVeloraAgentPipeline(
  rawInput: unknown,
  options: { onEvent?: AgentBusObserver } = {},
): Promise<PipelineOutput> {
  const input = PipelineInputSchema.parse(rawInput);
  const traceId = `velora_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const bus = createAgentBus(traceId, options.onEvent);
  const started = Date.now();
  const logs: AgentRunLog[] = [];
  const councilLogs: CouncilDebugLog[] = [];
  const tierLatencyMs: Record<string, number> = {};

  bus.emit("pipeline:start", { traceId, query: input.userQuery.slice(0, 120) });
  const retrievalStart = Date.now();
  bus.emit("tier:start", { traceId, tier: 1 });
  const retrieval = await retrieveCandidates(input, logs, councilLogs, bus, traceId);
  tierLatencyMs.tier1 = Date.now() - retrievalStart;
  bus.emit("tier:complete", { traceId, tier: 1, ms: tierLatencyMs.tier1 });

  const councilStart = Date.now();
  bus.emit("tier:start", { traceId, tier: 2 });
  const chain = await runStrictCouncilChain({
    query: input.userQuery,
    context: [
      input.country ? `COUNTRY: ${input.country}` : "",
      input.platform ? `PLATFORM: ${input.platform}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    candidates: retrieval.candidates,
    run: async (agent, prompt) => {
      bus.emit("agent:start", { traceId, agent: agent.name, tier: 2 });
      const agentStart = Date.now();
      try {
        const result = await executeAgentWithFallback(`Council ${agent.name}`, prompt, DEEP_CHAIN, {
          temperature: 0.3,
          retries: 2,
        });
        logs.push(result.log);
        bus.emit("agent:complete", {
          traceId,
          agent: agent.name,
          ok: result.log.ok,
          ms: Date.now() - agentStart,
        });
        if (!result.log.ok) {
          bus.emit("agent:error", {
            traceId,
            agent: agent.name,
            error: result.log.error ?? "unknown",
          });
        }
        return {
          raw: parseAgentJson<Record<string, unknown>>(result.text, {}),
          ok: result.log.ok,
          error: result.log.error,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bus.emit("agent:error", { traceId, agent: agent.name, error: message });
        bus.emit("agent:complete", {
          traceId,
          agent: agent.name,
          ok: false,
          ms: Date.now() - agentStart,
        });
        return { raw: {}, ok: false, error: message };
      }
    },
  });
  councilLogs.push(...chain.logs);
  tierLatencyMs.tier2 = Date.now() - councilStart;
  bus.emit("tier:complete", { traceId, tier: 2, ms: tierLatencyMs.tier2 });

  const products = toPipelineProducts(
    retrieval.candidates,
    chain.finalScore,
    chain.councilAverage,
    chain.shouldList,
  );
  const executiveSummary = `14-agent council tamamlandı. Council average: ${chain.councilAverage}/100, product fingerprint: ${chain.productFingerprint}/100, final score: ${chain.finalScore}/100. ${chain.shouldList ? "Ürünler listeleniyor." : "Nötr sonuçlar korunarak incelemeye bırakıldı."}`;
  const providerHits: Record<string, number> = {};
  for (const log of logs) {
    providerHits[log.provider] = (providerHits[log.provider] ?? 0) + 1;
  }
  const succeeded = logs.filter((log) => log.ok).length;

  bus.emit("pipeline:complete", { traceId, ok: true, ms: Date.now() - started });
  return PipelineOutputSchema.parse({
    topProducts: products,
    executiveSummary,
    metrics: {
      totalLatencyMs: Date.now() - started,
      agentCount: COUNCIL_AGENTS.length,
      succeeded,
      failed: logs.length - succeeded,
      providerHits,
      tierLatencyMs,
      logs,
      councilLogs,
      councilAverage: chain.councilAverage,
      productFingerprint: chain.productFingerprint,
      finalScore: chain.finalScore,
      listed: chain.shouldList,
      councilOutputs: JSON.stringify(chain.outputs),
      retrieverAttempts: retrieval.attempts,
    },
  });
}
