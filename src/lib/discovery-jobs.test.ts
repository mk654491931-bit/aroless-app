import { describe, expect, it } from "vitest";
import {
  DISCOVERY_AGENT_COUNT,
  DISCOVERY_AGENTS,
  IDEMPOTENCY_WINDOW_MS,
  PARALLEL_SAFE_AGENTS,
  agentCompletionRatio,
  applyAgentEvent,
  buildIdempotencyKey,
  idempotencyBucket,
  initialAgentProgress,
  isTerminalStatus,
  progressForStage,
  stageLabel,
  toJobView,
  type DiscoveryJobRow,
} from "./discovery-jobs.shared";

/**
 * The 14-agent council graph must mirror `council.server.ts` exactly. Those
 * names are module-private there (that file is server-only), so this is the
 * literal sync guard: if the council renames or reorders an agent, this test
 * fails instead of the UI silently showing a 13-row table.
 */
const PRODUCER_AGENTS = [
  "Trend Ekibi",
  "Finans Ekibi",
  "Pazarlama Ekibi",
  "Operasyon Ekibi",
  "Uyum Ekibi",
  "Yaratıcı Ekip",
];
const REVIEWER_AGENTS = [
  "Trend Hakemi",
  "Finans Hakemi",
  "Pazarlama Hakemi",
  "Operasyon Hakemi",
  "Uyum Hakemi",
  "Yaratıcı Hakem",
];

function row(overrides: Partial<DiscoveryJobRow> = {}): DiscoveryJobRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    status: "running",
    stage: "council",
    progress: 40,
    niche: "glassware",
    target_country: "US",
    result: null,
    error: null,
    billing_state: "charged",
    attempts: 1,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:10.000Z",
    finished_at: null,
    ...overrides,
  };
}

describe("14-agent dependency graph", () => {
  it("has exactly 14 agents across the four real tiers", () => {
    expect(DISCOVERY_AGENT_COUNT).toBe(14);
    expect(DISCOVERY_AGENTS.filter((a) => a.tier === 1)).toHaveLength(6);
    expect(DISCOVERY_AGENTS.filter((a) => a.tier === 2)).toHaveLength(6);
    expect(DISCOVERY_AGENTS.filter((a) => a.tier === 3)).toHaveLength(1);
    expect(DISCOVERY_AGENTS.filter((a) => a.tier === 4)).toHaveLength(1);
  });

  it("keeps the six producer teams independent and parallel-safe", () => {
    expect(PARALLEL_SAFE_AGENTS).toEqual(PRODUCER_AGENTS);
    for (const agent of DISCOVERY_AGENTS.filter((a) => a.tier === 1)) {
      expect(agent.dependsOn).toEqual([]);
    }
  });

  it("makes each reviewer depend only on its own producer", () => {
    const reviewers = DISCOVERY_AGENTS.filter((a) => a.tier === 2);
    expect(reviewers.map((r) => r.name)).toEqual(REVIEWER_AGENTS);
    reviewers.forEach((reviewer, i) => {
      expect(reviewer.dependsOn).toEqual([PRODUCER_AGENTS[i]]);
    });
  });

  it("fans the director in from all twelve and the auditor from the director", () => {
    const director = DISCOVERY_AGENTS.find((a) => a.name === "Müdür Sentezi");
    const auditor = DISCOVERY_AGENTS.find((a) => a.name === "Bağımsız Denetçi");
    expect(director?.dependsOn).toBe("all");
    expect(auditor?.dependsOn).toEqual(["Müdür Sentezi"]);
    expect(auditor?.tier).toBe(4);
  });
});

describe("progress derivation", () => {
  it("maps stages to monotonic percentages that end at 100", () => {
    expect(progressForStage("queued")).toBe(2);
    expect(progressForStage("retrieving", 0)).toBe(2);
    expect(progressForStage("retrieving", 1)).toBeGreaterThan(progressForStage("queued"));
    expect(progressForStage("council", 0)).toBeGreaterThan(progressForStage("retrieving", 1));
    expect(progressForStage("ranking")).toBeGreaterThan(progressForStage("council", 1));
    expect(progressForStage("done")).toBe(100);
  });

  it("clamps a misbehaving ratio inside its stage", () => {
    expect(progressForStage("retrieving", 5)).toBe(progressForStage("retrieving", 1));
    expect(progressForStage("retrieving", -3)).toBe(progressForStage("retrieving", 0));
    expect(progressForStage("retrieving", Number.NaN)).toBe(progressForStage("retrieving", 0));
  });

  it("returns 0 for an unknown stage and labels known ones", () => {
    expect(progressForStage("nonsense")).toBe(0);
    expect(stageLabel("done")).toBe("Tamamlandı");
    expect(stageLabel("failed")).toBe("Başarısız");
    expect(stageLabel("council")).toContain("14");
  });
});

