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
 * DAĞITIM PLANI üç yoldan biridir (`discoveryDispatchPlan`):
 *  - `qstash`     → QStash anahtarları var; iş QStash'e yayınlanır (mevcut yol).
 *  - `in-process` → Kalıcı süreç (Render / VPS) ve QStash yok: iş AYNI süreçte
 *                   arka planda koşar (`job-runner.server.ts`). İstek anında
 *                   döner; bu yüzden QStash olmadan da tek bir 504 üretilmez.
 *  - `inline`     → Sunucusuz ortam ve QStash yok: ağır hattı istek içinde
 *                   çalıştırmaktan başka yol yoktur (çağıran kendi bütçesiyle
 *                   kısaltır).
 * QStash yapılandırılmış fakat publish başarısızsa fallback yapılmaz; işin gerçek
 * kuyruğa alma hatası korunur ve aynı kısa HTTP isteğinde ağır işlem tekrarlanmaz.
 *
 * Ek npm bağımlılığı yoktur — QStash ve Redis REST API'leri `fetch` ile
 * kullanılır (lock dosyası / kurulum riski sıfır).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DiscoveryInput, DiscoveryResult } from "@/lib/discovery-pipeline.server";
import {
  backgroundJobTimeoutMs,
  detectHostRuntime,
  platformDurationSeconds,
  readEnvValue,
  runsOnPersistentHost,
} from "@/lib/host-runtime.server";
import { backgroundJobsEnabled, runInBackground } from "@/lib/job-runner.server";
import { MIN_INLINE_COUNCIL_MS } from "@/lib/council-budget.server";

type EnvMap = Record<string, string | undefined>;

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

/** Hosting'in tek bir istek için izin verdiği en yüksek süre (Render). */
const LONG_LIVED_MAX_SECONDS = 900;

/** QStash'in Render işçisini beklerken kullandığı süre (900'ün altında pay bırakır). */
const LONG_LIVED_QSTASH_TIMEOUT_SECONDS = 890;

/** İstemcinin iş durumunu kaç ms aralıkla yoklayacağı. */
export const JOB_POLL_INTERVAL_MS = 2_000;

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

// ---------- Süre bütçesi (platforma göre: Vercel 60 sn, Render 900 sn) ----------

/**
 * True when this process runs on a host without a serverless request limit
 * (Render's persistent Node web service or a self-hosted Node server) so work
 * can be finished outside the request instead of being cut off at 60s.
 *
 * Detection lives in `host-runtime.server.ts` so every budget in the codebase
 * reads the platform the same way.
 */
export function runsOnLongLivedHost(envMap: EnvMap = process.env): boolean {
  return runsOnPersistentHost(envMap);
}

/**
 * True when the QStash worker lives on a long-lived host — either because this
 * process itself is on Render, or because a remote worker URL points the job at
 * a Render service while the trigger keeps running on Vercel.
 *
 * İki değişkeni de sayıyoruz: ürün bulucu `DISCOVERY_WORKER_URL` ile, ağır işler
 * (AI Konsey) `WORKER_URL` ile hedefleniyor. Yalnızca birine bakmak, hibrit
 * kurulumda tetikleyicinin 300 sn'lik bütçesini tüm zincire uygulardı.
 */
export function workerTargetIsLongLived(envMap: EnvMap = process.env): boolean {
  return remoteWorkerConfigured(envMap) || runsOnLongLivedHost(envMap);
}

/** Bu sürecin barındırıldığı platformun istek başına süre bütçesi (saniye). */
export function functionMaxDurationSeconds(envMap: EnvMap = process.env): number {
  return platformDurationSeconds(envMap);
}

/**
 * QStash'e verilen `Upstash-Timeout` değeri (saniye).
 *
 * Öncelik: açık `QSTASH_TIMEOUT_SECONDS` → işçinin barındığı host'un bütçesi.
 * Tetikleyici Vercel'de, işçi Render'da olsa bile süre işçiye göre belirlenir;
 * aksi halde uzun iş 60 sn'de kesilip kullanıcıya 504 olarak dönerdi.
 */
