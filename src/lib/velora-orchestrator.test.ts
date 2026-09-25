// VELORA 14 AJAN ORKESTRATÖRÜ — faz dilimleme, 8 sn tavanı, ürün başına konsey,
// iki hattın kesişimi, QStash tekrar teslimi ve panel yoklaması.
//
// Bu testler Vercel Free Tier sözleşmesini sabitler:
//  1. 14 ajanın tamamı 4 faza eksiksiz dağıtılır (boşluksuz/çakışmasız),
//  2. her faz KENDİ adımında koşar ve 8 sn tavanını ASLA aşamaz (asılı üye nötr döner),
//  3. durum adımlar arasında geçici kovada (temp state) taşınır ve QStash devri
//     sonraki fazı yayınlayıp anında döner,
//  4. AYNI fazın tekrar teslimi idempotenttir: kayıtlı faz yeniden koşmaz,
//     hâlâ koşan faz ikinci kez başlatılmaz → çift AI harcaması olmaz,
//  5. nihai karar İKİ BAĞIMSIZ HATTIN ağırlıklı birleşimidir (14 ajan %70 ⊕
//     analiz %30) ve her hat kendi ilk 5'ini bağımsız bulur; eksik sıra DOLDURULMAZ,
//  6. sonuç veritabanına push edilir, OTOMATİK SELF-TEST kaydı geri okuyup
//     doğrular ve panel `runId` ile koşu durumunu yoklayabilir.
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
import { combineJointScores } from "./consensus-types";
import {
  VELORA_PHASES,
  VELORA_PHASE_CEILING_MS,
  VELORA_PIPELINE_TOP_N,
  VELORA_TOP_N,
  buildWinnerDossier,
  councilAverageOf,
  plannedAgentCount,
  resumeVeloraRun,
  runVeloraPhase,
  selfTestVeloraRun,
  startVeloraRun,
  veloraAnalysisScore,
  veloraRunStatus,
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

/** Bir fazın üyelerinin EKRAN adları (test stub'ı isimle eşleştirir). */
function agentNamesOf(phaseId: 1 | 2 | 3 | 4): string[] {
  return phaseById(phaseId).agents.map(
    (key) => COUNCIL_AGENTS.find((agent) => agent.key === key)!.name,
  );
}

type StubOptions = {
  retrieverText?: string;
  hanging?: Set<string>;
  /** Ürün başına verilecek puanlar. Verilirse YALNIZCA listelenen ürünler oylanır. */
  votes?: Record<string, number>;
  /** Ajanlar hiç `product_scores` döndürmez (ürün başına oy yok senaryosu). */
  omitVotes?: boolean;
};

/**
 * Sahte AI:
 *  - retriever gerçek ürün adı döner,
 *  - her üye kendi `scoreKey`ine 90 verir ve istemde gördüğü finalist kimlikleri
 *    için `product_scores` üretir (ürün başına konsey bu diziden kurulur).
 */
function stubRunner(options: StubOptions = {}) {
  return (agentName: string, prompt: string) => {
    prompts.push({ agentName, prompt });
    if (options.hanging?.has(agentName)) return new Promise<never>(() => {});
    if (agentName === "Product Retriever") {
      return Promise.resolve({
        text:
          options.retrieverText ??
          JSON.stringify({ candidates: [{ name: "Mini Ice Maker XR-500", category: "Kitchen" }] }),
        log: agentLog(agentName),
      });
    }
    const scoreKey = COUNCIL_AGENTS.find((a) => a.name === agentName)?.scoreKey;
    const body: Record<string, unknown> = scoreKey ? { [scoreKey]: 90 } : {};
    if (!options.omitVotes) {
      const ids = [...new Set(prompt.match(/\bC\d+\b/g) ?? [])];
      const scored = options.votes
        ? ids.filter((id) => options.votes?.[id] !== undefined)
        : ids;
      body["product_scores"] = scored.map((id) => ({
        id,
        score: options.votes?.[id] ?? 90,
        note: `kanıt: ${id} canlı piyasa`,
      }));
    }
    return Promise.resolve({ text: JSON.stringify(body), log: agentLog(agentName) });
  };
}

type FakeStore = VeloraStore & { states: Map<string, VeloraRunState>; rows: Record<string, unknown>[] };

function fakeStore(): FakeStore {
  const states = new Map<string, VeloraRunState>();
  const rows: Record<string, unknown>[] = [];
  const payloadOf = (row: Record<string, unknown>) =>
    (row["payload"] ?? null) as Record<string, unknown> | null;
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
    async fetchRunWinners(runId) {
      return rows.filter((row) => payloadOf(row)?.["run_id"] === runId) as never;
    },
  };
}

