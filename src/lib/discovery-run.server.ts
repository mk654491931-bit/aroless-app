// ============================================================================
// Async Product Discovery — orchestrator (server only)
//
// Runs one job off the client's HTTP connection, so Cloudflare's 100s wall can
// no longer answer 524. It reuses the *existing* engines unchanged:
//
//   • `buildMarketScan`            — the live product retriever (Gemini +
//     Google-grounded scan) that already powers the streaming feed. Every
//     product is pushed to Postgres the moment it is produced.
//   • `runCouncil`                 — the real 14-agent council, with its
//     observer stream mapped onto a 14-row progress table. Prompts, tier order,
//     scoring and the 24h cache are untouched.
//   • `rankProfitable`             — the existing profitability ranking.
//
// What this module adds is orchestration only: durable progress, partial
// results, idempotency and the failure policy (refund only when a job produced
// nothing).
// ============================================================================

import { createDeadline, WORKER_BUDGET_MS } from "./deadline.server";
import {
  agentCompletionRatio,
  applyAgentEvent,
  initialAgentProgress,
  progressForStage,
  type DiscoveryAgentProgress,
  type DiscoveryJobResult,
  type DiscoveryTransientState,
} from "./discovery-jobs.shared";
import {
  claimJob,
  finishJob,
  getJobAny,
  readJobTransient,
  refundJob,
  writeJobProgress,
} from "./discovery-jobs.server";
import { acquireJobLock, releaseJobLock } from "./redis.server";
import type { AgentBusEvent } from "./agent-bus.server";
import type { CouncilReport } from "./council.server";
import type { StreamedProduct } from "./product-stream.shared";

export type DiscoveryRunOutcome =
  | { kind: "completed"; jobId: string; persisted: number; partial: boolean }
  /**
   * `unavailable` is a storage outage, not a bad job: the worker must answer
   * 5xx so QStash retries instead of treating the run as a no-op.
   */
  | { kind: "refused"; jobId: string; reason: "terminal" | "busy" | "missing" | "unavailable" }
  | { kind: "failed"; jobId: string; message: string };

const MAX_RESULT_PRODUCTS = 24;

/**
 * Runs one job.
 *
 * Callers (the worker route) translate `refused: "busy"` into HTTP 429 so
 * QStash retries later; everything else is already final.
 */