export function qstashTimeoutSeconds(): number {
  const configured = Number(env(QSTASH_TIMEOUT_ENV) ?? "");
  if (Number.isFinite(configured) && configured >= 15) {
    return Math.min(LONG_LIVED_MAX_SECONDS, Math.round(configured));
  }
  return workerTargetIsLongLived()
    ? LONG_LIVED_QSTASH_TIMEOUT_SECONDS
    : Math.max(15, functionMaxDurationSeconds() - 2);
}

/**
 * İşçinin ağır hatta harcayabileceği süre. Üst sınırın altında bırakılan pay,
 * sonucu Supabase + Redis'e yazmak ve yanıt dönmek içindir.
 */
export function workerBudgetMs(): number {
  return Math.max(25_000, (functionMaxDurationSeconds() - 16) * 1000);
}

/**
 * Bir işin bitmesi için beklenebilecek süre (saniye).
 *
 * Uzak worker tanımlıysa iş tetikleyicinin değil **worker'ın** bütçesiyle koşar.
 * Hibrit kurulumda (Vercel tetikler + Render çalıştırır) tetikleyicinin 300 sn'si
 * baz alınırsa, 350-400 sn süren 14'lü konsey tamamlanmadan istemci "zaman
 * aşımı" gösterirdi: sonuç önbelleğe yazılır ama kullanıcı hiç görmez.
 */
export function jobWaitBudgetSeconds(envMap: EnvMap = process.env): number {
  if (workerTargetIsLongLived(envMap)) return LONG_LIVED_MAX_SECONDS;
  return functionMaxDurationSeconds(envMap);
}

/** Tetikleyicinin sonucu beklerken kullanabileceği en uzun süre. */
export function clientWaitMs(): number {
  return Math.max(20_000, (jobWaitBudgetSeconds() - 8) * 1000);
}

/**
 * İstemcinin yoklama planı — tek kaynak burasıdır.
 *
 * Tarayıcı sabit bir süre varsaymaz; bütçe `jobWaitBudgetSeconds()`'ten gelir:
 * iş bu süreçte koşuyorsa platformun limiti (Render ~14,9 dk), iş uzak worker'a
 * gidiyorsa worker'ın limiti (hibritte de ~14,9 dk). Böylece uzun süren iş
 * istemcide erken "zaman aşımı" olarak görünmez; worker yoksa kısa süreli
 * Vercel fonksiyonu da gereksiz yere yoklanmaz.
 */