describe("idempotency window", () => {
  it("is stable inside a bucket and changes across buckets", () => {
    // Start at a bucket boundary so the window edges are unambiguous.
    const t = 2_833_333 * IDEMPOTENCY_WINDOW_MS;
    expect(idempotencyBucket(t)).toBe(Math.floor(t / IDEMPOTENCY_WINDOW_MS));
    expect(idempotencyBucket(t)).toBe(idempotencyBucket(t + IDEMPOTENCY_WINDOW_MS - 1));
    expect(idempotencyBucket(t + IDEMPOTENCY_WINDOW_MS)).not.toBe(idempotencyBucket(t));
    expect(IDEMPOTENCY_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("normalises the niche so a double submit shares one key", () => {
    const a = buildIdempotencyKey({ niche: "  Glass   Ware ", targetCountry: "us", bucket: 7 });
    const b = buildIdempotencyKey({ niche: "glass ware", targetCountry: "US", bucket: 7 });
    expect(a).toBe(b);
    expect(a).toContain("pd:");
    expect(a.length).toBeLessThanOrEqual(80);
  });
});

describe("agent event table", () => {
  it("starts with all 14 agents waiting", () => {
    const agents = initialAgentProgress();
    expect(agents).toHaveLength(14);
    expect(agents.every((a) => a.phase === "waiting")).toBe(true);
  });

  it("never lets a late running frame undo a finished agent", () => {
    let agents = initialAgentProgress();
    agents = applyAgentEvent(agents, { agent: "Trend Ekibi", phase: "complete", ms: 120 });
    agents = applyAgentEvent(agents, { agent: "Trend Ekibi", phase: "running" });
    expect(agents.find((a) => a.name === "Trend Ekibi")?.phase).toBe("complete");
  });

  it("records errors without dropping the agent row", () => {
    let agents = initialAgentProgress();
    agents = applyAgentEvent(agents, {
      agent: "Finans Ekibi",
      phase: "error",
      error: "rate limited",
    });
    const row = agents.find((a) => a.name === "Finans Ekibi");
    expect(row?.phase).toBe("error");
    expect(row?.error).toBe("rate limited");
  });

  it("computes completion across the full 14-row table (partial runs included)", () => {
    let agents = initialAgentProgress();
    expect(agentCompletionRatio(agents)).toBe(0);
    agents = applyAgentEvent(agents, { agent: "Trend Ekibi", phase: "complete" });
    expect(agentCompletionRatio(agents)).toBeCloseTo(1 / 14);
  });
});

describe("durable row → wire view", () => {
  it("treats completed as 100% and stage done", () => {
    const view = toJobView(
      row({ status: "completed", progress: 63, finished_at: "2026-09-12T00:01:00Z" }),
    );
    expect(view.status).toBe("completed");
    expect(view.progress).toBe(100);
    expect(view.stage).toBe("done");
    expect(isTerminalStatus(view.status)).toBe(true);
  });

  it("never lets transient state claim a job finished", () => {
    const view = toJobView(row({ status: "running", progress: 10 }), {
      stage: "done",
      progress: 100,
      agents: [],
      partial: true,
    });
    expect(view.status).toBe("running");
    expect(view.stage).not.toBe("done");
    expect(view.partial).toBe(true);
  });

  it("never rewinds progress", () => {
    const view = toJobView(row({ status: "running", progress: 55 }), { progress: 12 });
    expect(view.progress).toBe(55);
  });

  it("defaults to the 14-row agent table before any event", () => {
    const view = toJobView(row());
    expect(view.agents).toHaveLength(14);
  });

  it("surfaces partial from either the row result or transient state", () => {
    const withResult = toJobView(
      row({
        status: "completed",
        result: {
          traceId: "t",
          niche: "n",
          targetCountry: "US",
          products: [],
          persisted: 0,
          failedWrites: 0,
          partial: true,
          partialReason: "gateway_budget",
          agents: [],
          council: null,
          durationMs: 1,
          generatedAt: "2026-09-12T00:00:00Z",
        },
      }),
    );
    expect(withResult.partial).toBe(true);
  });
});
