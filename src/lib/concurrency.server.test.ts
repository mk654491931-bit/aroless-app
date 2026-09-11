import { describe, expect, it } from "vitest";
import { clampBatchSize, fulfilled, mapBatched, settleBatched } from "./concurrency.server";

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
