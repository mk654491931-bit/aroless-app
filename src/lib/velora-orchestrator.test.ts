// VELORA 14 AJAN ORKESTRATÖRÜ — faz dilimleme, 8 sn tavanı, temp state, push ve self-test.
//
// Bu testler Vercel Free Tier sözleşmesini sabitler:
//  1. 14 ajanın tamamı 4 faza eksiksiz dağıtılır (boşluksuz/çakışmasız),
//  2. her faz KENDİ adımında koşar ve 8 sn tavanını ASLA aşamaz (asılı üye nötr döner),
//  3. durum adımlar arasında geçici kovada (temp state) taşınır ve QStash devri
//     sonraki fazı yayınlayıp anında döner,
//  4. sonuç veritabanına push edilir ve OTOMATİK SELF-TEST kaydı geri okuyup doğrular.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAgentWithFallback: vi.fn(),
  collectSignals: vi.fn(),
  signalsBlock: vi.fn(),
  buildLiveEvidenceBlock: vi.fn(),
}));

vi.mock("./ai-router.server", () => ({
  DEEP_CHAIN: ["gemini"],
  executeAgentWithFallback: mocks.executeAgentWithFallback,
  parseAgentJson: (text: string, fallback: unknown) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  },
}));

vi.mock("./data-pipeline.server", () => ({
  collectSignals: mocks.collectSignals,
  signalsBlock: mocks.signalsBlock,
}));

vi.mock("./market-verify.server", () => ({
  buildLiveEvidenceBlock: mocks.buildLiveEvidenceBlock,
}));

vi.mock("./discovery-jobs.server", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  qstashConfigured: () => false,
  qstashFanOut: vi.fn(),
}));

import { COUNCIL_AGENTS } from "./council-chain.server";
import {
  VELORA_PHASES,
  VELORA_PHASE_CEILING_MS,
  buildWinnerDossier,
  councilAverageOf,
  plannedAgentCount,
  resumeVeloraRun,
  runVeloraPhase,
  selfTestVeloraRun,
  startVeloraRun,
  veloraAnalysisScore,
  winnerRows,
  formatVeloraSelfTestReport,
  phaseById,
  type VeloraRunState,
  type VeloraStore,
} from "./velora-orchestrator.server";

const RADAR = ["TikTok: mini ice maker", "Yandex: kompakt buz makinesi"];
const RADAR_BLOCK = `TREND RADAR: ${RADAR.join(" | ")}`;
const LIVE_BLOCK = "LIVE MARKET: AliExpress supplier $4.20 | Google Trends momentum +12%";

type PromptCall = { agentName: string; prompt: string };
let prompts: PromptCall[] = [];

function signalsFixture() {
  return {
    data: {
      keyword: "mini ice maker",
      country: "US",
      trends: { yearly: [], monthly: [], momentum_pct: 12, source: "google" },
      reddit: [],
      tiktok: ["mini ice maker"],
      amazon: [],
      google_rising: [],
      radar: RADAR,
      github: [],
      sources: [{ name: "Google Trends", status: "active" as const, items: 12 }],
      collected_at: new Date().toISOString(),
    },
    cache_hit: false,
  };
}

function agentLog(agentName: string) {
  return { agent: agentName, provider: "gemini", attempts: 1, latencyMs: 3, ok: true };
}

/** Sahte AI: retriever gerçek ürün adı döner, her üye kendi `scoreKey`ine 90 verir. */
function stubRunner(options: { retrieverText?: string; hanging?: Set<string> } = {}) {
  return (agentName: string, prompt: string) => {
    prompts.push({ agentName, prompt });
    if (options.hanging?.has(agentName)) return new Promise<never>(() => {});
    if (agentName === "Product Retriever") {
      return Promise.resolve({
        text: options.retrieverText ?? JSON.stringify({ candidates: [{ name: "Mini Ice Maker XR-500", category: "Kitchen" }] }),
        log: agentLog(agentName),
      });
    }
    const scoreKey = COUNCIL_AGENTS.find((a) => a.name === agentName)?.scoreKey;
    return Promise.resolve({ text: scoreKey ? JSON.stringify({ [scoreKey]: 90 }) : "{}", log: agentLog(agentName) });
  };
}

type FakeStore = VeloraStore & { states: Map<string, VeloraRunState>; rows: Record<string, unknown>[] };

