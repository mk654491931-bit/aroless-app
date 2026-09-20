/**
 * Konsey (14 ajan) süre bütçesi — 504'ün son kalesi.
 *
 * Sorun: 14 ajanlı hat tam derinlikte 350-400 sn sürer. Vercel Hobby'de bir
 * fonksiyonun hem varsayılanı hem ÜST SINIRI 300 sn'dir; aşarsa istek
 * `504 FUNCTION_INVOCATION_TIMEOUT` olur ve kullanıcı raporu hiç görmez.
 *
 * Çözüm: hattı sabit bir "her şey bitsin" sözü vermek yerine, eldeki süreye
 * göre **aşamalı** planlamak:
 *
 *   signals → teams (6 üretici) → review (6 hakem) → director → auditor
 *
 * Her aşamanın bir rezervi vardır ve bir aşama ancak
 * `kalan süre >= kendi rezervi + sonraki aşamaların rezervi` ise başlar.
 * Bir model çağrısı da en fazla `kalan süre - sonraki aşamaların rezervi`
 * kadar beklenir. Bu iki kural birlikte şunu GARANTİ eder:
 *
 *   toplam çalışma süresi <= sum(rezervler) <= bütçe - dönüş payı
 *
 * Yani istek, platform onu kesmeden önce kendi kendine biter; sığmayan
 * aşamalar atlanır ve rapor deterministik olarak derlenir (bkz.
 * `council.server.ts` → `synthesizeDirector`). Kullanıcı 504 yerine her zaman
 * bir rapor alır — derinliği bütçeye göre dürüstçe etiketlenmiş olarak.
 */

import {
  backgroundJobTimeoutMs,
  detectHostRuntime,
  platformDurationSeconds,
  withDeadlineOutcome,
  type DeadlineOutcome,
} from "@/lib/host-runtime.server";

export type CouncilDepth = "full" | "fast" | "enrich";

/** Aşama sırası. Rezervler bu sıraya göre "sonrası" toplanır. */
export const COUNCIL_STAGE_ORDER = ["signals", "teams", "review", "director", "auditor"] as const;

export type CouncilStage = (typeof COUNCIL_STAGE_ORDER)[number];

type Profile = {
  /** Tek bir model çağrısının üst sınırı. */
  perCallMs: number;
  /** Bir aşamada kaç motor denenecek (yedekler dahil). */
  maxAttempts: number;
  /** Aşama rezervleri — toplamı bütçeye sığmak zorundadır. */
  reserves: Record<CouncilStage, number>;
  /** Bu profilde HİÇ koşmayan aşamalar (rapor bunu dürüstçe listeler). */
  skips?: CouncilStage[];
};

/**
 * Hızlı profil — 300 sn'lik sunucusuz isteğin içinde koşar.
 *
 * Rezervler toplamı 245 sn; 300 sn'lik Hobby limitinden dönüş payı (10 sn)
 * çıkınca 282 sn kullanılabilir kalır → 37 sn emniyet payı.
 */
export const COUNCIL_FAST_PROFILE: Profile = {
  perCallMs: 35_000,
  maxAttempts: 2,
  reserves: {
    signals: 30_000,
    teams: 80_000,
    review: 55_000,
    director: 50_000,
    auditor: 30_000,
  },
};

/**
 * Tam profil — kalıcı süreçte (Render/VPS) arka plan işi olarak koşar.
 * Rezervler toplamı 750 sn; arka plan işi üst sınırı 900 sn.
 */
export const COUNCIL_FULL_PROFILE: Profile = {
  perCallMs: 120_000,
  maxAttempts: 4,
  reserves: {
    signals: 90_000,
    teams: 240_000,
    review: 180_000,
    director: 150_000,
    auditor: 90_000,
  },
};

