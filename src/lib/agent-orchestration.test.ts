import { describe, it, expect } from "vitest";
import {
  consensusDecision,
  describeFailure,
  mapWithConcurrency,
  runWithFallback,
  safeSink,
  settleAll,
  TimeoutError,
  withTimeout,
  type AgentEvent,
} from "@/lib/agent-orchestration";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withTimeout", () => {
  it("resolves a fast task", async () => {
    expect(await withTimeout(async () => "ok", 50)).toBe("ok");
  });

  it("rejects a slow task with a TimeoutError", async () => {
    let caught: unknown;
    try {
      await withTimeout(async () => {
        await tick(60);
        return "late";
      }, 10, "gemini");
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof TimeoutError).toBe(true);
    expect((caught as TimeoutError).label).toBe("gemini");
  });

  it("propagates the original error rather than a timeout", async () => {
    let message = "";
    try {
      await withTimeout(async () => {
        throw new Error("quota exhausted");
      }, 50);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("quota exhausted");
  });

  it("ignores a late resolution after the timeout fired", async () => {
    let taskFinished = false;
    let rejected = false;
    try {
      await withTimeout(async () => {
        await tick(40);
        taskFinished = true;
        return "late";
      }, 10);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    await tick(60);
    // The task did finish; the caller was simply no longer listening, and no
    // second settle was attempted.
    expect(taskFinished).toBe(true);
  });
});

describe("runWithFallback", () => {
  it("uses the first provider that works", async () => {
    const result = await runWithFallback([
      { name: "gemini", call: async () => "a" },
      { name: "groq", call: async () => "b" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("a");
      expect(result.provider).toBe("gemini");
      expect(result.failures).toHaveLength(0);
    }
  });

  it("falls through to a later provider and records the failures", async () => {
    const result = await runWithFallback([
      {
        name: "gemini",
        call: async () => {
          throw new Error("429");
        },
      },
      {
        name: "gateway",
        call: async () => {
          throw new Error("503");
        },
      },
      { name: "groq", call: async () => "c" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("groq");
      expect(result.failures.map((f) => f.name)).toEqual(["gemini", "gateway"]);
    }
  });

  it("does not hang on a provider that never answers", async () => {
    const started = Date.now();
    const result = await runWithFallback(
      [
        { name: "stalled", call: () => new Promise<string>(() => {}) },
        { name: "groq", call: async () => "c" },
      ],
      { timeoutMs: 20 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("groq");
    expect(Date.now() - started < 400).toBe(true);
  });

  it("reports failure when every provider is down", async () => {
    const result = await runWithFallback([
      {
        name: "a",
        call: async () => {
          throw new Error("down");
        },
      },
      {
        name: "b",
        call: async () => {
          throw new Error("down");
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(2);
  });

  it("notifies onFailure per fallback", async () => {
    const seen: string[] = [];
    await runWithFallback(
      [
        {
          name: "a",
          call: async () => {
            throw new Error("down");
          },
        },
        { name: "b", call: async () => "ok" },
      ],
      { onFailure: (f) => seen.push(f.name) },
    );
    expect(seen).toEqual(["a"]);
  });

  it("handles an empty provider list without throwing", async () => {
    const result = await runWithFallback<string>([]);
    expect(result.ok).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order", async () => {
    const out = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms, i) => {
      await tick(ms);
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:10", "2:20", "3:0"]);
  });

  it("never exceeds the concurrency window", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 9 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick(5);
      active--;
      return 1;
    });
    expect(peak).toBe(3);
  });

  it("is faster than sequential execution", async () => {
    const started = Date.now();
    await mapWithConcurrency(Array.from({ length: 8 }, () => 25), 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(Date.now() - started < 160).toBe(true); // sequential would be ~200ms
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("treats a zero or negative limit as one", async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
  });
});

describe("settleAll", () => {
  it("keeps successes and collects failures", async () => {
    const { values, failures } = await settleAll([
      { name: "ok", call: async () => 1 },
      {
        name: "bad",
        call: async () => {
          throw new Error("nope");
        },
      },
    ]);
    expect(values).toEqual([{ name: "ok", value: 1 }]);
    expect(failures.map((f) => f.name)).toEqual(["bad"]);
  });

  it("one failure does not cancel the others", async () => {
    const { values } = await settleAll([
      {
        name: "bad",
        call: async () => {
          throw new Error("nope");
        },
      },
      { name: "slow", call: async () => (await tick(15), "done") },
    ]);
    expect(values).toEqual([{ name: "slow", value: "done" }]);
  });
});

describe("consensusDecision", () => {
  it("approves when everyone approves and the average clears the bar", () => {
    const result = consensusDecision(
      [
        { score: 80, decision: "APPROVED" },
        { score: 76, decision: "APPROVED" },
      ],
      75,
    );
    expect(result).toEqual({ approved: true, average_score: 78, votes: 2 });
  });

  it("rejects when one agent vetoes despite a high average", () => {
    const result = consensusDecision(
      [
        { score: 95, decision: "APPROVED" },
        { score: 90, decision: "REJECTED" },
      ],
      75,
    );
    expect(result.approved).toBe(false);
    expect(result.average_score).toBe(93);
  });

  it("rejects a unanimous approval that misses the average", () => {
    expect(
      consensusDecision(
        [
          { score: 74, decision: "APPROVED" },
          { score: 74, decision: "APPROVED" },
        ],
        75,
      ).approved,
    ).toBe(false);
  });

  it("approves exactly at the threshold", () => {
    expect(
      consensusDecision([{ score: 75, decision: "APPROVED" }], 75).approved,
    ).toBe(true);
  });

  it("skips absent agents instead of counting them as rejections", () => {
    const result = consensusDecision(
      [{ score: 90, decision: "APPROVED" }, null, undefined],
      75,
    );
    expect(result).toEqual({ approved: true, average_score: 90, votes: 1 });
  });

  it("rounds the average like the previous implementation", () => {
    expect(
      consensusDecision(
        [
          { score: 80, decision: "APPROVED" },
          { score: 81, decision: "APPROVED" },
        ],
        75,
      ).average_score,
    ).toBe(81);
  });

  it("returns a safe zero when no agent answered", () => {
    expect(consensusDecision([], 75)).toEqual({
      approved: false,
      average_score: 0,
      votes: 0,
    });
  });
});

describe("safeSink", () => {
  it("forwards events", () => {
    const seen: AgentEvent[] = [];
    safeSink((e) => seen.push(e))({ type: "stage:start", stage: "finder", at: 1 });
    expect(seen).toHaveLength(1);
  });

  it("swallows a listener that throws", () => {
    const sink = safeSink(() => {
      throw new Error("listener bug");
    });
    expect(() => sink({ type: "stage:start", stage: "audit", at: 1 })).not.toThrow();
  });

  it("is a no-op without a listener", () => {
    expect(() => safeSink()({ type: "stage:start", stage: "consensus", at: 1 })).not.toThrow();
  });
});

describe("describeFailure", () => {
  it("describes a timeout", () => {
    expect(describeFailure(new TimeoutError("groq", 20))).toBe("groq timed out after 20ms");
  });

  it("uses an error message", () => {
    expect(describeFailure(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-error", () => {
    expect(describeFailure("weird")).toBe("weird");
  });
});
