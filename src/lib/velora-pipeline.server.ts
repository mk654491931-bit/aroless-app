import { z } from "zod";
import {
  DEEP_CHAIN,
  executeAgentWithFallback,
  parseAgentJson,
  type AgentRunLog,
} from "./ai-router.server";
import { withDeadline } from "./ai.server";
import { createAgentBus } from "./agent-bus.server";
import { combineJointScores } from "./consensus-types";
import { collectSignals, signalsBlock } from "./data-pipeline.server";
import { buildLiveEvidenceBlock } from "./market-verify.server";
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
    /** Analiz hattı tarafı: retriever'ın kanıt/çeşitlilik parmak izi. */
    analysisScore: z.number().min(0).max(100),
    /** ORTAK KARAR: analiz hattı ⊕ 14'lü konsey (eşit ortaklık). */
    jointScore: z.number().min(0).max(100),
    jointSource: z.enum(["joint", "analysis", "council", "none"]),
    /** Hattın gerçekten kullandığı ORTAK kanıt (trend radarı + canlı piyasa). */
    evidence: z.object({
      live: z.boolean(),
      scrapedTrends: z.number().int().min(0),
      radar: z.array(z.string()),
      sources: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["active", "error"]),
          items: z.number(),
        }),
      ),
    }),
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

/** Trend radarı kazımaları + canlı piyasa kanıtı için ayrılan süre (ms). */
export const VELORA_EVIDENCE_BUDGET_MS = 20_000;

export type VeloraEvidence = {
  /** Retriever'a ve 14 üyenin TAMAMINA giren ortak kanıt bloğu. */
  block: string;
  /** Trend radarı kazımalarından gelen tekil trend adları. */
  radar: string[];
  /** Hangi kaynak kaç satır verdi — dürüst raporlama. */
  sources: { name: string; status: "active" | "error"; items: number }[];
  /** Canlı piyasa kanıtı (Google Trends + tedarik fiyatı + ilanlar) geldi mi? */
  live: boolean;
};

export const EMPTY_VELORA_EVIDENCE: VeloraEvidence = {
  block: "",
  radar: [],
  sources: [],
  live: false,
};

/**
 * Velora hattının ORTAK kanıtı.
 *
 * Ürün bulucu ve 14'lü AI Konsey, trend radarının kazımalarını
 * (`data-pipeline.server.ts` → Google/Amazon/TikTok/Yandex/RSS/GitHub) ve canlı
 * piyasa kanıtını ortak veri olarak kullanıyor. Velora hattı daha önce YALNIZCA
 * AI'ya soruyordu; aynı soruya iki farklı gerçeklik üretiliyordu. Artık aynı
 * kazımalar çekiliyor ve retriever ile 14 üyenin HEPSİ aynı bloğu görüyor →
 * hat gerekirse scraping yapar ve konsey ile bulucu ORTAK karar verir.
 *
 * Her kaynak süre sınırlıdır: yavaş bir kaynak hattı bekletemez. Kanıt gelmezse
 * hat kanıtsız (ama dürüst) devam eder; hiçbir koşulda fırlatmaz.
 */
export async function collectVeloraEvidence(
  input: PipelineInput,
  budgetMs: number = VELORA_EVIDENCE_BUDGET_MS,
): Promise<VeloraEvidence> {
  const country = (input.country ?? "GLOBAL").toUpperCase();
  try {
    const [signalsOutcome, liveOutcome] = await Promise.allSettled([
      withDeadline(
        collectSignals(input.userQuery, country, input.platform ?? "General"),
        budgetMs,
        "velora:signals",
      ),
      withDeadline(buildLiveEvidenceBlock(input.userQuery, country), budgetMs, "velora:live"),
    ]);
    const signals = signalsOutcome.status === "fulfilled" ? signalsOutcome.value.data : null;
    const liveBlock = liveOutcome.status === "fulfilled" ? (liveOutcome.value ?? "") : "";
    const scrapedBlock = signals ? signalsBlock(signals) : "";
    return {
      block: [scrapedBlock, liveBlock].filter(Boolean).join("\n\n"),
      radar: signals?.radar ?? [],
      sources: signals?.sources ?? [],
      live: liveBlock.trim().length > 0,
    };
  } catch {
    // Kazıma hattı tamamen düşse bile Velora hattı çalışmaya devam eder.
    return EMPTY_VELORA_EVIDENCE;
  }
}

