// ============================================================================
// Bounded parallel batches (server only)
//
// Long pipelines mix "must be independent" work (scraping, DB writes, LLM
// calls per item) with provider rate limits. `mapBatched` / `settleBatched` run
// that work concurrently in small batches instead of one-by-one, while keeping
// result order and containing per-item failures so one rejection can never
// kill the batch (or the request).
// ============================================================================

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

/** Resolves with the fulfilled values only (failed items are dropped). */
export function fulfilled<T>(results: ReadonlyArray<PromiseSettledResult<T>>): T[] {
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled")
    .map((r) => r.value);
}
