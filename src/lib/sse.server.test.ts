import { describe, expect, it } from "vitest";
import {
  createSseResponse,
  encodeHeartbeat,
  encodeSse,
  encodeSseEvent,
  sseHeaders,
} from "./sse.server";

async function readAll(response: Response): Promise<string> {
  const body = response.body;
  if (!body) throw new Error("missing body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

describe("SSE helpers", () => {
  it("encodes status payloads as complete SSE data frames", () => {
    const frame = encodeSse({
      status: "status",
      event: "agent:start",
      traceId: "trace-test",
      data: { agent: "CFO Agent" },
    });

    expect(frame).toBe(
      `data: ${JSON.stringify({
        status: "status",
        event: "agent:start",
        traceId: "trace-test",
        data: { agent: "CFO Agent" },
      })}\n\n`,
    );
  });

  it("encodes named frames that dispatchers surface as event names", () => {
    expect(encodeSseEvent("error", { type: "error", message: "boom" })).toBe(
      `event: error\ndata: ${JSON.stringify({ type: "error", message: "boom" })}\n\n`,
    );
  });

  it("uses an SSE comment heartbeat that intermediaries do not expose as data", () => {
    expect(encodeHeartbeat()).toBe(":ping\n\n");
  });

  it("disables proxy buffering in the response headers", () => {
    const headers = sseHeaders();
    expect(headers.get("Content-Type")).toContain("text/event-stream");
    expect(headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(headers.get("X-Accel-Buffering")).toBe("no");
  });
});

describe("createSseResponse", () => {
  it("flushes the first byte before any producer work can block", async () => {
    const order: string[] = [];
    const response = createSseResponse(
      async (emit) => {
        order.push("producer");
        emit(encodeSseEvent("complete", { type: "complete", data: { count: 1 } }));
      },
      { heartbeatMs: 1_000 },
    );

    const text = await readAll(response);
    expect(order).toEqual(["producer"]);
    expect(text.startsWith(": initial-connect\n\n")).toBe(true);
    expect(text).toContain("event: complete");
  });

  it("keeps the connection alive with heartbeats while the producer thinks", async () => {
    const response = createSseResponse(
      async (emit) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        emit(encodeSseEvent("complete", { type: "complete" }));
      },
      { heartbeatMs: 10 },
    );

    const text = await readAll(response);
    expect(text).toContain(":ping");
    expect(text.trimEnd().endsWith(`data: {"type":"complete"}`)).toBe(true);
  });

  it("propagates a client abort into the producer signal", async () => {
    const abort = new AbortController();
    let observedAbort = false;

    const response = createSseResponse(
      async (_emit, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        observedAbort = signal.aborted;
      },
      { signal: abort.signal, heartbeatMs: 1_000 },
    );

    setTimeout(() => abort.abort(), 5);
    await readAll(response);
    expect(observedAbort).toBe(true);
  });

  it("contains producer failures instead of leaking an open stream", async () => {
    const response = createSseResponse(
      async () => {
        throw new Error("scanner exploded");
      },
      { heartbeatMs: 1_000 },
    );

    const text = await readAll(response);
    expect(text).toContain("event: error");
    expect(text).toContain("Bağlantı beklenmedik şekilde kesildi.");
  });

  it("closes the stream on the budget and flushes partial results", async () => {
    let sawAbort = false;

    const response = createSseResponse(
      async (_emit, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        sawAbort = signal.aborted;
      },
      {
        heartbeatMs: 1_000,
        budgetMs: 60,
        onBudgetExhausted: (emit) => {
          emit(encodeSseEvent("complete", { type: "complete", data: { partial: true } }));
        },
      },
    );

    const text = await readAll(response);
    expect(text).toContain(": budget-exhausted");
    expect(text).toContain(`data: {"type":"complete","data":{"partial":true}}`);

    // The producer wakes up after its own (longer) sleep and must see the abort.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(sawAbort).toBe(true);
  });

  it("phones the partial hook exactly once", async () => {
    let hookCalls = 0;

    const response = createSseResponse(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      },
      {
        heartbeatMs: 1_000,
        budgetMs: 60,
        onBudgetExhausted: () => {
          hookCalls += 1;
        },
      },
    );

    await readAll(response);
    expect(hookCalls).toBe(1);
  });
});