/**
 * Zenginleştirme profili — ürün bulucu gibi SÜRE KISITLI bir hattın İÇİNDEN
 * çağrılır.
 *
 * 6 uzman ekip (üretici) + müdür koşar; hakem turu ve bağımsız denetçi
 * ATLANIR ve bu durum raporda `skipped_stages` + `depth: "enrich"` ile
 * dürüstçe söylenir. Rezervler toplamı 52 sn + 10 sn dönüş payı = 62 sn:
 * böylece tek bir ürün bütün bütçeyi yiyemez ve aynı iş içinde birkaç ürün
 * birden çok motorlu karne alabilir.
 */
export const COUNCIL_ENRICH_PROFILE: Profile = {
  perCallMs: 14_000,
  maxAttempts: 2,
  reserves: {
    signals: 8_000,
    teams: 26_000,
    review: 0,
    director: 18_000,
    auditor: 0,
  },
  skips: ["review", "auditor"],
};

/** Sonucu yazıp yanıtı serialize etmek için ayrılan pay. */
export const COUNCIL_RETURN_MARGIN_MS = 10_000;

/**
 * Zenginleştirmenin anlamlı olması için gereken en düşük bütçe (ms).
 * Altında hiç başlatmayız: eksik bir karne üretmek yerine ürünü olduğu gibi
 * bırakırız.
 */
export const COUNCIL_ENRICH_MIN_MS = sumReserves(COUNCIL_ENRICH_PROFILE) + COUNCIL_RETURN_MARGIN_MS;

/**
 * Kısa karneye verilebilecek ÜST bütçe (ms).
 *
 * Rezervler tek başına 52 sn tutar; en kötü durumda hakem/deneme tekrarları da
 * eklenince ürün başına maliyet ~62-70 sn'yi geçmez. Üst sınırı bu yüzden
 * koyuyoruz: bulucu hattı 8 ürünü karneye çıkarmak istese bile tek bir ürün
 * hattın kalan süresini yiyip sonrakileri imkânsız bırakamaz.
 */
export const COUNCIL_ENRICH_BUDGET_MS = 90_000;

/** Bu süreden kısa bir çağrı başlatmak anlamsız (boşa zaman aşımı olur). */
export const MIN_CALL_MS = 8_000;

/**
 * Zincir tükendiğinde denenen son yedeğin rapor etiketi.
 *
 * Konseyin 6 ekibi kendi model zincirini sırayla dener (Groq → Gemini →
 * OpenRouter → HF). Profil `maxAttempts` ile zinciri kırptığı için (hızlı ve
 * zenginleştirme profilinde 2 deneme) bu zincirin SONUNDAKİ havuz motoru hiç
 * koşmuyordu: iki sağlayıcı da o anda kotadaysa ekip `unavailable` dönüyor ve
 * karne boş kalıyordu. Aşağıdaki karar, zincir tükendiğinde ama süre varken
 * 22 slotluk anahtar havuzunun (Gemini/Groq/Cerebras/SambaNova/HF/OpenRouter)
 * denenmesini sağlar — yani hangi sağlayıcı müsaitse cevabı o verir.
 */
export const COUNCIL_MESH_ENGINE = "Anahtar havuzu (22 slot)";

/**
 * Zincirin deneme hakkı bittiğinde bir havuz turu daha denenmeli mi?
 *
 * `attempted < maxAttempts` ise zincirin kendi sıradaki motoru koşacaktır
 * (bu tur gereksiz olurdu). Süre `MIN_CALL_MS`in altındaysa tur başlatılmaz:
 * beklemek 504 üretir, eksik karne üretmez.
 */
export function needsMeshFallback(args: {
  attempted: number;
  maxAttempts: number;
  timeLeftMs: number;
}): boolean {
  if (args.attempted < args.maxAttempts) return false;
  return Number.isFinite(args.timeLeftMs) && args.timeLeftMs >= MIN_CALL_MS;
}

/**
 * İstek içinde konsey koşturmak için gereken en düşük bütçe.
 * Altındaysa hızlı profil bile anlamlı rapor üretemez: açık hata döneriz
 * (504 değil) ve kredi harcanmaz.
 */