const runAgentStub = (runner: ReturnType<typeof stubRunner>) =>
  runner as unknown as typeof import("./ai-router.server").executeAgentWithFallback;

/** Testlerde elle kurulan koşu durumu — yeni alanlar varsayılanlarıyla gelir. */
function baseState(overrides: Partial<VeloraRunState> = {}): VeloraRunState {
  return {
    runId: "r1",
    query: "mini ice maker",
    country: "US",
    platform: "Amazon",
    language: "tr",
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    status: "running",
    evidenceByLine: {
      analysis: { block: RADAR_BLOCK, radar: RADAR, live: true },
      council: { block: RADAR_BLOCK, radar: RADAR, live: true },
    },
    evidenceBlock: RADAR_BLOCK,
    scrapedTrends: RADAR,
    live: true,
    candidates: [],
    analysisLine: [],
    phases: [],
    runningPhase: null,
    push: null,
    selfTest: null,
    ...overrides,
  };
}

const handoffStub = async ({ phase }: { phase: number }) => ({
  ok: true,
  mode: "qstash" as const,
  messageId: `msg-${phase}`,
});

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
    expect(phaseById(2).key).toBe("quality-gate");
    expect(() => phaseById(9 as 1)).toThrow(/UNKNOWN_VELORA_PHASE/);
  });

  it("tavan ücretsiz plan fonksiyon limitinin çok altındadır", () => {
    expect(VELORA_PHASE_CEILING_MS).toBeLessThanOrEqual(8_000);
    // Toplam istek-içi koşu yolu (4 faz) dar limitlerde bile 504 üretmez.
    expect(VELORA_PHASE_CEILING_MS * VELORA_PHASES.length).toBeLessThanOrEqual(32_000);
    // Ağırlıklı birleşimden en iyi 3 istenir; her bağımsız hat daha geniş bir
    // ilk 5 çıkarır ki gerçek ortak ürünler elenmesin.
    expect(VELORA_TOP_N).toBe(3);
    expect(VELORA_PIPELINE_TOP_N).toBeGreaterThan(VELORA_TOP_N);
  });
});

describe("iki hat ayrı Trend Radar kazımalarını kullanır (paralel, bağımsız)", () => {
  it("kanıt kazımadan gelir ve HEM analiz hattına HEM 14 üyenin tamamına verilir", async () => {
    const store = fakeStore();
    await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    // Kanıt Trend Radar kazıma hattından gelir (`collectSignals` → `runScrapeJob`),
    // Her hat kendi scraping snapshot'ını çeker: iki bağımsız kaynak taraması
    // paralel başlar, sonuçlar yalnız karar katmanında birleştirilir.
    expect(mocks.collectSignals).toHaveBeenCalledTimes(2);
    expect(mocks.collectSignals).toHaveBeenCalledWith("mini ice maker", "US", "General");
    // Canlı piyasa kanıtı da aynı anda (paralel) çekildi.
    expect(mocks.buildLiveEvidenceBlock).toHaveBeenCalledTimes(2);

    // 14 üyenin HEPSİ kazınan bloğu gördü.
    const council = prompts.filter(
      (p) => p.agentName !== "Product Retriever" && p.agentName !== "Analysis Line",
    );
    expect(council).toHaveLength(14);
    expect(council.every((p) => p.prompt.includes(RADAR[0]!))).toBe(true);

    // Analiz hattı (Product Retriever) da AYNI kazınmış kanıtı gördü — iki hat
    // birbirinden bağımsız karar verir ama aynı gerçekliğe bakar.
    const retriever = prompts.find((p) => p.agentName === "Product Retriever");
    expect(retriever).toBeDefined();
    expect(retriever!.prompt).toContain(RADAR[0]!);
    expect(retriever!.prompt).toContain("ANALYSIS-LINE SCRAPING EVIDENCE");
  });
});

