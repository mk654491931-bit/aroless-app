// ============================================================================
// Async Product Discovery — QStash worker delivery (server only)
//
// The worker endpoint is public by necessity (QStash calls it), so this module
// owns the two things that keep that safe and correct:
//
//   • **Signature verification first.** Nothing runs before the
//     `Upstash-Signature` header is verified against the raw body. An
//     unverifiable delivery is rejected, so a stranger cannot trigger (or
//     consume) a paid pipeline, and a missing signing-key config is reported as
//     `503` instead of silently accepting unsigned requests.
//   • **Retry semantics that match QStash.** QStash retries only non-2xx. So:
//       - `completed`            → 200 (done)
//       - duplicate/terminal     → 200 no-op (retrying can never help)
//       - `busy` (live lease)    → 429 (retry later, then this delivery wins)
//       - `failed` / storage     → 500/503 (retry)
//     A duplicate delivery is therefore a cheap no-op and can never double-run
//     the pipeline, double-write results or double-charge credits.
//
// The verification and the runner are injectable so the whole decision table is
// unit-testable without a queue or a database.
// ============================================================================

import { isUuid } from "./discovery-jobs.server";
import { verifyQstashSignature, type VerifyResult } from "./qstash.server";
import type { DiscoveryRunOutcome } from "./discovery-run.server";

/** A QStash job body is `{ "jobId": "<uuid>" }` — a few dozen bytes. */
const MAX_WORKER_BODY_BYTES = 2_048;

export type WorkerHttpResult = {
  status: number;
  body: Record<string, unknown>;
  /** `true` when QStash should retry (mirrors a non-2xx status). */
  retry: boolean;
};

type VerifyFn = (signature: string | null, rawBody: string, url?: string) => Promise<VerifyResult>;

export type WorkerDeliveryInput = {
  signature: string | null;
  rawBody: string;
  url?: string;
  /** Injectable for tests; defaults to the real signed-runner. */
  verify?: VerifyFn;
  run?: (jobId: string) => Promise<DiscoveryRunOutcome>;
};

function jobIdFromBody(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { jobId?: unknown };
    return typeof parsed?.jobId === "string" ? parsed.jobId.trim() : "";
  } catch {
    return "";
  }
}

/** Decides the HTTP result for one QStash delivery. Never throws. */
export async function processDiscoveryDelivery(
  input: WorkerDeliveryInput,
): Promise<WorkerHttpResult> {
  if (input.rawBody.length > MAX_WORKER_BODY_BYTES) {
    // Reject oversized bodies before spending a signature verification on them.
    return { status: 413, body: { error: "Payload too large." }, retry: false };
  }

  const verify = input.verify ?? verifyQstashSignature;
  let verified: VerifyResult;
  try {
    verified = await verify(input.signature, input.rawBody, input.url);
  } catch (error) {
    console.error("[discovery-worker] signature verification threw", error);
    verified = { ok: false, reason: "invalid_signature" };
  }

  if (!verified.ok) {
    if (verified.reason === "unconfigured") {
      // Without signing keys we cannot tell a real QStash call from a forged
      // one, so we must not run anything. Retry: the operator may be fixing the
      // missing keys while the queue retries.
      return {
        status: 503,
        body: { error: "Worker signature verification is not configured." },
        retry: true,
      };
    }
    return {
      status: 401,
      body: {
        error:
          verified.reason === "missing_signature" ? "Missing signature." : "Invalid signature.",
      },
      retry: false,
    };
  }

  const jobId = jobIdFromBody(input.rawBody);
  if (!isUuid(jobId)) {
    return { status: 400, body: { error: "Missing or invalid jobId." }, retry: false };
  }

  const run = input.run ?? (await import("./discovery-run.server")).runDiscoveryJob;

  let outcome: DiscoveryRunOutcome;
  try {
    outcome = await run(jobId);
  } catch (error) {
    console.error("[discovery-worker] runner threw", error);
    return { status: 500, body: { ok: false, jobId, error: "Worker failed." }, retry: true };
  }

  switch (outcome.kind) {
    case "completed":
      return {
        status: 200,
        body: {
          ok: true,
          jobId,
          kind: "completed",
          persisted: outcome.persisted,
          partial: outcome.partial,
        },
        retry: false,
      };
    case "failed":
      // A real failure: retrying a partially-produced job is safe (the claim RPC
      // refuses terminal rows), so ask QStash to try again.
      return { status: 500, body: { ok: false, jobId, kind: "failed" }, retry: true };
    case "refused": {
      if (outcome.reason === "busy") {
        // Another worker holds a live lease. Retry after it finishes.
        return { status: 429, body: { ok: false, jobId, kind: "busy" }, retry: true };
      }
      if (outcome.reason === "unavailable") {
        // Storage was unreachable; running blind could duplicate work.
        return { status: 503, body: { ok: false, jobId, kind: "unavailable" }, retry: true };
      }
      // Terminal or missing: a duplicate delivery must be a no-op, and retrying
      // it can never change the outcome. Answer 200 so QStash stops.
      return {
        status: 200,
        body: { ok: true, jobId, kind: "noop", reason: outcome.reason },
        retry: false,
      };
    }
    default:
      return { status: 200, body: { ok: true, jobId, kind: "noop" }, retry: false };
  }
}