export const MIN_INLINE_COUNCIL_MS = 120_000;

/** Arka plan işi için varsayılan bütçe: iş zaman aşımının (900 sn) altında. */
export const DEFAULT_COUNCIL_BUDGET_MS = 870_000;

/**
 * Konsey bu süre bütçesine sığmadığında fırlatılır.
 *
 * 504 yerine ANLAŞILIR bir hata: kredi iade edilir ve kullanıcı ne olduğunu
 * okur. Hiçbir koşulda istek platform tarafından kesilmez, çünkü karar burada
 * verilir — hat çalışmaya başlamadan önce.
 */
export class CouncilBudgetError extends Error {
  readonly budgetMs: number;
  readonly stage: string;

  constructor(budgetMs: number, stage: string) {
    super(
      `Konsey için ayrılan süre yetersiz (${Math.round(budgetMs / 1000)} sn; en az ` +
        `${Math.round(MIN_INLINE_COUNCIL_MS / 1000)} sn gerekir). "${stage}" aşaması başlatılamadı — ` +
        `iş arka planda koşmalıdır (Render servisi veya WORKER_URL tanımlı olsun).`,
    );
    this.name = "CouncilBudgetError";
    this.budgetMs = budgetMs;
    this.stage = stage;
  }
}

/**
 * Konseyin BU SÜREÇTE kullanabileceği varsayılan süre bütçesi (ms).
 *
 * Kritik: bütçeyi platformun limiti belirler, sabit bir sayı değil.
 *  - Sunucusuz (Vercel): fonksiyon limiti (Hobby'de 300 sn) → `fast` profil,
 *    yani istek kendi kendine biter ve 504 yerine rapor döner.
 *  - Kalıcı süreç (Render / VPS / yerel dev): arka plan işi sınırı (900 sn) →
 *    `full` profil, 14 ajanın tamamı koşar.
 */
export function defaultCouncilBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const runtime = detectHostRuntime(env);
  const ms = runtime.serverless ? platformDurationSeconds(env) * 1000 : backgroundJobTimeoutMs(env);
  return Math.max(MIN_INLINE_COUNCIL_MS, Math.round(ms));
}

export type CouncilBudget = {
  depth: CouncilDepth;
  startedAt: number;
  /** İşin bitmesi gereken an (epoch ms) — dönüş payı düşülmüş. */
  deadlineAt: number;
  /** Kullanılabilir toplam bütçe (ms, dönüş payı dahil). */
  totalMs: number;
  perCallMs: number;
  maxAttempts: number;
  reserves: Record<CouncilStage, number>;
  /** Bu profilde hiç koşmayacak aşamalar (rapora `skipped_stages` olarak yazılır). */
  skips: CouncilStage[];
};

/**
 * Bütçe tam profili (750 sn rezerv + dönüş payı) kaldırıyor mu?
 * Kaldırmıyorsa hızlı profille koşar: 300 sn'lik Hobby isteği de tam bu yüzden
 * 504 yerine rapor üretir.
 */
/**
 * Bütçeye göre profil. `enrich` yalnızca çağıran AÇIKÇA istediğinde seçilir
 * (`planCouncilBudget({ depth: "enrich" })`): ürün bulucu içinden çağrılan
 * kısa karnedir, tam bir konsey raporu değildir.
 */
export function councilDepthFor(budgetMs: number): CouncilDepth {
  return sumReserves(COUNCIL_FULL_PROFILE) + COUNCIL_RETURN_MARGIN_MS <= budgetMs ? "full" : "fast";
}

/** Bir profilin aşama rezervleri toplamı — bütçeye sığmak zorundadır. */
export function sumReserves(profile: Pick<Profile, "reserves">): number {
  return COUNCIL_STAGE_ORDER.reduce((sum, stage) => sum + profile.reserves[stage], 0);
}