export async function runDiscoveryJob(jobId: string): Promise<DiscoveryRunOutcome> {
  // 1. Single-execution gate. Postgres is authoritative here, Redis is only the
  //    fast path.
  const claim = await claimJob(jobId);
  if (!claim.ok) {
    // Storage unavailable: do NOT run. Retrying is safe, running blind is not
    // (it could duplicate work and duplicate DB writes).
    return { kind: "refused", jobId, reason: "unavailable" };
  }
  if (!claim.claimed) {
    if (claim.status === "missing" || !claim.status) {
      return { kind: "refused", jobId, reason: "missing" };
    }
    if (claim.status === "running" || claim.status === "queued") {
      return { kind: "refused", jobId, reason: "busy" };
    }
    return { kind: "refused", jobId, reason: "terminal" };
  }

  const hasLock = await acquireJobLock(jobId);
  if (!hasLock) return { kind: "refused", jobId, reason: "busy" };

  const deadline = createDeadline(WORKER_BUDGET_MS);
  let agents: DiscoveryAgentProgress[] = initialAgentProgress();
  const collected: StreamedProduct[] = [];
  let persisted = 0;
  let failedWrites = 0;
  let council: CouncilReport | null = null;
  let agentsFailed = 0;

  try {
    const job = await getJobAny(jobId);
    if (!job) return { kind: "refused", jobId, reason: "missing" };

    // A resumed run keeps the progress the previous attempt already reported.
    const previous = await readJobTransient(jobId);
    if (previous?.agents?.length) agents = previous.agents;

    const niche = String(job.niche ?? "").slice(0, 80);
    const targetCountry = String(job.target_country ?? "GLOBAL").toUpperCase();
    const traceId = `pd_${jobId.slice(0, 8)}`;
    const startedAt = Date.now();

    const publish = async (
      state: DiscoveryTransientState,
      options: { persist?: boolean; stageChanged?: boolean } = {},
    ): Promise<void> => {
      await writeJobProgress(jobId, state, {
        persist: options.persist ?? false,
        ...(options.stageChanged ? { stageChanged: true } : {}),
      });
    };

    // ---- Phase 1: live retrieval + immediate DB push -----------------------
    await publish(
      { stage: "retrieving", progress: progressForStage("retrieving", 0) },
      {
        persist: true,
        stageChanged: true,
      },
    );

    const { buildMarketScan } = await import("./hot-scan.server");
    const { persistStreamedProduct } = await import("./product-store.server");

    const scan = await buildMarketScan(niche, {
      signal: deadline.signal,
      concurrency: 3,
      onItem: async (product, index) => {
        collected.push(product);
        const outcome = await persistStreamedProduct(product, {
          userId: job.user_id,
          targetCountry,
        });
        if (outcome.saved) persisted += 1;
        else if (outcome.error) failedWrites += 1;

        await publish({
          stage: "retrieving",
          progress: progressForStage("retrieving", Math.min(1, (index + 1) / Math.max(1, 12))),
        });
      },
    });

    if (collected.length === 0 && scan.items.length > 0) collected.push(...scan.items);

    await publish(
      {
        stage: "persisting",
        progress: progressForStage("persisting"),
      },
      { persist: true, stageChanged: true },
    );

    // ---- Phase 2: the real 14-agent council, with live agent progress ------
    let councilSkipped = false;
    if (deadline.expired()) {
      councilSkipped = true;
    } else {
      await publish(
        { stage: "council", progress: progressForStage("council", 0) },
        {
          persist: true,
          stageChanged: true,
        },
      );

      const observer = (event: AgentBusEvent): void => {
        const payload = event.payload as Record<string, unknown>;
        const agent = String(payload["agent"] ?? "");
        if (!agent) return;

        if (event.type === "agent:start") {
          agents = applyAgentEvent(agents, { agent, phase: "running" });
        } else if (event.type === "agent:complete") {
          agents = applyAgentEvent(agents, {
            agent,
            phase: payload["ok"] === false ? "error" : "complete",
            ...(typeof payload["ms"] === "number" ? { ms: payload["ms"] as number } : {}),
          });
        } else if (event.type === "agent:error") {
          agentsFailed += 1;
          agents = applyAgentEvent(agents, {
            agent,
            phase: "error",
            error: String(payload["error"] ?? "").slice(0, 200),
          });
        } else {
          return;
        }

        // Fire-and-forget: progress reporting must never slow the agents down.
        void publish({
          stage: "council",
          progress: progressForStage("council", agentCompletionRatio(agents)),
          agents,
        });
      };

      const councilQuery = (collected[0]?.name ?? niche).slice(0, 140);
      try {
        const { runCouncil } = await import("./council.server");
        council = await runCouncil(councilQuery, targetCountry, "General", "tr", observer);
      } catch (error) {
        // A council failure is not a job failure: products are already stored.
        agentsFailed += 1;
        console.error("[discovery-run] council failed", error);
      }
    }

    // ---- Phase 3: ranking --------------------------------------------------
    await publish(
      {
        stage: "ranking",
        progress: progressForStage("ranking", 0),
        agents,
      },
      { persist: true, stageChanged: true },
    );

    let products = collected;
    try {
      const { rankProfitable } = await import("./profitability");
      const ranked = rankProfitable(collected);
      if (ranked.length) products = ranked;
    } catch {
      /* ranking is an optimisation, not a requirement */
    }

    const partial = deadline.expired() || agentsFailed > 0 || councilSkipped;
    const result: DiscoveryJobResult = {
      traceId,
      niche,
      targetCountry,
      products: products.slice(0, MAX_RESULT_PRODUCTS),
      persisted,
      failedWrites,
      partial,
      ...(partial
        ? {
            partialReason: (deadline.expired() ? "gateway_budget" : "agent_failures") as
              "gateway_budget" | "agent_failures",
          }
        : {}),
      agents,
      council: council
        ? {
            veloraScore: council.velora_score,
            verdict: council.verdict,
            confidence: council.confidence,
            executiveReport: council.executive_report,
            cacheHit: council.cache_hit,
            agentsCompleted: council.teams.length * 2 + 2,
            agentsFailed,
          }
        : null,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };

    const finished = await finishJob(
      jobId,
      "completed",
      result,
      partial && products.length === 0 ? "partial_empty" : null,
    );

    // If the durable write failed the job stays `running` and QStash retries;
    // re-running is safe because the claim RPC is idempotent.
    if (!finished) return { kind: "failed", jobId, message: "finish_failed" };

    return { kind: "completed", jobId, persisted, partial };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[discovery-run] job failed", message);
    await finishJob(jobId, "failed", null, message.slice(0, 300));
    // Fairness: a job that produced nothing is refunded. A job that stored
    // products fails soft (partial) and keeps the charge.
    if (collected.length === 0) await refundJob(jobId);
    return { kind: "failed", jobId, message };
  } finally {
    deadline.dispose();
    await releaseJobLock(jobId);
  }
}
