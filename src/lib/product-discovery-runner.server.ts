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
//   2. `in-process` → kalıcı süreçte (kendi Node sunucumuz / VPS) zincir arka
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
// DİLİMLER — HER TESLİMAT EN FAZLA BİR DİLİM (varsayılan 10 sn):
//
// Her taşıyıcı (QStash teslimatı, süreç içi arka plan işi, tarayıcı yoklaması)
// AYNI kuralı uygular: bir adımı dilim dilim koşar, her dilimin ilerlemesini
// ara noktaya yazar ve sıradaki dilime bırakır. Devam dilimlerinin sırası
// `slices` defterinden okunur (`product-discovery-slices.server.ts`), satırın
// yaşından DEĞİL — önceki dilim biteli saniyeler olduğu için satır taze
// görünür. Böylece uzun adımlar hiçbir fonksiyonu dakikalarca meşgul etmez.
//
// UÇTAN UCA GARANTİLER: kredi `/start`ta bir kez düşülür (`discovery:<runId>`),
// her adım en fazla bir kez çalışır (`advanceDiscoveryStatus` compare-and-swap),
// aynı dilim iki kez koşmaz (defter + QStash dedupe kimliği), hata hâlinde kredi
// TAM BİR KEZ iade edilir.
// ============================================================================

import { readEnvValue, runsOnPersistentHost } from "./host-runtime.server";
import { backgroundJobsEnabled } from "./job-runner.server";
import {
  advanceDiscoveryStatus,
  readDiscoveryCheckpoint,
  readDiscoveryJob,
  saveDiscoveryCheckpoint,
  touchDiscoveryRun,
  type DiscoveryCheckpoint,
  type DiscoveryJobRecord,
} from "./product-discovery-jobs.server";
import { DISCOVERY_STEPS, type DiscoveryStep } from "./product-discovery-qstash.server";
import {
  decideSliceClaim,
  lastStepSlice,
  MAX_STEP_SLICES,
  readSliceState,
  sliceDeadlineAt,
  sliceWorkMs,
  writeSliceState,
} from "./product-discovery-slices.server";
import { executeProductDiscoveryStep, type StepOutcome } from "./product-discovery-steps.server";
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
  if (token && workerSecret) return "qstash";
  if (runsOnPersistentHost(env) && backgroundJobsEnabled(env)) return "in-process";
  return "inline";
}

/**
 * Bu hatta zinciri hangi yolun taşıdığını ve EKSİK ANAHTARLARI söyler.
 *
 * NEDEN AYRI (ölçülen teşhis hatası): `/health` iki AYRI hesaplayıcı
 * kullanıyordu. `discoveryDispatchPlan()` yalnız token + sır arar ve
 * "qstash" der; Product Discovery zinciri ise ÜÇÜNCÜ anahtarı da ister
 * (`QSTASH_CURRENT_SIGNING_KEY`). Sonuç: panel "qstash" gösterirken hat aslında
 * `inline` çalışıyor, ağır iş tek HTTP isteğine giriyor ve kullanıcı zaman aşımı
 * görüyordu — teşhisi koyan ile hat arasındaki sessiz anlaşmazlık.
 *
 * Bu fonksiyon ikisini TEK yerde birleştirir ve eksik anahtarları ADLARIYLA
 * döner (değerleri asla). Sır içermez.
 */