/**
 * Trend radarı kazımalarından gelen GERÇEK trend adlarını aday ürüne çevirir.
 *
 * AI retriever boş dönerse hat uydurma isim yerine kazınmış gerçek sinyali
 * kullanır (`"TikTok: mini ice maker"` → `mini ice maker`). Kaynak etiketi
 * adayın üzerinde kalır; kanıtın nereden geldiği kaybolmaz.
 */
export function scrapedCandidates(radar: string[]): RetrieverCandidate[] {
  const seen = new Set<string>();
  const out: RetrieverCandidate[] = [];
  for (const line of radar) {
    const raw = String(line ?? "").trim();
    if (!raw) continue;
    const [maybeSource, ...rest] = raw.split(":");
    const source = (rest.length ? (maybeSource ?? "").trim() : "") || "Trend Radar";
    const name = (rest.length ? rest.join(":") : raw).trim();
    if (name.length < 3) continue;
    const identity = name.toLocaleLowerCase("tr-TR");
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      name: name.slice(0, 180),
      category: "Trend radar (scraped)",
      priceRange: "",
      estimatedMarginPct: 0,
      demandScore: 60,
      competitionScore: 50,
      sentiment: `Kazınmış trend sinyali (${source}); manuel doğrulama gerekir.`,
      whyNow: `Trend radarı kazımasında canlı sinyal: ${raw.slice(0, 200)}`,
      risks: ["Canlı kazıma sinyali; tedarik/fiyat doğrulanmadı"],
    });
    if (out.length >= 12) break;
  }
  return out;
}

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
          demandScore: Number.isFinite(Number(value.demandScore))
            ? Number(value.demandScore)
            : 50,
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

