import { describe, expect, it, vi } from "vitest";
import {
  GATEWAY_LIMIT_MS,
  JSON_BUDGET_MS,
  STREAM_BUDGET_MS,
  createDeadline,
  withDeadline,
} from "./deadline.server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("budget constants", () => {
  it("stays under Cloudflare's 100s hard wall", () => {
    expect(STREAM_BUDGET_MS).toBeLessThan(GATEWAY_LIMIT_MS);
    expect(JSON_BUDGET_MS).toBeLessThan(GATEWAY_LIMIT_MS);
    // Leave room to flush a final chunk / serialize the body.
    expect(GATEWAY_LIMIT_MS - STREAM_BUDGET_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe("createDeadline", () => {
  it("resolves work that finishes in time", async () => {
    const deadline = createDeadline(1_000);
    await expect(deadline.race(Promise.resolve("ok"))).resolves.toBe("ok");
    expect(deadline.expired()).toBe(false);
    expect(deadline.remaining()).toBeGreaterThan(0);
    deadline.dispose();
  });

  it("resolves null (never throws) once the budget is spent", async () => {
    const deadline = createDeadline(60);
    const never = new Promise<string>(() => undefined);

    await expect(deadline.race(never)).resolves.toBeNull();
    expect(deadline.expired()).toBe(true);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  it("runs the flush hook exactly once when the budget expires", async () => {
    const deadline = createDeadline(60);
    const flush = vi.fn();
    deadline.onExpire(flush);

    await sleep(150);
    expect(flush).toHaveBeenCalledTimes(1);
    deadline.dispose();
  });

  it("runs a hook registered after expiry immediately", async () => {
    const deadline = createDeadline(60);
    await sleep(150);

    const late = vi.fn();
    deadline.onExpire(late);
    expect(late).toHaveBeenCalledTimes(1);
    deadline.dispose();
  });

  it("follows a parent abort signal", () => {
    const parent = new AbortController();
    const deadline = createDeadline(5_000, parent.signal);

    parent.abort();
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });
});

describe("withDeadline", () => {
  it("returns the real result when the work finishes in time", async () => {
    await expect(
      withDeadline(
        async () => "done",
        () => "partial",
        500,
      ),
    ).resolves.toBe("done");
  });

  it("returns partial data instead of failing when the budget is spent", async () => {
    const partial = vi.fn(() => ({ items: ["a"], partial: true }));
    const result = await withDeadline(
      () => new Promise<{ items: string[]; partial?: boolean }>(() => undefined),
      partial,
      60,
    );

    expect(partial).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: ["a"], partial: true });
  });
});
