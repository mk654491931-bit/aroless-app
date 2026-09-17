/**
 * Asenkron arama işleri — Publish → Poll mimarisi.
 *
 * Akış:
 *  1. Tetikleyici (`/api/search` veya `generateProducts`) Supabase `searches`
 *     tablosunda `status: "processing"` bir kayıt açar.
 *  2. İş, Upstash QStash üzerinden `/api/worker` adresine yayınlanır ve istek
 *     anında sonlanır (90 sn sunucu zaman aşımı hiç tetiklenmez).
 *  3. İşçi ağır Gemini + scraping hattını çalıştırır, bitişte kayda
 *     `completed` + `result` (veya `failed` + `error`) yazar ve sonucu Upstash
 *     Redis'te önbelleğe alır.
 *
 * SÜRE BÜTÇESİ (ÖNEMLİ): Vercel Hobby planında bir fonksiyon en fazla 60 sn
 * çalışabilir. Bu yüzden hem işçinin hat bütçesi hem de tetikleyicinin
 * bekleme süresi `VERCEL_FUNCTION_MAX_DURATION` (varsayılan 60) değerinden
 * türetilir; hiçbir istek platform sınırına dayanmaz, dolayısıyla 504 /
 * "zaman aşımı" hatası oluşmaz.
 *
 * QStash değişkenleri yoksa çağrı yapan taraf kontrollü inline fallback kullanır.
 * QStash yapılandırılmış fakat publish başarısızsa fallback yapılmaz; işin gerçek
 * kuyruğa alma hatası korunur ve aynı kısa HTTP isteğinde ağır işlem tekrarlanmaz.
 *
 * Ek npm bağımlılığı yoktur — QStash ve Redis REST API'leri `fetch` ile
 * kullanılır (lock dosyası / kurulum riski sıfır).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DiscoveryInput, DiscoveryResult } from "@/lib/discovery-pipeline.server";

export const JOB_TABLE = "searches";

/** "https" + "://" — tek parça şeklinde yazılmaz, böylece şablon güvenli kalır. */
const HTTPS_PREFIX = "https:" + "//";

const QSTASH_REGIONAL_ENDPOINTS: Record<string, string> = {
  global: HTTPS_PREFIX + "qstash.upstash.io",
  eu: HTTPS_PREFIX + "qstash-eu-central-1.upstash.io",
  europe: HTTPS_PREFIX + "qstash-eu-central-1.upstash.io",
  "eu-central-1": HTTPS_PREFIX + "qstash-eu-central-1.upstash.io",
  us: HTTPS_PREFIX + "qstash-us-east-1.upstash.io",
  usa: HTTPS_PREFIX + "qstash-us-east-1.upstash.io",
  "us-east-1": HTTPS_PREFIX + "qstash-us-east-1.upstash.io",
};

