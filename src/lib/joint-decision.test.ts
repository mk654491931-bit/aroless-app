// ORTAK KARAR — ürün bulucunun analiz hattı puanı ile 14'lü AI Konsey karnesinin
// birleşimi. Ağırlık AÇIKÇA 14 ajan lehinedir (konsey %70 / analiz %30): karar
// konseyin ana eksenidir. Bu testler ağırlığı ve eksik/geçersiz sinyallerde
// çökmediğini sabitler.
import { describe, expect, it } from "vitest";
import { combineJointScores } from "./consensus-types";

describe("combineJointScores (analiz hattı + 14'lü konsey ortak kararı)", () => {
  it("iki sinyal de varsa 14 ajan %70, analiz %30 ağırlığıyla birleşir", () => {
    const decision = combineJointScores({ analysisScore: 80, councilScore: 60 });
    expect(decision.score).toBe(66); // 60*0.7 + 80*0.3
    expect(decision.source).toBe("joint");
    expect(decision.analysisWeight).toBe(0.3);
    expect(decision.councilWeight).toBe(0.7);
  });

  it("konsey kararı analizden daha ağır basar", () => {
    // Analiz hattı 90 derken konsey 50 diyorsa sonuç 62'dir (50*0.7 + 90*0.3):
    // 14 ajanlı konsey kararın ana eksenidir, analiz onu destekler.
    expect(combineJointScores({ analysisScore: 90, councilScore: 50 }).score).toBe(62);
  });

  it("karne henüz gelmediyse yalnızca analiz hattı puanı geçerlidir", () => {
    const decision = combineJointScores({ analysisScore: 72, councilScore: 0 });
    expect(decision.score).toBe(72);
    expect(decision.source).toBe("analysis");
    expect(decision.councilWeight).toBe(0);
  });

  it("analiz puanı yoksa yalnızca konsey puanı geçerlidir", () => {
    const decision = combineJointScores({ analysisScore: undefined, councilScore: 64 });
    expect(decision.score).toBe(64);
    expect(decision.source).toBe("council");
    expect(decision.analysisWeight).toBe(0);
  });

  it("hiç sinyal yoksa 0 döner ve çökmez", () => {
    expect(combineJointScores({})).toEqual({
      score: 0,
      source: "none",
      analysisWeight: 0,
      councilWeight: 0,
    });
    expect(combineJointScores({ analysisScore: Number.NaN, councilScore: -5 }).score).toBe(0);
    expect(combineJointScores({ analysisScore: null, councilScore: null }).source).toBe("none");
  });

  it("puanları 0-100 aralığına kırpar", () => {
    expect(combineJointScores({ analysisScore: 250, councilScore: 100 }).score).toBe(100);
    expect(combineJointScores({ analysisScore: 100, councilScore: 0 }).score).toBe(100);
  });
});
