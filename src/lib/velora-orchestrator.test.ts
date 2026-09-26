// VELORA 14 AJAN ORKESTRATÖRÜ — FAZ 0 kazıması, faz dilimleme, 8 sn tavanı,
// ajan başına uzmanlık kanıtı, 14 ajan ortalaması, QStash tekrar teslimi ve
// panel yoklaması.
//
// Bu testler Vercel Free Tier sözleşmesini ve ÜRÜN SÖZLEŞMESİNİ sabitler:
//  1. FAZ 0 (niş kazıması) 14 ajandan ÖNCE koşar, AI çağrısı yapmaz ve sonucu
//     koşu durumuna yazar; aynı niş 24 saat içinde ikinci kez kazınmaz,
//  2. 14 ajanın tamamı tek fazda eksiksiz dağıtılır (boşluksuz/çakışmasız),
//  3. her faz KENDİ adımında koşar ve 8 sn tavanını ASLA aşamaz (asılı üye nötr döner),
//  4. her ajan kendi UZMANLIK KANITINI ayrıca görür (CFO fiyatı, UX şikâyeti…),
//  5. durum adımlar arasında geçici kovada taşınır, QStash devri sonraki fazı
//     yayınlayıp anında döner ve AYNI fazın tekrar teslimi idempotenttir,
//  6. nihai liste 14 AJAN ORTALAMASINA göre kurulur ve en iyi 5 ürünü gösterir;
//     eksik sıra DOLDURULMAZ,
//  7. sonuç veritabanına push edilir, OTOMATİK SELF-TEST kaydı geri okuyup
//     doğrular ve panel `runId` ile koşu durumunu yoklayabilir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAgentWithFallback: vi.fn(),
  harvestNicheSignalsCached: vi.fn(),
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

// FAZ 0 kazıyıcısı: testlerde ağa çıkılmaz, ölçülmüş bir kanıt fixture'ı döner.
vi.mock("./velora-niche-scrape.server", () => ({
  harvestNicheSignalsCached: mocks.harvestNicheSignalsCached,
  VELORA_HARVEST_BUDGET_MS: 12_000,
}));

vi.mock("./data-pipeline.server", () => ({
  collectSignals: vi.fn(),
  signalsBlock: vi.fn(),
}));

vi.mock("./market-verify.server", () => ({
  buildLiveEvidenceBlock: vi.fn(),
}));

vi.mock("./discovery-jobs.server", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  qstashConfigured: () => false,
  qstashFanOut: vi.fn(),
}));

import { COUNCIL_AGENTS } from "./council-chain.server";
import { councilFinalScore } from "./velora-council-score";
import { NicheSignalsSchema, type NicheSignals } from "./velora-niche-signals";
import {
  VELORA_PHASES,
  VELORA_PHASE_CEILING_MS,
  VELORA_HARVEST_CEILING_MS,
  VELORA_FINALIST_COUNT,
  VELORA_PIPELINE_TOP_N,
  VELORA_TOP_N,
  phaseCeilingFor,
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
  productConsensus,
  type VeloraRunState,
  type VeloraStore,
} from "./velora-orchestrator.server";

const RADAR = ["TikTok: mini ice maker", "Yandex: kompakt buz makinesi"];
const RADAR_BLOCK = `TREND RADAR: ${RADAR.join(" | ")}`;

type PromptCall = { agentName: string; prompt: string };
let prompts: PromptCall[] = [];

