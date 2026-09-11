import { describe, expect, it } from "vitest";
import {
  pollDiscoveryJob,
  runDiscoveryJob,
  startDiscoveryJob,
  type DiscoveryJobProgress,
  type DiscoveryTransport,
} from "./discovery-job";
import type { DiscoveryJobView } from "./discovery-jobs.shared";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function view(overrides: Partial<DiscoveryJobView> = {}): DiscoveryJobView {
  return {
    jobId: JOB_ID,
    status: "running",
    stage: "council",
    stageLabel: "14'lü AI Konsey doğrulaması",
    progress: 40,
    agents: [],
    partial: false,
    result: null,
    error: null,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:05.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes a fake transport so each test can script the exact exchange. */
function transport(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
): DiscoveryTransport {
  return async (path, init) => handler(path, init);
}

describe("startDiscoveryJob", () => {
  it("returns the job id and reused flag from a 202", async () => {
    const t = transport(() => json({ jobId: JOB_ID, reused: false }, 202));
    await expect(startDiscoveryJob({ niche: "glassware" }, t)).resolves.toEqual({
      ok: true,
      jobId: JOB_ID,
      reused: false,
    });
  });

  it("flags an unconfigured queue so the caller can fall back to streaming", async () => {
    const t = transport(() => json({ error: "no queue", code: "QUEUE_UNAVAILABLE" }, 503));
    await expect(startDiscoveryJob({ niche: "glassware" }, t)).resolves.toEqual({
      ok: false,
      reason: "queue_unavailable",
    });
  });

  it("flags an unauthenticated caller", async () => {
    const t = transport(() => json({ error: "login" }, 401));
    await expect(startDiscoveryJob({ niche: "glassware" }, t)).resolves.toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("surfaces a server error message", async () => {
    const t = transport(() => json({ error: "Kredi bitti." }, 402));
    const result = await startDiscoveryJob({ niche: "glassware" }, t);
    expect(result).toEqual({ ok: false, reason: "error", message: "Kredi bitti." });
  });

  it("never throws when the transport itself fails", async () => {
    const t = transport(() => {
      throw new Error("offline");
    });
    await expect(startDiscoveryJob({ niche: "glassware" }, t)).resolves.toEqual({
      ok: false,
      reason: "error",
      message: "offline",
    });
  });

  it("rejects a 202 without a job id", async () => {
    const t = transport(() => json({ reused: false }, 202));
    const result = await startDiscoveryJob({ niche: "glassware" }, t);
    expect(result.ok).toBe(false);
  });
});

describe("pollDiscoveryJob", () => {
  it("polls until terminal and reports increasing progress", async () => {
    const progress: DiscoveryJobProgress[] = [];
    let calls = 0;
    const t = transport(() => {
      calls += 1;
      if (calls === 1) return json({ job: view({ progress: 10, stage: "retrieving" }) });
      return json({
        job: view({ status: "completed", stage: "done", progress: 100, finishedAt: "now" }),
      });
    });

    const result = await pollDiscoveryJob(JOB_ID, {
      transport: t,
      intervalMs: 0,
      onProgress: (p) => progress.push(p),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe("completed");
      expect(result.job.progress).toBe(100);
    }
    expect(progress).toHaveLength(2);
    expect(progress[1]!.progress).toBeGreaterThan(progress[0]!.progress);
  });

  it("returns a failed job (with whatever partial data it carries) instead of throwing", async () => {
    const t = transport(() => json({ job: view({ status: "failed", error: "llm down" }) }));
    const result = await pollDiscoveryJob(JOB_ID, { transport: t, intervalMs: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe("failed");
      expect(result.job.error).toBe("llm down");
    }
  });

  it("surfaces auth loss while polling", async () => {
    const t = transport(() => json({ error: "login" }, 401));
    await expect(pollDiscoveryJob(JOB_ID, { transport: t })).resolves.toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("reports a 404 (foreign or unknown job) as an error", async () => {
    const t = transport(() => json({ error: "İş bulunamadı." }, 404));
    const result = await pollDiscoveryJob(JOB_ID, { transport: t });
    expect(result).toEqual({ ok: false, reason: "error", message: "İş bulunamadı." });
  });

  it("times out instead of polling forever", async () => {
    const t = transport(() => json({ job: view() }));
    const result = await pollDiscoveryJob(JOB_ID, { transport: t, intervalMs: 0, timeoutMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "error") expect(result.message).toContain("zaman aşımı");
  });

  it("returns an error for a malformed status payload", async () => {
    const t = transport(() => json({ job: { nope: true } }));
    const result = await pollDiscoveryJob(JOB_ID, { transport: t });
    expect(result.ok).toBe(false);
  });
});

describe("runDiscoveryJob", () => {
  it("starts then polls to completion in one call", async () => {
    const seen: string[] = [];
    const t = transport((path) => {
      seen.push(path);
      if (path.includes("/start")) return json({ jobId: JOB_ID, reused: false }, 202);
      return json({ job: view({ status: "completed", stage: "done", progress: 100 }) });
    });

    const result = await runDiscoveryJob({ niche: "glassware" }, { transport: t, intervalMs: 0 });
    expect(result.ok).toBe(true);
    expect(seen[0]).toContain("/api/product-discovery/start");
    expect(seen[1]).toContain(`/api/product-discovery/status?jobId=${JOB_ID}`);
  });

  it("propagates queue_unavailable without polling", async () => {
    let polls = 0;
    const t = transport((path) => {
      if (path.includes("/status")) polls += 1;
      return json({ error: "no queue", code: "QUEUE_UNAVAILABLE" }, 503);
    });
    await expect(runDiscoveryJob({ niche: "glassware" }, { transport: t })).resolves.toEqual({
      ok: false,
      reason: "queue_unavailable",
    });
    expect(polls).toBe(0);
  });

  it("sends the niche and country the server expects", async () => {
    let payload: unknown;
    const t = transport((path, init) => {
      if (path.includes("/start")) {
        payload = JSON.parse(String(init?.body));
        return json({ jobId: JOB_ID }, 202);
      }
      return json({ job: view({ status: "completed" }) });
    });
    await runDiscoveryJob(
      { niche: " mugs ", targetCountry: "US" },
      { transport: t, intervalMs: 0 },
    );
    expect(payload).toEqual({ niche: " mugs ", targetCountry: "US" });
  });
});
