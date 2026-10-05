// ============================================================================
// DİLİMLİ ZİNCİR — "HER İŞLEM 10 SN, SONRA QSTASH" SÖZLEŞMESİ.
//
// Bu testler davranışı kilitler:
//   1. Bir teslimatın iş bütçesi DİLİMDİR (zincir sözü değil).
//   2. Adım dilimde bitmezse ilerleme ARA NOKTAYA yazılır ve `done`e EKLENMEZ.
//   3. Sıradaki dilim tam kaldığı yerden devam eder (kısmi durum taşınır).
//   4. Zincir sürücüsü de aynı kuralı uygular: uzun adımı dilim dilim koşar.
//
// Ağ ve veritabanı YOK: iş deposu ve adım yürütücüsü taklit edilir.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";

import { discoverySliceMs, sliceWorkMs } from "./product-discovery-slices.server";
import { runDiscoveryChain, runOneDiscoveryStep } from "./product-discovery-runner.server";
import type { ProductDiscoveryInput } from "./product-discovery.types";

const jobsMock = vi.hoisted(() => ({
  readDiscoveryJob: vi.fn(),
  readDiscoveryCheckpoint: vi.fn(),
  advanceDiscoveryStatus: vi.fn(),
  saveDiscoveryCheckpoint: vi.fn(),
  touchDiscoveryRun: vi.fn(),
  failAndRefund: vi.fn(),
  finishDiscoveryJob: vi.fn(),
  writeDiscoveryProgress: vi.fn(),
}));

const stepsMock = vi.hoisted(() => ({ executeProductDiscoveryStep: vi.fn() }));

vi.mock("./product-discovery-jobs.server", () => jobsMock);
vi.mock("./product-discovery-steps.server", () => stepsMock);

const INPUT: ProductDiscoveryInput = {
  niche: "air fryer",
  country: "US",
  platform: "General",
  topN: 5,
};

function jobRecord(over: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    userId: "user-1",
    status: "processing",
    discoveryStatus: "deep_analysis",
    discoveryProgress: 90,
    discoveryStep: "deep",
    chargedCredits: 1,
    stats: null,
    error: null,
    updatedAt: Date.now(),
    ...over,
  };
}

const product = (n: number) => ({ name: `Ürün ${n}`, fingerprint: `fp-${n}` });

type ExecArgs = {
  step: string;
  slice?: number;
  sliceState?: unknown;
  sliceDeadlineAt?: number;
  deadlineAt?: number;
  batch: unknown[];
};