/** FAZ 0'ın döndürdüğü ÖLÇÜLMÜŞ kanıt (canlı kazımanın test fixture'ı). */
function harvestFixture(overrides: Partial<NicheSignals> = {}) {
  return {
    data: NicheSignalsSchema.parse({
      niche: "mini ice maker",
      country: "US",
      platform: "General",
      collectedAt: "2026-09-25T10:00:00.000Z",
      trendSeries: [50, 55, 60],
      trendMomentumPct: 12,
      googleRising: ["ice maker for small room"],
      tiktok: ["mini ice maker"],
      amazonMovers: ["portable ice maker"],
      reddit: [
        {
          title: "This mini ice maker broke in a week",
          subreddit: "BuyItForLife",
          score: 120,
          comments: 40,
          url: "",
          complaint: true,
        },
      ],
      hackerNews: [{ title: "Show HN: mini ice maker", points: 60, comments: 25, url: "" }],
      priceSamples: [
        { platform: "Amazon", priceUsd: 39.99 },
        { platform: "AliExpress", priceUsd: 21.5 },
      ],
      retailMedianUsd: 30.75,
      supplier: { priceUsd: 18, shippingUsd: 4, live: true, sampleTitle: "portable ice maker" },
      news: [{ title: "Ice maker demand grows", source: "Retail Dive", url: "" }],
      github: [],
      radar: RADAR,
      sources: [
        { name: "Google Trends", status: "active", items: 12, detail: "" },
        { name: "Reddit", status: "active", items: 5, detail: "" },
        { name: "Hacker News", status: "active", items: 3, detail: "" },
        { name: "Google News", status: "active", items: 4, detail: "" },
        { name: "Marketplace prices", status: "active", items: 2, detail: "" },
        { name: "Trend Radar", status: "active", items: 6, detail: "" },
        { name: "GitHub", status: "error", items: 0, detail: "403 rate limited" },
        { name: "Supplier pricing", status: "active", items: 1, detail: "" },
      ],
      live: true,
      ...overrides,
    }),
    cache_hit: false,
  };
}

function agentLog(agentName: string) {
  return { agent: agentName, provider: "gemini", attempts: 1, latencyMs: 3, ok: true };
}

/** Bir fazın üyelerinin EKRAN adları (test stub'ı isimle eşleştirir). */
function agentNamesOf(phaseId: 0 | 1 | 2 | 3 | 4): string[] {
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
  /**
   * Her ajanın oyuna AJAN BAZLI kaydırılacak puan farkı. Konsey oylarını
   * yapay olarak bölerek "yayılım" senaryosu üretir.
   */
  spread?: number;
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
      const scored = options.votes ? ids.filter((id) => options.votes?.[id] !== undefined) : ids;
      // Ajan bazlı kaydırma: konseyin oy dağılımını yapay olarak böler.
      const agentIndex = Math.max(
        0,
        COUNCIL_AGENTS.findIndex((a) => a.name === agentName),
      );
      const offset = options.spread ? (agentIndex % 2 === 0 ? options.spread : -options.spread) : 0;
      body["product_scores"] = scored.map((id) => ({
        id,
        score: Math.max(0, Math.min(100, (options.votes?.[id] ?? 90) + offset)),
        note: `kanıt: ${id} canlı piyasa`,
      }));
    }
    return Promise.resolve({ text: JSON.stringify(body), log: agentLog(agentName) });
  };
}

