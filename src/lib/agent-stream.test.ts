import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import {
  mapAgentEvent,
  parseAgentSseFrame,
  streamCouncilAnalysis,
  type AgentProgress,
} from "./agent-stream";

vi.mock("@/lib/api-client", () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function statusFrame(event: string, data: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ status: "status", event, traceId: "t1", data })}\n\n`;
}

describe("parseAgentSseFrame", () => {
  it("ignores heartbeats and connection flushes", () => {
    expect(parseAgentSseFrame(":ping")).toBeNull();
    expect(parseAgentSseFrame(": initial-connect")).toBeNull();
    expect(parseAgentSseFrame("")).toBeNull();
  });

  it("parses data frames and drops malformed payloads", () => {
    expect(parseAgentSseFrame('data: {"status":"complete","data":{"a":1}}')).toEqual({
      status: "complete",
      data: { a: 1 },
    });
    expect(parseAgentSseFrame("data: {broken")).toBeNull();
  });
});

describe("mapAgentEvent", () => {
  it("maps agent lifecycle events onto progress", () => {
    expect(
      mapAgentEvent({
        status: "status",
        event: "agent:start",
        data: { agent: "Trend Ekibi", tier: 1 },
      }),
    ).toEqual({ agent: { agent: "Trend Ekibi", status: "running", tier: 1 } });

    expect(
      mapAgentEvent({
        status: "status",
        event: "agent:complete",
        data: { agent: "Trend Ekibi", ok: true, ms: 1200, tier: 1 },
      }),
    ).toEqual({ agent: { agent: "Trend Ekibi", status: "complete", tier: 1, ms: 1200 } });

    expect(
      mapAgentEvent({
        status: "status",
        event: "agent:complete",
        data: { agent: "Finans Ekibi", ok: false },
      }),
    ).toEqual({ agent: { agent: "Finans Ekibi", status: "error" } });
  });

  it("maps stage events and ignores unknown ones", () => {
    expect(mapAgentEvent({ status: "status", event: "pipeline:start", data: {} })).toEqual({
      stage: { stage: "pipeline:start" },
    });
    expect(
      mapAgentEvent({ status: "status", event: "tier:complete", data: { tier: 2, ms: 900 } }),
    ).toEqual({ stage: { stage: "tier:2:complete", ms: 900 } });
    expect(mapAgentEvent({ status: "status", event: "cache:hit", data: {} })).toEqual({});
    expect(mapAgentEvent({ status: "status", event: "agent:start", data: {} })).toEqual({});
  });
});

describe("streamCouncilAnalysis", () => {
  it("streams council mode, ignores pings and resolves the final report", async () => {
    mockedFetch.mockResolvedValueOnce(
      sseResponse([
        ": initial-connect\n\n",
        ":ping\n\n",
        statusFrame("pipeline:start", { traceId: "t1", query: "buz makinesi" }),
        statusFrame("agent:start", { traceId: "t1", agent: "Trend Ekibi", tier: 1 }),
        ":ping\n\n",
        statusFrame("agent:complete", {
          traceId: "t1",
          agent: "Trend Ekibi",
          ok: true,
          ms: 1200,
        }),
        `data: ${JSON.stringify({ status: "complete", data: { velora_score: 88, cache_hit: false } })}\n\n`,
      ]),
    );

    const agents: AgentProgress[] = [];
    const stages: string[] = [];

    const report = await streamCouncilAnalysis(
      { query: "buz makinesi", country: "TR", lang: "tr" },
      {
        onAgent: (agent) => agents.push(agent),
        onStage: (stage) => stages.push(stage.stage),
      },
    );

    expect(report).toMatchObject({ velora_score: 88 });

    const [path, init] = mockedFetch.mock.calls[0] ?? [];
    expect(path).toBe("/api/public/agent");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: "council",
      userQuery: "buz makinesi",
      country: "TR",
      language: "tr",
    });

    // Heartbeats never reach the UI.
    expect(agents).toHaveLength(2);
    expect(agents[0]?.status).toBe("running");
    expect(agents[1]).toMatchObject({ status: "complete", ms: 1200 });
    expect(stages).toEqual(["pipeline:start"]);
  });

  it("surfaces a streamed error frame as a rejection", async () => {
    mockedFetch.mockResolvedValueOnce(
      sseResponse([`data: ${JSON.stringify({ status: "error", error: "Krediniz bitti." })}\n\n`]),
    );

    await expect(streamCouncilAnalysis({ query: "test" })).rejects.toThrow("Krediniz bitti.");
  });

  it("fails when the stream closes without a complete frame", async () => {
    mockedFetch.mockResolvedValueOnce(sseResponse([":ping\n\n"]));
    await expect(streamCouncilAnalysis({ query: "test" })).rejects.toThrow(
      "Analiz tamamlanmadan bağlantı kapandı.",
    );
  });

  it("resolves partial instead of throwing when the budget cuts the run", async () => {
    mockedFetch.mockResolvedValueOnce(
      sseResponse([
        ": initial-connect\n\n",
        statusFrame("agent:complete", { traceId: "t1", agent: "Trend Ekibi", ok: true, ms: 900 }),
        `data: ${JSON.stringify({
          status: "partial",
          traceId: "t1",
          data: {
            partial: true,
            partialReason: "gateway_budget",
            mode: "council",
            completed: [{ agent: "Trend Ekibi", status: "complete", ms: 900 }],
            elapsedMs: 92_000,
          },
        })}\n\n`,
      ]),
    );

    const partials: unknown[] = [];
    const report = await streamCouncilAnalysis(
      { query: "buz makinesi" },
      { onPartial: (info) => partials.push(info) },
    );

    expect(report).toBeNull();
    expect(partials).toHaveLength(1);
    expect(partials[0]).toMatchObject({
      partial: true,
      reason: "gateway_budget",
      completed: [{ agent: "Trend Ekibi", status: "complete", ms: 900 }],
    });
  });

  it("keeps the agents it saw when the stream dies without any final frame", async () => {
    mockedFetch.mockResolvedValueOnce(
      sseResponse([
        statusFrame("agent:start", { traceId: "t1", agent: "Finans Ekibi" }),
        statusFrame("agent:complete", { traceId: "t1", agent: "Finans Ekibi", ok: true, ms: 500 }),
      ]),
    );

    const partials: Array<{ completed: AgentProgress[] }> = [];
    const report = await streamCouncilAnalysis(
      { query: "buz makinesi" },
      { onPartial: (info) => partials.push(info) },
    );

    expect(report).toBeNull();
    expect(partials[0]?.completed).toHaveLength(1);
    expect(partials[0]?.completed[0]).toMatchObject({ agent: "Finans Ekibi", status: "complete" });
  });
});