function fakeStore(): FakeStore {
  const states = new Map<string, VeloraRunState>();
  const rows: Record<string, unknown>[] = [];
  return {
    states,
    rows,
    async saveState(state) {
      states.set(state.runId, JSON.parse(JSON.stringify(state)) as VeloraRunState);
    },
    async loadState(runId) {
      return states.get(runId) ?? null;
    },
    async pushWinners(winnerRowsInput) {
      rows.push(...(winnerRowsInput as unknown as Record<string, unknown>[]));
      return { ok: true, ids: rows.map((_, i) => `row-${i + 1}`) };
    },
    async fetchWinners(day, titles) {
      return rows.filter(
        (row) => row["day"] === day && titles.includes(String(row["title"])),
      ) as never;
    },
  };
}

const runAgentStub = (runner: ReturnType<typeof stubRunner>) =>
  runner as unknown as typeof import("./ai-router.server").executeAgentWithFallback;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  prompts = [];
  mocks.collectSignals.mockResolvedValue(signalsFixture());
  mocks.signalsBlock.mockReturnValue(RADAR_BLOCK);
  mocks.buildLiveEvidenceBlock.mockResolvedValue(LIVE_BLOCK);
  mocks.executeAgentWithFallback.mockImplementation(stubRunner());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("faz planı (14 ajan → 4 faz)", () => {
  it("14 ajanın TAMAMINI boşluksuz ve çakışmasız dağıtır", () => {
    expect(plannedAgentCount()).toBe(14);
    expect(plannedAgentCount()).toBe(COUNCIL_AGENTS.length);
    const flat = VELORA_PHASES.flatMap((p) => p.agents);
    expect(flat).toHaveLength(14);
    expect(new Set(flat).size).toBe(14);
    expect([...flat].sort()).toEqual([...COUNCIL_AGENTS.map((a) => a.key)].sort());
  });

  it("her fazın bir kimliği ve adı vardır; bilinmeyen faz kimliği hata verir", () => {
    expect(VELORA_PHASES.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(phaseById(2).key).toBe("economics");
    expect(() => phaseById(9 as 1)).toThrow(/UNKNOWN_VELORA_PHASE/);
  });

  it("tavan ücretsiz plan fonksiyon limitinin çok altındadır", () => {
    expect(VELORA_PHASE_CEILING_MS).toBeLessThanOrEqual(8_000);
    // Toplam istek-içi koşu yolu (4 faz) dar limitlerde bile 504 üretmez.
    expect(VELORA_PHASE_CEILING_MS * VELORA_PHASES.length).toBeLessThanOrEqual(32_000);
  });
});

describe("runVeloraPhase (izole ve zaman dilimli adım)", () => {
  it("fazın üyelerini koşar ve ortak kanıtı hepsine verir", async () => {
    const state: VeloraRunState = {
      runId: "r1",
      query: "mini ice maker",
      country: "US",
      platform: "Amazon",
      language: "tr",
      startedAtMs: Date.now(),
      status: "running",
      evidenceBlock: RADAR_BLOCK,
      scrapedTrends: RADAR,
      live: true,
      candidates: [],
      phases: [],
    };
    const result = await runVeloraPhase(phaseById(1), state, {
      store: fakeStore(),
      runAgent: runAgentStub(stubRunner()),
    });

    expect(result.agents).toHaveLength(4);
    expect(result.withinCeiling).toBe(true);
    expect(result.agents.every((a) => a.ok && a.score === 90)).toBe(true);
    expect(prompts).toHaveLength(4);
    expect(prompts.every((p) => p.prompt.includes("TREND RADAR"))).toBe(true);
    expect(prompts.every((p) => p.prompt.includes("PHASE 1/4"))).toBe(true);
  });

  it("tavanı AŞMAZ: asılı üye nötr/timeout döner, faz yine biter", async () => {
    const state: VeloraRunState = {
      runId: "r2",
      query: "mini ice maker",
      country: "US",
      platform: "Amazon",
      language: "tr",
      startedAtMs: Date.now(),
      status: "running",
      evidenceBlock: "",
      scrapedTrends: [],
      live: false,
      candidates: [],
      phases: [],
    };
    const hanging = new Set([COUNCIL_AGENTS.find((a) => a.key === "trend_hunter")!.name]);
    const started = Date.now();
    const result = await runVeloraPhase(phaseById(1), state, {
      store: fakeStore(),
      runAgent: runAgentStub(stubRunner({ hanging })),
      phaseCeilingMs: 150,
    });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.withinCeiling).toBe(true);
    const timedOut = result.agents.filter((a) => a.timedOut);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]!.score).toBe(50);
    expect(timedOut[0]!.ok).toBe(false);
    // Diğer üyeler tavan yüzünden kaybolmadı.
    expect(result.agents.filter((a) => a.ok)).toHaveLength(3);
  });
});