describe("HAT A — bağımsız AI analiz hattı, 14 ajanla PARALEL koşar", () => {
  it("analiz turu ajanlar koşarken puan üretir ve ağırlıklı birleşime girer", async () => {
    const store = fakeStore();
    let councilStarted = false;
    let openGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    // Analiz turu, bir konsey üyesi koşmaya BAŞLAYANA kadar bekler. İki hat
    // paralel değilse (ajanlar bitmeden analiz başlamıyorsa) bu söz asla
    // çözülmez ve puan `heuristic` olarak kalır → test kırılır.
    const runner = (agentName: string, prompt: string) => {
      prompts.push({ agentName, prompt });
      if (agentName === "Product Retriever") {
        return Promise.resolve({
          text: JSON.stringify({
            candidates: [{ name: "Mini Ice Maker XR-500", category: "Kitchen" }],
          }),
          log: agentLog(agentName),
        });
      }
      if (agentName === "Analysis Line") {
        return (async () => {
          await Promise.race([gate, new Promise((r) => setTimeout(r, 2_000))]);
          return {
            text: JSON.stringify({ scores: [{ id: "C1", score: 88, reason: "canlı kanıt güçlü" }] }),
            log: agentLog(agentName),
          };
        })();
      }
      if (!councilStarted) {
        councilStarted = true;
        openGate?.();
      }
      const scoreKey = COUNCIL_AGENTS.find((a) => a.name === agentName)?.scoreKey;
      const body: Record<string, unknown> = scoreKey ? { [scoreKey]: 90 } : {};
      const ids = [...new Set(prompt.match(/\bC\d+\b/g) ?? [])];
      body["product_scores"] = ids.map((id) => ({ id, score: 90, note: `kanıt: ${id}` }));
      return Promise.resolve({ text: JSON.stringify(body), log: agentLog(agentName) });
    };

    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runner as never },
    );
    const state = store.states.get(result.runId!)!;

    // Analiz hattı KENDİ AI turunun puanını yazdı (formül değil).
    const lineEntry = state.analysisLine.find((row) => row.candidateId === "C1")!;
    expect(lineEntry).toMatchObject({ score: 88, source: "ai" });
    // Puanı olmayan adaylar için dürüstçe formül moduna düşer.
    expect(
      state.analysisLine.filter((row) => row.candidateId !== "C1").every((r) => r.source === "heuristic"),
    ).toBe(true);
    // Analiz turu finalistleri GÖRDÜ (bağımsız puanlama, ajan oyuna bakmaz).
    const analysisPrompt = prompts.find((p) => p.agentName === "Analysis Line")!;
    expect(analysisPrompt.prompt).toContain("C1");
    expect(analysisPrompt.prompt).toContain("INDEPENDENT AI ANALYSIS LINE");
    // Karne bu puanı kullanır: %30'luk hat gerçek AI yorumuna bağlandı.
    const product = result.dossier!.products.find((p) => p.name === "Mini Ice Maker XR-500")!;
    expect(product.analysisScore).toBe(88);
  });

  it("analiz turu çökerse deterministik formüle düşer, koşu yine tamamlanır", async () => {
    const store = fakeStore();
    const runner = (agentName: string, prompt: string) => {
      prompts.push({ agentName, prompt });
      if (agentName === "Product Retriever") {
        return Promise.resolve({
          text: JSON.stringify({
            candidates: [{ name: "Mini Ice Maker XR-500", category: "Kitchen", demandScore: 80 }],
          }),
          log: agentLog(agentName),
        });
      }
      if (agentName === "Analysis Line") return Promise.reject(new Error("PROVIDER_DOWN"));
      const body: Record<string, unknown> = { score: 90 };
      const ids = [...new Set(prompt.match(/\bC\d+\b/g) ?? [])];
      body["product_scores"] = ids.map((id) => ({ id, score: 90, note: `kanıt: ${id}` }));
      return Promise.resolve({ text: JSON.stringify(body), log: agentLog(agentName) });
    };

    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runner as never },
    );
    const state = store.states.get(result.runId!)!;

    expect(state.analysisLine.length).toBeGreaterThan(0);
    expect(state.analysisLine.every((row) => row.source === "heuristic")).toBe(true);
    expect(state.analysisLine.every((row) => Number.isFinite(row.score))).toBe(true);
    expect(result.status).toBe("completed");
  });
});