type FakeStore = VeloraStore & {
  states: Map<string, VeloraRunState>;
  rows: Record<string, unknown>[];
};

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
    nicheSignals: harvestFixture().data,
    harvestError: "",
    evidenceByLine: {
      analysis: { block: RADAR_BLOCK, radar: RADAR, live: true },
      council: { block: RADAR_BLOCK, radar: RADAR, live: true },
    },
    evidenceBlock: RADAR_BLOCK,
    scrapedTrends: RADAR,
    live: true,
    candidates: [],
    analysisLine: [],
    trackRecord: {},
    requestedBy: null,
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
  // Çağrı sayaçları testler arası birikmesin.
  mocks.harvestNicheSignalsCached.mockReset();
  mocks.harvestNicheSignalsCached.mockResolvedValue(harvestFixture());
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

  it("FAZ 0 kazıma, 14 ajandan ÖNCE ve AI çağrısı yapmadan koşar", () => {
    const harvest = phaseById(0);
    expect(harvest.key).toBe("niche-harvest");
    expect(harvest.agents).toHaveLength(0);
    // Ajan fazları 1'de: kazıma bitmeden hiçbir ajan devreye girmiyor.
    expect(VELORA_PHASES.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(phaseById(0).id).toBeLessThan(phaseById(1).id);
    expect(phaseCeilingFor(0)).toBe(VELORA_HARVEST_CEILING_MS);
    expect(phaseCeilingFor(1)).toBe(VELORA_PHASE_CEILING_MS);
  });

  it("her fazın bir kimliği ve adı vardır; bilinmeyen faz kimliği hata verir", () => {
    expect(phaseById(2).key).toBe("quality-gate");
    expect(phaseById(3).key).toBe("council-average");
    expect(() => phaseById(9 as 1)).toThrow(/UNKNOWN_VELORA_PHASE/);
  });

  it("tavan ücretsiz plan fonksiyon limitinin çok altındadır", () => {
    expect(VELORA_PHASE_CEILING_MS).toBeLessThanOrEqual(8_000);
    // Toplam istek-içi koşu yolu (5 adım) dar limitlerde bile 504 üretmez:
    // 4 AI fazı 8 sn + kazıma fazı 12 sn = 44 sn (Vercel Hobby tavanı 300 sn).
    const worstCase = VELORA_PHASES.reduce((total, phase) => total + phaseCeilingFor(phase.id), 0);
    expect(worstCase).toBeLessThanOrEqual(48_000);
    // Kullanıcıya 14 ajan ortalamasına göre en iyi 5 ürün gösterilir; aday
    // havuzu daha geniş olmalı ki kalite kapısı eleyince de sıra doldurulsun.
    expect(VELORA_TOP_N).toBe(5);
    expect(VELORA_PIPELINE_TOP_N).toBeGreaterThan(VELORA_TOP_N);
  });

  it("havuz ÜRÜN başına değil NİŞin TAMAMI ölçeğinde: 3 üründe durmaz", () => {
    // Eski davranış: retriever `collected.length >= 3` ile duruyordu ve
    // finalist havuzu 8 ile sınırlıydı. "Nişin tamamını tara" isteği bunu
    // gereksiz kılıyor. Havuz en az 12 ürün tutmalı.
    expect(VELORA_FINALIST_COUNT).toBeGreaterThanOrEqual(12);
    // İki bağımsız hat havuzun tamamını doldurabilmeli.
    expect(VELORA_PIPELINE_TOP_N).toBe(VELORA_FINALIST_COUNT);
    // 14 ajanın tamamı havuzu puanlıyor → toplam oy sayısı.
    expect(plannedAgentCount() * VELORA_FINALIST_COUNT).toBeGreaterThanOrEqual(168);
  });
});

