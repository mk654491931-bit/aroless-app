// ============================================================================
// PRODUCT DISCOVERY — ZİNCİR SÜRÜCÜSÜ (QStash ZORUNLU DEĞİL).
//
// SORUN (canlıda ölçüldü): hat YALNIZ QStash üzerinden koşuyordu. `/start` adımı
// kuyruğa alamadığında `ok:false` dönüyor ve arayüz sessizce eski yola
// düşüyordu; kullanıcı "14 ajan çalışmıyor" görüyordu. QStash'in çalışması ÜÇ
// ayrı anahtarın birlikte doğru olmasına bağlıydı:
//   QSTASH_TOKEN + JOB_WORKER_SECRET (yayın) + QSTASH_CURRENT_SIGNING_KEY
//   (adım ucunun imza doğrulaması). Biri eksikse zincir ilk adımda ölür.
//
// ÇÖZÜM — üç taşıyıcı, TEK iş mantığı (`product-discovery-steps.server.ts`):
//
//   1. `qstash`     → üç anahtar da varsa adımlar kuyruğa yayınlanır (mevcut yol).
//   2. `in-process` → kalıcı süreçte (Render/VPS/self-hosted Node) zincir arka
//                     planda koşar; istek anında döner, sekme kapansa da iş biter.
//   3. `inline`     → kuyruk yok: zinciri İSTEMCİNİN yoklaması sürer. Her
//                     yoklama biraz ilerler; iş nerede kaldıysa DB'deki ara
//                     noktadan devam eder.
//
// İLERLEMENİN GERÇEK KAYNAĞI: `searches.result` içindeki ara nokta
// (`readDiscoveryCheckpoint`). Durum sütunları yalnızca KİLİT ve İLERLEME
// GÖSTERGESİDİR; migration uygulanmamış bir veritabanında bu sütunlar yoktur ama
// zincir yine de doğru sırayla koşar. Bu ayrım kritik: ilerlemeyi yalnız durum
// sütununa bağlamak, "kolon yok" durumunda yanlış adımı çalıştırırdı.
//
// UÇTAN UCA GARANTİLER: kredi `/start`ta bir kez düşülür (`discovery:<runId>`),
// her adım en fazla bir kez çalışır (`advanceDiscoveryStatus` compare-and-swap),
// hata hâlinde kredi TAM BİR KEZ iade edilir.
// ============================================================================

import { readEnvValue, runsOnPersistentHost } from "./host-runtime.server";
import { backgroundJobsEnabled } from "./job-runner.server";
import {
  advanceDiscoveryStatus,
  readDiscoveryCheckpoint,
  readDiscoveryJob,
  saveDiscoveryCheckpoint,
  type DiscoveryCheckpoint,
  type DiscoveryJobRecord,
} from "./product-discovery-jobs.server";
import { DISCOVERY_STEPS, type DiscoveryStep } from "./product-discovery-qstash.server";
import {
  executeProductDiscoveryStep,
  type StepOutcome,
} from "./product-discovery-steps.server";
import type { ProductDiscoveryInput, ProductDiscoveryStatus } from "./product-discovery.types";

type EnvMap = Record<string, string | undefined>;

/** Zinciri taşıyan yol. */
export type DiscoveryRunnerMode = "qstash" | "in-process" | "inline";

/**
 * Bu kurulumda zinciri hangi yol taşıyabilir?
 *
 * QStash'i "ÇALIŞIYOR" saymanın koşulu: yalnız token + worker sırrı yetmez,
 * İMZA anahtarı da gerekir. Aksi hâlde adım ucu (doğru biçimde) her teslimatı
 * 401 ile reddeder ve iş sessizce ölür. Bu üçlüyü birlikte aramak, "kuyruk
 * yapılandırılmış" yanılgısını ortadan kaldırır.
 */
export function discoveryRunnerMode(env: EnvMap = process.env): DiscoveryRunnerMode {
  const token = readEnvValue(env, "QSTASH_TOKEN");
  const workerSecret = readEnvValue(env, "JOB_WORKER_SECRET");
  const signingKey = readEnvValue(env, "QSTASH_CURRENT_SIGNING_KEY");
  if (token && workerSecret && signingKey) return "qstash";
  if (runsOnPersistentHost(env) && backgroundJobsEnabled(env)) return "in-process";
  return "inline";
}

