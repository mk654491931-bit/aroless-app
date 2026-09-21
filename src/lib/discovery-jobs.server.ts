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
 * SÜRE BÜTÇESİ (ÖNEMLİ): Vercel Hobby planında bir fonksiyon EN FAZLA 300 sn
 * çalışabilir (eski "60 sn" kuralı geçersizdir). Bu yüzden hem işçinin hat
 * bütçesi hem de tetikleyicinin bekleme süresi `VERCEL_FUNCTION_MAX_DURATION`
 * (varsayılan 300) değerinden türetilir; hiçbir istek platform sınırına
 * dayanmaz, dolayısıyla 504 / "zaman aşımı" hatası oluşmaz.
 *
 * Vercel'e göre optimize edilmiş sözleşme (Hobby 300 sn):
 *   uçtan uca söz 280 sn = hat 260 sn (`DISCOVERY_MAX_BUDGET_MS`) + 20 sn dönüş
 *   payı. 300 sn'lik duvarın 20 sn altında kalırız; hat kendi kendine biter.
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
import {
  COUNCIL_ENRICH_BUDGET_MS,
  COUNCIL_ENRICH_MIN_MS,
  MIN_INLINE_COUNCIL_MS,
} from "@/lib/council-budget.server";

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
 * Ürün bulucu ("find winners") için SERT üst sınır (ms).
 *
 * Ürün kararı: ağır hat en fazla 280 sn sürsün. Bu tek sayı hem hattın
 * bütçesini hem istemcinin yoklama penceresini belirler; platform 900 sn verse
 * bile hat kendini 280 sn'ye sığdırır ve kalite adımları için içeride rezerv
 * ayrılır (bkz. `discoveryStagePlan` → aşama pencereleri + konsey rezervi).
 */
export const DISCOVERY_END_TO_END_MS = 280_000;

/** Sonucu yazmak + yanıt dönmek + kuyruk gecikmesi için ayrılan pay (ms). */
export const DISCOVERY_RETURN_MARGIN_MS = 20_000;

/**
 * İşçinin ağır hatta harcayabileceği süre (ms).
 *
 * ÖNEMLİ AYRIM: kullanıcının gördüğü süre "tıkla → sonuç"tur ve bu, işçinin
 * hattı koştuğu bütçeden **büyüktür**: araya iş kuyruğa alınma, sonucun
 * Supabase/Redis'e yazılması ve istemcinin bir sonraki yoklama tick'i girer.
 * Eskiden ikisi aynı sayıydı (280 sn), bu yüzden hat tam bütçesini kullandığında
 * kullanıcı 285-300 sn bekliyor ve "280 saniyeden fazla sürüyor" görüyordu.
 * Artık 280 sn **uçtan uca sözdür**; hattın payı bu sözden dönüş payı düşülerek
 * hesaplanır.
 */
export const DISCOVERY_MAX_BUDGET_MS = DISCOVERY_END_TO_END_MS - DISCOVERY_RETURN_MARGIN_MS;

/**
 * İşçinin ağır hatta harcayabileceği süre. Platformun limiti ne olursa olsun
 * `DISCOVERY_MAX_BUDGET_MS` (280 sn söz − 20 sn dönüş payı = 260 sn) ile
 * sınırlanır; altındaki 16 sn'lik pay sonucu Supabase + Redis'e yazmak ve yanıt
 * dönmek içindir.
 */
export function workerBudgetMs(): number {
  const platformMs = (functionMaxDurationSeconds() - 16) * 1000;
  return Math.max(25_000, Math.min(DISCOVERY_MAX_BUDGET_MS, platformMs));
}

/** Ürün bulucunun konsey karnesinden sonra sonucu yazması için ayrılan pay. */
export const COUNCIL_ENRICH_MARGIN_MS = 5_000;

/**
 * Ürün bulucunun kaç ürününe AI Konsey karnesi çıkarabileceği.
 *
 * Karne (6 uzman üretici ekip + müdür) ürün başına ~62 sn rezerv ister; bu
 * yüzden kaç ürünün karne alacağını yalnızca **kalan süre** belirler. Çıktı: tek
 * bir ürün hattın bütçesini yiyip sonrakileri karnesiz bırakamaz, ama kalan süre
 * varsa da boş bırakılmaz. 0 ise bulucu konseyi hiç çağırmaz ve sonucu
 * `skipped_council` ile dürüstçe işaretler.
 */
/**
 * Karne çıkarılacak en iyi ürün sayısı.
 *
 * Neden 3: bir karne (~62 sn) pahalıdır ve ilk üç ürün kullanıcı kararını
 * belirler. 3'ün üzerine çıkmak hattın bütçesini doldurup sonucu dakikalarca
 * geciktirir; karne almayan ürünler zaten canlı doğrulanmış ve kazanan puanı
 * hesaplanmış olarak kullanıcıya ulaşır (bkz. `publishPartial`).
 */
