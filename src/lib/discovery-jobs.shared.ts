// ============================================================================
// Async Product Discovery — shared contract (client + server safe)
//
// Product Discovery no longer runs inside one request. The client starts a job,
// then polls a status endpoint; this module is the single, isomorphic
// definition of what a job is, so the API route, the background worker and the
// React panel can never drift apart.
//
// It contains **no secrets and no server-only imports**: the browser is only
// ever allowed to know a job id and a poll URL.
// ============================================================================

import type { StreamedProduct } from "./product-stream.shared";

/** Terminal states never run again. */
export const TERMINAL_JOB_STATUSES = ["completed", "failed", "canceled"] as const;

export type DiscoveryJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

/** Ordered pipeline phases. `progress` is derived from these, not guessed. */
export const DISCOVERY_STAGES = [
  { id: "queued", label: "Sıraya alındı", weight: 2 },
  { id: "retrieving", label: "Canlı ürün taraması", weight: 40 },
  { id: "persisting", label: "Veritabanına yazılıyor", weight: 13 },
  { id: "council", label: "14'lü AI Konsey doğrulaması", weight: 35 },
  { id: "ranking", label: "Skorlama ve sıralama", weight: 10 },
] as const;

export type DiscoveryStageId = (typeof DISCOVERY_STAGES)[number]["id"] | "done" | "failed";

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function stageLabel(stage: string): string {
  if (stage === "done") return "Tamamlandı";
  if (stage === "failed") return "Başarısız";
  return DISCOVERY_STAGES.find((s) => s.id === stage)?.label ?? "İşleniyor";
}

/**
 * Progress percentage for a stage plus partial progress inside that stage.
 *
 * `ratio` is clamped, so a misbehaving agent loop can never push the bar past
 * the stage it belongs to (and the bar never goes backwards on retries because
 * the caller takes the max).
 */
export function progressForStage(stage: string, ratio = 1): number {
  if (stage === "done") return 100;
  const index = DISCOVERY_STAGES.findIndex((s) => s.id === stage);
  if (index < 0) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const before = DISCOVERY_STAGES.slice(0, index).reduce((sum, s) => sum + s.weight, 0);
  const inside = DISCOVERY_STAGES[index]!.weight * clamped;
  return Math.max(0, Math.min(100, Math.round(before + inside)));
}

// ---------------------------------------------------------------------------
// The real 14-agent council dependency graph
//
// Mirrors `council.server.ts` exactly (producer teams → reviewers → director →
// auditor). The names are duplicated here on purpose: that file is server-only
// and would drag the AI clients into the browser bundle. `discovery-jobs.test.ts`
// asserts the two lists stay in sync.
//
// Dependency shape, from the real implementation:
//   tier 1 (6 producer teams)  — fully independent, safe to run in parallel
//   tier 2 (6 reviewer teams)  — each depends on its own producer only
//   tier 3 (director)          — depends on all 12 above
//   tier 4 (auditor)           — depends on the director
// A failure inside one tier-1/full-tier-2 pair must not stop its siblings, so
// the council treats each agent independently and degrades to partial results.
// ---------------------------------------------------------------------------
export const DISCOVERY_AGENTS = [
  { name: "Trend Ekibi", tier: 1, team: "market", dependsOn: [] },
  { name: "Finans Ekibi", tier: 1, team: "finance", dependsOn: [] },
  { name: "Pazarlama Ekibi", tier: 1, team: "marketing", dependsOn: [] },
  { name: "Operasyon Ekibi", tier: 1, team: "operations", dependsOn: [] },
  { name: "Uyum Ekibi", tier: 1, team: "compliance", dependsOn: [] },
  { name: "Yaratıcı Ekip", tier: 1, team: "creative", dependsOn: [] },
  { name: "Trend Hakemi", tier: 2, team: "market", dependsOn: ["Trend Ekibi"] },
  { name: "Finans Hakemi", tier: 2, team: "finance", dependsOn: ["Finans Ekibi"] },
  { name: "Pazarlama Hakemi", tier: 2, team: "marketing", dependsOn: ["Pazarlama Ekibi"] },
  { name: "Operasyon Hakemi", tier: 2, team: "operations", dependsOn: ["Operasyon Ekibi"] },
  { name: "Uyum Hakemi", tier: 2, team: "compliance", dependsOn: ["Uyum Ekibi"] },
  { name: "Yaratıcı Hakem", tier: 2, team: "creative", dependsOn: ["Yaratıcı Ekip"] },
  { name: "Müdür Sentezi", tier: 3, team: null, dependsOn: "all" },
  { name: "Bağımsız Denetçi", tier: 4, team: null, dependsOn: ["Müdür Sentezi"] },
] as const;

export const DISCOVERY_AGENT_COUNT = DISCOVERY_AGENTS.length;

/** Independent agents (tier 1) — the ones safe to fan out in parallel. */
export const PARALLEL_SAFE_AGENTS = DISCOVERY_AGENTS.filter((a) => a.tier === 1).map((a) => a.name);

export type DiscoveryAgentPhase = "waiting" | "running" | "complete" | "error";

export type DiscoveryAgentProgress = {
  name: string;
  tier: number;
  phase: DiscoveryAgentPhase;
  ms?: number;
  error?: string;
};

/** Fresh 14-row progress table, so the UI can render before any agent runs. */
export function initialAgentProgress(): DiscoveryAgentProgress[] {
  return DISCOVERY_AGENTS.map((agent) => ({
    name: agent.name,
    tier: agent.tier,
    phase: "waiting" as const,
  }));
}