describe("runVeloraPhase (izole ve zaman dilimli adım)", () => {
  it("fazın üyelerini koşar ve ortak kanıtı hepsine verir", async () => {
    const state = baseState();
    const result = await runVeloraPhase(phaseById(1), state, {
      store: fakeStore(),
      runAgent: runAgentStub(stubRunner()),
    });

    expect(result.agents).toHaveLength(14);
    expect(result.withinCeiling).toBe(true);
    expect(result.agents.every((a) => a.ok && a.score === 90)).toBe(true);
    expect(prompts).toHaveLength(14);
    expect(prompts.every((p) => p.prompt.includes("TREND RADAR"))).toBe(true);
    expect(prompts.every((p) => p.prompt.includes("PHASE 1/4"))).toBe(true);
  });

  it("tavanı AŞMAZ: asılı üye nötr/timeout döner, faz yine biter", async () => {
    const state = baseState({ runId: "r2", evidenceBlock: "", scrapedTrends: [], live: false });
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
    expect(result.agents.filter((a) => a.ok)).toHaveLength(13);
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
    expect(saved.status).toBe("completed");
    expect(saved.runningPhase).toBeNull();

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
    // Yalnızca Faz 1 koştu: 14 ajanın tamamı tek burst içinde paralel başlar.
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(14);
    // Faz 1'den sonra durum "running" ve sıradaki faz kaydedilmemiş.
    expect(store.states.get(result.runId!)!.phases.map((p) => p.id)).toEqual([1]);
  });

  it("QStash geri çağrısı kaydedilmiş durumu yükleyip kalan fazları tamamlar", async () => {
    const store = fakeStore();
    const started = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub },
    );

    const second = await resumeVeloraRun(started.runId!, 2, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(second.status).toBe("dispatched");
    expect(second.completedPhases).toBe(2);

    const third = await resumeVeloraRun(started.runId!, 3, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(third.completedPhases).toBe(3);

    const fourth = await resumeVeloraRun(started.runId!, 4, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
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
    expect(result.dossier!.notes).toContain("LIVE_EVIDENCE_UNAVAILABLE");
    // Kanıt yokken retriever'ın adlandırdığı gerçek ürün yine kazanır.
    expect(result.dossier!.products[0]!.name).toBe("Mini Ice Maker XR-500");
    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(councilCalls.every((c) => c.prompt.includes("independent scrape returned no data"))).toBe(true);
  });

  it("14 ajanın HEPSİ finalist listesini görür ve ürün başına puan istenir", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(councilCalls).toHaveLength(14);
    expect(councilCalls.every((c) => c.prompt.includes("FINALIST PRODUCTS"))).toBe(true);
    expect(councilCalls.every((c) => c.prompt.includes("product_scores"))).toBe(true);
    expect(councilCalls.every((c) => /C1\./.test(c.prompt))).toBe(true);
    // Adaylar sabit kimlik taşır: iki hattın eşleştirme anahtarı budur.
    const saved = store.states.get(result.runId!)!;
    expect(saved.candidates.map((c) => c["candidateId"])).toEqual(["C1", "C2", "C3"]);
  });
});