function cleanQStashToken(value: string): string {
  let cleaned = value.trim().replace(/^["']|["']$/g, "").trim();
  cleaned = cleaned.replace(/^Bearer\s+/i, "").trim();
  cleaned = cleaned.replace(/^QSTASH_TOKEN\s*=\s*/i, "").trim();
  return cleaned.replace(/^["']|["']$/g, "").trim();
}

function qstashToken(): string | undefined {
  const value = env("QSTASH_TOKEN");
  if (!value) return undefined;
  const cleaned = cleanQStashToken(value);
  return cleaned || undefined;
}

/** QStash REST API tabanı; QSTASH_URL, QSTASH_REGION'dan önce gelir. */
export function qstashBaseUrl(): string {
  const configured = env("QSTASH_URL");
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured
      .replace(/\/v2\/publish\/?$/i, "")
      .replace(/\/+$/, "");
  }
  // The project has been configured against the EU QStash account. Keep this
  // explicit default so an omitted region cannot send an EU token to the
  // global/legacy endpoint and produce a misleading 401.
  const region = (env("QSTASH_REGION") ?? "eu").toLowerCase();
  return QSTASH_REGIONAL_ENDPOINTS[region] ?? QSTASH_REGIONAL_ENDPOINTS.global;
}

/** QStash'in çağıracağı worker URL'si. Render URL'si base olarak da verilebilir. */
function discoveryWorkerUrl(origin: string): string {
  const configured = env("DISCOVERY_WORKER_URL");
  if (!configured) return origin.replace(/\/+$/g, "") + "/api/worker";

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return "";
    if (!url.pathname || url.pathname === "/") url.pathname = "/api/worker";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

const QSTASH_TIMEOUT_ENV = "QSTASH_TIMEOUT_SECONDS";

export type JobStatus = "processing" | "completed" | "failed";

export type WorkerPayload = {
  jobId: string;
  userId: string;
  accessToken: string;
  input: DiscoveryInput;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "unknown error");
}

// ---------- Süre bütçesi (Hobby = 60 sn) ----------

/** Maximum request budget used by the current hosting runtime (seconds). */
export function functionMaxDurationSeconds(): number {
  const isRender = env("NITRO_PRESET") === "render_com" || Boolean(env("RENDER_SERVICE_ID"));
  const defaultDuration = isRender ? 900 : 60;
  // Vercel's setting is intentionally ignored on Render so a stale project
  // variable cannot reintroduce the old serverless timeout after migration.
  const configuredDuration = isRender ? undefined : env("VERCEL_FUNCTION_MAX_DURATION");
  const raw = Number(configuredDuration ?? defaultDuration);
  if (!Number.isFinite(raw) || raw < 10) return defaultDuration;
  return Math.min(900, Math.round(raw));
}

/**
 * İşçinin ağır hatta harcayabileceği süre. Üst sınırın altında bırakılan pay,
 * sonucu Supabase + Redis'e yazmak ve yanıt dönmek içindir.
 */
export function workerBudgetMs(): number {
  return Math.max(25_000, (functionMaxDurationSeconds() - 16) * 1000);
}

/** Tetikleyicinin sonucu beklerken kullanabileceği en uzun süre. */
export function clientWaitMs(): number {
  return Math.max(20_000, (functionMaxDurationSeconds() - 8) * 1000);
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** İş kayıtlarını yazmak için servis rolü istemcisi (RLS bypass). */
export function jobStore(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** Kullanıcı JWT'si ile istemci — kredi RPC'leri ve RLS auth.uid() görür. */
export function userClient(accessToken: string): SupabaseClient<Database> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing");
  return createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** JWT'yi doğrular ve kullanıcı kimliğini döner. */
export async function resolveUserId(accessToken: string): Promise<string> {
  const { data, error } = await userClient(accessToken).auth.getClaims(accessToken);
  const sub = data?.claims?.sub;
  if (error || !sub) throw new Error("Unauthorized");
  return String(sub);
}

/** QStash'in geri çağıracağı herkese açık origin. */
export function appOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const isLocal = (value: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value);
  if (host && !isLocal(host)) return proto + ":" + "//" + host;

  const explicit = env("APP_URL") ?? env("PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost = env("VERCEL_PROJECT_PRODUCTION_URL") ?? env("VERCEL_URL");
  if (vercelHost) {
    const bare = vercelHost.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
    return HTTPS_PREFIX + bare;
  }

  return host ? proto + ":" + "//" + host : "";
}

/** İşçi uç noktasını korumak için paylaşılan sır. */
export function workerSecret(): string | undefined {
  // QSTASH_TOKEN authenticates the publish request; it must never double as
  // the secret forwarded to the worker.
  return env("JOB_WORKER_SECRET");
}

export function qstashConfigured(): boolean {
  return !!qstashToken() && !!workerSecret();
}

export function verifyWorkerRequest(request: Request): boolean {
  const secret = workerSecret();
  if (!secret) return false;
  const provided =
    request.headers.get("x-job-secret") ??
    request.headers.get("upstash-forward-x-job-secret") ??
    "";
  return provided.length > 0 && provided === secret;
}

async function publishToQStash(
  destinationUrl: string,
  payload: WorkerPayload,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const token = qstashToken();
  const secret = workerSecret();
  if (!token || !secret) return { ok: false, error: "QSTASH_NOT_CONFIGURED" };

  // The sender may be Vercel while the worker lives on Render. In that case
  // the timeout must follow the worker target, not the sender's 60s limit.
  const configuredTimeout = Number(env(QSTASH_TIMEOUT_ENV) ?? "");
  const targetIsLongLived = Boolean(env("DISCOVERY_WORKER_URL")) ||
    env("NITRO_PRESET") === "render_com" ||
    Boolean(env("RENDER_SERVICE_ID"));
  const timeoutSeconds = Number.isFinite(configuredTimeout) && configuredTimeout >= 15
    ? Math.min(900, Math.round(configuredTimeout))
    : targetIsLongLived
      ? 890
      : Math.max(15, functionMaxDurationSeconds() - 2);
  const qstashTimeout = `${timeoutSeconds}s`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(qstashBaseUrl() + "/v2/publish/" + destinationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Upstash-Method": "POST",
        "Upstash-Retries": "3",
        "Upstash-Timeout": qstashTimeout,
        "Upstash-Deduplication-Id": payload.jobId,
        "Upstash-Forward-x-job-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `QSTASH_PUBLISH_FAILED_${res.status}: ${detail.slice(0, 180)}` };
    }
    const json = (await res.json().catch(() => null)) as { messageId?: string } | null;
    return { ok: true, messageId: json?.messageId ?? "" };
  } catch (e) {
    return { ok: false, error: `QSTASH_PUBLISH_FAILED: ${errorMessage(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function markJobCompleted(
  jobId: string,
  result: DiscoveryResult,
  attemptCount = 0,
): Promise<void> {
  const { error } = await jobStore().rpc("complete_search_job", {
    _job_id: jobId,
    _attempt_count: attemptCount,
    _result: result,
  });
  if (!error) return;
  if (!isMissingRpc(error)) throw new Error(error.message);
  const { error: updateError } = await jobStore()
    .from(JOB_TABLE)
    .update({ status: "completed", result, error: null, locked_until: null } as never)
    .eq("id", jobId);
  if (updateError) throw new Error(updateError.message);
}

export async function markJobFailed(
  jobId: string,
  message: string,
  attemptCount = 0,
): Promise<void> {
  const { error } = await jobStore().rpc("fail_search_job", {
    _job_id: jobId,
    _attempt_count: attemptCount,
    _error: message,
  });
  if (!error) return;
  if (!isMissingRpc(error)) throw new Error(error.message);
  const { error: updateError } = await jobStore()
    .from(JOB_TABLE)
    .update({ status: "failed", error: message.slice(0, 2000), locked_until: null } as never)
    .eq("id", jobId);
  if (updateError) throw new Error(updateError.message);
}

// ---------- Upstash Redis (REST) önbellek ----------

export function redisConfigured(): boolean {
  return !!env("UPSTASH_REDIS_REST_URL") && !!env("UPSTASH_REDIS_REST_TOKEN");
}

async function redisCommand(command: Array<string | number>): Promise<unknown> {
  const url = env("UPSTASH_REDIS_REST_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  try {
    const res = await fetch(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { result?: unknown } | null;
    return json?.result ?? null;
  } catch {
    return null;
  }
}

export async function cacheJobResult(
  jobId: string,
  result: unknown,
  ttlSeconds = 86_400,
): Promise<void> {
  if (!redisConfigured()) return;
  await redisCommand(["SET", `search:result:${jobId}`, JSON.stringify(result), "EX", ttlSeconds]);
}

export async function cachedJobResult<T>(jobId: string): Promise<T | null> {
  if (!redisConfigured()) return null;
  const raw = await redisCommand(["GET", `search:result:${jobId}`]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------- `searches` tablosu işlemleri ----------

export async function createJobRow(args: {
  jobId: string;
  userId: string;
  input: DiscoveryInput;
}): Promise<void> {
  const { error } = await jobStore()
    .from(JOB_TABLE)
    .insert({
      id: args.jobId,
      user_id: args.userId,
      query: args.input.niche,
      params: args.input,
      status: "processing",
    });
  if (error) throw new Error(error.message);
}

export async function setJobMessageId(jobId: string, messageId: string): Promise<void> {
  if (!messageId) return;
  await jobStore()
    .from(JOB_TABLE)
    .update({ qstash_message_id: messageId } as never)
    .eq("id", jobId);
}

function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "42883" ||
        /could not find the function|function .* does not exist|undefined function/i.test(
          error.message ?? "",
        )),
  );
}

export type SearchJobClaim = {
  state: "claimed" | "completed" | "failed" | "processing" | "missing";
  attemptCount?: number;
  reliable: boolean;
};

/** Claim a delivery when the reliability migration is installed. */
export async function claimSearchJob(jobId: string): Promise<SearchJobClaim> {
  const { data, error } = await jobStore().rpc("claim_search_job", {
    _job_id: jobId,
    _lease_seconds: 900,
  });
  if (!error && data && typeof data === "object") {
    const raw = data as { state?: SearchJobClaim["state"]; attempt_count?: number };
    const state = raw.state;
    if (
      state === "claimed" ||
      state === "completed" ||
      state === "failed" ||
      state === "processing" ||
      state === "missing"
    ) {
      return {
        state,
        attemptCount:
          typeof raw.attempt_count === "number" ? raw.attempt_count : undefined,
        reliable: true,
      };
    }
  }
  // The base searches migration is enough to run safely in legacy mode. The
  // reliability migration can be applied independently without blocking the
  // first deployment.
  if (isMissingRpc(error)) return { state: "claimed", reliable: false };
  throw new Error(error?.message || "Could not claim search job");
}

export async function readJobRow(
  jobId: string,
): Promise<{ status: JobStatus; result: unknown; error: string | null } | null> {
  const { data, error } = await jobStore()
    .from(JOB_TABLE)
    .select("status, result, error")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { status: JobStatus; result: unknown; error: string | null };
  return { status: row.status, result: row.result, error: row.error };
}

// ---------- Yüksek seviye API ----------

/** İş kaydını açar ve QStash'e yayınlar. Kredi burada DÜŞÜLMEZ (işçi düşer). */
export async function startDiscoveryJob(args: {
  input: DiscoveryInput;
  userId: string;
  accessToken: string;
  origin: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (!qstashConfigured()) return { ok: false, error: "QSTASH_NOT_CONFIGURED" };
  if (!args.origin || /localhost|127\.0\.0\.1/i.test(args.origin)) {
    return { ok: false, error: "ORIGIN_NOT_PUBLIC" };
  }

  const jobId = globalThis.crypto.randomUUID();
  try {
    await createJobRow({ jobId, userId: args.userId, input: args.input });
  } catch (e) {
    return { ok: false, error: `JOB_STORE_UNAVAILABLE: ${errorMessage(e)}` };
  }

  const target = discoveryWorkerUrl(args.origin);
  if (!target) {
    await markJobFailed(jobId, "DISCOVERY_WORKER_URL_INVALID").catch(() => {});
    return { ok: false, error: "DISCOVERY_WORKER_URL_INVALID" };
  }
  const published = await publishToQStash(target, {
    jobId,
    userId: args.userId,
    accessToken: args.accessToken,
    input: args.input,
  });
  if (!published.ok) {
    await markJobFailed(jobId, published.error).catch(() => {});
    return { ok: false, error: published.error };
  }
  await setJobMessageId(jobId, published.messageId);
  return { ok: true, jobId };
}

/**
 * Kayıt `completed`/`failed` olana kadar bekler (sunucu tarafı yoklama).
 *
 * Bekleme süresi HER ZAMAN `clientWaitMs()` ile sınırlandırılır; böylece
 * çağıran taraf yanlışlıkla daha uzun bir süre isterse dahi istek Vercel'in
 * (Hobby'de 60 sn) sert sınırına çarpmaz.
 */
export async function waitForJob(
  jobId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<{ status: JobStatus; result?: unknown; error?: string | null }> {
  const maxWait = clientWaitMs();
  const timeoutMs = Math.min(opts?.timeoutMs ?? maxWait, maxWait);
  const intervalMs = Math.max(1_000, opts?.intervalMs ?? 1_500);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const row = await readJobRow(jobId);
    if (row && row.status !== "processing") {
      return { status: row.status, result: row.result, error: row.error };
    }
    if (Date.now() + intervalMs >= deadline) return { status: "processing" };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** QStash işçisinin gövdesi: ağır hattı çalıştırır ve sonucu kalıcılaştırır. */
export async function runJob(
  payload: WorkerPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let attemptCount = 0;
  try {
    const claim = await claimSearchJob(payload.jobId);
    if (claim.state === "completed") return { ok: true };
    if (claim.state !== "claimed") return { ok: false, error: `JOB_${claim.state.toUpperCase()}` };
    attemptCount = claim.attemptCount ?? 0;
    const { runProductDiscovery } = await import("@/lib/discovery-pipeline.server");
    const result: DiscoveryResult = await runProductDiscovery(payload.input, {
      supabase: userClient(payload.accessToken),
      userId: payload.userId,
      deductCredit: true,
      // Hat, kalan süreye göre kendini kısaltarak zamanında sonuç döner.
      budgetMs: workerBudgetMs(),
    });
    await markJobCompleted(payload.jobId, result, attemptCount);
    await cacheJobResult(payload.jobId, result).catch(() => {});
    return { ok: true };
  } catch (e) {
    const message = errorMessage(e);
    console.error(`[discovery-worker] job ${payload.jobId} failed: ${message}`);
    await markJobFailed(payload.jobId, message, attemptCount).catch(() => {});
    return { ok: false, error: message };
  }
}