/**
 * Adımın \"BAŞLIYOR\" durumu — yarıda kalan bir adım buraya geri alınır.
 *
 * `final` adımı bilerek `deep_analysis`e yazılır: bu adımın kendi çıkış durumu
 * `completed`dir ve `advanceDiscoveryStatus` `completed` yazarken satırın
 * `status`ünü de 'completed' yapar. Bunu adım BAŞLARKEN yapmak, isteği kesilen
 * bir koşuyu \"tamamlandı\" gibi gösterirdi. Bu yüzden `final` kendi çıkışını
 * yalnız `finishDiscoveryJob` ile (sonuç hazır olduğunda) yazar.
 */
const STEP_START_STATE: Record<DiscoveryStep, ProductDiscoveryStatus> = {
  scrape_filter: "queued",
  gemini: "filtering",
  deep: "gemini_shortlist",
  final: "deep_analysis",
};

/** Adım koşarken satıra yazılan durum (CAS kilidi). */
const STEP_RUNNING_STATE: Record<DiscoveryStep, ProductDiscoveryStatus> = {
  scrape_filter: "scraping",
  gemini: "gemini_shortlist",
  deep: "deep_analysis",
  final: "deep_analysis",
};

/**
 * Yarıda kalan bir adımı devralmadan önce beklenecek süre (ms).
 *
 * NEDEN BEKLEME: başka bir sürücü (ikinci sekme ya da süreç içi arka plan işi)
 * adımı ŞU AN koşuyor olabilir. Canlı bir isteğin durumunu geri almak işi
 * ikiye katlar. Taze satıra dokunmayıp yalnız \"yaşlı\" satırı devralmak bu
 * yarışı pratikte ortadan kaldırır.
 */
export const STALE_STEP_TAKEOVER_MS = 90_000;

/** Bir adımı başlatmak için gereken en küçük bütçe (ms). */
export const MIN_STEP_BUDGET_MS = 25_000;

/**
 * Tarayıcının yoklaması zinciri KOŞMALI mı?
 *
 * ÖLÇÜLEN HATA: yoklama isteği her koşulda adımı sahiplenip çalıştırıyordu.
 * QStash kurulu olsa bile kuyruğa yayınlanan adım, tarayıcının isteği içinde
 * önce sahipleniliyordu; yani ağır iş yine tek HTTP isteğinde bitiyor, istek
 * platform tavanına dayanıyor ve kullanıcı "Arka plan analizi zaman aşımına
 * uğradı" kartını görüyordu. Kuyruk kurmanın sebebi tam olarak bunu taşımamaktı.
 *
 * KURAL:
 *   • `qstash` değilse → yoklama sürücüdür (mevcut davranış; kuyruk yok).
 *   • `qstash` ise      → kuyruk sahiplenir, yoklama YALNIZ okur.
 *   • Ancak satır `STALE_STEP_TAKEOVER_MS` boyunca güncellenmediyse kuyruk
 *     sessizce ölmüş demektir; yoklama devralır (kayıp olan taraf böyle korunur).
 *
 * @param updatedAt satırın son yazılma anı; `null` okunamadı → devral.
 */
export function clientDrivesChain(
  mode: DiscoveryRunnerMode,
  updatedAt: number | null,
  now: number = Date.now(),
): boolean {
  if (mode !== "qstash") return true;
  if (updatedAt === null) return true;
  return now - updatedAt >= STALE_STEP_TAKEOVER_MS;
}

export type StepClaim =
  | { state: "claimed"; job: DiscoveryJobRecord }
  /** Başka bir sürücü adımı aldı ya da hâlâ koşuyor. */
  | { state: "in-progress"; job: DiscoveryJobRecord }
  /** İş kaydı okunamadı. */
  | { state: "missing"; job: null }
  /** İş zaten bitmiş/başarısız. */
  | { state: "terminal"; job: DiscoveryJobRecord };

/**
 * Bir adımı ATOMİK olarak sahiplenir.
 *
 * Compare-and-swap mantığı: satır, okuduğumuz durumu HÂLÂ taşıyorsa geçişi biz
 * yaparız. Aynı adımı iki taşıyıcı (ör. QStash teslimatı + tarayıcı yoklaması)
 * aynı anda isterse yalnız biri `claimed` görür — iş iki kez koşmaz.
 *
 * Yarıda kalan adım: durum "çalışıyor" işaretinde kalmışsa ve satır yeterince
 * eskimişse (STALE_STEP_TAKEOVER_MS) geri alınır ve yeniden sahiplenilir. Taze
 * satır dokunulmaz, çünkü onu şu an başka bir sürücü koşuyor olabilir.
 */
