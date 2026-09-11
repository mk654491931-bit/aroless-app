// ============================================================================
// Async Product Discovery — durable job store (server only)
//
// Talks to the `product_discovery_jobs` table through PostgREST with the
// service-role key, in the same style as `credits.server.ts`, because the
// generated `Database` types predate this table and hand-editing a generated
// file is not acceptable.
//
// Guarantees this module owns:
//   • **No double charge.** A job row is inserted BEFORE the credit is taken,
//     keyed by `(user_id, idempotency_key)`. A unique violation means someone
//     else already created that job, so the caller reuses it and never pays
//     twice.
//   • **No double work.** `claimJob` is a single atomic RPC; a duplicate QStash
//     delivery gets `claimed: false` and the worker exits without side effects.
//   • **No secrets in the row.** Only request parameters are persisted.
//
// `fetchImpl` is injectable so the whole module is unit-testable without a
// database.
// ============================================================================

import type {
  DiscoveryAgentProgress,
  DiscoveryJobResult,
  DiscoveryJobRow,
} from "./discovery-jobs.shared";
import {
  JOB_STATE_KEY,
  isRedisConfigured,
  redisDel,
  redisGetJson,
  redisSetJson,
} from "./redis.server";
import type { DiscoveryTransientState } from "./discovery-jobs.shared";

type FetchImpl = typeof fetch;

const JOBS_PATH = "/rest/v1/product_discovery_jobs";

export type StoreResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

function restConfig(): { url: string; key: string } | null {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;
  return { url, key };
}