export const DISCOVERY_COUNCIL_TARGET_PRODUCTS = 3;

export function councilEnrichLimit(timeLeftMs: number, limit = 8): number {
  if (!Number.isFinite(timeLeftMs)) return 0;
  const usable = timeLeftMs - COUNCIL_ENRICH_MARGIN_MS;
  return Math.max(0, Math.min(limit, Math.floor(usable / COUNCIL_ENRICH_MIN_MS)));
}

/** Karne turunun sonunda yanıt/skorlama için bırakılan pay (ms). */
export const COUNCIL_ENRICH_TAIL_MS = 3_000;

/**
 * SIRADAKİ ürüne verilebilecek karne bütçesi (ms) — sıfırsa hiç başlatılmaz.
 *
 * Neden ayrı bir fonksiyon: hat "kaç karne sığar"ı bir kez hesaplayıp
 * (`councilEnrichLimit`, ürün başına 62 sn) çağrıları sırayla yapıyordu, ama
 * çağrı başına üst sınır 90 sn'ydi ve çağrı bütçesi
 * `Math.max(COUNCIL_ENRICH_MIN_MS, …)` ile ALT SINIRA yükseltiliyordu. Kalan
 * süre 20 sn iken bile 62 sn'lik bir çağrı başlatılabiliyordu → hat 280 sn'lik
 * sözünü onlarca saniye aşıyordu (kullanıcının gördüğü "280 sn'den çok").
 *
 * Kural: her çağrı kalan süreden dönüş payını ve kuyruk payını düşer, üst
 * sınırla kırpılır; tam bir karne (COUNCIL_ENRICH_MIN_MS) sığmıyorsa 0 döner.
 */
export function councilEnrichCallMs(
  timeLeftMs: number,
  returnFloorMs: number,
  tailMs = COUNCIL_ENRICH_TAIL_MS,
): number {
  if (!Number.isFinite(timeLeftMs)) return 0;
  const usable = Math.min(timeLeftMs - returnFloorMs - tailMs, COUNCIL_ENRICH_BUDGET_MS);
  return usable >= COUNCIL_ENRICH_MIN_MS ? Math.round(usable) : 0;
}

/** Üst üste bu kadar karne turu boş dönerse motorlar susmuş demektir: döngü durur. */
export const COUNCIL_MAX_FAILURES = 2;

export type CouncilLoopAction = "carnet" | "stop-time" | "stop-failures" | "done";

/**
 * Konsey karne DÖNGÜSÜNÜN kararı — sıradaki ürüne karne çıkarılmalı mı?
 *
 * Neden ayrı ve saf bir fonksiyon: döngü iki farklı durumda durmalıdır.
 *  1. `stop-time`: kalan süre tam bir karneye yetmiyor (62 sn) → yarım karne
 *     üretmek yerine dururuz; bütçe aşılmaz.
 *  2. `stop-failures`: motorlar üst üste boş dönüyor → kalan süreyi başarısız
 *     çağrılarla yakmayız (kullanıcı sonucu daha erken görür).
 * Ayrıca karne alan ürün sayısı `enriched` ile sayılır: bayrak "karne HİÇ
 * çıkmadı" anlamına gelir, "hepsi çıkmadı" değil — aksi halde bir ürün karne
 * almışken kullanıcıya "konsey atlandı" denirdi.
 */
export function councilLoopDecision(args: {
  carnetMs: number;
  remaining: number;
  failures: number;
  maxFailures?: number;
}): CouncilLoopAction {
  if (args.remaining <= 0) return "done";
  if (args.failures >= (args.maxFailures ?? COUNCIL_MAX_FAILURES)) return "stop-failures";
  return args.carnetMs > 0 ? "carnet" : "stop-time";
}

/**
 * Hattın bütçesi bitmeden ÖNCE bitmesi için ayrılan taban pay (ms).
 *
 * Konseydeki dönüş payının ürün bulucu karşılığıdır: sonuç yazımı, winner
 * skorlama, GPU'suz toparlama ve yanıt için. Bu pay sayesinde hat kendi
 * kendine biter, platform onu kesmez (504 yok).
 */
export const DISCOVERY_RETURN_FLOOR_MS = 10_000;

