// VELORA HATTI — uçtan uca test.
//
// Bu testler hattın SÖZ verdiği üç davranışı sabitler:
//  1. 14 ajanın TAMAMI fiilen koşar (tek tek, sırayla) ve
//  2. retriever + 14 üyenin HEPSİ aynı ORTAK kazıma kanıtını görür (trend radarı
//     kazımaları + canlı piyasa kanıtı = bulucu ile ortak veri),
//  3. nihai karar ORTAK KARAR formülüdür (analiz hattı ⊕ konsey, eşit ortaklık)
//     ve kazıma/AI düştüğünde hat yine dürüst biçimde tamamlanır.
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

import { COUNCIL_AGENTS } from "./council-chain.server";
import { combineJointScores } from "./consensus-types";
import {
  collectVeloraEvidence,
  runVeloraAgentPipeline,
  scrapedCandidates,
  veloraProductScore,
} from "./velora-pipeline.server";

const RADAR = ["TikTok: mini ice maker", "Yandex: kompakt buz makinesi"];
const RADAR_BLOCK = `TREND RADAR (Google/Amazon/TikTok/Yandex/RSS/GitHub kazımaları): ${RADAR.join(" | ")}`;
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
  return { agent: agentName, provider: "gemini", attempts: 1, latencyMs: 5, ok: true };
}

/**
 * Sahte AI yönlendirici: retriever'ın yanıtını `retrieverText` belirler, konsey
 * üyelerinin her birine kendi `scoreKey`i üzerinden 90 puan döndürür. Böylece
 * hem 14 çağrının fiilen koştuğunu hem de puanların ortak karara girdiğini
 * görebiliyoruz — ağ çağrısı yok.
 */
