/**
 * Host çalışma zamanı algılama ve istek bütçeleri — 504 sınıfı hataların tek
 * karar noktası.
 *
 * Neden gerekli: platformların isteği kesme süresi birbirinden çok farklıdır.
 *
 * | Platform            | İsteği kim keser?             | Kalıcı süreç |
 * | ------------------- | ----------------------------- | ------------ |
 * | Vercel (Hobby)      | fonksiyon limiti (60 sn)      | hayır        |
 * | Render Web Service  | proxy'de sert sınır           | **evet**     |
 * | Kalıcı Node / VPS   | yok (biz `REQUEST_BUDGET_MS`  | **evet**     |
 * |                     | ile sınırlarız)               |              |
 *
 * Kalıcı bir süreçte (Render) uzun işi istek içinde beklemek yerine **arka
 * plana** atıp istemciye hızlı yanıt dönmek tek doğru çözümdür. Bu modül arka
 * plan işinin mümkün olup olmadığını, ne kadar sürebileceğini ve tek bir
 * isteğin ne zaman "hazır değil" (warming) demesi gerektiğini bildirir.
 * Hiçbir yerde sabit "60" veya "900" yazılmaz.
 */

export type HostRuntimeName = "render" | "vercel" | "node" | "local";

export type HostRuntime = {
  /** Platform etiketi — log ve /health çıktısında görünür. */
  name: HostRuntimeName;
  /** Platform isteği kendisi kesiyor mu (kısa ömürlü fonksiyon)? */
  serverless: boolean;
  /** Bu süreç istekler arasında yaşıyor mu (Render / VPS / dev sunucusu)? */
  persistent: boolean;
  /** Arka plan işi bu süreçte anlamlı mı? */
  backgroundJobs: boolean;
};

type Env = Record<string, string | undefined>;

/** Kalıcı Node sunucusu üreten Nitro preset'leri. */
const PERSISTENT_PRESETS = new Set([
  "render-com",
  "node-server",
  "node",
  "platform-sh",
  "bun",
  "deno",
  "render-com-node",
]);

/** Sunucusuz (serverless) olduğu bilinen preset'ler. */
const SERVERLESS_PRESETS = new Set([
  "vercel",
  "vercel-edge",
  "netlify",
  "aws-lambda",
  "cloudflare",
  "cloudflare-module",
  "cloudflare-pages",
]);

const VERCEL_MARKERS = ["VERCEL", "VERCEL_URL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL"];
const RENDER_MARKERS = [
  "RENDER_SERVICE_ID",
  "RENDER_SERVICE_NAME",
  "RENDER_EXTERNAL_URL",
  "RENDER_EXTERNAL_HOSTNAME",
];

/** Vercel Hobby varsayılanı: bir fonksiyon en fazla 60 sn çalışır. */
export const VERCEL_DEFAULT_FUNCTION_SECONDS = 60;

/** Kalıcı süreçte tek bir işin üst sınırı (15 dk). */
export const MAX_LONG_LIVED_SECONDS = 900;

/**
 * Render'da proxy'nin isteği kesmesini beklemeden kendi koyduğumuz üst sınır.
 * Herhangi bir isteğin bu süreden uzun açık kalması 504 davetiyesidir.
 */
export const DEFAULT_INTERACTIVE_BUDGET_MS = 45_000;

/** Soğuk önbellekte istek içinde bekleyebileceğimiz en uzun süre. */
export const DEFAULT_WARM_WAIT_MS = 20_000;

/**
 * Tek bir isteğin üst sınırı için üst sınır (2 dk). Kalıcı süreçte platform
 * limiti olmasa da proxy'lerin önüne geçmek için bu tavana uyarız.
 */
export const MAX_INTERACTIVE_BUDGET_MS = 120_000;

const INTERACTIVE_BUDGET_ENV = "REQUEST_BUDGET_MS";
const WARM_WAIT_ENV = "WARM_WAIT_MS";
const JOB_TIMEOUT_ENV = "BACKGROUND_JOB_TIMEOUT_MS";
const FORCE_JOBS_ENV = "BACKGROUND_JOBS";

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Ortam değişkenini boş/whitespace'e karşı koruyarak okur. Bütçe hesaplayan
 * tüm modüller aynı kuralı kullansın diye dışa açıldı.
 */
