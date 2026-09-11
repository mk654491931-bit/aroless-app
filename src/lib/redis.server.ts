// ============================================================================
// Transient job state (server only) — Upstash Redis, optional by design
//
// Redis holds the *transient* coordination layer for async Product Discovery:
//    • a compact job state blob (status / stage / progress / agent table)
//    • short-lived locks so two workers cannot run the same job
//
// It is deliberately NOT the primary store: the durable job row lives in
// Postgres (`product_discovery_jobs`), so the feature keeps working — and keeps
// being correct — when Redis is not configured at all.
//
// Every function degrades safely. A missing configuration, a timeout or a
// network error returns `null` / `false` instead of throwing, so a Redis outage
// can slow progress reporting down but can never fail a paid job.
// ============================================================================

/** Transient keys must always expire; nothing here is a source of truth. */
export const JOB_STATE_TTL_SECONDS = 60 * 60; // 1 hour
export const JOB_LOCK_TTL_SECONDS = 10 * 60; // 10 minutes

export const JOB_STATE_KEY = (jobId: string): string => `pd:job:${jobId}:state`;
export const JOB_AGENTS_KEY = (jobId: string): string => `pd:job:${jobId}:agents`;
export const JOB_LOCK_KEY = (jobId: string): string => `pd:job:${jobId}:lock`;

type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

let client: RedisLike | null | undefined;

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

/** True when both Upstash REST values are present. */
export function isRedisConfigured(): boolean {
  return Boolean(readEnv("UPSTASH_REDIS_REST_URL") && readEnv("UPSTASH_REDIS_REST_TOKEN"));
}

/**
 * Lazily builds the Upstash client. Returns `null` (and stays null) when the
 * integration is not configured, so callers never pay a failed import.
 */
async function getClient(): Promise<RedisLike | null> {
  if (client !== undefined) return client;
  if (!isRedisConfigured()) {
    client = null;
    return client;
  }
  try {
    const { Redis } = await import("@upstash/redis");
    client = new Redis({
      url: readEnv("UPSTASH_REDIS_REST_URL"),
      token: readEnv("UPSTASH_REDIS_REST_TOKEN"),
      // Progress writes are fire-and-forget; never let a slow Redis hold a job.
      signal: AbortSignal.timeout(4_000),
      retry: { retries: 1, backoff: () => 150 },
    }) as unknown as RedisLike;
  } catch (error) {
    console.error("[redis] client unavailable", error);
    client = null;
  }
  return client;
}

/** Reads a JSON value. Returns `null` when unconfigured, missing or unreadable. */
export async function redisGetJson<T>(key: string): Promise<T | null> {
  try {
    const redis = await getClient();
    if (!redis) return null;
    const value = await redis.get<T>(key);
    if (value === null || value === undefined) return null;
    // Upstash may hand back an already-parsed object or a JSON string.
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

/** Writes a JSON value with a mandatory TTL. Best-effort: never throws. */
export async function redisSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number = JOB_STATE_TTL_SECONDS,
): Promise<boolean> {
  try {
    const redis = await getClient();
    if (!redis) return false;
    await redis.set(key, value, { ex: Math.max(1, Math.floor(ttlSeconds)) });
    return true;
  } catch {
    return false;
  }
}

export async function redisDel(key: string): Promise<void> {
  try {
    const redis = await getClient();
    if (!redis) return;
    await redis.del(key);
  } catch {
    /* best effort */
  }
}

/**
 * Acquires a short-lived lock (`SET NX EX`).
 *
 * Redis is the *fast path* only: the authoritative guard against double work is
 * the Postgres claim RPC. When Redis is down this returns `true` so the job
 * still runs and Postgres keeps it single-execution.
 */
export async function acquireJobLock(
  jobId: string,
  ttlSeconds: number = JOB_LOCK_TTL_SECONDS,
): Promise<boolean> {
  try {
    const redis = await getClient();
    if (!redis) return true;
    const result = await redis.set(JOB_LOCK_KEY(jobId), Date.now(), {
      ex: Math.max(1, Math.floor(ttlSeconds)),
      nx: true,
    });
    // Upstash returns "OK" on success and null when the key already exists.
    return result !== null && result !== undefined && result !== 0;
  } catch {
    return true;
  }
}

export async function releaseJobLock(jobId: string): Promise<void> {
  await redisDel(JOB_LOCK_KEY(jobId));
}