export function discoveryChainHealth(env: EnvMap = process.env): {
  mode: DiscoveryRunnerMode;
  missing: string[];
} {
  const missing: string[] = [];
  if (!readEnvValue(env, "QSTASH_TOKEN")) missing.push("QSTASH_TOKEN");
  if (!readEnvValue(env, "JOB_WORKER_SECRET")) missing.push("JOB_WORKER_SECRET");
  // `QSTASH_CURRENT_SIGNING_KEY` artık ZORUNLU DEĞİL: adım ucu yayıncının
  // ilettiği `x-job-secret` başlığını da kabul eder. Yine de tanımlıysa
  // ikinci bir doğrulama katmanıdır, o yüzden varlığı önerilir.
  return { mode: discoveryRunnerMode(env), missing };
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
 *
 * NEDEN 60 SN (eskiden 90): bu eşik aynı zamanda KURTARMA GECİKMESİDİR.
 * QStash teslimatı düşerse zinciri tarayıcı devralır; her devralma bu süre
 * kadar bekler ve zincir 2-3 kesinti yaşadığında 300 sn sözü aşılırdı. 60 sn,
 * kalp atışı aralığının (20 sn) üç katıdır: canlı bir adımın satırı en fazla
 * ~20 sn eskir, yani 60 sn'ye ulaşması için üç kalp atışının ÜST ÜSTE
 * düşmesi gerekir — yarışı hâlâ pratikte imkânsız kılar.
 */
export const STALE_STEP_TAKEOVER_MS = 60_000;

/**
 * BİR DİLİMİ başlatmak için gereken en küçük bütçe (ms).
 *
 * NEDEN ARTIK "ADIM" DEĞİL "DİLİM" EŞİĞİ: eskiden her adım tek bir istekte
 * koşuyordu ve ona en az 25 sn tanımak zorundaydık (`MIN_STEP_BUDGET_MS`). Artık
 * her teslimat en fazla bir dilim (varsayılan 10 sn) koşar ve devam dilimleri
 * birbirini hızla takip eder. Bu yüzden zincir kapısı küçüldü: kalan süre tek
 * bir dilime yetiyorsa adım yine başlar, yetmiyorsa dürüstçe durur (iş zaten
 * ara noktada saklıdır ve bir sonraki yoklama/dilim devam eder).
 *
 * Süre neredeyse bittiğinde adımlar `forceFinish` ile "kalan işi deterministiğe
 * düşürüp bitir" der; yani kullanıcı hiçbir zaman yarım bir sonuç görmez.
 */
export const MIN_SLICE_BUDGET_MS = 4_000;

/** Kalp atışı aralığı (ms) — `STALE_STEP_TAKEOVER_MS`in yarısından kısa. */
/**
 * Kalp atışı artık 10 sn (eskiden 20 sn): adımın canlı olduğu daha sık
 * tazelenir, böylece yavaş bir dilim "ölü" sanılıp devralınmaz.
 */
export const DISCOVERY_HEARTBEAT_MS = Math.floor(STALE_STEP_TAKEOVER_MS / 6);

/**
 * Çalışan adımın satırını periyodik olarak tazeler.
 *
 * NEDEN VAR: `final` adımı çalışırken durumu değişmez (`deep_analysis` →
 * `deep_analysis`), dolayısıyla `updated_at` kendiliğinden tazelenmez. Adım
 * platform tarafından ortasında kesilirse satır "çalışıyor" görünür ama ÖLÜ
 * kalır: `clientDrivesChain` onu taze sayar, yoklama devralmaz, watchdog
 * tetiklenmez ve iş `processing`e sonsuza kadar kilitlenir.
 *
 * Bu, iki hatanın birden kaynağıdır:
 *   • Kalp atışı YOKSA → devralma çalışmaz (ölü adım sonsuza kadar kilitli).
 *   • Kalp atışı ÇOK SIKSA → devralma hiç çalışmaz (ölü sürücü yanlışlıkla
 *     canlı sanılır, iş yine takılır).
 * Aralık bu yüzden eşiğin belirgin altında tutulur: iki tazeleme arasında
 * eşiği aşacak kadar uzun, ama ölü bir adımın "canlı" görünmesi için gereken
 * süreden belirgin kısa.
 *
 * GÜVENLİK: yalnız `updated_at` yazılır; durum/sonuç/kredi alanlarına
 * dokunulmaz. Terminal duruma geçmiş bir satır `status = 'processing'`
 * filtresiyle eşleşmez, yani kalp atışı bitmiş bir işi diriltemez.
 */
export function startDiscoveryHeartbeat(runId: string): { stop: () => void } {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void touchDiscoveryRun(runId).catch(() => {
      /* geçici veritabanı hatası: bir sonraki atışta yeniden denenir */
    });
  }, DISCOVERY_HEARTBEAT_MS);
  // Vercel'de bekleyen timer'ler süreci ayakta tutmasın.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

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
 * eskimişse (STALE_STEP_TAKEOVER_MS) kilit KENDİNE GEÇİŞLE tazelenir. Taze
 * satır dokunulmaz, çünkü onu şu an başka bir sürücü koşuyor olabilir.
 *
 * `final` İSTİSNASI — ÖLÇÜLEN HATA: `final`ın hem başlangıç hem çalışma durumu
 * `deep_analysis`tir (`running === start`). `deep` bittiği anda satır taze
 * olduğu için `final`ın QStash teslimatı "başka biri koşuyor" sanılıp
 * `deduped` olarak YUTULUYOR ve adım ucu 200 döndüğü için QStash onu bir daha
 * DENEMİYORDU. Son adım hiç koşmuyor; iş yalnız satır bayatlayınca
 * (STALE_STEP_TAKEOVER_MS) tarayıcı devraldığında bitiyordu — kullanıcının
 * ölçtüğü "300 saniyeden fazla dönüyor, sonuç yok" tam olarak bu gecikmedir.
 *
 * DOĞRU ÖLÇÜT SATIRIN YAŞI DEĞİL, ARA NOKTADIR: ara nokta `deep`i bitmiş
 * gösteriyorsa `final` hemen alınabilir (kilidi yaşla bekletmek yalnızca
 * gecikme üretir; `deep` bitmemişse ara nokta bunu söyler ve sıradaki adım
 * zaten `deep`tir). Bu ayrım, `final`ın sonucu YALNIZ BİR KEZ yazmasıyla
 * birlikte güvenlidir (`finish_discovery_job`: `WHERE status = 'processing'`).
 *
 * DEVAM DİLİMLERİ (`opts.slice > 0`) — İKİNCİ İSTİSNA:
 *
 * Bir adım artık tek istekte bitmek zorunda değildir; dilim dilim ilerler ve
 * her dilim AYNI durum sütununda (`running`) bekler. Bu yüzden bir devam dilimi
 * için satırın yaşına bakmak YANLIŞ olurdu: önceki dilim biteli saniyeler
 * olmuştur, satır taze görünür ve devralma kuralı devam dilimini sonsuza kadar
 * bloke ederdi.
 *
 * Doğru ölçüt DİLİM DEFTERİDİR (`decideSliceClaim`): yalnız `next === slice`
 * olan dilim koşar. Gecikmiş bir tekrar teslimat hiçbir şey yapmaz, erken gelen
 * teslimat bekler. Kilidin tazelenmesi kendine geçişle ("running → running")
 * yapılır; durum İLERLEMEZ, terminal yazımı yine `finishDiscoveryJob`a kalır.
 */
