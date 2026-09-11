// ============================================================================
// Gateway-safe deadline guard (server only)
//
// Cloudflare kills any request that stays open for 100s and answers with
// `524 A Timeout Occurred`, even when the origin is still working. Long
// scrapes / LLM chains therefore must never run past that window.
//
// A `Deadline` gives the work a hard budget:
//   • `signal` aborts (cooperatively) once the budget is spent, so scrapers,
//     DB writes and LLM calls stop instead of leaking.
//   • `race(work)` resolves to `null` instead of throwing, which is what lets
//     callers return PARTIAL results as a normal, successful response.
//   • `onExpire()` runs the producer's "flush what we already have" hook.
//
// Budget defaults stay ~5-8s under the hard limit so the response (and the
// last stream chunk) always leaves the origin before the proxy gives up.
// ============================================================================

/** Cloudflare's hard request limit. Never work up to this. */
export const GATEWAY_LIMIT_MS = 100_000;

/** Budget for streamed responses — leaves room to flush a final frame. */
export const STREAM_BUDGET_MS = 92_000;

/** Budget for plain JSON responses — leaves room to serialize and send. */
export const JSON_BUDGET_MS = 90_000;

/**
 * Sub-budget for the primary LLM fan-out inside a JSON request. Capping it
 * well below the outer budget keeps the retry/enrichment stages alive instead
 * of letting one stalled provider eat the whole request.
 */
export const FANOUT_BUDGET_MS = 45_000;

export type Deadline = {
  readonly budgetMs: number;
  readonly startedAt: number;
  /** Aborts when the budget is spent (or when the parent signal aborts). */
  readonly signal: AbortSignal;
  /** Milliseconds left before the budget is spent (never negative). */
  remaining(): number;
  expired(): boolean;
  /** Resolves with `null` (never throws) when the budget runs out first. */
  race<T>(work: Promise<T>): Promise<T | null>;
  /** Registers the "flush partial results" hook. */
  onExpire(handler: () => void): void;
  /** Clears the timer. Always call it when the work finishes early. */
  dispose(): void;
};

export function createDeadline(
  budgetMs: number = STREAM_BUDGET_MS,
  parent?: AbortSignal,
): Deadline {
  // Floor only guards against an accidental 0/negative budget; real callers
  // pass tens of seconds. Small values stay usable so the guard is testable.
  const budget = Math.max(50, Math.floor(budgetMs));
  const controller = new AbortController();
  const startedAt = Date.now();
  const handlers: Array<() => void> = [];
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
    for (const handler of handlers.splice(0)) {
      try {
        handler();
      } catch (error) {
        console.error("[deadline] expire handler failed", error);
      }
    }
  }, budget);
  // Never keep a Node process alive just for a deadline timer.
  (timer as { unref?: () => void }).unref?.();

  const onParentAbort = (): void => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  const dispose = (): void => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  };

  return {
    budgetMs: budget,
    startedAt,
    signal: controller.signal,
    remaining: () => Math.max(0, budget - (Date.now() - startedAt)),
    expired: () => expired,
    race: async <T>(work: Promise<T>): Promise<T | null> => {
      if (expired) return null;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<null>((resolve) => {
            settleTimer = setTimeout(() => resolve(null), budget - (Date.now() - startedAt));
            (settleTimer as { unref?: () => void }).unref?.();
          }),
        ]);
      } finally {
        if (settleTimer) clearTimeout(settleTimer);
      }
    },
    onExpire: (handler) => {
      if (expired) {
        try {
          handler();
        } catch (error) {
          console.error("[deadline] expire handler failed", error);
        }
        return;
      }
      handlers.push(handler);
    },
    dispose,
  };
}

/**
 * Bounds a single expensive call (LLM, scrape, …) with the JSON budget.
 *
 * Returns `work()`'s result, or `null` when the budget is spent — never throws
 * for the timeout itself, so callers keep their existing "no data" branch.
 * The timer is always cleared, so a fast call leaks nothing.
 */
export async function raceBudget<T>(
  work: () => Promise<T>,
  budgetMs: number = JSON_BUDGET_MS,
): Promise<T | null> {
  const deadline = createDeadline(budgetMs);
  try {
    return await deadline.race(work());
  } finally {
    deadline.dispose();
  }
}

/**
 * Runs `work` under a budget and falls back to `partial` when the budget is
 * spent. Used by JSON endpoints that must answer 200 with whatever they have
 * instead of letting the gateway return a 524 to the client.
 */
export async function withDeadline<T>(
  work: (deadline: Deadline) => Promise<T>,
  partial: () => T | Promise<T>,
  budgetMs: number = JSON_BUDGET_MS,
  parent?: AbortSignal,
): Promise<T> {
  const deadline = createDeadline(budgetMs, parent);
  try {
    const result = await deadline.race(work(deadline));
    return result === null ? await partial() : result;
  } finally {
    deadline.dispose();
  }
}