function retrieverPrompt(input: PipelineInput, query: string, evidenceBlock = ""): string {
  return `You are the Product Retriever for Aroless. Search broadly for real, specific, nameable products related to the query.

QUERY: ${query}
COUNTRY: ${input.country ?? "GLOBAL"}
PLATFORM: ${input.platform ?? "any"}
${
  evidenceBlock
    ? `\nSHARED LIVE EVIDENCE (trend radar scrapings + live market verification — the SAME data the finder's analysis pipeline and the 14-member council use). Treat it as ground truth and prefer products that appear here:\n${evidenceBlock.slice(0, 4_000)}\n`
    : "\nSHARED LIVE EVIDENCE: none available for this run.\n"
}
Do not require every filter to match. Prefer broad keyword/semantic matches and return the three strongest alternatives even when the exact query has no result. Never return markdown. Return ONLY JSON:
{"candidates":[{"name":string,"category":string,"priceRange":string,"estimatedMarginPct":number,"demandScore":number 0-100,"competitionScore":number 0-100,"sentiment":string,"whyNow":string,"risks":string[]}],"search_note":string}`;
}

async function retrieveCandidates(
  input: PipelineInput,
  logs: AgentRunLog[],
  councilLogs: CouncilDebugLog[],
  evidence: VeloraEvidence,
): Promise<{ candidates: RetrieverCandidate[]; attempts: number }> {
  const queries = relaxSearchQuery(input.userQuery);
  let attempts = 0;
  const collected: RetrieverCandidate[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    attempts++;
    const result = await executeAgentWithFallback(
      `Product Retriever (${attempts})`,
      retrieverPrompt(input, query, evidence.block),
      DEEP_CHAIN,
      { temperature: 0.35, retries: 2 },
    );
    logs.push(result.log);
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

  // AI retriever boş döndü: uydurma isim yerine trend radarından GERÇEK kazınmış
  // trend adlarını aday olarak kullan (ortak scraping).
  const scraped = scrapedCandidates(evidence.radar);
  if (scraped.length) {
    const debug = makeDebugLog(
      "Product Retriever",
      { queries, attempts, source: "trend-radar-scrape", radar: evidence.radar.length },
      scraped.slice(0, 5),
      Math.min(3, scraped.length),
      "FALLBACK_TRIGGERED",
    );
    councilLogs.push(debug);
    emitDebugLog(debug);
    return { candidates: scraped, attempts };
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
export async function runVeloraAgentPipeline(rawInput: unknown): Promise<PipelineOutput> {
  const input = PipelineInputSchema.parse(rawInput);
  const traceId = `velora_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const bus = createAgentBus(traceId);
  const started = Date.now();
  const logs: AgentRunLog[] = [];
  const councilLogs: CouncilDebugLog[] = [];
  const tierLatencyMs: Record<string, number> = {};

  bus.emit("pipeline:start", { traceId, query: input.userQuery.slice(0, 120) });

  // ORTAK KANIT: trend radarı kazımaları + canlı piyasa kanıtı. Bulucu ve 14'lü
  // konsey aynı bloğu kullanır; Velora hattı da artık aynı veriye bakar.
  const evidenceStart = Date.now();
  const evidence = await collectVeloraEvidence(input);
  bus.emit("evidence:collected", {
    traceId,
    ms: Date.now() - evidenceStart,
    scraped: evidence.radar.length,
    live: evidence.live,
  });

  const retrievalStart = Date.now();
  bus.emit("tier:start", { traceId, tier: 1 });
  const retrieval = await retrieveCandidates(input, logs, councilLogs, evidence);
  tierLatencyMs.tier1 = Date.now() - retrievalStart;
  bus.emit("tier:complete", { traceId, tier: 1, ms: tierLatencyMs.tier1 });

  const councilStart = Date.now();
  bus.emit("tier:start", { traceId, tier: 2 });
  // 14 üyenin HEPSİ aynı kanıt bloğunu görür: konsey ile analiz hattı ayrı
  // gerçeklik üretmez; aynı kazınmış veriye bakıp ORTAK karar verir.
  const sharedContext = [
    input.country ? `COUNTRY: ${input.country}` : "",
    input.platform ? `PLATFORM: ${input.platform}` : "",
    evidence.block
      ? `SHARED LIVE EVIDENCE (trend radar scrapings + live market verification):\n${evidence.block}`
      : "SHARED LIVE EVIDENCE: none available for this run; score neutrally where it matters.",
  ]
    .filter(Boolean)
    .join("\n");
  const chain = await runStrictCouncilChain({
    query: input.userQuery,
    context: sharedContext,
    candidates: retrieval.candidates,
    run: async (agent, prompt) => {
      bus.emit("agent:start", { traceId, agent: agent.name, tier: 2 });
      const agentStart = Date.now();
      const result = await executeAgentWithFallback(
        `Council ${agent.name}`,
        prompt,
        DEEP_CHAIN,
        { temperature: 0.3, retries: 2 },
      );
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
    },
  });
  councilLogs.push(...chain.logs);
  tierLatencyMs.tier2 = Date.now() - councilStart;
  bus.emit("tier:complete", { traceId, tier: 2, ms: tierLatencyMs.tier2 });

  /**
   * ORTAK KARAR — Velora hattı da bulucuyla AYNI formülü kullanır: analiz hattı
   * (retriever'ın kanıt/çeşitlilik parmak izi) ⊕ 14'lü konsey ortalaması, eşit
   * ortaklık. Böylece hat "konsey puanı" ile "analiz puanı" arasında seçim
   * yapmaz; ikisini birlikte karara çevirir.
   */
  const joint = combineJointScores({
    analysisScore: chain.productFingerprint,
    councilScore: chain.councilAverage,
  });
  const listed = joint.score >= 60;
  const products = toPipelineProducts(
    retrieval.candidates,
    joint.score,
    chain.councilAverage,
    listed,
  );
  const executiveSummary = `14-agent council tamamlandı. Council average: ${chain.councilAverage}/100, product fingerprint: ${chain.productFingerprint}/100, ortak karar (analiz ⊕ konsey): ${joint.score}/100 (${joint.source}). ${listed ? "Ürünler listeleniyor." : "Nötr sonuçlar korunarak incelemeye bırakıldı."}`;
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
      finalScore: joint.score,
      listed,
      councilOutputs: JSON.stringify(chain.outputs),
      retrieverAttempts: retrieval.attempts,
      analysisScore: chain.productFingerprint,
      jointScore: joint.score,
      jointSource: joint.source,
      evidence: {
        live: evidence.live,
        scrapedTrends: evidence.radar.length,
        radar: evidence.radar.slice(0, 16),
        sources: evidence.sources,
      },
    },
  });
}
