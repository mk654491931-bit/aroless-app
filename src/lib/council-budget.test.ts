// Unit tests for the council (14 agents) time budget — the 504 firewall.
//
// 14 ajanlı tam hat 350-400 sn sürer. Vercel Hobby'de bir fonksiyonun ÜST
// SINIRI 300 sn'dir: aşarsa istek `504 FUNCTION_INVOCATION_TIMEOUT` olur ve
// kullanıcı raporu hiç görmez. Bu bütçe planı, hat platform onu kesmeden
// bitecek şekilde kurulur; buradaki testler o garantiyi sabitler:
//
//   1. Rezerv toplamı + dönüş payı, kabul edilen HER bütçeye sığar.
//   2. Her çağrı `kalan süre - sonraki aşamaların rezervi` ile sınırlanır,
//      yani hiçbir aşama sonrakini imkânsız hale getiremez.
//   3. Süre bitmek üzereyse çağrı hiç başlatılmaz (beklemek = 504).
// Saf mantık: ağ yok, AI anahtarı gerekmez.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNCIL_ENRICH_BUDGET_MS,
  COUNCIL_ENRICH_MIN_MS,
  COUNCIL_ENRICH_PROFILE,
  COUNCIL_FAST_PROFILE,
  COUNCIL_FULL_PROFILE,
  COUNCIL_RETURN_MARGIN_MS,
  COUNCIL_STAGE_ORDER,
  CouncilBudgetError,
  MIN_INLINE_COUNCIL_MS,
  canAffordCall,
  callTimeoutMs,
  councilDepthFor,
  defaultCouncilBudgetMs,
  laterReserveMs,
  planCouncilBudget,
  remainingMs,
  stageFits,
  sumReserves,
  withStageDeadline,
} from "./council-budget.server";

/** Vercel Hobby'nin güncel fonksiyon üst sınırı. */
const HOBBY_LIMIT_MS = 300_000;
/** Kalıcı süreçteki arka plan işi üst sınırı (Render). */
const BACKGROUND_JOB_LIMIT_MS = 900_000;

const MANAGED_KEYS = [
  "NITRO_PRESET",
  "RENDER_SERVICE_ID",
  "VERCEL",
  "VERCEL_FUNCTION_MAX_DURATION",
  "BACKGROUND_JOB_TIMEOUT_MS",
  "REQUEST_BUDGET_MS",
];

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const key of MANAGED_KEYS) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("profil rezervleri platform limitine sığar", () => {
  it("hızlı profil 300 sn'lik Hobby limitine dönüş payıyla sığar", () => {
    // Sabitler dokümantasyondaki sözleşmedir: 30+80+55+50+30 = 245 sn.
    expect(sumReserves(COUNCIL_FAST_PROFILE)).toBe(245_000);
    expect(sumReserves(COUNCIL_FAST_PROFILE) + COUNCIL_RETURN_MARGIN_MS).toBeLessThanOrEqual(
      HOBBY_LIMIT_MS,
    );
  });

  it("tam profil 900 sn'lik arka plan işi limitine sığar", () => {
    expect(sumReserves(COUNCIL_FULL_PROFILE)).toBe(750_000);
    expect(sumReserves(COUNCIL_FULL_PROFILE) + COUNCIL_RETURN_MARGIN_MS).toBeLessThanOrEqual(
      BACKGROUND_JOB_LIMIT_MS,
    );
  });

  it("her aşama sırayla tam rezervini harcasa bile zincir sonuna kadar sığar", () => {
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 });
    let elapsed = 0;
    for (const stage of COUNCIL_STAGE_ORDER) {
      // Aşama başlarken sonraki aşamaların rezervi GARANTİ edilmiş olmalı.
      expect(stageFits(budget, stage, elapsed)).toBe(true);
      elapsed += budget.reserves[stage];
    }
    expect(elapsed + COUNCIL_RETURN_MARGIN_MS).toBeLessThanOrEqual(HOBBY_LIMIT_MS);
  });
});