export function jobPollingPlan(): { pollMaxMs: number; pollIntervalMs: number } {
  return { pollMaxMs: clientWaitMs(), pollIntervalMs: JOB_POLL_INTERVAL_MS };
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

/**
 * İşi hangi yolla çalıştıracağımız: QStash, süreç içi arka plan veya istek
 * içinde (inline). Tek karar noktasıdır; hem server function hem `/api/search`
 * buradan okur, böylece iki yol farklı davranamaz.
 */
export type DiscoveryDispatchMode = "qstash" | "in-process" | "inline";

export function discoveryDispatchPlan(envMap: EnvMap = process.env): DiscoveryDispatchMode {
  const token = cleanQStashToken(readEnvValue(envMap, "QSTASH_TOKEN") ?? "");
  const secret = readEnvValue(envMap, "JOB_WORKER_SECRET") ?? "";
  if (token && secret) return "qstash";
  // Render gibi kalıcı bir süreçte QStash opsiyoneldir: iş aynı süreçte arka
  // planda koşar ve istek anında döner. Böylece anahtar girilmemiş bir kurulumda
  // bile "sürekli 504" durumu oluşmaz.
  if (runsOnLongLivedHost(envMap) && backgroundJobsEnabled(envMap)) return "in-process";
  return "inline";
}

// ---------- Uzak worker (hibrit: Vercel tetikler, Render çalıştırır) ----------

/** Uzak worker adresi tanımlı mı? (`WORKER_URL` ya da `DISCOVERY_WORKER_URL`) */
export function remoteWorkerConfigured(envMap: EnvMap = process.env): boolean {
  return Boolean(
    readEnvValue(envMap, "WORKER_URL") ?? readEnvValue(envMap, "DISCOVERY_WORKER_URL"),
  );
}

/**
 * Ağır işlerin worker uç noktası (`/api/jobs`).
 *
 * `WORKER_URL` (tercih) veya `DISCOVERY_WORKER_URL` taban alınır ve yol her
 * zaman `/api/jobs` yapılır: aynı Render servisi hem `/api/worker` (ürün
 * bulucu) hem `/api/jobs` (konsey ve diğer ağır işler) ucunu besler.
 */
export function workerJobsUrl(envMap: EnvMap = process.env): string {
  const configured =
    readEnvValue(envMap, "WORKER_URL") ?? readEnvValue(envMap, "DISCOVERY_WORKER_URL");
  if (!configured) return "";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return "";
    url.pathname = "/api/jobs";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * Ağır bir işi uzak worker'a QStash ile yollar. İstek ANINDA döner; worker işi
 * kendi süreç içi kuyruğunda çalıştırır (Retries: 3, dedupe: `dedupeId`).
 */
export async function enqueueRemoteJob(args: {
  kind: string;
  payload: Record<string, unknown>;
  dedupeId: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  return qstashPublish(workerJobsUrl(), { kind: args.kind, ...args.payload }, args.dedupeId);
}

/**
 * Ağır bir iş için en iyi yol — **504 garantisi bu sözleşmedir**.
 *
 *  - `in-process`    → kalıcı servis (Render/VPS): süreç içi arka plan kuyruğu.
 *  - `qstash-worker` → sunucusuz tetikleyici + QStash + uzak Render worker'ı:
 *                      iş Render'da koşar, tetikleyici anında döner.
 *  - `inline`        → yerel geliştirme ya da uzak worker'ı olmayan ama
 *                      fonksiyon limiti ağır işe YETEN sunucusuz ortam (Vercel
 *                      Hobby 300 sn): hat, istek içinde bütçesine sığdırılarak
 *                      koşar ve sonucu aynı istekte döner.
 *  - `unavailable`   → fonksiyon limiti ağır işe yetmiyor (ör. 60 sn'ye
 *                      daraltılmış): istek içinde koşmak yerine HIZLI ve AÇIK
 *                      hata döner. Asla 504 üretilmez.
 */
export type LongJobPlan = "in-process" | "qstash-worker" | "inline" | "unavailable";

/**
 * Fonksiyon limiti ağır bir hattı İSTEK İÇİNDE koşmaya yetiyor mu?
 *
 * Vercel Hobby'de 300 sn (`nitro.config.ts` → `vercel.functions.maxDuration`),
 * ve 14 ajanlı konseyin `fast` profili 245 sn rezerv + 10 sn dönüş payı ister:
 * istek kendi kendine biter, 504 oluşmaz. Limit 120 sn'nin (MIN_INLINE_COUNCIL_MS)
 * altına daraltılmışsa hiçbir ağır hat sığmaz; o durumda koşmak yerine hızlı ve
 * açık hata döneriz (kredi harcanmadan).
 */
export function inlineHeavyWorkFits(envMap: EnvMap = process.env): boolean {
  return platformDurationSeconds(envMap) * 1000 >= MIN_INLINE_COUNCIL_MS;
}

export function longJobPlan(envMap: EnvMap = process.env): LongJobPlan {
  const runtime = detectHostRuntime(envMap);

  // Kalıcı servis: arka plan kuyruğu.
  if (!runtime.serverless && runtime.name !== "local") {
    return backgroundJobsEnabled(envMap) ? "in-process" : "inline";
  }

  // Sunucusuz (Vercel): tercih worker; worker yoksa istek içinde ama MUTLAKA
  // platform limitine sığdırılarak koşar (bütçe `host-runtime`ten gelir).
  if (runtime.serverless) {
    const qstashReady = Boolean(
      cleanQStashToken(readEnvValue(envMap, "QSTASH_TOKEN") ?? "") &&
        readEnvValue(envMap, "JOB_WORKER_SECRET"),
    );
    if (qstashReady && remoteWorkerConfigured(envMap)) return "qstash-worker";
    return inlineHeavyWorkFits(envMap) ? "inline" : "unavailable";
  }

  // Yerel geliştirme: istek sınırı yok, eski davranış korunur.
  return "inline";
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

/**
 * QStash'e tek bir HTTP işi yayınlar (ortak yol: ürün bulucu + konsey).
 *
 * `Upstash-Forward-x-job-secret` başlığı worker ucunun doğrulaması için taşınır;
 * `Upstash-Deduplication-Id` aynı işin iki kez çalışmasını engeller.
 */
async function qstashPublish(
  destinationUrl: string,
  body: unknown,
  dedupeId: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const token = qstashToken();
  const secret = workerSecret();
  if (!token || !secret) return { ok: false, error: "QSTASH_NOT_CONFIGURED" };
  if (!destinationUrl) return { ok: false, error: "WORKER_URL_NOT_CONFIGURED" };

  const qstashTimeout = `${qstashTimeoutSeconds()}s`;

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
        "Upstash-Deduplication-Id": dedupeId,
        "Upstash-Forward-x-job-secret": secret,
      },
      body: JSON.stringify(body),
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

async function publishToQStash(
  destinationUrl: string,
  payload: WorkerPayload,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  return qstashPublish(destinationUrl, payload, payload.jobId);
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

// Sunucu tarafı "iş bitene kadar bekle" yardımcı fonksiyonu bilinçli olarak yok:
// kısa ömürlü bir fonksiyonda beklemek 504'ün ta kendisidir. Durum, tarayıcı
// tarafından `getDiscoveryJob` (RLS kapsamlı, kullanıcı JWT'si) ile yoklanır ve
// bekleme bütçesi tek kaynaktan — `jobPollingPlan()` — bildirilir.

// ---------- Yüksek seviye API ----------

/** İş kaydını açar ve QStash'e yayınlar. Kredi burada DÜŞÜLMEZ (işçi düşer). */
export async function startDiscoveryJob(args: {
  input: DiscoveryInput;
  userId: string;
  accessToken: string;
  origin: string;
}): Promise<
  { ok: true; jobId: string; mode: DiscoveryDispatchMode } | { ok: false; error: string }
> {
  const mode = discoveryDispatchPlan();
  // Sunucusuz ortam + QStash yok: arka plan yoktur, çağıran taraf inline koşar.
  if (mode === "inline") return { ok: false, error: "BACKGROUND_DISPATCH_UNAVAILABLE" };

  const jobId = globalThis.crypto.randomUUID();
  try {
    await createJobRow({ jobId, userId: args.userId, input: args.input });
  } catch (e) {
    return { ok: false, error: `JOB_STORE_UNAVAILABLE: ${errorMessage(e)}` };
  }

  const payload: WorkerPayload = {
    jobId,
    userId: args.userId,
    accessToken: args.accessToken,
    input: args.input,
  };

  if (mode === "in-process") {
    // Kalıcı süreç: işi kendi kuyruğumuza atıp ANINDA dönüyoruz. İstemci
    // `getDiscoveryJob` ile Supabase'den yoklar; istek hiçbir zaman platform
    // zaman aşımına dayanmaz.
    const started = runInBackground("discovery-job", () => runJob(payload), {
      key: jobId,
      timeoutMs: backgroundJobTimeoutMs(),
    });
    if (!started.started) {
      const reason = `BACKGROUND_JOB_UNAVAILABLE:${started.reason ?? "unknown"}`;
      await markJobFailed(jobId, reason).catch(() => {});
      return { ok: false, error: reason };
    }
    return { ok: true, jobId, mode };
  }

  // QStash yolu: worker'ın public adresi şart.
  if (!args.origin || /localhost|127\.0\.0\.1/i.test(args.origin)) {
    await markJobFailed(jobId, "ORIGIN_NOT_PUBLIC").catch(() => {});
    return { ok: false, error: "ORIGIN_NOT_PUBLIC" };
  }

  const target = discoveryWorkerUrl(args.origin);
  if (!target) {
    await markJobFailed(jobId, "DISCOVERY_WORKER_URL_INVALID").catch(() => {});
    return { ok: false, error: "DISCOVERY_WORKER_URL_INVALID" };
  }
  const published = await publishToQStash(target, payload);
  if (!published.ok) {
    await markJobFailed(jobId, published.error).catch(() => {});
    return { ok: false, error: published.error };
  }
  await setJobMessageId(jobId, published.messageId);
  return { ok: true, jobId, mode };
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
