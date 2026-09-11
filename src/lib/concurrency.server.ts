// ============================================================================
// Bounded parallel batches (server only)
//
// Long pipelines mix "must be independent" work (scraping, DB writes, LLM
// calls per item) with provider rate limits. `mapBatched` / `settleBatched` run
// that work concurrently in small batches instead of one-by-one, while keeping
// result order and containing per-item failures so one rejection can never
// kill the batch (or the request).
//
// `settleWithDeadline` is the gateway-safe variant: a fan-out of LLM calls can
// stall on one slow provider for minutes, so it stops waiting once the budget
// is spent and hands back the results that did arrive.
// ============================================================================

import type { Deadline } from "./deadline.server";

/** Marks a task that never reported back before the deadline. */
export class DeadlineExceededError extends Error {
  constructor(message = "Task did not finish before the request budget") {
    super(message);
    this.name = "DeadlineExceededError";
  }
}

export function clampBatchSize(size: number | undefined, fallback = 3): number {
  const n = Math.floor(Number(size));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 12);
}

/**
 * Maps `items` through `fn` in batches of `batchSize`, preserving input order.
 * Returns a settled result per item — a failing item never rejects the call.
 */
export async function mapBatched<T, R>(
  items: readonly T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const size = clampBatchSize(batchSize);
  const results: Array<PromiseSettledResult<R>> = [];

  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const settled = await Promise.allSettled(batch.map((item, offset) => fn(item, start + offset)));
    results.push(...settled);
  }

  return results;
}

/** Splits a list of independent thunks into batches and runs each batch in parallel. */
export async function settleBatched<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  batchSize: number,
): Promise<Array<PromiseSettledResult<T>>> {
  return mapBatched(tasks, batchSize, (task) => task());
}

/**
 * Runs every task in parallel and stops waiting when `deadline` is spent.
 *
 * Unlike `Promise.allSettled` this never blocks on a stalled provider: the
 * returned array always has one entry per task (unfinished ones become a
 * `DeadlineExceededError` rejection) and `timedOut` tells the caller whether
 * the result set is partial. Late settle-ups after the deadline are ignored.
 */
export async function settleWithDeadline<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  deadline: Deadline,
): Promise<{ results: Array<PromiseSettledResult<T>>; timedOut: boolean }> {
  const slots: Array<PromiseSettledResult<T> | undefined> = new Array(tasks.length).fill(undefined);
  const running = Promise.all(
    tasks.map(async (task, index) => {
      try {
        slots[index] = { status: "fulfilled", value: await task() };
      } catch (reason) {
        slots[index] = { status: "rejected", reason };
      }
    }),
  );

  const timedOut = (await deadline.race(running)) === null;

  return {
    timedOut,
    results: slots.map(
      (slot): PromiseSettledResult<T> =>
        slot ?? { status: "rejected", reason: new DeadlineExceededError() },
    ),
  };
}

/** Resolves with the fulfilled values only (failed items are dropped). */
export function fulfilled<T>(results: ReadonlyArray<PromiseSettledResult<T>>): T[] {
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled")
    .map((r) => r.value);
}