describe("kısa karne profili (ürün bulucu içinden)", () => {
  it("6 uzman ekip + müdür koşar; hakem turu ve denetçi atlanır", () => {
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, depth: "enrich", now: 0 });
    expect(budget.depth).toBe("enrich");
    expect(budget.skips).toEqual(["review", "auditor"]);
    expect(sumReserves(COUNCIL_ENRICH_PROFILE)).toBe(52_000);
  });

  it("otomatik seçimde (depth verilmezse) asla enrich'e düşmez", () => {
    // Kısa karne yalnızca çağıran AÇIKÇA istediğinde koşar; /council ekranı
    // 300 sn'de hızlı profille tam rapor almaya devam eder.
    expect(planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 }).depth).toBe("fast");
    expect(planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 }).skips).toEqual([]);
  });

  it("atlanan aşamalar için hiç çağrı bütçesi harcanmaz", () => {
    const budget = planCouncilBudget({
      budgetMs: COUNCIL_ENRICH_BUDGET_MS,
      depth: "enrich",
      now: 0,
    });
    // Kapı `skips` listesidir (council.server bu aşamaları hiç başlatmaz);
    // rezervleri de 0 olduğu için zincirden hiç süre almazlar.
    expect(budget.skips).toContain("review");
    expect(budget.skips).toContain("auditor");
    expect(budget.reserves.review).toBe(0);
    expect(budget.reserves.auditor).toBe(0);
    // Atlanan aşamalar sonraki rezervlere yazılmaz: müdür yine yer bulur.
    expect(laterReserveMs(budget, "teams")).toBe(18_000);
  });

  it("ürün başına maliyet sabittir ve 280 sn'lik hatta sığar", () => {
    // Bulucu hat 280 sn ile sınırlı: tek bir ürün karnesi (rezervler + en kötü
    // ek deneme) bu bütçenin küçük bir dilimini kullanmalı ki birkaç ürün
    // birden karne alabilsin.
    expect(COUNCIL_ENRICH_MIN_MS).toBe(62_000);
    expect(COUNCIL_ENRICH_BUDGET_MS).toBe(90_000);
    expect(COUNCIL_ENRICH_BUDGET_MS).toBeLessThan(280_000 / 2);
    // Alt sınırın altında bir bütçe verilirse hat başlamamalı (bkz. bulucu:
    // `councilCount` hesabı bu sabitle ürün sayısını belirler).
    expect(COUNCIL_ENRICH_MIN_MS).toBeGreaterThan(COUNCIL_ENRICH_BUDGET_MS / 2);
  });

  it("kısa karnede de hiçbir aşama sonrakini imkânsız bırakmaz", () => {
    const budget = planCouncilBudget({
      budgetMs: COUNCIL_ENRICH_BUDGET_MS,
      depth: "enrich",
      now: 0,
    });
    let elapsed = 0;
    for (const stage of ["signals", "teams", "director"] as const) {
      expect(stageFits(budget, stage, elapsed)).toBe(true);
      elapsed += budget.reserves[stage];
    }
    expect(elapsed + COUNCIL_RETURN_MARGIN_MS).toBeLessThanOrEqual(COUNCIL_ENRICH_BUDGET_MS);
  });
});

describe("councilDepthFor", () => {
  it("tam profili yalnızca 760 sn ve üzeri bütçede seçer", () => {
    const full = sumReserves(COUNCIL_FULL_PROFILE) + COUNCIL_RETURN_MARGIN_MS;
    expect(councilDepthFor(full - 1)).toBe("fast");
    expect(councilDepthFor(full)).toBe("full");
    expect(councilDepthFor(BACKGROUND_JOB_LIMIT_MS)).toBe("full");
  });

  it("Hobby'nin 300 sn'sinde hızlı profili seçer (504 yerine rapor)", () => {
    expect(councilDepthFor(HOBBY_LIMIT_MS)).toBe("fast");
  });
});