export function readEnvValue(env: Env, key: string): string | undefined {
  return read(env, key);
}

function truthy(env: Env, key: string): boolean {
  const value = read(env, key)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function falsy(env: Env, key: string): boolean {
  const value = read(env, key)?.toLowerCase();
  return value === "0" || value === "false" || value === "no" || value === "off";
}

function anySet(env: Env, keys: string[]): boolean {
  return keys.some((key) => Boolean(read(env, key)));
}

/** Nitro preset adını kebab-case'e çevirir (nitro `resolvePreset` ile aynı kural). */
function normalizePreset(value: string): string {
  return value.toLowerCase().replace(/_/g, "-");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberFrom(env: Env, key: string): number | undefined {
  const raw = read(env, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Bu sürecin hangi platformda koştuğunu döner. Saf fonksiyon: testler env'i
 * argümanla verir, üretimde `process.env` kullanılır.
 */
export function detectHostRuntime(env: Env = process.env): HostRuntime {
  const preset = read(env, "NITRO_PRESET");
  const normalized = preset ? normalizePreset(preset) : "";

  const isRender = anySet(env, RENDER_MARKERS) || normalized.startsWith("render-");
  const isVercel = anySet(env, VERCEL_MARKERS) || normalized.startsWith("vercel");
  const isPersistentPreset = PERSISTENT_PRESETS.has(normalized);
  const isServerlessPreset = SERVERLESS_PRESETS.has(normalized);

  // Render marker'ı, göç sonrası kalmış bir VERCEL_URL'den önce gelir: aksi
  // halde kalıcı servis yanlışlıkla sunucusuz sanılır ve tüm arka plan işleri
  // (504 korumasının tamamı) kapanırdı. Yalnızca build hedefi açıkça Vercel
  // seçilmişse (NITRO_PRESET=vercel*) Vercel kazanır.
  const presetIsVercel = normalized.startsWith("vercel");
  let name: HostRuntimeName;
  if (isRender && !presetIsVercel) name = "render";
  else if (isVercel || isServerlessPreset) name = "vercel";
  else if (isPersistentPreset) name = "node";
  else name = "local";

  const serverless = name === "vercel";
  // Dev sunucusu da istekler arasında yaşar; onu "local" etiketiyle ayırıyoruz.
  const persistent = name === "render" || name === "node" || name === "local";

  let backgroundJobs = persistent;
  if (falsy(env, FORCE_JOBS_ENV)) backgroundJobs = false;
  // Sunucusuz bir ortamda zorla açmak isteyenler için kaçış kapısı (ör. kendi
  // `waitUntil` uygulaması olan bir sağlayıcı).
  if (truthy(env, FORCE_JOBS_ENV)) backgroundJobs = true;

  return { name, serverless, persistent, backgroundJobs };
}

/**
 * İstek yerine arka plan işi kullanabileceğimiz kalıcı bir servis miyiz?
 * (Render Web Service veya kendi Node sunucun.) Vercel ve dev'de `false`.
 */
export function runsOnPersistentHost(env: Env = process.env): boolean {
  const runtime = detectHostRuntime(env);
  return runtime.persistent && !runtime.serverless && runtime.name !== "local";
}

/**
 * Bu sürecin kendi koyduğu istek başına süre bütçesi (saniye).
 *
 * Kalıcı serviste platform limiti yoktur; üst sınırı biz koyarız. Sunucusuz
 * ortamda `VERCEL_FUNCTION_MAX_DURATION` (varsayılan 60) geçerlidir ve kalıcı
 * serviste bu değişken **bilinçli olarak yok sayılır** — göç sonrası kalan eski
 * bir değişken 60 sn'lik zaman aşımını geri getirmemelidir.
 */
export function platformDurationSeconds(env: Env = process.env): number {
  const longLived = runsOnPersistentHost(env);
  const fallback = longLived ? MAX_LONG_LIVED_SECONDS : VERCEL_DEFAULT_FUNCTION_SECONDS;
  const configured = longLived ? undefined : numberFrom(env, "VERCEL_FUNCTION_MAX_DURATION");
  if (configured === undefined || configured < 10) return fallback;
  return clamp(Math.round(configured), 10, MAX_LONG_LIVED_SECONDS);
}

/**
 * Tek bir etkileşimli HTTP isteğinin cevaplanması için ayırdığımız süre (ms).
 *
 * Kalıcı süreçte `REQUEST_BUDGET_MS` ile ayarlanır (varsayılan 45 sn, üst sınır
 * 120 sn). Sunucusuz ortamda fonksiyon limitinin 8 sn altı alınır ki yanıt
 * platformun kesmesinden önce çıksın.
 */
export function interactiveRequestBudgetMs(env: Env = process.env): number {
  const runtime = detectHostRuntime(env);
  if (!runtime.serverless) {
    const configured = numberFrom(env, INTERACTIVE_BUDGET_ENV);
    return clamp(
      Math.round(configured ?? DEFAULT_INTERACTIVE_BUDGET_MS),
      5_000,
      MAX_INTERACTIVE_BUDGET_MS,
    );
  }
  return Math.max(10_000, (platformDurationSeconds(env) - 8) * 1000);
}

/**
 * Arka plan işi için sert zaman aşımı (ms). İş bu süreyi aşarsa kuyruk slotu
 * serbest bırakılır ve iş başarısız sayılır.
 */
export function backgroundJobTimeoutMs(env: Env = process.env): number {
  const configured = numberFrom(env, JOB_TIMEOUT_ENV);
  return clamp(Math.round(configured ?? MAX_LONG_LIVED_SECONDS * 1000), 30_000, 1_800_000);
}

/**
 * Önbellek soğukken istek içinde bekleyebileceğimiz süre (ms).
 *
 * Aşılırsa istek `warming` durumuyla **anında** döner; tarama arka planda sürer
 * ve istemci kısa aralıklarla tekrar sorar. Böylece hiçbir istek 504'e dönüşmez.
 */
export function warmingWaitMs(env: Env = process.env): number {
  const configured = numberFrom(env, WARM_WAIT_ENV);
  return clamp(Math.round(configured ?? DEFAULT_WARM_WAIT_MS), 3_000, 25_000);
}

/** /health ve log satırları için özet (sır içermez). */
export function hostRuntimeSummary(env: Env = process.env): {
  runtime: HostRuntimeName;
  serverless: boolean;
  persistent: boolean;
  backgroundJobs: boolean;
  interactiveBudgetMs: number;
  platformSeconds: number;
  warmingWaitMs: number;
} {
  const runtime = detectHostRuntime(env);
  return {
    runtime: runtime.name,
    serverless: runtime.serverless,
    persistent: runtime.persistent,
    backgroundJobs: runtime.backgroundJobs,
    interactiveBudgetMs: interactiveRequestBudgetMs(env),
    platformSeconds: platformDurationSeconds(env),
    warmingWaitMs: warmingWaitMs(env),
  };
}

/**
 * Bir sözün verilen süre içindeki akıbeti.
 *
 * Üç durumu AYIRMAK gerekir: "değer geldi", "hata verdi" ve "hâlâ sürüyor".
 * Çağıran taraf bunları karıştırırsa başarısız bir taramayı sonsuz "warming"
 * gibi gösterir (ya da tersini yapar).
 */
export type DeadlineOutcome<T> =
  | { kind: "value"; value: T }
  | { kind: "rejected" }
  | { kind: "pending" };

/** Bir söze üst sınır koyar; süre aşılırsa `pending` döner (bekleyip 504 olmaz). */
export function withDeadlineOutcome<T>(
  promise: Promise<T>,
  ms: number,
): Promise<DeadlineOutcome<T>> {
  return new Promise<DeadlineOutcome<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "pending" });
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "value", value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "rejected" });
      },
    );
  });
}
