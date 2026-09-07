// Unit tests for the unified AI node pool (pure logic — no network).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPoolNodes,
  markPoolGroupOutcome,
  poolBackoffMs,
  parkPoolGroup,
  poolGroupAvailable,
  poolHealthSummary,
  readPoolGroupKeys,
  resetPoolCooldowns,
} from "./ai-pool.server";

function stubEnv(entries: Record<string, string>) {
  for (const [k, v] of Object.entries(entries)) vi.stubEnv(k, v);
}

describe("ai-pool availability registry", () => {
  beforeEach(() => {
    resetPoolCooldowns();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("builds the full 22-slot pool when every group is configured", () => {
    stubEnv({
      CEREBRAS_API_KEY: "ck1",
      CEREBRAS_API_KEY_2: "ck2",
      CEREBRAS_API_KEY_3: "ck3",
      SAMBANOVA_API_KEY: "sk1",
      SAMBANOVA_API_KEY_2: "sk2",
      PROVIDER_A_BASE_URL: "https://a.example.test/v1",
      PROVIDER_A_1: "a1",
      PROVIDER_A_2: "a2",
      PROVIDER_A_3: "a3",
      PROVIDER_A_4: "a4",
      PROVIDER_A_5: "a5",
      PROVIDER_B_BASE_URL: "https://b.example.test/v1",
      PROVIDER_B_1: "b1",
      PROVIDER_B_2: "b2",
      PROVIDER_B_3: "b3",
      PROVIDER_B_4: "b4",
      PROVIDER_B_5: "b5",
      PROVIDER_C_BASE_URL: "https://c.example.test/v1",
      PROVIDER_C_1: "c1",
      PROVIDER_C_2: "c2",
      PROVIDER_C_3: "c3",
      PROVIDER_C_4: "c4",
      PROVIDER_C_5: "c5",
      PROVIDER_D_BASE_URL: "https://d.example.test/v1",
      PROVIDER_D_1: "d1",
      PROVIDER_D_2: "d2",
      PROVIDER_D_3: "d3",
      PROVIDER_D_4: "d4",
      PROVIDER_D_5: "d5",
    });
    const nodes = buildPoolNodes();
    // 3 Cerebras + 2 SambaNova + 4×5 PROVIDER = 25 configured keys.
    expect(nodes.length).toBe(25);
    expect(nodes[0].id).toBe("CEREBRAS-01");
    expect(nodes.map((n) => n.group)).toContain("pool_d");
    expect(nodes.filter((n) => n.group === "pool_a")).toHaveLength(5);
    expect(poolHealthSummary().total).toBe(25);
    expect(poolHealthSummary().available).toBe(25);
  });

  it("never exposes key material in the health summary", () => {
    stubEnv({
      CEREBRAS_API_KEY: "super-secret-123",
      PROVIDER_A_BASE_URL: "https://a.example.test/v1",
      PROVIDER_A_1: "a-secret-1",
    });
    const json = JSON.stringify(poolHealthSummary());
    expect(json).not.toContain("super-secret-123");
    expect(json).not.toContain("a-secret-1");
    // group labels only — never node ids or key material
    expect(json).toContain("cerebras");
    expect(json).toContain("pool_a");
  });

  it("skips PROVIDER groups that have keys but no base URL", () => {
    stubEnv({
      PROVIDER_A_1: "a1",
      PROVIDER_A_2: "a2",
    });
    const nodes = buildPoolNodes();
    expect(nodes.some((n) => n.group === "pool_a")).toBe(false);
    expect(poolGroupAvailable("pool_a")).toBe(false);
    const h = poolHealthSummary();
    expect(h.configured).toBe(2); // keys exist…
    expect(h.available).toBe(0); // …but no endpoint → unusable
  });

  it("prioritizes fast nodes (Cerebras) and deep nodes (SambaNova) by class", () => {
    stubEnv({
      CEREBRAS_API_KEY: "ck1",
      SAMBANOVA_API_KEY: "sk1",
      PROVIDER_A_BASE_URL: "https://a.example.test/v1",
      PROVIDER_A_1: "a1",
      PROVIDER_B_BASE_URL: "https://b.example.test/v1",
      PROVIDER_B_1: "b1",
    });
    const fast = buildPoolNodes("fast");
    expect(fast[0].group).toBe("cerebras");
    // fast order: cerebras → pools → sambanova
    expect(fast.map((n) => n.group)).toEqual([
      "cerebras",
      "pool_a",
      "pool_b",
      "sambanova",
    ]);
    const deep = buildPoolNodes("deep");
    expect(deep[0].group).toBe("sambanova");
    expect(deep.map((n) => n.group)).toEqual([
      "sambanova",
      "pool_a",
      "pool_b",
      "cerebras",
    ]);
  });

  it("cooldown parks a quota-failed node and rotates to the next available", () => {
    stubEnv({
      CEREBRAS_API_KEY: "ck1",
      CEREBRAS_API_KEY_2: "ck2",
      SAMBANOVA_API_KEY: "sk1",
    });
    expect(poolBackoffMs("fast")).toBe(0);
    markPoolGroupOutcome("cerebras", 1, "quota");
    const nodes = buildPoolNodes("fast");
    expect(nodes[0].id).toBe("CEREBRAS-02");
    expect(nodes.some((n) => n.id === "CEREBRAS-01")).toBe(false);
    expect(poolBackoffMs("fast")).toBe(0); // CEREBRAS-02 still ready

    // after the quota cooldown the node returns
    vi.advanceTimersByTime(91_000);
    const after = buildPoolNodes("fast");
    expect(after.some((n) => n.id === "CEREBRAS-01")).toBe(true);
  });

  it("clears group circuit on the next successful outcome", () => {
    stubEnv({
      CEREBRAS_API_KEY: "ck1",
    });
    parkPoolGroup("cerebras", "server");
    expect(poolGroupAvailable("cerebras")).toBe(false);
    markPoolGroupOutcome("cerebras", 1, "ok");
    expect(poolGroupAvailable("cerebras")).toBe(true);
    expect(buildPoolNodes("fast").some((n) => n.id === "CEREBRAS-01")).toBe(true);
  });

  it("returns keys in canonical slot order for provider wrappers", () => {
    stubEnv({
      CEREBRAS_API_KEY_1: "one",
      CEREBRAS_API_KEY: "zero",
      CEREBRAS_API_KEY_5: "five",
    });
    const keys = readPoolGroupKeys("cerebras");
    expect(keys).toEqual(["zero", "one", "five"]);
    expect(keys.join(",")).not.toContain("undefined");
  });
});