export async function claimDiscoveryStep(
  runId: string,
  step: DiscoveryStep,
): Promise<StepClaim> {
  const job = await readDiscoveryJob(runId);
  if (!job) return { state: "missing", job: null };
  if (job.status !== "processing") return { state: "terminal", job };

  const start = STEP_START_STATE[step];
  const running = STEP_RUNNING_STATE[step];
  let claimFrom = job.discoveryStatus;

  // DİKKAT — `running !== start` KOŞULU ZORUNLU: `final` adımının "çalışıyor"
  // durumu, kendi başlangıç durumuyla AYNIdır ('deep_analysis' — çünkü bu adım
  // satırı `completed` yapmamalıdır, bkz. STEP_START_STATE açıklaması). Bu
  // koşul olmadan `final`, hemen önce biten `deep` adımının taze `updated_at`
  // değerini görür, "başka biri koşuyor" sanır ve kullanıcı sonucu 90 sn
  // gecikmeli görürdü.
  if (running !== start && claimFrom === running) {
    const age = job.updatedAt === null ? Number.POSITIVE_INFINITY : Date.now() - job.updatedAt;
    if (age < STALE_STEP_TAKEOVER_MS) return { state: "in-progress", job };
    const reclaimed = await advanceDiscoveryStatus({
      runId,
      from: running,
      to: start,
      progress: 10,
      step,
    });
    if (!reclaimed) return { state: "in-progress", job };
    claimFrom = start;
  }

  const claimed = await advanceDiscoveryStatus({
    runId,
    from: claimFrom,
    to: running,
    progress: 10,
    step,
  });
  return claimed ? { state: "claimed", job: { ...job, discoveryStatus: running } } : { state: "in-progress", job };
}

/**
 * TEK bir adımı çalıştırır — QStash teslimatının giriş noktası.
 *
 * NEDEN ORTAK: aynı adımı iki taşıyıcı koşabildiği için (QStash teslimatı ve
 * tarayıcı yoklamasının sürdüğü zincir) sahiplenme, çalıştırma ve ara nokta
 * yazımı TEK yerde olmalıdır. Aksi hâlde iki yol farklı davranır: biri
 * `result` alanına ara nokta yazar, diğeri yazmaz ve devam edilemez.
 */
export async function runOneDiscoveryStep(args: {
  runId: string;
  userId: string;
  input: ProductDiscoveryInput;
  step: DiscoveryStep;
  /** QStash gövdesinden gelen adaylar (varsa ara nokta yerine kullanılır). */
  batch?: unknown[];
  consensus?: unknown[];
  deadlineAt?: number;
}): Promise<
  | { ok: true; deduped: false; outcome: Extract<StepOutcome, { ok: true }> }
  | { ok: true; deduped: true }
  | { ok: false; error: string }