export async function claimDiscoveryStep(
  runId: string,
  step: DiscoveryStep,
  /** Çağıranın elinde varsa ara nokta; yoksa burada okunur (fazladan sorgu yok). */
  checkpoint?: DiscoveryCheckpoint | null,
  /** `slice > 0` → bu teslimat bir devam dilimidir (bkz. yukarıdaki not). */
  opts: { slice?: number } = {},
): Promise<StepClaim> {
  const job = await readDiscoveryJob(runId);
  if (!job) return { state: "missing", job: null };
  if (job.status !== "processing") return { state: "terminal", job };

  const start = STEP_START_STATE[step];
  const running = STEP_RUNNING_STATE[step];
  const slice =
    Number.isFinite(opts.slice) && (opts.slice as number) > 0
      ? Math.floor(opts.slice as number)
      : 0;

  if (slice > 0) {
    const cursor = readSliceState(checkpoint?.slices, step);
    if (decideSliceClaim(cursor.next, slice) !== "run") return { state: "in-progress", job };
    // `final` devam dilimi ancak `deep` GERÇEKTEN bittiyse koşar: sıra bozulursa
    // elinde oy satırı olmayan son adım sahte bir "nihai liste" üretirdi.
    if (step === "final") {
      const done = (checkpoint ?? (await readDiscoveryCheckpoint(runId)))?.done ?? [];
      if (!done.includes("deep")) return { state: "in-progress", job };
    }
    const refreshed = await advanceDiscoveryStatus({
      runId,
      from: running,
      to: running,
      progress: job.discoveryProgress,
      step,
    });
    return refreshed
      ? { state: "claimed", job: { ...job, discoveryStatus: running } }
      : { state: "in-progress", job };
  }

  const claimFrom = job.discoveryStatus;

  if (step === "final") {
    const done = (checkpoint ?? (await readDiscoveryCheckpoint(runId)))?.done ?? [];
    if (!done.includes("deep")) return { state: "in-progress", job };
    // Aşağıdaki CAS `deep_analysis → deep_analysis` kendine geçişidir ve
    // bilerek serbesttir (bkz. `PRODUCT_DISCOVERY_TRANSITIONS`): kilit alınır,
    // terminal durum (`completed`) yine yalnız `finishDiscoveryJob` ile yazılır.
    if (claimFrom !== start) {
      // Beklenmeyen satır (migration öncesi şema ya da bozulmuş kayıt): yine de
      // denenir — CAS `WHERE discovery_status = _from` ile eşleşmezse hiçbir
      // şey yazılmaz. Log, canlıda bu sınıf sorunun görünmesini sağlar.
      console.warn(`[discovery] final: beklenen durum ${start}, görülen ${claimFrom}`);
    }
  } else if (claimFrom === running) {
    // YARIDA ÖLEN ADIMI DEVRAL — GERİ ALMA YOK.
    //
    // Ölçülen hata: bu dal önce `running → start` geri geçişini deniyordu
    // (ör. ölü `deep` için `deep_analysis → gemini_shortlist`) ama bu geçişler
    // durum makinesinde TANIMLI DEĞİLDİ; `canTransition` reddediyor ve kilit
    // hiç tazelenemiyordu. Yani ölü adım 20 dakikalık watchdog kapanana kadar
    // kurtarılamıyordu — kullanıcının "dönüyor ama sonuç yok" hâli.
    //
    // DOĞRUSU: durum ZATEN "çalışıyor" işaretindedir ve doğrudur; tazelenmesi
    // gereken şey KİLİDİN sahibidir. Kendine geçiş (`running → running`) bunu
    // atomik olarak yapar: `WHERE discovery_status = _from` eşleşmezse başka
    // bir taşıyıcı önce davranmıştır ve biz hiçbir şey yapmayız.
    const age = job.updatedAt === null ? Number.POSITIVE_INFINITY : Date.now() - job.updatedAt;
    if (age < STALE_STEP_TAKEOVER_MS) return { state: "in-progress", job };
    const reclaimed = await advanceDiscoveryStatus({
      runId,
      from: running,
      to: running,
      progress: 10,
      step,
    });
    return reclaimed
      ? { state: "claimed", job: { ...job, discoveryStatus: running } }
      : { state: "in-progress", job };
  }

  const claimed = await advanceDiscoveryStatus({
    runId,
    from: claimFrom,
    to: running,
    progress: 10,
    step,
  });
  return claimed
    ? { state: "claimed", job: { ...job, discoveryStatus: running } }
    : { state: "in-progress", job };
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
  /** Bu teslimatın dilim numarası (0 = adımın ilk dilimi). */
  slice?: number;
}): Promise<
  | { ok: true; deduped: false; outcome: Extract<StepOutcome, { ok: true }> }
  | { ok: true; deduped: true }
  | { ok: false; error: string }