describe("ürün başına ajan konsensüsü (run geneli ortalama kopyalanmaz)", () => {
  it("her ürün KENDİ oylarıyla puanlanır ve ürün başına ortak karar hesaplanır", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner({ votes: { C1: 90, C2: 60, C3: 30 } })) },
    );

    const products = result.dossier!.products;
    expect(products).toHaveLength(3);
    expect(products.map((p) => p.councilScore).sort((a, b) => a - b)).toEqual([30, 60, 90]);
    expect(new Set(products.map((p) => p.councilScore)).size).toBe(3);
    // Run geneli ortalama tek bir sayıdır ve ürünlere KOPYALANMAZ: üç farklı ürünün
    // konsey puanı üç farklı değerdir (hepsi aynı ortalamaya sabitlenmez).
    expect(result.dossier!.council_average).toBe(90);
    expect(new Set(products.map((p) => p.councilScore)).size).toBeGreaterThan(1);

    for (const product of products) {
      expect(product.councilVotes).toBe(14);
      expect(product.councilCoverage).toBe(1);
      const expected = combineJointScores({
        analysisScore: product.analysisScore,
        councilScore: product.councilScore,
      });
      expect(product.winnerScore).toBe(expected.score);
      expect((product.agentEvidence ?? []).length).toBeGreaterThan(0);
      // Canlı kanıt var + tüm ajanlar oy verdi → doğrulanmış.
      expect(product.verification).toBe("verified");
    }
  });

  it("canlı kanıt yoksa 'verified' DENMEZ: dürüst etiket 'unverified' kalır", async () => {
    mocks.buildLiveEvidenceBlock.mockResolvedValue("");

    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    expect(result.dossier!.evidence.live).toBe(false);
    expect(result.dossier!.notes).toContain("LIVE_EVIDENCE_UNAVAILABLE");
    expect(result.dossier!.products.every((p) => p.verification === "unverified")).toBe(true);
  });
});

describe("ortak karar: iki bağımsız hattın AĞIRLIKLI birleşimi", () => {
  it("her hat kendi ilk 5'ini bulur; %70 ajan ⊕ %30 analiz ağırlıklı ilk 3 çıkar", async () => {
    const store = fakeStore();
    // Ajanlar yalnızca C2 ve C3'ü puanlar → konsey hattının kendi ilk 5'i C2,C3.
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner({ votes: { C2: 88, C3: 70 } })) },
    );
    const dossier = result.dossier!;

    expect(dossier.rank_source).toBe("weighted");
    expect(dossier.products).toHaveLength(3);
    // C2 ve C3 iki hattın ilk 5'inde ortak; C1 yalnız analiz hattından gelir.
    expect(dossier.intersection_count).toBe(2);
    expect(dossier.requested_top).toBe(3);
    expect(dossier.finalists).toBe(3);
    expect(dossier.evaluated).toBe(2);
    // Ajan oyu olmayan ürün bile birleşimde korunur (sıra DOLDURULMAZ).
    expect(dossier.products.map((p) => p.name)).toContain("Mini Ice Maker XR-500");
    expect(dossier.products.map((p) => p.rank)).toEqual([1, 2, 3]);
    // Ağırlıklı puan gerçekten 14 ajan %70 ⊕ analiz %30 formülünden gelir.
    for (const product of dossier.products) {
      expect(product.winnerScore).toBe(
        combineJointScores({
          analysisScore: product.analysisScore,
          councilScore: product.councilScore,
        }).score,
      );
    }
  });

  it("ajan hiç ürün puanı vermezse kesişim İDDİA EDİLMEZ ve sonuç dürüstçe etiketlenir", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner({ omitVotes: true })) },
    );
    const dossier = result.dossier!;

    expect(dossier.rank_source).toBe("analysis-only");
    expect(dossier.intersection_count).toBe(0);
    expect(dossier.evaluated).toBe(0);
    expect(dossier.notes).toContain("AGENT_CONSENSUS_UNAVAILABLE");
    expect(dossier.products.every((p) => p.councilVotes === 0)).toBe(true);
    expect(dossier.products.every((p) => p.verification === "unknown")).toBe(true);
    // Yalnızca analiz hattı sıralaması raporlanır — uydurma kesişim yok.
    expect(dossier.products[0]!.name).toBe("Mini Ice Maker XR-500");
    expect(dossier.products.every((p) => (p.analysisScore ?? 0) > 0)).toBe(true);
  });

  it("KALİTE KAPISI: yedek/dolgu metinleri listeye almaz, yalnız gerçek ürünleri gösterir", async () => {
    const store = fakeStore();
    // Ajan hiç ürün puanı vermez VE retriever boş döner → havuz dolgu metinleriyle
    // dolar; kapı bunları eleyip uydurma sıra göstermemeli.
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner({ omitVotes: true, retrieverText: "{}" })) },
    );
    const dossier = result.dossier!;

    // Yedek (fallback) adaylar listeye girmedi: dönen her ürün ya model ürünü ya
    // da gerçek kazınmış trend adıdır.
    expect(dossier.products.every((p) => p.source !== "fallback")).toBe(true);
    // Eksik sıra DOLDURULMAZ: en fazla VELORA_TOP_N ve puanı barajın üstünde.
    expect(dossier.products.length).toBeLessThanOrEqual(VELORA_TOP_N);
    expect(dossier.products.every((p) => p.winnerScore >= 25)).toBe(true);
    expect(dossier.requested_top).toBe(VELORA_TOP_N);
  });

  it("kararı analiz hattı ⊕ ürün başına konsey formülüne bağlar ve ürünleri puana göre dizer", async () => {
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
    expect(dossier.phases.filter((p) => p.agents > 0)).toHaveLength(1);
  });
});