> {
  const claim = await claimDiscoveryStep(args.runId, args.step);
  if (claim.state === "in-progress") return { ok: true, deduped: true };
  if (claim.state === "terminal") return { ok: true, deduped: true };
  if (claim.state === "missing") return { ok: false, error: "İş kaydı bulunamadı." };

  const checkpoint = await readDiscoveryCheckpoint(args.runId);
  const batch = args.batch?.length ? args.batch : (checkpoint?.shortlist ?? []);
  const consensus = args.consensus?.length ? args.consensus : (checkpoint?.votes ?? []);

  // Adım bütçesi SABİT 200 sn DEĞİL, teslimatın GERÇEK penceresinden türetilir
  // (`Upstash-Timeout`). Neden: teslimat penceresi işçinin barındığı host'a göre
  // değişir (Vercel 298 sn, kalıcı süreç 890 sn) ve sabit bir değer ya gereksiz
  // zaman yakar ya da teslimatı platform öldürür. 20 sn yanıt payı bırakılır ki
  // adım platformdan ÖNCE kendi kendine durup ara sonuçla dönsün.
  const deliveryWindowMs = Math.max(
    MIN_STEP_BUDGET_MS,
    (await import("./discovery-jobs.server")).qstashTimeoutSeconds() * 1000 - 20_000,
  );

  const outcome = await executeProductDiscoveryStep({
    step: args.step,
    runId: args.runId,
    userId: args.userId,
    input: args.input,
    batch,
    consensus,
    deadlineAt: args.deadlineAt ?? Date.now() + deliveryWindowMs,
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };

  // Ara nokta yazımı: QStash yolunda da gerekir, çünkü aynı işin kalan adımları
  // kuyruk kaybolursa tarayıcı yoklaması tarafından sürdürülür.
  const previous = checkpoint ?? { v: 1 as const, done: [], shortlist: [], votes: [] };
  if (!previous.done.includes(args.step)) {
    await saveDiscoveryCheckpoint(args.runId, {
      v: 1,
      done: [...previous.done, args.step],
      shortlist: outcome.products,
      votes: outcome.consensus,
    });
  }

  return { ok: true, deduped: false, outcome };
}

export type ChainOutcome = {
  /** İş terminal duruma ulaştı mı? */
  completed: boolean;
  /** Bu çağrıda koşan adımlar (log/teşhis için). */
  ran: DiscoveryStep[];
  /** Bütçe/başka sürücü nedeniyle durduysa nedeni. */
  stop?: "budget" | "in-progress" | "terminal";
  error?: string;
};

/**
 * Zinciri, verilen bütçe içinde olabildiğince ilerletir.
 *
 * İDEMPOTENT VE DEVAM EDEBİLİR: aynı iş için kaç kez çağrılırsa çağrılsın her
 * adım EN FAZLA bir kez çalışır (ara nokta + atomik CAS geçişi).
 */
export async function runDiscoveryChain(args: {
  runId: string;
  userId: string;
  input: ProductDiscoveryInput;
  /** Bu istekte harcanabilecek süre (ms). */
  budgetMs: number;
}): Promise<ChainOutcome> {
  const deadline = Date.now() + Math.max(MIN_STEP_BUDGET_MS, args.budgetMs);
  const ran: DiscoveryStep[] = [];

  let checkpoint: DiscoveryCheckpoint =
    (await readDiscoveryCheckpoint(args.runId)) ?? { v: 1, done: [], shortlist: [], votes: [] };

  for (const step of DISCOVERY_STEPS) {
    // Zincir her zaman baştan taranır ve bitmiş adımlar atlanır: sıradaki adım
    // "tamamlanmamış İLK adım"dır. Bu yüzden yarıda kalan bir adımdan SONRAKİ
    // adım asla erken (elinde girdi yokken) koşmaz.
    if (checkpoint.done.includes(step)) continue;

    if (Date.now() + MIN_STEP_BUDGET_MS > deadline) {
      return { completed: false, ran, stop: "budget" };
    }

    // Adımı atomik sahiplen. `advanceDiscoveryStatus` migration'sız şemada
    // (RPC yok) başarı sayılır: orada kilit yoktur ama zincir yine doğru
    // sırayla ilerler ve ara nokta çift çalışmayı zaten engeller.
    const claim = await claimDiscoveryStep(args.runId, step);
    if (claim.state === "missing") {
      return { completed: false, ran, stop: "terminal", error: "İş kaydı bulunamadı." };
    }
    if (claim.state === "terminal") {
      return { completed: claim.job.status === "completed", ran, stop: "terminal" };
    }
    if (claim.state === "in-progress") return { completed: false, ran, stop: "in-progress" };

    console.log(`[discovery] adım başladı: ${step} (run ${args.runId.slice(0, 8)})`);

    const outcome = await executeProductDiscoveryStep({
      step,
      runId: args.runId,
      userId: args.userId,
      input: args.input,
      batch: checkpoint.shortlist,
      consensus: checkpoint.votes,
      // Adıma isteğin bitişine kadar zaman tanınır: `deep` gibi uzun adımlar
      // platform kesmeden ÖNCE kendi kendine durur, iş yarıda kalmaz.
      deadlineAt: deadline,
    });

    if (!outcome.ok) {
      // Adım çöktü: iş `failed` ve kredi iade edildi (executor yaptı).
      return { completed: false, ran, stop: "terminal", error: outcome.error };
    }

    ran.push(step);
    checkpoint = {
      v: 1,
      done: [...checkpoint.done, step],
      shortlist: outcome.products,
      votes: outcome.consensus,
    };
    if (outcome.status === "completed") return { completed: true, ran, stop: "terminal" };
    await saveDiscoveryCheckpoint(args.runId, checkpoint);
  }

  return { completed: true, ran, stop: "terminal" };
}
