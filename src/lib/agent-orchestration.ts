// ============================================================================
// Orchestration primitives for the multi-agent product discovery engine.
//
// Everything here is provider-agnostic and pure enough to test: no fetch, no
// env, no Supabase. agents.server.ts supplies the actual AI calls.
//
// Why this exists: the agent layer used a nested try/catch pyramid for its
// provider fallback with no timeout anywhere, so a single provider that
// accepted the socket and then went quiet would hang one whole consensus run
// until the platform killed the function. There was also no way for a caller
// to observe progress, so a 3-agent debate looked like one long stall.
// ============================================================================

export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Reject if `task` has not settled within `ms`.
 *
 * Takes a factory rather than a promise so the timer starts with the work,
 * and clears the timer on settle so a resolved call cannot keep the event
 * loop (or a serverless invocation) alive.
 */
export function withTimeout<T>(
  task: () => Promise<T>,
  ms: number,
  label = "task",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TimeoutError(label, ms));
    }, ms);

    task().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type Provider<T> = {
  name: string;
  call: () => Promise<T>;
};

export type FallbackFailure = { name: string; error: unknown };

export type FallbackResult<T> =
  | { ok: true; value: T; provider: string; failures: FallbackFailure[] }
  | { ok: false; failures: FallbackFailure[] };

/**
 * Try providers in order until one succeeds, bounding each attempt.
 *
 * Replaces the nested try/catch pyramid. Two behavioural gains: every attempt
 * is time-bounded, and the failures are returned instead of swallowed, so a
 * run that silently degraded to the third-choice provider is now visible
 * rather than indistinguishable from a healthy run.
 */
export async function runWithFallback<T>(
  providers: ReadonlyArray<Provider<T>>,
  options: { timeoutMs?: number; onFailure?: (failure: FallbackFailure) => void } = {},
): Promise<FallbackResult<T>> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const failures: FallbackFailure[] = [];

  for (const provider of providers) {
    try {
      const value = await withTimeout(provider.call, timeoutMs, provider.name);
      return { ok: true, value, provider: provider.name, failures };
    } catch (error) {
      const failure = { name: provider.name, error };
      failures.push(failure);
      options.onFailure?.(failure);
    }
  }

  return { ok: false, failures };
}

/**
 * Map with bounded concurrency, preserving input order.
 *
 * Candidate scanning fans out over 6-10 products. Sequential await makes the
 * run as slow as the sum of every call; unbounded Promise.all trips provider
 * rate limits and gets the whole batch throttled. A small window is the only
 * shape that is both fast and survivable.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: ReadonlyArray<TIn>,
  limit: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const width = Math.max(1, Math.floor(limit));
  const results = new Array<TOut>(items.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, items.length) }, drain));
  return results;
}

/** Settle every task, keeping successes and reporting failures rather than throwing. */
export async function settleAll<T>(
  tasks: ReadonlyArray<{ name: string; call: () => Promise<T> }>,
): Promise<{ values: Array<{ name: string; value: T }>; failures: FallbackFailure[] }> {
  const settled = await Promise.allSettled(tasks.map((task) => task.call()));
  const values: Array<{ name: string; value: T }> = [];
  const failures: FallbackFailure[] = [];

  settled.forEach((outcome, index) => {
    const name = tasks[index]!.name;
    if (outcome.status === "fulfilled") values.push({ name, value: outcome.value });
    else failures.push({ name, error: outcome.reason });
  });

  return { values, failures };
}

// ---------------------------------------------------------------------------
// Consensus rule, extracted so it can be tested without calling a model.
// ---------------------------------------------------------------------------

export type AgentDecision = "APPROVED" | "REJECTED";

export type ScoredVerdict = { score: number; decision: AgentDecision };

export type ConsensusDecision = {
  approved: boolean;
  average_score: number;
  votes: number;
};

/**
 * A product survives only if every participating agent approves AND the mean
 * score clears the threshold. Unanimity is the point: the auditor exists to
 * veto the optimist, so "majority" would defeat the design.
 *
 * Absent agents (a provider was down) are skipped rather than counted as a
 * rejection, which matches the existing `!agent4 || approved` behaviour.
 */
export function consensusDecision(
  verdicts: ReadonlyArray<ScoredVerdict | null | undefined>,
  minimumAverage: number,
): ConsensusDecision {
  const present = verdicts.filter((v): v is ScoredVerdict => Boolean(v));
  if (present.length === 0) return { approved: false, average_score: 0, votes: 0 };

  const total = present.reduce((sum, v) => sum + v.score, 0);
  const average = Math.round(total / present.length);
  const unanimous = present.every((v) => v.decision === "APPROVED");

  return {
    approved: unanimous && average >= minimumAverage,
    average_score: average,
    votes: present.length,
  };
}

// ---------------------------------------------------------------------------
// Progress events. Lets a caller stream stage updates instead of staring at a
// spinner for the whole debate. Emission never throws into the pipeline.
// ---------------------------------------------------------------------------

export type AgentStage = "market" | "finder" | "audit" | "verify" | "consensus";

export type AgentEvent =
  | { type: "stage:start"; stage: AgentStage; at: number }
  | { type: "stage:done"; stage: AgentStage; at: number; provider?: string }
  | { type: "stage:failed"; stage: AgentStage; at: number; reason: string }
  | { type: "provider:fallback"; stage: AgentStage; at: number; from: string };

export type AgentEventSink = (event: AgentEvent) => void;

/** Wrap a sink so a badly behaved listener cannot break an agent run. */
export function safeSink(sink?: AgentEventSink): AgentEventSink {
  return (event) => {
    if (!sink) return;
    try {
      sink(event);
    } catch (error) {
      console.error("[agents] event sink threw", error);
    }
  };
}

/** Human-readable failure text without leaking stack traces to the client. */
export function describeFailure(error: unknown): string {
  if (error instanceof TimeoutError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