describe("startVeloraRun (uçtan uca orkestre koşu)", () => {
  it("14 ajanı 4 fazda koşar, temp state yazar, kazananı push eder ve self-test PASS verir", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US", platform: "Amazon" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    expect(result.status).toBe("completed");
    expect(result.completedPhases).toBe(4);

    // 14 ajan fiilen koştu.
    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(councilCalls).toHaveLength(14);
    expect(new Set(councilCalls.map((c) => c.agentName)).size).toBe(14);

    // Temp state her fazdan sonra yazıldı; adımlar stateless (runId ile taşınır).
    const saved = store.states.get(result.runId!)!;
    expect(saved.phases.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(saved.phases.every((p) => p.withinCeiling)).toBe(true);

    // Ortak karar = analiz hattı ⊕ 14'lü konsey; hepsi 90 verdi.
    expect(result.dossier!.council_average).toBe(90);
    expect(result.dossier!.joint_score).toBeGreaterThan(0);
    expect(result.dossier!.products[0]!.name).toBe("Mini Ice Maker XR-500");
    expect(result.dossier!.products[0]!.source).toBe("ai");
    expect(result.dossier!.products[0]!.rank).toBe(1);

    // PUSH: kazanan satırları veritabanına yazıldı.
    expect(result.push!.ok).toBe(true);
    expect(store.rows.length).toBe(result.dossier!.products.length);
    expect(store.rows[0]!["title"]).toBe("Mini Ice Maker XR-500");

    // OTOMATİK SELF-TEST: kayıt geri okundu, alan bütünlüğü tam.
    expect(result.selfTest!.verdict).toBe("PASS");
    expect(result.selfTest!.status).toBe("SUCCESS");
    expect(result.selfTest!.dbFetchVerified).toBe(true);
    expect(result.selfTest!.payloadIntegrity).toBe(true);
    expect(result.selfTest!.agentsLogged).toBe(14);
    expect(result.selfTest!.pushResult.recordIds.length).toBeGreaterThan(0);
    expect(result.selfTest!.performance.every((p) => p.withinCeiling)).toBe(true);

    const report = formatVeloraSelfTestReport(result.selfTest!, result.runId!);
    expect(report).toContain("[STATUS]: SUCCESS");
    expect(report).toContain("[PUSH RESULT]:");
    expect(report).toContain("[PERFORMANCE]:");
    expect(report).toContain("[TEST PASS]:");
  });

  it("QStash devri varsa faz 1'den sonra ANINDA döner ve sonraki fazı yayınlar", async () => {
    const store = fakeStore();
    const handoffCalls: number[] = [];
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      {
        store,
        runAgent: runAgentStub(stubRunner()),
        handoff: async ({ phase }) => {
          handoffCalls.push(phase);
          return { ok: true, mode: "qstash", messageId: "msg-1" };
        },
      },
    );

    expect(result.status).toBe("dispatched");
    expect(result.completedPhases).toBe(1);
    expect(result.nextPhase).toBe(2);
    expect(result.dispatch).toEqual({ ok: true, mode: "qstash", messageId: "msg-1" });
    expect(handoffCalls).toEqual([2]);
    // Yalnızca Faz 1 koştu: adım gerçekten mikro.
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(4);
  });

  it("QStash geri çağrısı kaydedilmiş durumu yükleyip kalan fazları tamamlar", async () => {
    const store = fakeStore();
    const handoff = async ({ phase }: { phase: number }) =>
      ({ ok: true, mode: "qstash" as const, messageId: `msg-${phase}` });
    const started = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()), handoff },
    );

    const second = await resumeVeloraRun(started.runId!, 2, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff,
    });
    expect(second.status).toBe("dispatched");
    expect(second.completedPhases).toBe(2);

    const third = await resumeVeloraRun(started.runId!, 3, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff,
    });
    expect(third.completedPhases).toBe(3);

    const fourth = await resumeVeloraRun(started.runId!, 4, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff,
    });
    expect(fourth.status).toBe("completed");
    expect(fourth.dossier!.phases.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(fourth.selfTest!.verdict).toBe("PASS");
  });

  it("bilinmeyen runId için temiz hata döner (çökmez)", async () => {
    const result = await resumeVeloraRun("yok", 2, { store: fakeStore() });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("RUN_STATE_NOT_FOUND");
  });

  it("ortak kanıt tamamen düşse bile hat tamamlanır ve dürüstçe raporlar", async () => {
    mocks.collectSignals.mockRejectedValue(new Error("scrape down"));
    mocks.buildLiveEvidenceBlock.mockRejectedValue(new Error("live down"));

    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    expect(result.status).toBe("completed");
    expect(result.dossier!.evidence.scraped_trends).toBe(0);
    expect(result.dossier!.evidence.live).toBe(false);
    expect(result.selfTest!.agentsLogged).toBe(14);
    // Kanıt yokken retriever'ın adlandırdığı gerçek ürün yine kazanan olur.
    expect(result.dossier!.products[0]!.name).toBe("Mini Ice Maker XR-500");
    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(councilCalls.every((c) => c.prompt.includes("none available for this run"))).toBe(true);
  });
});