function isServiceKeyOpaque(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

/**
 * Low-level PostgREST call. Never logs the key, the payload or the body of a
 * failed privileged response (those can echo user data).
 */
async function rest<T>(
  options: {
    path: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    query?: string;
    body?: unknown;
    prefer?: string;
  },
  fetchImpl: FetchImpl,
): Promise<StoreResult<T>> {
  const config = restConfig();
  if (!config) {
    return { ok: false, status: 500, message: "storage_unconfigured" };
  }

  const headers: Record<string, string> = {
    apikey: config.key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (!isServiceKeyOpaque(config.key)) headers["Authorization"] = `Bearer ${config.key}`;
  if (options.prefer) headers["Prefer"] = options.prefer;

  const query = options.query ? `?${options.query}` : "";
  try {
    const res = await fetchImpl(`${config.url}${options.path}${query}`, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, status: res.status, message: text.slice(0, 200) };
    }
    const data = text ? (JSON.parse(text) as T) : (null as T);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[discovery-jobs] request failed", message);
    return { ok: false, status: 0, message };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Newest job for an idempotency key (scoped to the owner by construction). */
export async function findJobByKey(
  userId: string,
  idempotencyKey: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoveryJobRow | null> {
  const res = await rest<DiscoveryJobRow[]>(
    {
      path: JOBS_PATH,
      method: "GET",
      query: `select=*&user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&order=created_at.desc&limit=1`,
    },
    fetchImpl,
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0] ?? null;
}

/**
 * IDOR guard: always filtered by `user_id`, and the status route answers 404
 * (never 403) for a foreign job so a job id cannot be probed for existence.
 */
export async function getJobOwned(
  jobId: string,
  userId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoveryJobRow | null> {
  if (!isUuid(jobId) || !isUuid(userId)) return null;
  const res = await rest<DiscoveryJobRow[]>(
    {
      path: JOBS_PATH,
      method: "GET",
      query: `select=*&id=eq.${encodeURIComponent(jobId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    },
    fetchImpl,
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0] ?? null;
}

/** Worker-side read (no ownership filter: the worker already holds the job id). */
export async function getJobAny(
  jobId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoveryJobRow | null> {
  if (!isUuid(jobId)) return null;
  const res = await rest<DiscoveryJobRow[]>(
    {
      path: JOBS_PATH,
      method: "GET",
      query: `select=*&id=eq.${encodeURIComponent(jobId)}&limit=1`,
    },
    fetchImpl,
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0] ?? null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateJobInput = {
  userId: string;
  niche: string;
  targetCountry: string;
  idempotencyKey: string;
  engine?: string;
};

export type CreateJobOutcome = {
  job: DiscoveryJobRow | null;
  /** `false` when an identical job already existed → the caller must not charge again. */
  created: boolean;
};

/**
 * Inserts the job row, claiming the `(user_id, idempotency_key)` slot.
 *
 * The unique constraint is the idempotency primitive: two concurrent `start`
 * calls (double click, retried fetch) race here, exactly one wins, and the
 * loser is handed the winner's row so it never charges a second credit.
 */
export async function createJob(
  input: CreateJobInput,
  fetchImpl: FetchImpl = fetch,
): Promise<CreateJobOutcome> {
  const existing = await findJobByKey(input.userId, input.idempotencyKey, fetchImpl);
  if (existing) return { job: existing, created: false };

  const res = await rest<DiscoveryJobRow[]>(
    {
      path: JOBS_PATH,
      method: "POST",
      prefer: "return=representation",
      body: {
        user_id: input.userId,
        niche: input.niche,
        target_country: input.targetCountry,
        engine: input.engine ?? "discovery",
        idempotency_key: input.idempotencyKey,
        payload: { niche: input.niche, targetCountry: input.targetCountry },
        status: "queued",
        stage: "queued",
        progress: 0,
        billing_state: "pending",
      },
    },
    fetchImpl,
  );

  if (res.ok) {
    const row = Array.isArray(res.data) ? (res.data[0] ?? null) : null;
    if (!row) return { job: null, created: false };
    return { job: row, created: true };
  }

  // 409 = unique violation → someone else won the race. Re-read and reuse.
  if (res.status === 409 || res.status === 400) {
    const raced = await findJobByKey(input.userId, input.idempotencyKey, fetchImpl);
    if (raced) return { job: raced, created: false };
  }
  return { job: null, created: false };
}

export type StartJobInput = {
  userId: string;
  niche: string;
  targetCountry: string;
  idempotencyKey: string;
};

/**
 * Compare-and-swap on the billing state: `pending` → `reserved`.
 *
 * PostgREST applies the filter atomically, so exactly one caller can win the
 * right to spend a credit — even when two requests reuse the same job row
 * (e.g. the user retried right after an interrupted first attempt).
 */
export async function reserveJobCharge(
  jobId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const res = await rest<DiscoveryJobRow[]>(
    {
      path: JOBS_PATH,
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(jobId)}&billing_state=eq.pending&select=id`,
      prefer: "return=representation",
      body: { billing_state: "reserved", updated_at: new Date().toISOString() },
    },
    fetchImpl,
  );
  return res.ok && Array.isArray(res.data) && res.data.length > 0;
}

/** Marks the row as charged. Called only after the credit RPC succeeded. */
export async function markJobCharged(
  jobId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const res = await rest<unknown>(
    {
      path: JOBS_PATH,
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(jobId)}`,
      body: { billing_state: "charged", updated_at: new Date().toISOString() },
    },
    fetchImpl,
  );
  return res.ok;
}

/** Removes a job that could not be charged, so the key can be retried cleanly. */
export async function deleteJob(jobId: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  await rest<unknown>(
    {
      path: JOBS_PATH,
      method: "DELETE",
      query: `id=eq.${encodeURIComponent(jobId)}`,
    },
    fetchImpl,
  );
}

/**
 * Atomic claim. Returns `claimed: false` for terminal jobs, for a live lease
 * held by another worker, and for missing jobs — the worker must then do
 * nothing at all.
 */
export async function claimJob(
  jobId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; claimed: boolean; status: string; attempts: number }> {
  const res = await rest<Array<{ claimed: boolean; status: string; attempts: number }>>(
    {
      path: "/rest/v1/rpc/claim_product_discovery_job",
      method: "POST",
      body: { _job_id: jobId },
    },
    fetchImpl,
  );
  if (!res.ok) {
    return { ok: false, claimed: false, status: "unavailable", attempts: 0 };
  }
  const row = Array.isArray(res.data)
    ? res.data[0]
    : (res.data as unknown as { claimed?: boolean });
  return {
    ok: true,
    claimed: Boolean(row && "claimed" in row ? row.claimed : false),
    status: String((row as { status?: string } | null)?.status ?? ""),
    attempts: Number((row as { attempts?: number } | null)?.attempts ?? 0),
  };
}

/** Terminal write. The RPC refuses to overwrite an already-terminal row. */
export async function finishJob(
  jobId: string,
  status: "completed" | "failed" | "canceled",
  result: DiscoveryJobResult | null,
  error: string | null,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const res = await rest<boolean>(
    {
      path: "/rest/v1/rpc/finish_product_discovery_job",
      method: "POST",
      body: { _job_id: jobId, _status: status, _result: result, _error: error },
    },
    fetchImpl,
  );
  // Transient state is meaningless once the durable row is terminal.
  await redisDel(JOB_STATE_KEY(jobId));
  return res.ok;
}

/** Refunds exactly once, only if the job was really charged. */
export async function refundJob(jobId: string, fetchImpl: FetchImpl = fetch): Promise<boolean> {
  const res = await rest<boolean>(
    {
      path: "/rest/v1/rpc/refund_product_discovery_job",
      method: "POST",
      body: { _job_id: jobId },
    },
    fetchImpl,
  );
  if (!res.ok) return false;
  return res.data === true;
}

// ---------------------------------------------------------------------------
// Progress (Redis fast path + durable fallback)
// ---------------------------------------------------------------------------

/**
 * Records progress.
 *
 * Redis is the fast path for pollers. The durable row is updated when the
 * stage changes (real checkpoints) or whenever Redis is unavailable, so the UI
 * still advances — just at stage granularity — without Redis configured.
 */
export async function writeJobProgress(
  jobId: string,
  state: DiscoveryTransientState,
  options: { persist: boolean; stageChanged?: boolean } = { persist: false },
): Promise<void> {
  const previous = await redisGetJson<DiscoveryTransientState>(JOB_STATE_KEY(jobId));
  // Progress must never go backwards (late writes, retries).
  const merged: DiscoveryTransientState = {
    ...previous,
    ...state,
    progress: Math.max(
      Number(previous?.progress ?? 0),
      Number.isFinite(Number(state.progress)) ? Number(state.progress) : 0,
    ),
    updatedAt: Date.now(),
  };

  const stored = await redisSetJson(JOB_STATE_KEY(jobId), merged);
  if (options.persist || options.stageChanged || !stored) {
    await persistProgressToRow(jobId, merged);
  }
}

async function persistProgressToRow(jobId: string, state: DiscoveryTransientState): Promise<void> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof state.stage === "string" && state.stage) body["stage"] = state.stage;
  if (Number.isFinite(Number(state.progress))) {
    body["progress"] = Math.max(0, Math.min(100, Math.round(Number(state.progress))));
  }
  await rest<unknown>(
    {
      path: JOBS_PATH,
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(jobId)}`,
      body,
    },
    fetch,
  );
}

/** Redis view of a job, used to answer polls fast. `null` when Redis is absent. */
export async function readJobTransient(jobId: string): Promise<DiscoveryTransientState | null> {
  if (!isRedisConfigured()) return null;
  return redisGetJson<DiscoveryTransientState>(JOB_STATE_KEY(jobId));
}

export type { DiscoveryAgentProgress };