function stubRunner(retrieverText: string) {
  return (agentName: string, prompt: string) => {
    prompts.push({ agentName, prompt });
    if (agentName.startsWith("Product Retriever")) {
      return Promise.resolve({ text: retrieverText, log: agentLog(agentName) });
    }
    const scoreKey = COUNCIL_AGENTS.find((a) => `Council ${a.name}` === agentName)?.scoreKey;
    const text = scoreKey ? JSON.stringify({ [scoreKey]: 90 }) : "{}";
    return Promise.resolve({ text, log: agentLog(agentName) });
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  prompts = [];
  mocks.collectSignals.mockResolvedValue(signalsFixture());
  mocks.signalsBlock.mockReturnValue(RADAR_BLOCK);
  mocks.buildLiveEvidenceBlock.mockResolvedValue(LIVE_BLOCK);
  mocks.executeAgentWithFallback.mockImplementation(
    stubRunner(JSON.stringify({ candidates: [{ name: "Mini Ice Maker XR-500", category: "Kitchen" }] })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectVeloraEvidence (ortak kazıma kanıtı)", () => {
  it("trend radarı kazımalarını ve canlı piyasa kanıtını tek blokta birleştirir", async () => {
    const evidence = await collectVeloraEvidence({ userQuery: "mini ice maker", language: "en" }, 5_000);

    expect(evidence.block).toContain("TREND RADAR");
    expect(evidence.block).toContain("LIVE MARKET");
    expect(evidence.radar).toEqual(RADAR);
    expect(evidence.live).toBe(true);
    expect(evidence.sources).toEqual([{ name: "Google Trends", status: "active", items: 12 }]);
  });

  it("kazıma tamamen düşse bile fırlatmaz, dürüst boş kanıt döner", async () => {
    mocks.collectSignals.mockRejectedValue(new Error("scrape down"));
    mocks.buildLiveEvidenceBlock.mockRejectedValue(new Error("live down"));

    const evidence = await collectVeloraEvidence({ userQuery: "mini ice maker", language: "en" }, 5_000);

    expect(evidence).toEqual({ block: "", radar: [], sources: [], live: false });
  });
});

describe("scrapedCandidates (kazınmış trend → aday ürün)", () => {
  it("kaynak etiketini korur, tekrarları eler ve kısa isimleri atlar", () => {
    const candidates = scrapedCandidates(["TikTok: mini ice maker", "TikTok: mini ice maker", "RSS: ", "ab"]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe("mini ice maker");
    expect(candidates[0]!.category).toBe("Trend radar (scraped)");
    expect(candidates[0]!.whyNow).toContain("TikTok");
  });
});

describe("veloraProductScore (nişteki en iyi ürün sıralaması)", () => {
  it("modelin adlandırdığı gerçek ürün, kazınmış trend adını ve genel yedeği geçer", () => {
    const base = {
      name: "X",
      demandScore: 80,
      estimatedMarginPct: 45,
      competitionScore: 30,
      whyNow: "rising demand",
      risks: [],
      priceRange: "$29.99",
    };
    const ai = veloraProductScore({ ...base, source: "ai" }, 80).score;
    const scraped = veloraProductScore({ ...base, source: "trend-radar" }, 80).score;
    const fallback = veloraProductScore({ ...base, source: "fallback" }, 80).score;

    expect(ai).toBeGreaterThan(scraped);
    expect(scraped).toBeGreaterThan(fallback);
  });

  it("yüksek talep + marj + düşük rekabet daha yüksek puan verir", () => {
    const strong = veloraProductScore(
      { name: "a", demandScore: 95, estimatedMarginPct: 60, competitionScore: 10, whyNow: "x", risks: [], priceRange: "$40" },
      90,
    ).score;
    const weak = veloraProductScore(
      { name: "b", demandScore: 20, estimatedMarginPct: 5, competitionScore: 90, whyNow: "", risks: ["a", "b", "c"], priceRange: "" },
      40,
    ).score;

    expect(strong).toBeGreaterThan(weak);
  });

  it("eksik/geçersiz alanlarda çökmez ve her zaman 0-100 içinde kalır", () => {
    const missing = veloraProductScore({ name: "b" }, Number.NaN).score;
    expect(Number.isFinite(missing)).toBe(true);
    expect(missing).toBeGreaterThanOrEqual(0);

    const inflated = veloraProductScore(
      { name: "c", demandScore: 999, estimatedMarginPct: 999, competitionScore: -50 },
      500,
    ).score;
    expect(inflated).toBeLessThanOrEqual(100);
  });
});

describe("runVeloraAgentPipeline (14 ajan + ortak karar)", () => {
  it("14 ajanın tamamını koşar, ortak kanıtı herkese verir ve ortak kararı hesaplar", async () => {
    const result = await runVeloraAgentPipeline({
      userQuery: "mini ice maker",
      country: "US",
      platform: "Amazon",
    });

    // 1) 14 ajansın tamamı fiilen koştu.
    expect(result.metrics.agentCount).toBe(COUNCIL_AGENTS.length);
    const councilCalls = prompts.filter((p) => p.agentName.startsWith("Council "));
    expect(councilCalls).toHaveLength(14);
    expect(new Set(councilCalls.map((c) => c.agentName)).size).toBe(14);

    // 2) ORTAK kanıt hem retriever'a hem 14 üyenin hepsine gidiyor.
    const retrieverPrompts = prompts.filter((p) => p.agentName.startsWith("Product Retriever"));
    expect(retrieverPrompts.length).toBeGreaterThan(0);
    expect(retrieverPrompts.every((p) => p.prompt.includes("TREND RADAR"))).toBe(true);
    expect(councilCalls.every((c) => c.prompt.includes("TREND RADAR"))).toBe(true);
    expect(councilCalls.every((c) => c.prompt.includes("LIVE MARKET"))).toBe(true);

    // 3) Kanıt dürüstçe raporlanıyor.
    expect(result.metrics.evidence).toEqual({
      live: true,
      scrapedTrends: RADAR.length,
      radar: RADAR,
      sources: [{ name: "Google Trends", status: "active", items: 12 }],
    });

    // 4) Nihai karar ORTAK KARAR formülü: analiz hattı ⊕ 14'lü konsey.
    expect(result.metrics.councilAverage).toBe(90);
    const expected = combineJointScores({
      analysisScore: result.metrics.analysisScore,
      councilScore: result.metrics.councilAverage,
    });
    expect(result.metrics.jointScore).toBe(expected.score);
    expect(result.metrics.jointSource).toBe("joint");
    expect(result.metrics.finalScore).toBe(expected.score);
    expect(result.metrics.listed).toBe(expected.score >= 60);
    expect(result.topProducts[0]!.councilScore).toBe(expected.score);
    expect(result.topProducts[0]!.councilDecision).toBe(result.metrics.listed ? "LISTED" : `REVIEW_90`);

    // 5) En iyi ürün sıralaması: modelin adlandırdığı gerçek ürün başta, genel
    //    yedek metin onun önüne geçemez ve sıralama 1'den başlar.
    expect(result.topProducts[0]!.name).toBe("Mini Ice Maker XR-500");
    expect(result.topProducts[0]!.source).toBe("ai");
    expect(result.topProducts[0]!.rank).toBe(1);
    expect(result.topProducts.map((p) => p.rank)).toEqual(
      result.topProducts.map((_, i) => i + 1),
    );
    const scores = result.topProducts.map((p) => p.winnerScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
  });

  it("AI retriever boş dönerse gerçek kazınmış trend adlarını aday yapar", async () => {
    mocks.executeAgentWithFallback.mockImplementation(stubRunner("{}"));

    const result = await runVeloraAgentPipeline({ userQuery: "mini ice maker", country: "US" });

    const names = result.topProducts.map((p) => p.name);
    expect(names).toContain("mini ice maker");
    expect(names).toContain("kompakt buz makinesi");
    // Kazınmış trend adları havuzun başında gelir ama gerçek ad taşırlar.
    const scraped = result.topProducts.filter((p) => p.source === "trend-radar");
    expect(scraped).toHaveLength(RADAR.length);
    expect(scraped[0]!.category).toBe("Trend radar (scraped)");
    expect(result.topProducts[0]!.source).toBe("trend-radar");
    expect(result.metrics.evidence.scrapedTrends).toBe(RADAR.length);
    expect(result.metrics.agentCount).toBe(14);
    // Konsey kanıtsız kalmadı: kazınmış kanıt yine de 14 üyeye gitti.
    expect(prompts.filter((p) => p.agentName.startsWith("Council ")).every((c) => c.prompt.includes("TREND RADAR"))).toBe(true);
  });

  it("kazıma düşse bile 14 ajan koşar, karar dürüstçe 'kanıt yok' der ve hat kanıtsız tamamlanır", async () => {
    mocks.collectSignals.mockRejectedValue(new Error("scrape down"));
    mocks.buildLiveEvidenceBlock.mockRejectedValue(new Error("live down"));

    const result = await runVeloraAgentPipeline({ userQuery: "mini ice maker" });

    expect(result.metrics.agentCount).toBe(14);
    expect(result.metrics.evidence).toEqual({ live: false, scrapedTrends: 0, radar: [], sources: [] });
    expect(result.metrics.jointSource).toBe("joint");
    expect(result.metrics.finalScore).toBe(result.metrics.jointScore);
    const councilCalls = prompts.filter((p) => p.agentName.startsWith("Council "));
    expect(councilCalls).toHaveLength(14);
    expect(councilCalls.every((c) => c.prompt.includes("none available for this run"))).toBe(true);
    // Kazıma bir BONUS'tur, ön koşul değil: hat kanıtsız da AI retriever'ının
    // gerçek adayıyla sonuç üretir (uydurma ürün adı yazılmaz).
    expect(result.topProducts[0]!.name).toBe("Mini Ice Maker XR-500");
  });
});
