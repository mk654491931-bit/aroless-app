// ============================================================================
// Async Product Discovery — browser client (start → poll → result)
//
// The browser never waits on the pipeline, never holds a job open, and never
// touches a Redis credential. It:
//   1. POSTs `/api/product-discovery/start` (authenticated) and gets a `jobId`
//      back in milliseconds.
//   2. Polls `/api/product-discovery/status?jobId=…` (authenticated, ownership
//      checked server-side) until the job is terminal, forwarding progress so
//      the UI can animate stages and the 14-agent table.
//   3. Resolves with the durable result — including partial results, which are a
//      success, not an error.
//
// All transport is injectable so the flow is unit-testable without a network.
// The Supabase bearer token is attached by `apiFetch`, which is dynamically
// imported so this module stays importable in a Node test environment.
// ============================================================================

import type {
  DiscoveryAgentProgress,
  DiscoveryJobRequest,
  DiscoveryJobView,
} from "./discovery-jobs.shared";
import { isTerminalStatus } from "./discovery-jobs.shared";

/** Minimal transport contract — matches `apiFetch` (and a fake in tests). */
export type DiscoveryTransport = (path: string, init?: RequestInit) => Promise<Response>;

const defaultTransport: DiscoveryTransport = async (path, init) => {
  const { apiFetch } = await import("@/lib/api-client");
  return apiFetch(path, init);
};

/** How often the status endpoint is polled. */
export const STATUS_POLL_INTERVAL_MS = 2_000;
/** Hard ceiling for a single run, so a stuck job can never poll forever. */
export const STATUS_POLL_MAX_MS = 5 * 60 * 1_000;

export type DiscoveryJobProgress = {
  status: string;
  stage: string;
  stageLabel: string;
  progress: number;
  agents: DiscoveryAgentProgress[];
  partial: boolean;
};

export type DiscoveryJobCallbacks = {
  onProgress?: (progress: DiscoveryJobProgress) => void;
};

export type StartJobOutcome =
  | { ok: true; jobId: string; reused: boolean }
  /** The backend queue is not configured (or cannot verify deliveries). */
  | { ok: false; reason: "queue_unavailable" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "error"; message: string };

export type RunJobOutcome =
  | { ok: true; job: DiscoveryJobView }
  | { ok: false; reason: "queue_unavailable" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "error"; message: string };

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record["error"] === "string" && record["error"].trim()) return record["error"];
    if (typeof record["message"] === "string" && record["message"].trim()) return record["message"];
  }
  return fallback;
}

/** POST the request and hand back a job id. Never throws. */
export async function startDiscoveryJob(
  input: DiscoveryJobRequest,
  transport: DiscoveryTransport = defaultTransport,
): Promise<StartJobOutcome> {
  let response: Response;
  try {
    response = await transport("/api/product-discovery/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        niche: input.niche,
        ...(input.targetCountry ? { targetCountry: input.targetCountry } : {}),
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "İş başlatılamadı.",
    };
  }

  const payload = (await response.json().catch(() => null)) as
    (Record<string, unknown> & { jobId?: unknown; reused?: unknown; code?: unknown }) | null;

  if (!response.ok) {
    if (response.status === 503 && payload?.["code"] === "QUEUE_UNAVAILABLE") {
      return { ok: false, reason: "queue_unavailable" };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    return { ok: false, reason: "error", message: errorMessage(payload, "İş başlatılamadı.") };
  }

  const jobId = typeof payload?.["jobId"] === "string" ? payload["jobId"] : "";
  if (!jobId) return { ok: false, reason: "error", message: "Sunucu iş kimliği döndürmedi." };
  return { ok: true, jobId, reused: payload?.["reused"] === true };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type PollOptions = DiscoveryJobCallbacks & {
  transport?: DiscoveryTransport;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
};

/**
 * Polls until the job is terminal and returns its view.
 *
 * Transport/auth errors are surfaced (the caller may fall back); a job that
 * ends `failed`/`canceled` is still returned so the caller can render the error
 * and any partial products the row carries.
 */
export async function pollDiscoveryJob(
  jobId: string,
  options: PollOptions = {},
): Promise<RunJobOutcome> {
  const transport = options.transport ?? defaultTransport;
  const interval = options.intervalMs ?? STATUS_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? STATUS_POLL_MAX_MS);

  for (;;) {
    if (options.signal?.aborted) {
      return { ok: false, reason: "error", message: "İş iptal edildi." };
    }

    let response: Response;
    try {
      response = await transport(
        `/api/product-discovery/status?jobId=${encodeURIComponent(jobId)}`,
        {
          headers: { Accept: "application/json" },
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
    } catch (error) {
      return {
        ok: false,
        reason: "error",
        message: error instanceof Error ? error.message : "Durum sorgulanamadı.",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return {
        ok: false,
        reason: "error",
        message: errorMessage(payload, "Durum sorgulanamadı."),
      };
    }

    const payload = (await response.json().catch(() => null)) as { job?: DiscoveryJobView } | null;
    const job = payload?.job;
    if (!job || typeof job.jobId !== "string") {
      return { ok: false, reason: "error", message: "Durum yanıtı geçersiz." };
    }

    options.onProgress?.({
      status: job.status,
      stage: job.stage,
      stageLabel: job.stageLabel,
      progress: job.progress,
      agents: job.agents,
      partial: job.partial,
    });

    if (isTerminalStatus(job.status)) return { ok: true, job };

    if (Date.now() >= deadline) {
      return { ok: false, reason: "error", message: "İş zaman aşımına uğradı." };
    }
    try {
      await sleep(interval, options.signal);
    } catch {
      return { ok: false, reason: "error", message: "İş iptal edildi." };
    }
  }
}

/**
 * Full flow: start, then poll to completion. `queue_unavailable` is returned as
 * its own reason so the caller can fall back to the streaming endpoint.
 */
export async function runDiscoveryJob(
  input: DiscoveryJobRequest,
  options: DiscoveryJobCallbacks & {
    transport?: DiscoveryTransport;
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<RunJobOutcome> {
  const transport = options.transport ?? defaultTransport;
  const started = await startDiscoveryJob(input, transport);
  if (!started.ok) {
    if (started.reason === "queue_unavailable" || started.reason === "unauthorized") {
      return { ok: false, reason: started.reason };
    }
    return { ok: false, reason: "error", message: started.message };
  }

  return pollDiscoveryJob(started.jobId, {
    transport,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}
