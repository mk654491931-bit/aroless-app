import { describe, expect, it } from "vitest";
import {
  VELORA_ANALYSIS_WEIGHT,
  VELORA_COUNCIL_WEIGHT,
  VELORA_COVERAGE_FLOOR,
  councilFinalScore,
  councilRankKey,
  sortByCouncilAverage,
} from "./velora-council-score";

const AGENTS = 14;
const base = { agentCount: AGENTS, analysisScore: 50 } as const;

describe("councilFinalScore — 14 ajan ortalaması × güven", () => {
  it("14/14 oy ve tek puan varsa nihai puan ORTALAMANIN KENDİSİDİR", () => {
    const verdict = councilFinalScore({
      ...base,
      councilScore: 74,
      votes: 14,
      spread: 0,
      analysisScore: 20,
    });
    // Tam katılım + tam uzlaşma = güven 1 → analiz hattı yalnız %10 ağırlıkla
    // eşitlik bozucudur, ortalama ana eksendir.
    expect(verdict.source).toBe("council-average");
    expect(verdict.confidence).toBe(1);
    expect(verdict.coverage).toBe(1);
    expect(verdict.score).toBe(
      Math.round(74 * VELORA_COUNCIL_WEIGHT + 20 * VELORA_ANALYSIS_WEIGHT),
    );
  });

  it("AĞIRLIKLAR AÇIKÇA toplamı 1'dir (panelin konuştuğu sayılar)", () => {
    expect(VELORA_COUNCIL_WEIGHT + VELORA_ANALYSIS_WEIGHT).toBeCloseTo(1, 10);
    expect(VELORA_COUNCIL_WEIGHT).toBeGreaterThan(VELORA_ANALYSIS_WEIGHT);
  });

  it("az oy alan ürün, çok oy alan ürünü geçemez (katılım çarpanı)", () => {
    const thin = councilFinalScore({ ...base, councilScore: 96, votes: 2, spread: 0 });
    const broad = councilFinalScore({ ...base, councilScore: 70, votes: 12, spread: 0 });
    expect(thin.coverage).toBeLessThan(broad.coverage);
    expect(thin.confidence).toBeLessThan(broad.confidence);
    // Ham ortalamada 96 > 70 iken bile güven farkı sonucu döndürür.
    expect(thin.score).toBeLessThan(broad.score);
  });

  it("katılım cezası ürünü SIFIRLAMAZ — bilgi kaybolmaz", () => {
    const verdict = councilFinalScore({ ...base, councilScore: 80, votes: 1, spread: 0 });
    expect(verdict.score).toBeGreaterThan(0);
    // Taban katılım cezası: 1/14 oy → güven tavana yakın ama tabanın ÜSTÜNDE.
    expect(verdict.confidence).toBeGreaterThanOrEqual(VELORA_COVERAGE_FLOOR);
    expect(verdict.confidence).toBeLessThan(1);
  });

  it("bölünmüş konsey aynı ortalamayı taşısa da daha DÜŞÜK puan alır (uzlaşma)", () => {
    const tight = councilFinalScore({ ...base, councilScore: 75, votes: 14, spread: 0 });
    const split = councilFinalScore({ ...base, councilScore: 75, votes: 14, spread: 30 });
    expect(tight.confidence).toBe(1);
    expect(split.confidence).toBeLessThan(1);
    expect(split.score).toBeLessThan(tight.score);
  });

  it("yayılım arttıkça güven AZALIR (monoton)", () => {
    const scores = [0, 10, 20, 30, 45].map(
      (spread) => councilFinalScore({ ...base, councilScore: 75, votes: 14, spread }).score,
    );
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("hiç ajan oyu yoksa uydurma puan üretmez: karar analiz hattına devredilir", () => {
    const verdict = councilFinalScore({
      ...base,
      councilScore: 0,
      votes: 0,
      spread: 0,
      analysisScore: 61,
    });
    expect(verdict.source).toBe("analysis-only");
    expect(verdict.score).toBe(61);
    expect(verdict.confidence).toBe(0);
    expect(verdict.councilWeight).toBe(0);
    expect(verdict.analysisWeight).toBe(1);
  });

  it("oy yokken analiz hattı da yoksa puan 0'dır (nötr 50 uydurmaz)", () => {
    const verdict = councilFinalScore({
      ...base,
      councilScore: 0,
      votes: 0,
      spread: 0,
      analysisScore: null,
    });
    expect(verdict.score).toBe(0);
    expect(verdict.source).toBe("analysis-only");
  });

  it("sonuç her zaman 0-100 aralığındadır", () => {
    for (const [score, votes, spread] of [
      [100, 14, 0],
      [0, 14, 0],
      [100, 1, 99],
      [50, 7, 15],
    ] as const) {
      const verdict = councilFinalScore({ ...base, councilScore: score, votes, spread });
      expect(verdict.score).toBeGreaterThanOrEqual(0);
      expect(verdict.score).toBeLessThanOrEqual(100);
    }
  });

  it("analiz puanı verilmezse karar TAMAMEN 14 ajan ortalamasıdır", () => {
    const withAnalysis = councilFinalScore({
      ...base,
      councilScore: 80,
      votes: 14,
      spread: 0,
      analysisScore: 10,
    });
    const without = councilFinalScore({
      ...base,
      councilScore: 80,
      votes: 14,
      spread: 0,
      analysisScore: null,
    });
    // Analiz hattı olmadan karar TAMAMEN 14 ajan ortalamasıdır.
    expect(without.score).toBe(80);
    // Analiz hattı yalnız eşitlik bozucu: en kötü −%10, en iyi +%10.
    expect(withAnalysis.score).toBe(73);
    expect(without.score - withAnalysis.score).toBeLessThanOrEqual(8);
  });
});

describe("councilRankKey / sortByCouncilAverage", () => {
  const row = (councilScore: number, votes: number, analysisScore: number, identity: string) => ({
    verdict: councilFinalScore({ ...base, councilScore, votes, spread: 0, analysisScore }),
    councilScore,
    votes,
    analysisScore,
    identity,
  });

  it("yüksek 14 ajan ortalaması önce gelir", () => {
    const sorted = sortByCouncilAverage([row(60, 14, 90, "b"), row(85, 14, 10, "a")]);
    expect(sorted.map((r) => r.identity)).toEqual(["a", "b"]);
  });

  it("aynı puanda DAHA FAZLA ajan oylayan önce gelir (katılım)", () => {
    const thin = row(80, 2, 90, "thin");
    const broad = row(80, 14, 10, "broad");
    expect(sortByCouncilAverage([thin, broad]).map((r) => r.identity)).toEqual(["broad", "thin"]);
  });

  it("eşitlik bozucu: aynı puanda analiz hattı yalnız SONRA gelir", () => {
    const low = row(80, 14, 20, "low-analysis");
    const high = row(80, 14, 95, "high-analysis");
    expect(sortByCouncilAverage([low, high]).map((r) => r.identity)).toEqual([
      "high-analysis",
      "low-analysis",
    ]);
  });

  it("deterministiktir: normalize kimlik son karar olarak kullanılır", () => {
    const a = row(80, 14, 50, "ürün a");
    const b = row(80, 14, 50, "ürün b");
    // Puan/katılım/analiz segmentleri aynı; yalnız kimlik farklı.
    const prefix = (key: string) => key.split("|").slice(0, 4).join("|");
    expect(prefix(councilRankKey(a))).toBe(prefix(councilRankKey(b)));
    expect(councilRankKey(a)).not.toBe(councilRankKey(b));
    // Tam eşitlikte sıra ürün adının normalize parmak iziyle belirlenir.
    expect(sortByCouncilAverage([b, a]).map((r) => r.identity)).toEqual(["ürün a", "ürün b"]);
  });

  it("girdi dizisini DEĞİŞTİRMEZ (yerinde sıralama yapmaz)", () => {
    const input = [row(60, 14, 50, "b"), row(85, 14, 50, "a")];
    const before = input.map((r) => r.identity);
    sortByCouncilAverage(input);
    expect(input.map((r) => r.identity)).toEqual(before);
  });
});
