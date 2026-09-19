/**
 * In-process arka plan iş kuyruğu — Render'daki 504'lerin kök çözümü.
 *
 * Render bir **kalıcı** Node servisi çalıştırır: istek yanıtlandıktan sonra da
 * süreç yaşamaya devam eder. Bu yüzden uzun süren bir işi (ürün bulucu hattı,
 * konsey analizi, saatlik taramalar) istek içinde beklemek yerine burada
 * kuyruğa alıp istemciye anında dönebiliriz. İstek 504 olmaz, iş arka planda
 * tamamlanır ve sonuç Supabase/Redis'e yazıldığı için istemci yoklamayla alır.
 *
 * Neden QStash'e alternatif: QStash opsiyonel bir bağımlılıktır (anahtarları
 * girilmemiş olabilir). Render'da QStash olmadan da asenkron davranış doğru
 * sonuçtur; QStash varsa yine o kullanılır (bkz. `discoveryDispatchPlan`).
 *
 * Kurallar:
 * - Kuyruk **süreç içi**dir; birden fazla instance varsa her instance kendi
 *   işini yürütür. Bu yüzden aynı işin iki kez başlatılmasını `key` ile
 *   engelliyoruz (dedupe) ve işler idempotent yazılır.
 * - Eşzamanlılık sınırlıdır (`BACKGROUND_JOB_CONCURRENCY`, varsayılan 2): tek
 *   CPU'da SSR'ı aç bırakmamak için.
 * - Her işin sert bir zaman aşımı vardır; slot bu süre sonunda serbest kalır.
 * - Sunucusuz ortamda (Vercel) arka plan yoktur; çağıran taraf bunu görüp
 *   kendi bütçesi içinde çalışır.
 */

import {
  backgroundJobTimeoutMs,
  detectHostRuntime,
  runsOnPersistentHost,
} from "@/lib/host-runtime.server";

type Env = Record<string, string | undefined>;

export type RunInBackgroundResult = {
  started: boolean;
  /** Başlamadıysa nedeni — log/teşhis için. */
  reason?: "host-unsupported" | "duplicate";
  key?: string;
};

export type BackgroundJobStats = {
  enabled: boolean;
  concurrency: number;
  queued: number;
  active: number;
  completed: number;
  failed: number;
  timedOut: number;
  skipped: number;
  lastLabel?: string;
  lastError?: string;
};

type RunnerJob = {
  label: string;
  key?: string;
  timeoutMs: number;
  run: () => Promise<unknown>;
};

const queue: RunnerJob[] = [];
/** Aynı `key` ile ikinci kez iş kuyruğa alınmasın (dedupe). */
const inflight = new Map<string, RunnerJob>();

let active = 0;
let completed = 0;
let failed = 0;
let timedOut = 0;
let skipped = 0;
let lastLabel: string | undefined;
let lastError: string | undefined;

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "unknown error");
}

/** Eşzamanlı yürüyen iş sayısı (tek CPU'da SSR'ı boğmamak için sınırlı). */
export function backgroundJobConcurrency(env: Env = process.env): number {
  const parsed = Number(read(env, "BACKGROUND_JOB_CONCURRENCY") ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.round(parsed));
}

/** Bu süreçte arka plan işi başlatılabilir mi? */
export function backgroundJobsEnabled(env: Env = process.env): boolean {
  return detectHostRuntime(env).backgroundJobs;
}

export function backgroundJobStats(env: Env = process.env): BackgroundJobStats {
  return {
    enabled: backgroundJobsEnabled(env),
    concurrency: backgroundJobConcurrency(env),
    queued: queue.length,
    active,
    completed,
    failed,
    timedOut,
    skipped,
    ...(lastLabel ? { lastLabel } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

/** Testler ve kapanış senaryoları için sayacı sıfırlar (kuyruk boşaltılmaz). */
export function resetJobRunnerCounters(): void {
  queue.length = 0;
  inflight.clear();
  active = 0;
  completed = 0;
  failed = 0;
  timedOut = 0;
  skipped = 0;
  lastLabel = undefined;
  lastError = undefined;
}

/**
 * Uzun süren bir işi arka plana atar ve **anında** döner.
 *
 * Çağıran taraf `started: false` görürse işi kendi isteği içinde (kısaltılmış
 * bütçeyle) çalıştırmak zorundadır; sessizce düşürmek 504'e davettir.
 */
export function runInBackground(
  label: string,
  run: () => Promise<unknown>,
  opts: { key?: string; timeoutMs?: number; env?: Env } = {},
): RunInBackgroundResult {
  const env = opts.env ?? process.env;

  if (!backgroundJobsEnabled(env)) {
    skipped++;
    return { started: false, reason: "host-unsupported" };
  }
  if (opts.key && inflight.has(opts.key)) {
    skipped++;
    return { started: false, reason: "duplicate", key: opts.key };
  }

  const job: RunnerJob = {
    label,
    timeoutMs: opts.timeoutMs ?? backgroundJobTimeoutMs(env),
    run,
    ...(opts.key ? { key: opts.key } : {}),
  };
  queue.push(job);
  if (job.key) inflight.set(job.key, job);
  pump();
  return { started: true, ...(opts.key ? { key: opts.key } : {}) };
}

/**
 * Bu anahtarla bir iş kuyrukta veya çalışıyor mu?
 *
 * Kredi düşmeden ÖNCE sorulur: aynı sorgu zaten arkada çalışıyorsa ikinci
 * kullanıcı/i̇kinci tıklama kredi harcamamalı, yalnızca sonucu beklemeli.
 */
export function isBackgroundJobRunning(key: string): boolean {
  if (inflight.has(key)) return true;
  return queue.some((job) => job.key === key);
}

function pump(): void {
  const limit = backgroundJobConcurrency();
  while (active < limit && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    active++;
    void execute(job);
  }
}

async function execute(job: RunnerJob): Promise<void> {
  lastLabel = job.label;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("BACKGROUND_JOB_TIMEOUT")), job.timeoutMs);
    });
    await Promise.race([job.run(), timeout]);
    completed++;
  } catch (e) {
    const message = errorMessage(e);
    if (message === "BACKGROUND_JOB_TIMEOUT") timedOut++;
    failed++;
    lastError = `${job.label}: ${message}`;
    console.error(`[background-job] ${job.label} failed: ${message}`);
  } finally {
    if (timer) clearTimeout(timer);
    active = Math.max(0, active - 1);
    if (job.key) inflight.delete(job.key);
    pump();
  }
}

/**
 * Kuyruk boşalana kadar bekler. Testlerde ve zarif kapanışta kullanılır;
 * üretim istek yolunda çağrılmaz.
 */
export async function drainBackgroundJobs(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (active > 0 || queue.length > 0) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return true;
}

/** Teşhis logu: kuyrukta ne var? (sır içermez) */
export function describeBackgroundRunner(env: Env = process.env): string {
  const stats = backgroundJobStats(env);
  const target = runsOnPersistentHost(env) ? "kalıcı servis" : "sunucusuz";
  return `[jobs] ${target} · etkin=${stats.enabled} · eşzamanlılık=${stats.concurrency} · kuyruk=${stats.queued} · çalışan=${stats.active} · tamam=${stats.completed} · hata=${stats.failed}`;
}