describe("tek dilim koşumu (runOneDiscoveryStep)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `deep` adımının BAŞLANGIÇ durumu: devam dilimi kilidi bu değere bakmaz
    // (defter belirler), ilk dilim ise CAS ile bu durumdan 'deep_analysis'e
    // geçer.
    jobsMock.readDiscoveryJob.mockResolvedValue(
      jobRecord({ discoveryStatus: "gemini_shortlist", discoveryStep: "gemini" }),
    );
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);
    jobsMock.touchDiscoveryRun.mockResolvedValue(true);
  });

  it("ADIM BİTMEZSE ilerleme ara noktaya yazılır, `done`e EKLENMEZ", async () => {
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue({
      v: 1,
      done: ["scrape_filter", "gemini"],
      shortlist: [product(1)],
      votes: [],
      slices: { deep: { next: 1, partial: { done: ["cfo"], scores: {} } } },
    });
    stepsMock.executeProductDiscoveryStep.mockResolvedValue({
      ok: true,
      step: "deep",
      status: "deep_analysis",
      progress: 85,
      products: [product(1)],
      consensus: [],
      partial: true,
      sliceState: { done: ["cfo", "cmo"], scores: {} },
      sliceRemaining: 12,
      notes: [],
    });

    const result = await runOneDiscoveryStep({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      step: "deep",
      batch: [product(1)],
      slice: 1,
      deadlineAt: Date.now() + 200_000,
    });

    expect(result.ok && !result.deduped).toBe(true);
    const saved = jobsMock.saveDiscoveryCheckpoint.mock.calls.at(-1)?.[1];
    expect(saved.done).toEqual(["scrape_filter", "gemini"]);
    expect(saved.slices.deep).toEqual({
      next: 2,
      partial: { done: ["cfo", "cmo"], scores: {} },
    });

    // Kısmi durum sıradaki dilime TAŞINIR ve dilim numarası doğrudur.
    const exec = stepsMock.executeProductDiscoveryStep.mock.calls[0]?.[0] as ExecArgs;
    expect(exec.slice).toBe(1);
    expect(exec.sliceState).toEqual({ done: ["cfo"], scores: {} });
  });

  it("ADIM BİTERSE `done`e yazılır ve kısmi durum temizlenir", async () => {
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue({
      v: 1,
      done: ["scrape_filter", "gemini"],
      shortlist: [product(1)],
      votes: [],
      slices: { deep: { next: 2, partial: { done: ["cfo"] } } },
    });
    stepsMock.executeProductDiscoveryStep.mockResolvedValue({
      ok: true,
      step: "deep",
      status: "deep_analysis",
      progress: 90,
      products: [product(1)],
      consensus: [{ candidateId: "fp-1" }],
      notes: [],
    });

    await runOneDiscoveryStep({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      step: "deep",
      batch: [product(1)],
      slice: 2,
      deadlineAt: Date.now() + 200_000,
    });

    const saved = jobsMock.saveDiscoveryCheckpoint.mock.calls.at(-1)?.[1];
    expect(saved.done).toEqual(["scrape_filter", "gemini", "deep"]);
    expect(saved.votes).toEqual([{ candidateId: "fp-1" }]);
  });

  it("BİR TESLİMATIN İŞ BÜTÇESİ DİLİMDİR — zincir sözü değil", async () => {
    // Kullanıcının istediği kural: hiçbir fonksiyon uzun koşmaz. Adımın
    // gördüğü `sliceDeadlineAt` dilim bütçesini aşamaz; `deadlineAt` yalnız
    // zincirin mutlak sonudur.
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue({
      v: 1,
      done: ["scrape_filter", "gemini"],
      shortlist: [product(1)],
      votes: [],
      slices: { deep: { next: 0 } },
    });
    stepsMock.executeProductDiscoveryStep.mockResolvedValue({
      ok: true,
      step: "deep",
      status: "deep_analysis",
      progress: 85,
      products: [product(1)],
      consensus: [],
      partial: true,
      sliceState: { done: ["cfo"], scores: {} },
      sliceRemaining: 13,
      notes: [],
    });

    const chainDeadline = Date.now() + 250_000;
    await runOneDiscoveryStep({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      step: "deep",
      batch: [product(1)],
      deadlineAt: chainDeadline,
    });

    const exec = stepsMock.executeProductDiscoveryStep.mock.calls[0]?.[0] as ExecArgs;
    expect(exec.deadlineAt).toBe(chainDeadline);
    const budget = (exec.sliceDeadlineAt ?? 0) - Date.now();
    expect(budget).toBeLessThanOrEqual(discoverySliceMs());
    expect(budget).toBeGreaterThan(0);
  });

  it("ZİNCİR SÜRESİ BİTTİYSE adım zorla bitirilir (sonsuz dilim yok)", async () => {
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue({
      v: 1,
      done: ["scrape_filter", "gemini"],
      shortlist: [product(1)],
      votes: [],
      slices: { deep: { next: 0 } },
    });
    stepsMock.executeProductDiscoveryStep.mockResolvedValue({
      ok: true,
      step: "deep",
      status: "deep_analysis",
      progress: 90,
      products: [product(1)],
      consensus: [{ candidateId: "fp-1" }],
      notes: [],
    });

    await runOneDiscoveryStep({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      step: "deep",
      batch: [product(1)],
      // Zincirin kalan süresi bir dilime yetmiyor.
      deadlineAt: Date.now() + Math.floor(sliceWorkMs() / 2),
    });

    const exec = stepsMock.executeProductDiscoveryStep.mock.calls[0]?.[0] as ExecArgs;
    expect(
      (stepsMock.executeProductDiscoveryStep.mock.calls[0]?.[0] as { forceFinish?: boolean })
        .forceFinish,
    ).toBe(true);
    void exec;
  });
});