export type DiscoveryStagePlan = {
  budgetMs: number;
  /** Bütçeden düşülen dönüş payı. */
  returnFloorMs: number;
  /** Hat için gerçekten kullanılabilir süre (`budgetMs - returnFloorMs`). */
  usableMs: number;
  /** GitHub trendi + canlı piyasa kanıtı — artık PARALEL koşar. */
  prepMs: number;
  /** Zeminli (Google aramalı) açı turu; yavaş kalan motor düşer. */
  generationMs: number;
  /** Hakem turu: ürün başına hibrit puan + çok motorlu fikir birliği. */
  judgePerProductMs: number;
  judgeConcurrency: number;
  /** Canlı piyasa doğrulaması: ürün başına. */
  verifyPerProductMs: number;
  verifyConcurrency: number;
  /** En iyi 3 ürünün doğrulaması için ayrılan rezerv. */
  verifyReserveMs: number;
  /** AI Konsey karnesine ayrılan rezerv — hakem/doğrulama onu yiyemez. */
  councilReserveMs: number;
  /**
   * Karne çıkarılacak EN İYİ ürün sayısı (fast profilde 0).
   *
   * Sert üst sınır: eskiden karne döngüsü tüm ürünleri gezer ve yalnızca kalan
   * süre bir karneye yetmediğinde dururdu; hat bütçesini son saniyesine kadar
   * yaktığı için "tıkla → sonuç" süresi her koşuda ~4,5 dakika oluyordu.
   */
  councilTargetCount: number;
  /** Kaç zeminli açı paralel koşar (duvar saati maliyeti aynı, aday sayısı ↑). */
  angleCount: number;
};