describe("QStash tekrar teslimi (idempotent faz yönetimi)", () => {
  it("kayıtlı faz YENİDEN koşmaz: aynı mesaj iki kez gelse de AI ikinci kez harcanmaz", async () => {
    const store = fakeStore();
    const deps = { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub };
    const started = await startVeloraRun({ userQuery: "mini ice maker", country: "US" }, deps);

    const phaseTwoNames = agentNamesOf(2);
    const countPhaseTwo = () => prompts.filter((p) => phaseTwoNames.includes(p.agentName)).length;
    expect(countPhaseTwo()).toBe(0);

    const first = await resumeVeloraRun(started.runId!, 2, deps);
    expect(first.completedPhases).toBe(2);
    expect(countPhaseTwo()).toBe(0);

    // AYNI faz İKİNCİ kez teslim edildi (QStash retry): faz yeniden koşmadı.
    const replay = await resumeVeloraRun(started.runId!, 2, deps);
    expect(countPhaseTwo()).toBe(0);
    expect(replay.completedPhases).toBe(3);
    // Faz kayıtları tekilleşti: 2 numaralı faz iki kez yazılmadı.
    const phases = store.states.get(started.runId!)!.phases.map((p) => p.id);
    expect(phases).toEqual([1, 2, 3]);
  });

  it("HÂLÂ koşan faz ikinci kez BAŞLATILMAZ (eşzamanlı teslim kilidi)", async () => {
    const store = fakeStore();
    const deps = { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub };
    const started = await startVeloraRun({ userQuery: "mini ice maker", country: "US" }, deps);

    const state = store.states.get(started.runId!)!;
    state.runningPhase = { id: 2, startedAtMs: Date.now() };
    await store.saveState(state);

    const result = await resumeVeloraRun(started.runId!, 2, deps);

    expect(result.deduped).toBe(true);
    expect(result.status).toBe("dispatched");
    expect(result.completedPhases).toBe(1);
    expect(prompts.filter((p) => agentNamesOf(2).includes(p.agentName))).toHaveLength(0);
  });

  it("tamamlanmış koşuya gelen tekrar teslim yeni iş üretmez, karneyi döner", async () => {
    const store = fakeStore();
    const deps = { store, runAgent: runAgentStub(stubRunner()) };
    const done = await startVeloraRun({ userQuery: "mini ice maker", country: "US" }, deps);

    const replay = await resumeVeloraRun(done.runId!, 4, deps);
    expect(replay.deduped).toBe(true);
    expect(replay.status).toBe("completed");
    expect(replay.dossier!.products.length).toBeGreaterThan(0);
    // Hiçbir ajan yeniden çağrılmadı (14 çağrı sabit kaldı).
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(14);
  });
});