describe("çağrı bütçesi sonraki aşamaları korur", () => {
  it("tek çağrı `kalan süre - sonraki rezervler` sınırını aşmaz", () => {
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 });
    for (const stage of COUNCIL_STAGE_ORDER) {
      const timeout = callTimeoutMs(budget, stage, 0);
      const room = remainingMs(budget, 0) - laterReserveMs(budget, stage);
      expect(timeout).toBeLessThanOrEqual(room);
      expect(timeout).toBeLessThanOrEqual(budget.perCallMs);
    }
  });

  it("sonraki aşamaların rezervi yendiğinde çağrı başlatılmaz", () => {
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 });
    // Hakem turu gecikti: kalan süre tam olarak müdür + denetçi rezervi (80 sn).
    const now = budget.deadlineAt - laterReserveMs(budget, "review");
    expect(remainingMs(budget, now)).toBe(80_000);
    // Hakem için yer kalmadı → çağrı HİÇ başlatılmaz (beklemek = 504).
    expect(callTimeoutMs(budget, "review", now)).toBe(0);
    expect(canAffordCall(budget, "review", now)).toBe(false);
    expect(stageFits(budget, "review", now)).toBe(false);
    // Ama sonraki aşamaların rezervi hâlâ yerinde: rapor tamamlanabilir.
    expect(stageFits(budget, "director", now)).toBe(true);
    expect(callTimeoutMs(budget, "director", now)).toBeGreaterThan(0);
  });

  it("süresi tükenmiş bütçede beklemek yerine ANINDA 'pending' döner", async () => {
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 });
    const settled = await withStageDeadline(
      new Promise(() => {}),
      budget,
      "auditor",
      budget.deadlineAt + 1,
    );
    expect(settled).toEqual({ kind: "pending" });
  });

  it("askıda kalan model çağrısı aşama zaman aşımında çözülür", async () => {
    vi.useFakeTimers();
    const budget = planCouncilBudget({ budgetMs: HOBBY_LIMIT_MS, now: 0 });
    const pending = withStageDeadline(new Promise<string>(() => {}), budget, "signals", 0);
    await vi.advanceTimersByTimeAsync(budget.perCallMs + 1_000);
    expect(await pending).toEqual({ kind: "pending" });
  });
});

describe("defaultCouncilBudgetMs (platforma göre profil)", () => {
  it("Render'da tam hattı açar (14 ajan, 900 sn iş bütçesi)", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    const budget = planCouncilBudget({ budgetMs: defaultCouncilBudgetMs(), now: 0 });
    expect(defaultCouncilBudgetMs()).toBe(BACKGROUND_JOB_LIMIT_MS);
    expect(budget.depth).toBe("full");
    expect(budget.maxAttempts).toBeGreaterThan(COUNCIL_FAST_PROFILE.maxAttempts);
  });

  it("Vercel'de Hobby limitine göre hızlı profile iner", () => {
    vi.stubEnv("VERCEL", "1");
    expect(defaultCouncilBudgetMs()).toBe(HOBBY_LIMIT_MS);
    expect(planCouncilBudget({ budgetMs: defaultCouncilBudgetMs(), now: 0 }).depth).toBe("fast");
  });

  it("Vercel limiti 60 sn'ye çekilse bile anlamlı bir taban bırakır", () => {
    // Daraltılmış limit hızlı profile bile yetmez: bu durumda istek 504 olmaz,
    // `CouncilBudgetError` ile açık hata döner ve kredi iade edilir.
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    const budgetMs = defaultCouncilBudgetMs();
    expect(budgetMs).toBe(MIN_INLINE_COUNCIL_MS);

    const budget = planCouncilBudget({ budgetMs, now: 0 });
    expect(budget.depth).toBe("fast");
    expect(stageFits(budget, "teams", 0)).toBe(false);
    const raise = () => {
      throw new CouncilBudgetError(budgetMs, "uzman ekipler");
    };
    expect(raise).toThrow(CouncilBudgetError);
    expect(raise).toThrow(/yetersiz/);
    expect(raise).toThrow(/120 sn/);
  });

  it("aşırı küçük bir bütçede bile tabanın altına inmez", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "10");
    expect(defaultCouncilBudgetMs()).toBe(MIN_INLINE_COUNCIL_MS);
  });
});