function clampMs(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * N adet işi `concurrency` paralellikle koşmanın duvar saati maliyeti.
 *
 * Aşama kapıları bunu kullanır: “kaç ürün kaldıysa o kadar süre” ilkesi, tek bir
 * yavaş ürünün sonraki aşamaları (doğrulama + konsey) imkânsız hale
 * getirmesini engeller.
 */
export function batchReserveMs(perItemMs: number, count: number, concurrency: number): number {
  if (count <= 0 || perItemMs <= 0) return 0;
  return Math.ceil(count / Math.max(1, concurrency)) * Math.round(perItemMs);
}

/**
 * 280 sn'lik hattın aşama planı — tek kaynak.
 *
 * Neden gerekli: bütçe yalnızca `hasTime(12_000)` gibi sabit kapılarla
 * korunuyordu. Bu, zeminli açı turunun (paralel 8 arama, her biri 12 sn
 * timeout'lu) veya hakem turunun bütçenin tamamını yiyip son aşamaları
 * (canlı doğrulama, AI Konsey karnesi) dışarıda bırakmasına izin veriyordu:
 * hat zamanında biterdi ama iş "iyi" bitmezdi.
 *
 * Plan üç garantiyi verir:
 *  1. Hiçbir aşama planlanan penceresini aşamaz (per-call deadline).
 *  2. Hazırlık (GitHub + canlı kanıt) PARALEL koşar; seri ~40 sn boşa gidiyordu.
 *  3. Son iki aşama (doğrulama + konsey) için rezerv ayrılır; erken aşamalar
 *     onları yiyemez.
 */
export function discoveryStagePlan(
  budgetMs: number,
  opts: { fast?: boolean } = {},
): DiscoveryStagePlan {
  const total = Math.max(20_000, Math.round(budgetMs));
  const fast = opts.fast ?? total <= 75_000;
  const usableMs = Math.max(10_000, total - DISCOVERY_RETURN_FLOOR_MS);

  // Hazırlık (GitHub trendi + canlı piyasa kanıtı) SERİ bir adımdır: üretim
  // turu bu blok prompt'a girdiği için ondan sonra başlar. Eskiden 40 sn'ye
  // kadar bekleyebiliyordu, yani ilk AI çağrısı 40 sn sonra gidiyordu. Üst
  // sınır 14 sn'ye indi: kanıt yetişirse prompt'a girer, yetişmezse hat hiç
  // beklemez (asıl canlı veri zaten zeminli aramadan ve `verifyProduct`
  // katmanından gelir).
  const prepMs = fast ? 0 : clampMs(usableMs * 0.06, 6_000, 14_000);
  const judgePerProductMs = clampMs(usableMs * 0.05, 8_000, 15_000);
  const verifyPerProductMs = clampMs(usableMs * 0.03, 6_000, 12_000);
  const judgeConcurrency = fast ? 3 : 2;
  const verifyConcurrency = fast ? 3 : 2;
  // Hakem turuna ayrılan pay: konsey rezervinin üstüne eklenir.
  const judgeSlotMs = clampMs(usableMs * 0.1, 10_000, 40_000);
  // Çok kısa bütçelerde (ör. 20 sn'lik test) pencereler kullanılabilir süreye
  // sığacak şekilde küçülür — plan asla bütçesinden büyük olamaz.
  const generationMs = Math.min(
    clampMs(usableMs * 0.24, 20_000, 75_000),
    Math.max(5_000, Math.round(usableMs * 0.5)),
  );
  const verifyReserveMs = Math.min(
    batchReserveMs(verifyPerProductMs, 3, verifyConcurrency),
    Math.max(0, usableMs - generationMs - judgeSlotMs),
  );
  /** Karne hedefi: en iyi 3 ürün. Rezerv da bu sayıya göre ayrılır. */
  const councilTargetCount = fast ? 0 : DISCOVERY_COUNCIL_TARGET_PRODUCTS;
  const councilTarget = clampMs(
    usableMs * 0.3,
    COUNCIL_ENRICH_MIN_MS,
    COUNCIL_ENRICH_MIN_MS * councilTargetCount,
  );
  const councilRoom = usableMs - prepMs - generationMs - verifyReserveMs - judgeSlotMs;
  const councilReserveMs = fast ? 0 : Math.max(0, Math.min(councilTarget, councilRoom));

  return {
    budgetMs: total,
    returnFloorMs: DISCOVERY_RETURN_FLOOR_MS,
    usableMs,
    prepMs,
    generationMs,
    judgePerProductMs,
    judgeConcurrency,
    verifyPerProductMs,
    verifyConcurrency,
    verifyReserveMs,
    councilReserveMs,
    councilTargetCount,
    angleCount: fast ? 3 : 8,
  };
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
 * ÜRÜN BULUCU için yoklama planı — tek kaynak burasıdır.
 *
 * İş artık 280 sn ile sınırlı olduğu için pencere de ona göre kurulur: 280 sn
 * iş + 20 sn kuyruk/gecikme payı. Eskiden Render'da 14,9 dk bekleniyordu; iş
 * hiç o kadar sürmediği için kullanıcı saniyelerce boşuna bekliyordu.
 *
 * Konsey gibi DAHA UZUN işlerin kendi penceresi vardır (`clientWaitMs`), bu
 * yüzden ikisi ayrı tutulur.
 */
export function jobPollingPlan(): { pollMaxMs: number; pollIntervalMs: number } {
  return {
    // İstemci penceresi = uçtan uca söz (280 sn). İşçi 260 sn'de bitirir, kalan
    // 20 sn yazma + yoklama tick'i içindir; yani pencere her zaman işi kapsar.
    pollMaxMs: DISCOVERY_END_TO_END_MS,
    pollIntervalMs: JOB_POLL_INTERVAL_MS,
  };
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

/**
 * Arka plan yolu kurulamadığında (QStash publish hatası, kuyruk yok, süreç içi
 * kuyruk kapalı) ne yapacağımızın kararı.
 *
 * Vercel Hobby'de fonksiyon limiti 300 sn'dir ve hat 260 sn'de kendi kendine
 * biter: yani arka plan yolu düşse bile ağır iş bu isteğin İÇİNDE koşabilir.
 * Eskiden bu durumda kullanıcıya hata dönüyordu ("ürün bulucu çalışmıyor");
 * artık limit yetiyorsa istek yolu (inline) tercih edilir — 504 değil, sonuç.
 * Limit 120 sn'nin altına daraltılmışsa inline koşmak hattı ortasında keser,
 * bu yüzden orada açık hata döneriz (kredi harcanmaz).
 */
export type DiscoveryFallbackDecision = "background" | "inline" | "error";

export function discoveryFallbackDecision(args: {
  backgroundStarted: boolean;
  platformFits?: boolean;
}): DiscoveryFallbackDecision {
  if (args.backgroundStarted) return "background";
  return (args.platformFits ?? inlineHeavyWorkFits()) ? "inline" : "error";
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

/**
 * ÖN SONUÇ YAZIMI — iş hâlâ `processing` iken `result` alanını güncelle.
 *
 * Neden ayrı bir fonksiyon: `complete_search_job` atomik ve claim'e bağlıdır;
 * ön sonuç ise yalnızca kullanıcının beklemeyi bırakmasını sağlayan bir ara
 * adımdır. Bu yüzden durumu DEĞİŞTİRMEZ (`status = 'processing'` kalır), yalnızca
 * `result` yazar ve yarış koşullarına karşı `status = 'processing'` filtresiyle
 * korunur: iş tamamlandıysa/başarısız olduysa nihai kaydı asla ezmez.
 *
 * İstemci bu kaydı ilk yoklamada görür, ürünleri gösterir ve yoklamaya devam
 * eder; nihai sonuç geldiğinde yerini alır.
 */
export async function markJobPartial(jobId: string, result: DiscoveryResult): Promise<void> {
  const { error } = await jobStore()
    .from(JOB_TABLE)
    .update({ result } as never)
    .eq("id", jobId)
    .eq("status", "processing");
  if (error) throw new Error(error.message);
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
      // Ön sonuç: canlı doğrulanmış ürünler hazır olur olmaz yazılır; istemci
      // konsey karnelerini beklemeden ürünleri görür (yoklama devam eder).
      onProgress: (snapshot) => markJobPartial(payload.jobId, snapshot),
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