describe("zincir sürücüsü dilim dilim koşar (runDiscoveryChain)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sıradaki adıma geçilebilmesi için satır "boşta" olmalı: gerçek akışta
    // durum sütununu her dilim kendisi yazar (CAS).
    jobsMock.readDiscoveryJob.mockResolvedValue(
      jobRecord({ discoveryStatus: "queued", discoveryStep: "scrape_filter" }),
    );
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue(null);
    jobsMock.advanceDiscoveryStatus.mockResolvedValue(true);
    jobsMock.touchDiscoveryRun.mockResolvedValue(true);
    jobsMock.saveDiscoveryCheckpoint.mockResolvedValue(undefined);
  });

  it("uzun adımı dilimlere böler, ilerlemeyi yazar ve adımı bitirir", async () => {
    const calls: ExecArgs[] = [];
    stepsMock.executeProductDiscoveryStep.mockImplementation(async (args: ExecArgs) => {
      calls.push(args);
      if (args.step === "scrape_filter") {
        return {
          ok: true,
          step: "scrape_filter",
          status: "filtering",
          progress: 35,
          products: [product(1), product(2)],
          consensus: [],
          notes: [],
        };
      }
      if (args.step === "gemini") {
        return {
          ok: true,
          step: "gemini",
          status: "gemini_shortlist",
          progress: 70,
          products: [product(1), product(2)],
          consensus: [],
          notes: [],
        };
      }
      if (args.step === "deep") {
        const slice = args.slice ?? 0;
        // İlk iki dilim yarım kalır (14 rol 4 dalgada biter varsayımı),
        // üçüncü dilim konseyi tamamlar.
        if (slice < 2) {
          return {
            ok: true,
            step: "deep",
            status: "deep_analysis",
            progress: 85,
            products: args.batch,
            consensus: [],
            partial: true,
            sliceState: { done: [`role-${slice}`], scores: {} },
            sliceRemaining: 14 - slice,
            notes: [],
          };
        }
        return {
          ok: true,
          step: "deep",
          status: "deep_analysis",
          progress: 90,
          products: args.batch,
          consensus: [{ candidateId: "fp-1", councilScore: 80 }],
          notes: [],
        };
      }
      return {
        ok: true,
        step: "final",
        status: "completed",
        progress: 100,
        products: [product(1)],
        consensus: [{ candidateId: "fp-1", councilScore: 80 }],
        topProducts: [{ id: "fp-1", title: "Ürün 1", final_score: 80, selection_reason: "x" }],
        notes: [],
      };
    });

    const outcome = await runDiscoveryChain({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      budgetMs: 60_000,
    });

    expect(outcome.completed).toBe(true);
    // Adımların hepsi koştu; `deep` ÜÇ dilimde bitti.
    expect(calls.map((c) => `${c.step}#${c.slice ?? 0}`)).toEqual([
      "scrape_filter#0",
      "gemini#0",
      "deep#0",
      "deep#1",
      "deep#2",
      "final#0",
    ]);

    // ÜÇÜNCÜ dilim, İKİNCİ dilimin bıraktığı kısmi durumla başladı.
    expect(calls[4]?.sliceState).toEqual({ done: ["role-1"], scores: {} });

    // Ara nokta yalnız dilim sonunda ilerledi ve adım `done`e eklenmedi.
    const deepSaves = jobsMock.saveDiscoveryCheckpoint.mock.calls
      .map((call) => call[1] as { done: string[]; slices?: Record<string, { next: number }> })
      .filter((saved) => saved.slices?.["deep"] !== undefined);
    expect(deepSaves[0]?.slices?.["deep"]?.next).toBe(1);
    expect(deepSaves[0]?.done).not.toContain("deep");
    expect(deepSaves[1]?.slices?.["deep"]?.next).toBe(2);
    expect(deepSaves[1]?.done).not.toContain("deep");
    // Adım bitince `done`e girer (sonraki adıma geçilebilir).
    expect(deepSaves.at(-1)?.done).toContain("deep");
  });

  it("HER teslimat kendi DİLİM bütçesiyle sınırlıdır (10 sn)", async () => {
    const observed: number[] = [];
    stepsMock.executeProductDiscoveryStep.mockImplementation(async (args: ExecArgs) => {
      observed.push((args.sliceDeadlineAt ?? 0) - Date.now());
      if (args.step === "deep" && (args.slice ?? 0) === 0) {
        return {
          ok: true,
          step: "deep",
          status: "deep_analysis",
          progress: 85,
          products: args.batch,
          consensus: [],
          partial: true,
          sliceState: { done: ["cfo"], scores: {} },
          sliceRemaining: 13,
          notes: [],
        };
      }
      return {
        ok: true,
        step: args.step,
        status: args.step === "final" ? "completed" : "deep_analysis",
        progress: 90,
        products: args.batch,
        consensus: [{ candidateId: "fp-1", councilScore: 80 }],
        notes: [],
      };
    });

    await runDiscoveryChain({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      budgetMs: 60_000,
    });

    expect(observed.length).toBeGreaterThan(0);
    for (const budget of observed) {
      expect(budget).toBeLessThanOrEqual(discoverySliceMs());
    }
  });

  it("yarım kalan dilim ara noktada KALIR, sıradaki dilim oradan devam eder", async () => {
    jobsMock.readDiscoveryCheckpoint.mockResolvedValue({
      v: 1,
      done: ["scrape_filter", "gemini"],
      shortlist: [product(1)],
      votes: [],
      slices: { deep: { next: 3, partial: { done: ["role-0"] } } },
    });
    const seen: ExecArgs[] = [];
    const forced: boolean[] = [];
    stepsMock.executeProductDiscoveryStep.mockImplementation(async (args: ExecArgs) => {
      seen.push(args);
      const force = (
        stepsMock.executeProductDiscoveryStep.mock.calls.at(-1)?.[0] as
          { forceFinish?: boolean } | undefined
      )?.forceFinish;
      forced.push(force === true);
      // `final` adımı bu testin konusu değil: doğrudan biter.
      if (args.step !== "deep") {
        return {
          ok: true,
          step: args.step,
          status: "completed",
          progress: 100,
          products: args.batch,
          consensus: [],
          topProducts: [{ id: "fp-1", title: "Ürün 1", final_score: 80, selection_reason: "x" }],
          notes: [],
        };
      }
      // Son dilim ZORLA bitirilir: adımlar bu sözleşmeye uyar.
      if (force) {
        return {
          ok: true,
          step: "deep",
          status: "deep_analysis",
          progress: 90,
          products: args.batch,
          consensus: [{ candidateId: "fp-1", councilScore: 80 }],
          notes: [],
        };
      }
      return {
        ok: true,
        step: "deep",
        status: "deep_analysis",
        progress: 85,
        products: args.batch,
        consensus: [],
        partial: true,
        sliceState: { done: ["role-0", `role-${args.slice}`], scores: {} },
        sliceRemaining: 10,
        notes: [],
      };
    });

    const outcome = await runDiscoveryChain({
      runId: "run-1",
      userId: "user-1",
      input: INPUT,
      // Birkaç dilimlik bütçe: ilk dilimler kısmi kalır, son dilim zorla biter.
      budgetMs: 25_000,
    });

    // İlk dilim kısmi durumu TAŞIR: "role-0" önceki dilimden gelir.
    expect(seen[0]?.slice).toBe(3);
    expect(seen[0]?.sliceState).toEqual({ done: ["role-0"] });

    // Ara noktada ilerleme kaydedildi ve adım HENÜZ `done`e yazılmadı.
    const partialSave = jobsMock.saveDiscoveryCheckpoint.mock.calls
      .map((call) => call[1] as { done: string[]; slices: Record<string, { next: number }> })
      .find((saved) => saved.slices["deep"]?.next === 4);
    expect(partialSave?.done).not.toContain("deep");

    // Uzun bir adımda sonunda zorla bitirme devreye girer (sonsuz dilim yok).
    expect(forced.some(Boolean)).toBe(true);
    expect(outcome.completed).toBe(true);
  });
});
