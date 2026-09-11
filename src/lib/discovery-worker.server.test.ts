import { describe, expect, it } from "vitest";
import { processDiscoveryDelivery } from "./discovery-worker.server";
import type { VerifyResult } from "./qstash.server";
import type { DiscoveryRunOutcome } from "./discovery-run.server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const OK: VerifyResult = { ok: true };

function body(jobId: string): string {
  return JSON.stringify({ jobId });
}

function delivery(
  overrides: {
    signature?: string | null;
    rawBody?: string;
    verify?: () => Promise<VerifyResult>;
    run?: () => Promise<DiscoveryRunOutcome>;
  } = {},
) {
  return processDiscoveryDelivery({
    signature: overrides.signature === undefined ? "sig" : overrides.signature,
    rawBody: overrides.rawBody ?? body(JOB_ID),
    url: "https://app.example.com/api/product-discovery/worker",
    verify: overrides.verify ?? (async () => OK),
    run:
      overrides.run ??
      (async () => ({ kind: "completed", jobId: JOB_ID, persisted: 3, partial: false })),
  });
}

describe("signature verification", () => {
  it("rejects a missing signature without running anything", async () => {
    let ran = false;
    const result = await delivery({
      signature: null,
      verify: async () => ({ ok: false, reason: "missing_signature" }),
      run: async () => {
        ran = true;
        return { kind: "completed", jobId: JOB_ID, persisted: 0, partial: false };
      },
    });
    expect(result.status).toBe(401);
    expect(result.retry).toBe(false);
    expect(ran).toBe(false);
  });

  it("rejects a forged signature", async () => {
    const result = await delivery({
      verify: async () => ({ ok: false, reason: "invalid_signature" }),
    });
    expect(result.status).toBe(401);
    expect(result.retry).toBe(false);
  });

  it("fails closed (503, retry) when signing keys are not configured", async () => {
    const result = await delivery({ verify: async () => ({ ok: false, reason: "unconfigured" }) });
    expect(result.status).toBe(503);
    expect(result.retry).toBe(true);
  });

  it("fails closed when the verifier itself throws", async () => {
    const result = await delivery({
      verify: async () => {
        throw new Error("crypto exploded");
      },
    });
    expect(result.status).toBe(401);
    expect(result.retry).toBe(false);
  });
});

describe("payload validation", () => {
  it("rejects a body with no job id", async () => {
    const result = await delivery({ rawBody: JSON.stringify({}) });
    expect(result.status).toBe(400);
    expect(result.retry).toBe(false);
  });

  it("rejects a non-uuid job id", async () => {
    const result = await delivery({ rawBody: body("../../etc/passwd") });
    expect(result.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const result = await delivery({ rawBody: "{not json" });
    expect(result.status).toBe(400);
  });

  it("rejects an oversized body before verifying", async () => {
    const result = await delivery({ rawBody: "x".repeat(4_096) });
    expect(result.status).toBe(413);
    expect(result.retry).toBe(false);
  });

  it("verifies before parsing, so a forged request cannot probe the payload", async () => {
    let verified = false;
    const result = await processDiscoveryDelivery({
      signature: null,
      rawBody: "{not json",
      verify: async () => {
        verified = true;
        return { ok: false, reason: "missing_signature" };
      },
      run: async () => ({ kind: "completed", jobId: JOB_ID, persisted: 0, partial: false }),
    });
    expect(verified).toBe(true);
    expect(result.status).toBe(401);
  });
});

describe("duplicate delivery + retry semantics", () => {
  it("answers 200 (stop retrying) for an already-terminal job", async () => {
    const result = await delivery({
      run: async () => ({ kind: "refused", jobId: JOB_ID, reason: "terminal" }),
    });
    expect(result.status).toBe(200);
    expect(result.retry).toBe(false);
    expect(result.body["kind"]).toBe("noop");
  });

  it("answers 200 for a missing job so QStash stops retrying", async () => {
    const result = await delivery({
      run: async () => ({ kind: "refused", jobId: JOB_ID, reason: "missing" }),
    });
    expect(result.status).toBe(200);
    expect(result.retry).toBe(false);
  });

  it("answers 429 so a busy lease is retried later", async () => {
    const result = await delivery({
      run: async () => ({ kind: "refused", jobId: JOB_ID, reason: "busy" }),
    });
    expect(result.status).toBe(429);
    expect(result.retry).toBe(true);
  });

  it("answers 503 when storage is unreachable (never runs blind)", async () => {
    const result = await delivery({
      run: async () => ({ kind: "refused", jobId: JOB_ID, reason: "unavailable" }),
    });
    expect(result.status).toBe(503);
    expect(result.retry).toBe(true);
  });

  it("answers 500 so a failed run is retried", async () => {
    const result = await delivery({
      run: async () => ({ kind: "failed", jobId: JOB_ID, message: "llm down" }),
    });
    expect(result.status).toBe(500);
    expect(result.retry).toBe(true);
  });

  it("answers 500 when the runner throws", async () => {
    const result = await delivery({
      run: async () => {
        throw new Error("kaboom");
      },
    });
    expect(result.status).toBe(500);
    expect(result.retry).toBe(true);
  });

  it("reports a completed run with its persisted count and partial flag", async () => {
    const result = await delivery({
      run: async () => ({ kind: "completed", jobId: JOB_ID, persisted: 7, partial: true }),
    });
    expect(result.status).toBe(200);
    expect(result.retry).toBe(false);
    expect(result.body).toMatchObject({ ok: true, kind: "completed", persisted: 7, partial: true });
  });
});