describe("FAZ 0 — 14 ajan devreye girmeden ÖNCE sağlam kazıma", () => {
  it("kazıma tam olarak bir kez koşar, duruma yazılır ve 14 üyenin TAMAMINA verilir", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    // Aynı kazımayı iki kez çekmiyoruz: bu iki kat ağ yükü ve iki kat bekleme
    // demekti, fazladan bilgi değildi.
    expect(mocks.harvestNicheSignalsCached).toHaveBeenCalledTimes(1);
    expect(mocks.harvestNicheSignalsCached).toHaveBeenCalledWith({
      niche: "mini ice maker",
      country: "US",
      platform: "General",
    });

    // Kazıma Faz 0'da, 14 ajan Faz 1'de koştu: sıra sözleşmesi korunur.
    const phases = store.states.get(result.runId!)!.phases.map((p) => p.id);
    expect(phases).toEqual([0, 1, 2, 3, 4]);
    expect(phases.indexOf(0)).toBeLessThan(phases.indexOf(1));
    // Faz 0 hiçbir model çağrısı yapmadı.
    const harvestCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(harvestCalls).toHaveLength(14);

    // 14 üyenin HEPSİ kazınan bloğu gördü.
    const council = prompts.filter(
      (p) => p.agentName !== "Product Retriever" && p.agentName !== "Analysis Line",
    );
    expect(council).toHaveLength(14);
    expect(council.every((p) => p.prompt.includes(RADAR[0]!))).toBe(true);
    expect(council.every((p) => p.prompt.includes("PRE-COUNCIL SCRAPING EVIDENCE"))).toBe(true);

    // Analiz hattı da aynı kazınmış kanıtı gördü — iki hat birbirinden bağımsız
    // karar verir ama aynı gerçekliğe bakar.
    const retriever = prompts.find((p) => p.agentName === "Product Retriever");
    expect(retriever).toBeDefined();
    expect(retriever!.prompt).toContain(RADAR[0]!);
    expect(retriever!.prompt).toContain("ANALYSIS-LINE SCRAPING EVIDENCE");
  });

  it("her ajan KENDİ UZMANLIK KANITINI görür (CFO fiyatı, UX şikâyeti, denetçi kaynak tablosu)", async () => {
    await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store: fakeStore(), runAgent: runAgentStub(stubRunner()) },
    );
    const promptOf = (key: string) =>
      prompts.find((p) => COUNCIL_AGENTS.find((a) => a.key === key)?.name === p.agentName)!.prompt;
    const cfo = promptOf("cfo");
    const ux = promptOf("ux_specialist");
    const auditor = promptOf("independent_data_auditor");
    const channel = promptOf("channel_fit");

    expect(cfo).toContain("YOUR SPECIALIST EVIDENCE");
    expect(cfo).toContain("GÖZLENEN PERAKENDE FİYAT");
    expect(cfo).toContain("$30.75");
    expect(cfo).toContain("GÖZLENEN BRÜT MARJ");

    // UX ajanı gerçek şikâyet cümlesini görür.
    expect(ux).toContain("broke in a week");
    expect(ux).toContain("1/1 başlık olumsuz deneyim");

    // Denetçi izlenim değil KAYNAK DURUMU tablosunu görür (GitHub düştü).
    expect(auditor).toContain("KAYNAK DURUMU");
    expect(auditor).toContain("ERİŞİLEMEYEN KAYNAKLAR");
    expect(auditor).toContain("GitHub (403 rate limited)");

    // Kanal ajanı komisyon verisinin OLMADIĞINI görür — uydurma sayı yok.
    expect(channel).toContain("GÖZLENEN KANALLAR");
    expect(channel).toContain("KOMİSYON SONRASI MARJ: VERİ YOK");
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
            text: JSON.stringify({
              scores: [{ id: "C1", score: 88, reason: "canlı kanıt güçlü" }],
            }),
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
      state.analysisLine
        .filter((row) => row.candidateId !== "C1")
        .every((r) => r.source === "heuristic"),
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
  it("FAZ 0 kazıması + 14 ajanı koşar, temp state yazar, kazananı push eder ve self-test PASS verir", async () => {
    const store = fakeStore();
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US", platform: "Amazon" },
      { store, runAgent: runAgentStub(stubRunner()) },
    );

    expect(result.status).toBe("completed");
    expect(result.completedPhases).toBe(5);

    // 14 ajan fiilen koştu.
    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    expect(councilCalls).toHaveLength(14);
    expect(new Set(councilCalls.map((c) => c.agentName)).size).toBe(14);

    // Temp state her fazdan sonra yazıldı; adımlar stateless (runId ile taşınır).
    const saved = store.states.get(result.runId!)!;
    expect(saved.phases.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(saved.phases.every((p) => p.withinCeiling)).toBe(true);
    expect(saved.status).toBe("completed");
    expect(saved.runningPhase).toBeNull();
    // ÖLÇÜLEN kanıt koşu durumunda saklanır (ajanlar yeniden kazımaz).
    expect(saved.nicheSignals.priceSamples).toHaveLength(2);
    expect(saved.nicheSignals.supplier?.live).toBe(true);

    // Ortak karar = 14 ajan ortalaması; hepsi 90 verdi.
    expect(result.dossier!.council_average).toBe(90);
    expect(result.dossier!.rank_source).toBe("council-average");
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

  it("QStash devri varsa FAZ 0'dan sonra ANINDA döner ve ajan fazını yayınlar", async () => {
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
    expect(result.completedPhases).toBe(0);
    expect(result.nextPhase).toBe(1);
    expect(result.dispatch).toEqual({ ok: true, mode: "qstash", messageId: "msg-1" });
    expect(handoffCalls).toEqual([1]);
    // Kazıma bitti, ama HİÇBİR ajan çalışmadı: 14 ajan bir sonraki adımda.
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(
      0,
    );
    expect(store.states.get(result.runId!)!.phases.map((p) => p.id)).toEqual([0]);
    // Kazınan kanıt yine de durumda hazır.
    expect(store.states.get(result.runId!)!.nicheSignals.sources.length).toBeGreaterThan(0);
  });

  it("QStash geri çağrısı kaydedilmiş durumu yükleyip kalan fazları tamamlar", async () => {
    const store = fakeStore();
    const started = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub },
    );

    // Faz 0 kazımasından sonra sırada ajan fazı (1) vardır.
    const councilPhase = await resumeVeloraRun(started.runId!, 1, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(councilPhase.status).toBe("dispatched");
    expect(councilPhase.completedPhases).toBe(1);
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(
      14,
    );
    // Ajan fazı kazımayı TEKRARLAMAZ.
    expect(mocks.harvestNicheSignalsCached).toHaveBeenCalledTimes(1);

    const third = await resumeVeloraRun(started.runId!, 2, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(third.completedPhases).toBe(2);

    const fourth = await resumeVeloraRun(started.runId!, 3, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(fourth.completedPhases).toBe(3);

    const last = await resumeVeloraRun(started.runId!, 4, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
    expect(last.status).toBe("completed");
    expect(last.dossier!.phases.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    expect(last.selfTest!.verdict).toBe("PASS");
  });

  it("bilinmeyen runId için temiz hata döner (çökmez)", async () => {
    const result = await resumeVeloraRun("yok", 2, { store: fakeStore() });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("RUN_STATE_NOT_FOUND");
  });

  it("kazıma tamamen çökse bile hat tamamlanır ve dürüstçe raporlar", async () => {
    mocks.harvestNicheSignalsCached.mockRejectedValue(new Error("scrape down"));

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
    // Kazıma nedeni kaybolmaz: dossier notlarında açıkça yazar.
    expect(result.dossier!.notes.some((n) => n.startsWith("HARVEST_FAILED:"))).toBe(true);
    // Kanıt yokken retriever'ın adlandırdığı gerçek ürün yine kazanır.
    expect(result.dossier!.products[0]!.name).toBe("Mini Ice Maker XR-500");
    const councilCalls = prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName));
    // Ajanlara kanıtın boş olduğu ve nötr puan vermeleri gerektiği AÇIKÇA söylenir.
    expect(councilCalls.every((c) => c.prompt.includes("PRE-COUNCIL SCRAPING EVIDENCE"))).toBe(
      true,
    );
    expect(councilCalls.every((c) => c.prompt.includes("EVIDENCE THIN"))).toBe(true);
    expect(councilCalls.every((c) => c.prompt.includes("do NOT invent price data"))).toBe(true);
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
      const expected = councilFinalScore({
        councilScore: product.councilScore,
        votes: product.councilVotes ?? 0,
        spread: product.councilSpread ?? 0,
        agentCount: 14,
        analysisScore: product.analysisScore,
      });
      expect(product.winnerScore).toBe(expected.score);
      // 14/14 oy + tek puan = tam güven: ortalamanın kendisi nihai puandır.
      expect(product.councilConfidence).toBe(1);
      expect((product.agentEvidence ?? []).length).toBeGreaterThan(0);
      // Canlı kanıt var + tüm ajanlar oy verdi → doğrulanmış.
      expect(product.verification).toBe("verified");
    }
  });

  it("canlı kanıt yoksa 'verified' DENMEZ: dürüst etiket 'unverified' kalır", async () => {
    mocks.harvestNicheSignalsCached.mockResolvedValue(harvestFixture({ live: false }));

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

describe("C) ajan katılım göstergesi (yayılım, yalnız ortalama değil)", () => {
  /** 14 ajanın belirli oylarıyla konsensüs üreten koşu durumu. */
  const stateWithVotes = (scores: number[]): VeloraRunState =>
    baseState({
      candidates: [{ name: "Ürün A", candidateId: "C1" }],
      phases: [
        {
          id: 1,
          key: "parallel-council",
          name: "council",
          ms: 10,
          withinCeiling: true,
          agents: scores.map((score, index) => ({
            key: `a${index}`,
            name: `Agent ${index}`,
            ok: true,
            timedOut: false,
            score,
            latencyMs: 5,
            output: {},
            productVotes: [{ id: "C1", score, note: "" }],
          })),
        },
      ],
    });

  it("dar yayılım → 'unanimous'", () => {
    const entry = productConsensus(stateWithVotes(Array(14).fill(72))).get("C1")!;
    expect(entry.councilScore).toBe(72);
    expect(entry.spread).toBe(0);
    expect(entry.alignment).toBe("unanimous");
  });

  it("geniş yayılım → 'contested'", () => {
    // 7 ajan 95, 7 ajan 45 → stddev 25... daha da açık uç: 100/40 → 30.
    const votes = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 100 : 40));
    const entry = productConsensus(stateWithVotes(votes)).get("C1")!;
    expect(entry.spread).toBeGreaterThan(26);
    expect(entry.alignment).toBe("contested");
  });

  it("ORTALAMA AYNI olsa bile yayılım farklıysa etiket farklılaşır", () => {
    const tight = productConsensus(stateWithVotes(Array(14).fill(71))).get("C1")!;
    const split = productConsensus(
      stateWithVotes(Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 92 : 50))),
    ).get("C1")!;
    expect(tight.councilScore).toBe(split.councilScore);
    expect(tight.alignment).not.toBe(split.alignment);
  });

  it("min/max oy gerçek değerleri taşır", () => {
    const votes = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 88 : 54));
    const entry = productConsensus(stateWithVotes(votes)).get("C1")!;
    expect(entry.minScore).toBe(54);
    expect(entry.maxScore).toBe(88);
  });

  it("az oy varsa etiket 'none' — iki ajanın uyuşması fikir birliği sayılmaz", () => {
    const entry = productConsensus(stateWithVotes([70, 72])).get("C1")!;
    expect(entry.alignment).toBe("none");
  });

  it("dossier ürüne yayılımı ve etiketi taşır", async () => {
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store: fakeStore(), runAgent: runAgentStub(stubRunner({ spread: 40 })) },
    );
    const product = result.dossier!.products[0]!;
    expect(product.councilSpread!).toBeGreaterThan(0);
    expect(["split", "contested"]).toContain(product.councilAlignment);
  });
});

