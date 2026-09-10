import { describe, expect, it } from "vitest";
import { encodeHeartbeat, encodeSse } from "./sse.server";

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

  it("uses an SSE comment heartbeat that intermediaries do not expose as data", () => {
    expect(encodeHeartbeat()).toBe(":ping\n\n");
  });
});