> {
  // ARA NOKTA, SAHİPLENMEDEN ÖNCE okunur: `final`ın kilit kararı buna bağlıdır
  // (`deep` gerçekten bitti mi?), devam diliminin sırası DİLİM DEFTERİNDEN
  // okunur ve aynı okuma aşağıda aday/oy girdisi olarak da kullanılır —
  // fazladan sorgu yapılmaz.
  const checkpoint = await readDiscoveryCheckpoint(args.runId);
  const slice =
    Number.isFinite(args.slice) && (args.slice as number) > 0
      ? Math.floor(args.slice as number)
      : 0;
  const claim = await claimDiscoveryStep(args.runId, args.step, checkpoint, { slice });
  if (claim.state === "in-progress") return { ok: true, deduped: true };
  if (claim.state === "terminal") return { ok: true, deduped: true };
  if (claim.state === "missing") return { ok: false, error: "İş kaydı bulunamadı." };

  const batch = args.batch?.length ? args.batch : (checkpoint?.shortlist ?? []);
  const consensus = args.consensus?.length ? args.consensus : (checkpoint?.votes ?? []);
  const cursor = readSliceState(checkpoint?.slices, args.step);

  // DİLİM BÜTÇESİ — ADIMIN TAMAMI DEĞİL, BU TESLİMAT İÇİN.
  //
  // ÖLÇÜLEN HATA (dilimlemeden önce): adım bütçesi teslimat penceresinden
  // türetiliyordu (Vercel'de ~278 sn). Yani `deep`, 14 rolü konuşturup tek bir
  // fonksiyonu dakikalarca meşgul edebiliyor; `gemini` anahtar rotasyonuyla
  // aynı pencereyi yiyebiliyordu. Kullanıcının isteği bunun tersidir: HER işlem
  // 10 sn'ye bölünür. Artık dilim bitişi tek ölçüttür (`sliceDeadlineAt`),
  // zincirin mutlak sözü (`deadlineAtMs`) yalnız ÜST SINIR olarak uygulanır.
  const sliceDeadline = sliceDeadlineAt({ chainDeadlineAt: args.deadlineAt });
  const chainLeft =
    args.deadlineAt === undefined ? Number.POSITIVE_INFINITY : args.deadlineAt - Date.now();

  // ZORLA BİTİRME İKİ DURUMDA: adım son dilimine geldiyse (sonsuz zincir
  // olmaz) ya da zincirin kalan süresi bir dilime yetmiyorsa. İki durumda da
  // adım kalan işi DETERMİNİSTEĞE düşürüp biter — uydurmaz, dürüstçe yedekler.
  const forceFinish = lastStepSlice(slice) || chainLeft < sliceWorkMs();

  // KALP ATIŞI — SAHİPLENİLMİŞ ADIMIN "CANLI" GÖRÜNMESİ.
  //
  // Ölçülen hata: `final` adımı çalışırken durumu DEĞİŞMEZ (`deep_analysis`),
  // dolayısıyla `updated_at` hiç yenilenmiyordu. Adım platform tarafından
  // ortasında kesilirse (Vercel isteği kesti, ağ koptu) satır "çalışıyor"
  // görünür ama ÖLÜ kalıyordu; `clientDrivesChain` satırı taze saydığı için
  // yoklama devralmıyor, watchdog da tetiklenmiyordu. İş sonsuza kadar
  // `processing`e kilitleniyor — kullanıcı yine yarım saat bekliyor.
  //
  // Çözüm: adım çalışırken periyodik olarak `updated_at` tazelenir. Böylece
  // (a) canlı adım "taze" görünür ve başka sürücü onu çalmaz,
  // (b) adım ölürse tazeleme de durur, satır bayatlar ve devralma devreye girer.
  // Kalp atışı hafiftir (tek kolon güncellemesi) ve adım bitince hemen durur.
  const heartbeat = startDiscoveryHeartbeat(args.runId);
  let outcome: StepOutcome;
  try {
    outcome = await executeProductDiscoveryStep({
      step: args.step,
      runId: args.runId,
      userId: args.userId,
      input: args.input,
      batch,
      consensus,
      // Zincirin bitiş anı: adım "zorla bitir" kararını buna göre verir.
      deadlineAt: args.deadlineAt ?? sliceDeadline,
      // BU dilimin bitiş anı: tüm model çağrıları bunu aşamaz.
      sliceDeadlineAt: sliceDeadline,
      slice,
      sliceState: cursor.partial,
      forceFinish,
    });
  } finally {
    heartbeat.stop();
  }

  if (!outcome.ok) return { ok: false, error: outcome.error };

  // Ara nokta yazımı: QStash yolunda da gerekir, çünkü aynı işin kalan adımları
  // kuyruk kaybolursa tarayıcı yoklaması tarafından sürdürülür.
  const previous = checkpoint ?? { v: 1 as const, done: [], shortlist: [], votes: [] };

  if (outcome.partial) {
    // ADIM BİTMEDİ — İLERLEME KAYBOLMAZ.
    //
    // `done`e EKLENMEZ (adım tamamlanmadı), ama dilim defteri ilerler ve
    // adıma özel kısmi durum (ör. konseyde o ana kadar konuşan roller ve
    // puanları) saklanır. Sıradaki dilim tam olarak buradan devam eder; bu
    // yüzden uzun bir adım için hiçbir model çağrısı iki kez yapılmaz.
    await saveDiscoveryCheckpoint(args.runId, {
      ...previous,
      slices: writeSliceState(previous.slices, args.step, {
        next: slice + 1,
        partial: outcome.sliceState,
      }),
    });
    return { ok: true, deduped: false, outcome };
  }

  if (!previous.done.includes(args.step)) {
    await saveDiscoveryCheckpoint(args.runId, {
      v: 1,
      done: [...previous.done, args.step],
      shortlist: outcome.products,
      votes: outcome.consensus,
      // Adım bitti: defter "sonraki dilim yok" durumuna çekilir ki gecikmiş bir
      // dilim teslimatı `already-done` görüp hiçbir şey yapmasın.
      slices: writeSliceState(previous.slices, args.step, { next: slice + 1, partial: undefined }),
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
  const deadline = Date.now() + Math.max(MIN_SLICE_BUDGET_MS, args.budgetMs);
  const ran: DiscoveryStep[] = [];
  /** Bu çağrıda adımlara harcanan gerçek süre (ms) — teşhis için. */
  let spentMs = 0;

  let checkpoint: DiscoveryCheckpoint = (await readDiscoveryCheckpoint(args.runId)) ?? {
    v: 1,
    done: [],
    shortlist: [],
    votes: [],
  };

  for (const step of DISCOVERY_STEPS) {
    // Zincir her zaman baştan taranır ve bitmiş adımlar atlanır: sıradaki adım
    // "tamamlanmamış İLK adım"dır. Bu yüzden yarıda kalan bir adımdan SONRAKİ
    // adım asla erken (elinde girdi yokken) koşmaz.
    if (checkpoint.done.includes(step)) continue;

    const stepStartedAt = Date.now();
    let finished = false;

    // ---------- ADIMIN DİLİMLERİ ----------
    // İlk dilim tam bir adım bütçesi ister; devam dilimleri zaten ilerleme
    // kaydettiği için çok daha küçük bir pencereye sığar. Bu ayrım, "bütçe
    // bitti" kararının yarım kalmış bir adımı çöpe atmasını engeller.
    for (let slice = readSliceState(checkpoint.slices, step).next; ; slice = slice + 1) {
      // Kapı: kalan bütçe tek bir dilime yetmiyorsa yeni dilim başlatılmaz.
      // Adımlar zaten dilim dilim ilerliyor; durmak ilerlemeyi KAYBETTİRMEZ
      // (ara nokta saklıdır, sıradaki sürücü kaldığı yerden devam eder).
      if (Date.now() + MIN_SLICE_BUDGET_MS > deadline) {
        return { completed: false, ran, stop: "budget" };
      }

      // SONSUZ DİLİM SİGORTASI.
      //
      // Adımlar son dilimde zorla bitirilir (`forceFinish`) ama bir adım bunu
      // yok sayarsa zincir kendi kendini besler ve kullanıcı hiç sonuç görmez.
      // Bu tavan, hatalı bir adımın bile işi sonsuza kadar döndürememesini
      // garanti eder; durum dürüstçe "bütçe bitti" olarak raporlanır.
      if (slice >= MAX_STEP_SLICES) {
        console.error(`[discovery] dilim tavanı aşıldı: ${step} (${slice} dilim)`);
        return { completed: false, ran, stop: "budget" };
      }

      // Adımı (dilimi) atomik sahiplen. `advanceDiscoveryStatus` migration'sız
      // şemada (RPC yok) başarı sayılır: orada kilit yoktur ama zincir yine
      // doğru sırayla ilerler ve ara nokta çift çalışmayı zaten engeller.
      const claim = await claimDiscoveryStep(args.runId, step, checkpoint, { slice });
      if (claim.state === "missing") {
        return { completed: false, ran, stop: "terminal", error: "İş kaydı bulunamadı." };
      }
      if (claim.state === "terminal") {
        return { completed: claim.job.status === "completed", ran, stop: "terminal" };
      }
      if (claim.state === "in-progress") return { completed: false, ran, stop: "in-progress" };

      const cursor = readSliceState(checkpoint.slices, step);
      const sliceDeadline = sliceDeadlineAt({ chainDeadlineAt: deadline });

      if (slice === 0) {
        console.log(`[discovery] adım başladı: ${step} (run ${args.runId.slice(0, 8)})`);
      }

      // Aynı kalp atışı QStash yolunda da zorunluydu: yoklama sürücüsü de
      // `final`i çalıştırabiliyor ve bu yolda da kesilme sessiz kilit bırakıyordu.
      const heartbeat = startDiscoveryHeartbeat(args.runId);
      let outcome: StepOutcome;
      try {
        outcome = await executeProductDiscoveryStep({
          step,
          runId: args.runId,
          userId: args.userId,
          input: args.input,
          batch: checkpoint.shortlist,
          consensus: checkpoint.votes,
          // Zincirin bitişi ve BU dilimin bitişi ayrı ayrı verilir: model
          // çağrıları dilimin penceresini aşamaz.
          deadlineAt: deadline,
          sliceDeadlineAt: sliceDeadline,
          slice,
          sliceState: cursor.partial,
          forceFinish: lastStepSlice(slice) || deadline - Date.now() < sliceWorkMs(),
        });
      } finally {
        heartbeat.stop();
      }

      if (!outcome.ok) {
        // Adım çöktü: iş `failed` ve kredi iade edildi (executor yaptı).
        console.error(
          `[discovery] adım çöktü: ${step} ${Date.now() - stepStartedAt}ms · ${outcome.error}`,
        );
        return { completed: false, ran, stop: "terminal", error: outcome.error };
      }

      if (outcome.partial) {
        // Dilim bitti, adım bitmedi: ilerleme yazılır ve döngü devam eder.
        checkpoint = {
          ...checkpoint,
          slices: writeSliceState(checkpoint.slices, step, {
            next: slice + 1,
            partial: outcome.sliceState,
          }),
        };
        console.log(
          `[discovery] dilim bitti (devam ediyor): ${step}#${slice} ` +
            `${Date.now() - stepStartedAt}ms · kalan=${outcome.sliceRemaining ?? "?"}`,
        );
        await saveDiscoveryCheckpoint(args.runId, checkpoint);
        continue;
      }

      // SÜRE ÖLÇÜMÜ — canlı teşhisinin tek satırı.
      //
      // Neden: "zaman aşımına uğradı" belirtisinin hangi adımdan geldiği
      // tahminle değil, ÖLÇÜMLE anlaşılır. Kümelenmiş süreler hat bütçesinin
      // nerede harcandığını doğrudan gösterir (canlıda: kazıma ~25 sn,
      // Gemini ~20 sn, konsey ~40 sn, sıralama ~5 sn).
      spentMs += Date.now() - stepStartedAt;
      console.log(
        `[discovery] adım bitti: ${step} ${Date.now() - stepStartedAt}ms ` +
          `· dilim=${slice + 1} · durum=${outcome.status} ` +
          `· ürün=${outcome.products.length} · oy=${outcome.consensus.length} ` +
          `(kümelenmiş ${spentMs}ms)`,
      );

      ran.push(step);
      checkpoint = {
        v: 1,
        done: [...checkpoint.done, step],
        shortlist: outcome.products,
        votes: outcome.consensus,
        slices: writeSliceState(checkpoint.slices, step, { next: slice + 1, partial: undefined }),
      };
      if (outcome.status === "completed") return { completed: true, ran, stop: "terminal" };
      await saveDiscoveryCheckpoint(args.runId, checkpoint);
      finished = true;
      break;
    }

    if (!finished) return { completed: false, ran, stop: "budget" };
  }

  return { completed: true, ran, stop: "terminal" };
}
