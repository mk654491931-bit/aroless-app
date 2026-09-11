import { describe, expect, it } from "vitest";
import {
  DeadlineExceededError,
  clampBatchSize,
  fulfilled,
  mapBatched,
  settleBatched,
  settleWithDeadline,
} from "./concurrency.server";
import { createDeadline } from "./deadline.server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("clampBatchSize", () => {
  it("falls back for invalid sizes and caps runaway concurrency", () => {
    expect(clampBatchSize(undefined)).toBe(3);
    expect(clampBatchSize(0)).toBe(3);
    expect(clampBatchSize(-2)).toBe(3);
    expect(clampBatchSize(Number.NaN)).toBe(3);
    expect(clampBatchSize(4)).toBe(4);
    expect(clampBatchSize(999)).toBe(12);
  });
});

describe("mapBatched", () => {
  it("preserves order and isolates a failing item", async () => {
    const results = await mapBatched([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 3) throw new Error("boom");
      return n * 2;
    });

    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(fulfilled(results)).toEqual([2, 4, 8, 10]);
  });

  it("never runs more than one batch at a time", async () => {
    let active = 0;
    let peak = 0;

    await mapBatched([1, 2, 3, 4, 5, 6], 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return null;
    });

    expect(peak).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapBatched([], 3, async () => 1)).toEqual([]);
  });
});

describe("settleWithDeadline", () => {
  it("waits for every task while the budget lasts", async () => {
    const deadline = createDeadline(2_000);
    const { results, timedOut } = await settleWithDeadline(
      [async () => "a", async () => "b"],
      deadline,
    );
    deadline.dispose();

    expect(timedOut).toBe(false);
    expect(fulfilled(results)).toEqual(["a", "b"]);
  });

  it("keeps the results that arrived and drops the stalled one", async () => {
    const deadline = createDeadline(80);
    const { results, timedOut } = await settleWithDeadline<string>(
      [async () => "ready", () => new Promise<string>(() => undefined)],
      deadline,
    );
    deadline.dispose();

    expect(timedOut).toBe(true);
    expect(fulfilled(results)).toEqual(["ready"]);
    // The unfinished slot stays in place so indexes keep lining up.
    expect(results).toHaveLength(2);
    const dropped = results[1] as PromiseRejectedResult;
    expect(dropped.reason).toBeInstanceOf(DeadlineExceededError);
  });

  it("still reports real per-task failures separately from a timeout", async () => {
    const deadline = createDeadline(2_000);
    const { results, timedOut } = await settleWithDeadline<string>(
      [async () => "ok", async () => Promise.reject(new Error("provider 500"))],
      deadline,
    );
    deadline.dispose();

    expect(timedOut).toBe(false);
    expect(results[0]?.status).toBe("fulfilled");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(fulfilled(results)).toEqual(["ok"]);
  });
});

describe("settleBatched", () => {
  it("runs independent thunks in bounded batches", async () => {
    const order: number[] = [];
    const results = await settleBatched(
      [1, 2, 3].map((n) => async () => {
        order.push(n);
        return n;
      }),
      2,
    );

    expect(fulfilled(results)).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