describe("veloraRunStatus (panel yoklaması)", () => {
  it("bilinmeyen runId için 'unknown' döner (çökmez)", async () => {
    const status = await veloraRunStatus("yok-boyle-bir-kosu", { store: fakeStore() });
    expect(status.status).toBe("unknown");
    expect(status.completedPhases).toBe(0);
    expect(status.dossier).toBeNull();
    expect(status.notes).toContain("RUN_STATE_NOT_FOUND");
  });

  it("koşu sürerken ilerlemeyi, bitince karneyi yoklanabilir biçimde döner", async () => {
    const store = fakeStore();
    const deps = { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub };
    const started = await startVeloraRun({ userQuery: "mini ice maker", country: "US" }, deps);

    const middle = await veloraRunStatus(started.runId!, { store });
    expect(middle.status).toBe("running");
    expect(middle.completedPhases).toBe(1);
    expect(middle.nextPhase).toBe(2);
    expect(middle.activePhase).toBeNull();
    expect(middle.dossier).toBeNull();
    expect(middle.stale).toBe(false);
    expect(middle.pollIntervalMs).toBeGreaterThan(0);

    await resumeVeloraRun(started.runId!, 2, deps);
    await resumeVeloraRun(started.runId!, 3, deps);
    await resumeVeloraRun(started.runId!, 4, deps);

    const done = await veloraRunStatus(started.runId!, { store });
    expect(done.status).toBe("completed");
    expect(done.completedPhases).toBe(4);
    expect(done.nextPhase).toBeNull();
    expect(done.recovered).toBe(false);
    expect(done.dossier!.products.length).toBeGreaterThan(0);
    expect(done.dossier!.rank_source).toBe("weighted");
    expect(done.push!.ok).toBe(true);
    expect(done.selfTest!.verdict).toBe("PASS");
    expect(done.phases.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    // Model çağrıları tek Faz 1 burst'unda; sonraki checkpoint fazları temizlenmiş raporlanır.
    expect(done.phases[0]?.agents).toBe(14);
    expect(done.phases[0]?.timedOut).toBe(0);
    expect(done.phases.slice(1).every((p) => p.agents === 0 && p.timedOut === 0)).toBe(true);
  });

  it("geçici kova düşse bile karneyi KALICI kazanan kaydından geri kurar", async () => {
    const store = fakeStore();
    const done = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );
    const expected = done.dossier!.products.map((p) => p.name);

    // ai_cache TTL'i doldu: koşu durumu kayboldu, radar_items kaydı kaldı.
    store.states.clear();

    const status = await veloraRunStatus(done.runId!, { store });
    expect(status.status).toBe("completed");
    expect(status.recovered).toBe(true);
    expect(status.notes).toContain("STATE_EXPIRED_USING_WINNER_LEDGER");
    expect(status.dossier!.notes).toContain("RECOVERED_FROM_WINNER_LEDGER");
    expect(status.dossier!.products.map((p) => p.name)).toEqual(expected);
    expect(status.dossier!.rank_source).toBe("weighted");
    // Geri kurulan kayıt da ürün başına kanıt taşır (uydurma alan yok).
    expect(status.dossier!.products[0]!.candidateId).toBeTruthy();
    expect(status.dossier!.products[0]!.verification).toBe("verified");
  });

  it("ilerleme durmuşsa 'stale' işaretler (panel sonsuz yoklamaz)", async () => {
    const store = fakeStore();
    const started = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub },
    );
    const state = store.states.get(started.runId!)!;
    state.updatedAtMs = Date.now() - 10 * 60 * 1000;
    await store.saveState(state);

    const status = await veloraRunStatus(started.runId!, { store });
    expect(status.status).toBe("running");
    expect(status.stale).toBe(true);
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
  it("DTO'dan veritabanı satırı üretir, fiyat bandını ve ürün başına kanıtı ayrıştırır", () => {
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
      requested_top: 3,
      intersection_count: 1,
      rank_source: "weighted",
      finalists: 3,
      evaluated: 2,
      notes: [],
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
          councilScore: 74,
          councilDecision: "LISTED",
          winnerScore: 84,
          rank: 1,
          source: "ai",
          candidateId: "C1",
          identity: "mini ice maker xr 500",
          analysisScore: 91,
          councilVotes: 12,
          councilCoverage: 12 / 14,
          agentEvidence: ["CFO Agent: birim ekonomi canlı kanıtla uyumlu"],
          verification: "verified",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.day).toBe("2026-09-23");
    expect(rows[0]!.price_min).toBe(29.99);
    expect(rows[0]!.price_max).toBe(49);
    expect(rows[0]!.winner_score).toBe(84);
    expect(rows[0]!.niche).toBe("mini ice maker");
    const payload = rows[0]!.payload as Record<string, unknown>;
    expect(payload["joint_score"]).toBe(85);
    expect(payload["rank_source"]).toBe("weighted");
    expect(payload["product_council_score"]).toBe(74);
    expect(payload["product_council_votes"]).toBe(12);
    expect(payload["product_analysis_score"]).toBe(91);
    expect(payload["product_verification"]).toBe("verified");
    expect(payload["intersection_count"]).toBe(1);
  });
});