describe("self-test (push doğrulaması)", () => {
  it("veritabanı satırları eksikse FAIL verir ve nedenini yazar", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );
    // Kaydı yazılmamış gibi davran: geri okuma boş döner.
    store.rows.length = 0;
    const report = await selfTestVeloraRun(store.states.get(result.runId!)!, {
      store,
      dossier: result.dossier!,
      push: result.push!,
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.dbFetchVerified).toBe(false);
    expect(report.notes).toContain("DB_FETCH_MISSING_ROWS");
  });

  it("push başarısızsa FAIL verir ve hata notunu taşır", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );
    const report = await selfTestVeloraRun(store.states.get(result.runId!)!, {
      store,
      dossier: result.dossier!,
      push: { ok: false, ids: [], error: "RLS_DENIED" },
    });

    expect(report.status).toBe("FAILED");
    expect(report.verdict).toBe("FAIL");
    expect(report.notes.some((n) => n.startsWith("PUSH_FAILED"))).toBe(true);
  });
});

describe("kazanan karne (dossier) ve DTO", () => {
  it("ortak kararı analiz ⊕ konsey formülüne bağlar ve ürünleri puana göre dizer", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );
    const state = store.states.get(result.runId!)!;
    const dossier = buildWinnerDossier(state);

    expect(dossier.council_average).toBe(councilAverageOf(state.phases));
    expect(dossier.analysis_score).toBe(veloraAnalysisScore(state));
    const scores = dossier.products.map((p) => p.winnerScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(dossier.products.map((p) => p.rank)).toEqual(dossier.products.map((_, i) => i + 1));
    expect(dossier.phases.every((p) => p.agents > 0)).toBe(true);
  });

  it("DTO'dan veritabanı satırı üretir ve fiyat bandını ayrıştırır", () => {
    const rows = winnerRows({
      run_id: "r1",
      query: "mini ice maker",
      country: "US",
      platform: "Amazon",
      generated_at: "2026-09-23T10:00:00.000Z",
      council_average: 80,
      analysis_score: 90,
      joint_score: 85,
      joint_source: "joint",
      listed: true,
      evidence: { live: true, scraped_trends: 2, radar: RADAR },
      phases: [],
      products: [
        {
          name: "Mini Ice Maker XR-500",
          category: "Kitchen",
          priceRange: "$29.99 - $49.00",
          estimatedMarginPct: 55,
          demandScore: 88,
          competitionScore: 25,
          sentiment: "positive",
          whyNow: "rising demand",
          risks: [],
          councilScore: 85,
          councilDecision: "LISTED",
          winnerScore: 84,
          rank: 1,
          source: "ai",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.day).toBe("2026-09-23");
    expect(rows[0]!.price_min).toBe(29.99);
    expect(rows[0]!.price_max).toBe(49);
    expect(rows[0]!.winner_score).toBe(84);
    expect(rows[0]!.niche).toBe("mini ice maker");
    expect((rows[0]!.payload as Record<string, unknown>)["joint_score"]).toBe(85);
  });
});