export function planCouncilBudget(
  opts: { budgetMs?: number; now?: number; depth?: CouncilDepth } = {},
): CouncilBudget {
  const now = opts.now ?? Date.now();
  const rawBudget = Math.max(0, Math.round(opts.budgetMs ?? DEFAULT_COUNCIL_BUDGET_MS));
  const depth = opts.depth ?? councilDepthFor(rawBudget);
  const profile =
    depth === "full"
      ? COUNCIL_FULL_PROFILE
      : depth === "enrich"
        ? COUNCIL_ENRICH_PROFILE
        : COUNCIL_FAST_PROFILE;
  return {
    depth,
    startedAt: now,
    deadlineAt: now + Math.max(0, rawBudget - COUNCIL_RETURN_MARGIN_MS),
    totalMs: rawBudget,
    perCallMs: profile.perCallMs,
    maxAttempts: profile.maxAttempts,
    reserves: { ...profile.reserves },
    skips: [...(profile.skips ?? [])],
  };
}

export function remainingMs(budget: CouncilBudget, now = Date.now()): number {
  return Math.max(0, budget.deadlineAt - now);
}

/** Bu aşamadan SONRA gelen aşamaların toplam rezervi. */
export function laterReserveMs(budget: CouncilBudget, stage: CouncilStage): number {
  const index = COUNCIL_STAGE_ORDER.indexOf(stage);
  return COUNCIL_STAGE_ORDER.slice(index + 1).reduce((sum, s) => sum + budget.reserves[s], 0);
}

/**
 * Aşamaya başlamak için yeterli süre var mı?
 * Sonraki aşamaların rezervi korunur — bu sayede hiçbir aşama bütçeyi
 * "yiyip" sonrakini imkânsız hale getiremez.
 */
export function stageFits(budget: CouncilBudget, stage: CouncilStage, now = Date.now()): boolean {
  return remainingMs(budget, now) >= budget.reserves[stage] + laterReserveMs(budget, stage);
}

/** Sonraki aşamaların rezervini bozmadan bu çağrıya verilebilecek süre. */
export function callTimeoutMs(
  budget: CouncilBudget,
  stage: CouncilStage,
  now = Date.now(),
): number {
  const room = remainingMs(budget, now) - laterReserveMs(budget, stage);
  return Math.max(0, Math.min(budget.perCallMs, room));
}

/** Kalan süreye anlamlı bir çağrı sığar mı? Sığmıyorsa hiç başlatmayız. */
export function canAffordCall(
  budget: CouncilBudget,
  stage: CouncilStage,
  now = Date.now(),
): boolean {
  return callTimeoutMs(budget, stage, now) >= MIN_CALL_MS;
}

/**
 * Bir model çağrısını aşamanın bütçesine bağlar.
 *
 * `withDeadlineOutcome` sözü iptal etmez, yalnızca "hâlâ sürüyor" der; böylece
 * yavaş bir sağlayıcı yüzünden isteğin tamamı askıda kalmaz, sıradaki yedek
 * motora geçilir. Süre yetmiyorsa çağrı hiç beklenmez: `pending` döner.
 */
export function withStageDeadline<T>(
  promise: Promise<T>,
  budget: CouncilBudget,
  stage: CouncilStage,
  now = Date.now(),
): Promise<DeadlineOutcome<T>> {
  const timeout = callTimeoutMs(budget, stage, now);
  if (timeout < MIN_CALL_MS) return Promise.resolve({ kind: "pending" });
  return withDeadlineOutcome(promise, timeout);
}

/** /health ve log satırları için özet (sır içermez). */
export function councilBudgetSummary(budget: CouncilBudget): {
  depth: CouncilDepth;
  totalMs: number;
  remainingMs: number;
  perCallMs: number;
  maxAttempts: number;
} {
  return {
    depth: budget.depth,
    totalMs: budget.totalMs,
    remainingMs: remainingMs(budget),
    perCallMs: budget.perCallMs,
    maxAttempts: budget.maxAttempts,
  };
}