describe("D) pazar erişimi (kural tabanlı, ücretsiz)", () => {
  it("her ürün için pazar satırı üretilir ve kanal bilinmiyorsa UYDURMAZ", async () => {
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store: fakeStore(), runAgent: runAgentStub(stubRunner()) },
    );
    const reach = result.dossier!.products[0]!.marketReach;
    expect(reach).toBeDefined();
    expect(reach!.entries.length).toBeGreaterThan(0);
    expect(reach!.entries.every((e) => e.country && e.verdict)).toBe(true);
  });
});

describe("E) sonuç geri besleme (geçmiş performans)", () => {
  it("geçmiş PARMAK İZİYLE eşleşir — farklı yazılmış aynı ürün de bulunur", async () => {
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      {
        store: fakeStore(),
        runAgent: runAgentStub(stubRunner()),
        fetchTrackRecord: async () => ({
          // Anahtar normalize parmak izi; ürün adı farklı yazılmış olabilir.
          "mini ice maker xr 500": {
            title: "MINI ICE MAKER XR-500 (2.5L)",
            appearances: 3,
            avgScore: 78,
            bestRank: 1,
            lastSeenDay: "2026-09-20",
            daysSinceSeen: 5,
          },
        }),
      },
    );
    const product = result.dossier!.products[0]!;
    expect(product.trackRecord).toMatchObject({ appearances: 3, avgScore: 78, bestRank: 1 });
  });

  it("geçmiş okunamazsa koşu yine tamamlanır (zenginleştirici, zorunlu değil)", async () => {
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      {
        store: fakeStore(),
        runAgent: runAgentStub(stubRunner()),
        fetchTrackRecord: async () => {
          throw new Error("geçmiş okunamadı");
        },
      },
    );
    expect(result.status).toBe("completed");
    expect(result.dossier!.products.length).toBeGreaterThan(0);
    expect(result.dossier!.products.every((p) => p.trackRecord === undefined)).toBe(true);
  });
});