/** Applies one agent event to a progress table, preserving order + history. */
export function applyAgentEvent(
  current: readonly DiscoveryAgentProgress[],
  event: {
    agent: string;
    phase: DiscoveryAgentPhase;
    ms?: number;
    error?: string;
  },
): DiscoveryAgentProgress[] {
  const known = DISCOVERY_AGENTS.find((a) => a.name === event.agent);
  const base = current.some((a) => a.name === event.agent)
    ? current
    : [
        ...current,
        {
          name: event.agent,
          tier: known?.tier ?? 0,
          phase: "waiting" as const,
        },
      ];

  return base.map((agent) => {
    if (agent.name !== event.agent) return agent;
    // A late/duplicate `running` frame must never undo a finished agent.
    if (agent.phase === "complete" && event.phase === "running") return agent;
    return {
      name: agent.name,
      tier: agent.tier,
      phase: event.phase,
      ...(typeof event.ms === "number" ? { ms: event.ms } : {}),
      ...(event.error ? { error: event.error } : {}),
    };
  });
}

/** Fraction of the 14 agents that reached a terminal-per-run phase. */
export function agentCompletionRatio(agents: readonly DiscoveryAgentProgress[]): number {
  if (agents.length === 0) return 0;
  const settled = agents.filter((a) => a.phase === "complete" || a.phase === "error").length;
  return settled / DISCOVERY_AGENTS.length;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type DiscoveryJobRequest = {
  niche: string;
  targetCountry?: string;
  /** Reserved for future engines so the wire format never has to change. */
  engine?: "discovery";
};

export type DiscoveryCouncilSummary = {
  veloraScore: number;
  verdict: string;
  confidence: number;
  executiveReport: string;
  cacheHit: boolean;
  agentsCompleted: number;
  agentsFailed: number;
};

export type DiscoveryJobResult = {
  traceId: string;
  niche: string;
  targetCountry: string;
  products: StreamedProduct[];
  persisted: number;
  failedWrites: number;
  partial: boolean;
  partialReason?: "gateway_budget" | "agent_failures";
  agents: DiscoveryAgentProgress[];
  council: DiscoveryCouncilSummary | null;
  durationMs: number;
  generatedAt: string;
};

export type DiscoveryJobView = {
  jobId: string;
  status: DiscoveryJobStatus;
  stage: string;
  stageLabel: string;
  progress: number;
  agents: DiscoveryAgentProgress[];
  partial: boolean;
  result: DiscoveryJobResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

/** Small durable key the client may hold. Never contains a secret. */
export function buildIdempotencyKey(input: {
  niche: string;
  targetCountry: string;
  bucket: number;
}): string {
  const slug = input.niche.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 48);
  return `pd:${slug}:${input.targetCountry.toUpperCase()}:${input.bucket}`;
}

/**
 * Idempotency window: the same niche+country inside the same 10-minute bucket
 * reuses the previous job instead of charging the user twice for a double
 * click, a retried fetch or an impatient second tap.
 */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

export function idempotencyBucket(now = Date.now()): number {
  return Math.floor(now / IDEMPOTENCY_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Durable row → wire view
//
// The durable job row (Postgres) is the source of truth. Redis only carries the
// fast-moving progress fields, so the merge rule is explicit:
//   • status/result/error/finished → durable row (Redis can never "complete" a
//     job, otherwise a lost Redis key would look like a finished job)
//   • stage/progress/agents/partial → whichever is further along, so a delayed
//     progress write can never rewind the UI
// ---------------------------------------------------------------------------

export type DiscoveryJobRow = {
  id: string;
  /** Owner. Used server-side for persistence + ownership; never sent to the wire view. */
  user_id: string;
  status: string;
  stage: string;
  progress: number;
  niche: string;
  target_country: string;
  result: DiscoveryJobResult | null;
  error: string | null;
  billing_state: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

/** Compact transient state written to Redis on every progress tick. */
export type DiscoveryTransientState = {
  stage?: string;
  progress?: number;
  agents?: DiscoveryAgentProgress[];
  partial?: boolean;
  updatedAt?: number;
};

function asStatus(value: string): DiscoveryJobStatus {
  return value === "running" || value === "completed" || value === "failed" || value === "canceled"
    ? value
    : "queued";
}

function asProgress(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function toJobView(
  row: DiscoveryJobRow,
  transient?: DiscoveryTransientState | null,
): DiscoveryJobView {
  const status = asStatus(row.status);
  const durableProgress = asProgress(row.progress, 0);
  const transientProgress = asProgress(transient?.progress, 0);
  // Never rewind; never let transient state claim the job finished.
  const progress = isTerminalStatus(status)
    ? status === "completed"
      ? 100
      : Math.max(durableProgress, transientProgress)
    : Math.max(durableProgress, transientProgress);

  // A non-terminal job must not display a terminal stage/progress from
  // transient state: Redis may only ever move a job *forward*, never declare it
  // finished. Only the durable row (finishJob) can do that.
  const transientStage =
    transient?.stage && transient.stage !== "done" && transient.stage !== "failed"
      ? transient.stage
      : "";
  const stage = transientStage || row.stage;
  const agents =
    transient?.agents && transient.agents.length > 0 ? transient.agents : initialAgentProgress();

  return {
    jobId: row.id,
    status,
    stage: isTerminalStatus(status) ? (status === "completed" ? "done" : "failed") : stage,
    stageLabel: stageLabel(stage),
    progress,
    agents,
    partial: Boolean(transient?.partial) || Boolean(row.result?.partial),
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  };
}