describe("nihai karar: 14 AJAN ORTALAMASI (katılım + uzlaşma düzeltmeli)", () => {
  it("her hat kendi ilk-N listesini bulur; 14 ajan ortalamasına göre sıralar", async () => {
    const store = fakeStore();
    // Ajanlar yalnızca C2 ve C3'ü puanlar → konsey hattının kendi ilk 8'i C2,C3.
    const result = await startVeloraRun(
      { userQuery: "mini ice maker", country: "US" },
      { store, runAgent: runAgentStub(stubRunner({ votes: { C2: 88, C3: 70 } })) },
    );
    const dossier = result.dossier!;

    expect(dossier.rank_source).toBe("council-average");
    // C2 ve C3 iki hattın ilk 8'inde ortak; C1 yalnız analiz hattından gelir.
    expect(dossier.intersection_count).toBe(2);
    expect(dossier.requested_top).toBe(VELORA_TOP_N);
    expect(dossier.finalists).toBe(3);
    expect(dossier.evaluated).toBe(2);
    // Ajan oyu olmayan ürün bile sıra DOLDURULMAZ diye korunur.
    expect(dossier.products.map((p) => p.name)).toContain("Mini Ice Maker XR-500");
    expect(dossier.products.map((p) => p.rank)).toEqual([1, 2, 3]);
    // AJAN OYU OLAN ÜRÜN DAHA YÜKSEK ORTALAMALI ÜRÜNÜN ÖNÜNDE GEÇER.
    const voted = dossier.products.filter((p) => (p.councilVotes ?? 0) > 0);
    expect(voted).toHaveLength(2);
    expect(voted[0]!.councilScore!).toBeGreaterThan(voted[1]!.councilScore!);
    // Nihai puan gerçekten 14 ajan ortalaması × güven formülünden gelir.
    for (const product of dossier.products) {
      const expected = councilFinalScore({
        councilScore: product.councilScore,
        votes: product.councilVotes ?? 0,
        spread: product.councilSpread ?? 0,
        agentCount: 14,
        analysisScore: product.analysisScore,
      });
      expect(product.winnerScore).toBe(expected.score);
    }
  });

  it("az oy alan ürün, çok oy alan ürünü GEÇEMEZ (katılım çarpanı uçtan uca)", () => {
    // C1'i yalnız 2 ajan 96 derken 12 ajan C2'ye 70 diyor: HAM ORTALAMADA C1
    // kazanır. "14 ajan ortalaması" diyebilmek için katılım gerektiği için
    // nihai sıralamada C2 ÖNDE gelmelidir.
    const voter = (key: string, score: number, votes: { id: string; score: number }[]) => ({
      key,
      name: key,
      ok: true,
      timedOut: false,
      score,
      latencyMs: 1,
      output: {},
      productVotes: votes.map((v) => ({ ...v, note: "" })),
    });
    const state = baseState({
      candidates: [
        { name: "Ürün A", candidateId: "C1", source: "ai", demandScore: 80 },
        { name: "Ürün B", candidateId: "C2", source: "ai", demandScore: 80 },
      ],
      analysisLine: [
        {
          candidateId: "C1",
          identity: "urun a",
          name: "Ürün A",
          score: 80,
          reason: "",
          source: "ai",
        },
        {
          candidateId: "C2",
          identity: "urun b",
          name: "Ürün B",
          score: 80,
          reason: "",
          source: "ai",
        },
      ],
      phases: [
        {
          id: 1,
          key: "parallel-council",
          name: "council",
          ms: 10,
          withinCeiling: true,
          agents: [
            voter("a1", 96, [{ id: "C1", score: 96 }]),
            voter("a2", 96, [{ id: "C1", score: 96 }]),
            ...Array.from({ length: 12 }, (_, i) => voter(`b${i}`, 70, [{ id: "C2", score: 70 }])),
          ],
        },
      ],
    });

    const dossier = buildWinnerDossier(state);
    const a = dossier.products.find((p) => p.candidateId === "C1")!;
    const b = dossier.products.find((p) => p.candidateId === "C2")!;
    // Ham ortalamada C1 önde…
    expect(a.councilScore!).toBeGreaterThan(b.councilScore!);
    expect(a.councilVotes).toBe(2);
    expect(b.councilVotes).toBe(12);
    // …ama katılım çarpanı nihai sırayı tersine çevirir.
    expect(a.councilConfidence!).toBeLessThan(b.councilConfidence!);
    expect(b.winnerScore).toBeGreaterThan(a.winnerScore);
    expect(dossier.products[0]!.candidateId).toBe("C2");
    expect(dossier.rank_source).toBe("council-average");
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
    // Faz 0 bitti, sırada 1 (14 ajan) vardır: önce onu koştur.
    await resumeVeloraRun(started.runId!, 1, deps);

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
    expect(phases).toEqual([0, 1, 2, 3]);
  });

  it("HÂLÂ koşan faz ikinci kez BAŞLATILMAZ (eşzamanlı teslim kilidi)", async () => {
    const store = fakeStore();
    const deps = { store, runAgent: runAgentStub(stubRunner()), handoff: handoffStub };
    const started = await startVeloraRun({ userQuery: "mini ice maker", country: "US" }, deps);
    await resumeVeloraRun(started.runId!, 1, deps);

    const state = store.states.get(started.runId!)!;
    state.runningPhase = { id: 2, startedAtMs: Date.now() };
    await store.saveState(state);

    const result = await resumeVeloraRun(started.runId!, 2, deps);

    expect(result.deduped).toBe(true);
    expect(result.status).toBe("dispatched");
    // Faz 0 (kazıma) + Faz 1 (14 ajan) kayıtlıdır.
    expect(result.completedPhases).toBe(2);
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
    expect(prompts.filter((p) => COUNCIL_AGENTS.some((a) => a.name === p.agentName))).toHaveLength(
      14,
    );
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

    await resumeVeloraRun(started.runId!, 1, deps);
    const middle = await veloraRunStatus(started.runId!, { store });
    expect(middle.status).toBe("running");
    // Faz 0 (kazıma) + Faz 1 (14 ajan) bitti, sırada 2.
    expect(middle.completedPhases).toBe(2);
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
    expect(done.completedPhases).toBe(5);
    expect(done.nextPhase).toBeNull();
    expect(done.recovered).toBe(false);
    expect(done.dossier!.products.length).toBeGreaterThan(0);
    expect(done.dossier!.rank_source).toBe("council-average");
    expect(done.push!.ok).toBe(true);
    expect(done.selfTest!.verdict).toBe("PASS");
    expect(done.phases.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
    // Model çağrıları tek Faz 1 burst'unda; kazıma ve checkpoint fazları temiz raporlanır.
    expect(done.phases[0]?.agents).toBe(0);
    expect(done.phases[1]?.agents).toBe(14);
    expect(done.phases[1]?.timedOut).toBe(0);
    expect(
      done.phases.filter((p) => p.id !== 1).every((p) => p.agents === 0 && p.timedOut === 0),
    ).toBe(true);
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
    expect(status.dossier!.rank_source).toBe("council-average");
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
    await resumeVeloraRun(started.runId!, 1, {
      store,
      runAgent: runAgentStub(stubRunner()),
      handoff: handoffStub,
    });
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
      requested_top: 5,
      intersection_count: 1,
      rank_source: "council-average",
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
    expect(payload["rank_source"]).toBe("council-average");
    expect(payload["product_council_score"]).toBe(74);
    expect(payload["product_council_votes"]).toBe(12);
    expect(payload["product_analysis_score"]).toBe(91);
    expect(payload["product_verification"]).toBe("verified");
    expect(payload["intersection_count"]).toBe(1);
  });
});
