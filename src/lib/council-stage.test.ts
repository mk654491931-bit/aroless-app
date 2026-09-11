import { describe, expect, it } from "vitest";
import {
  COUNCIL_STAGE_SIGNALS,
  COUNCIL_STAGE_START,
  nextStageIndex,
  stageIndexForAgent,
  stageIndexForStage,
} from "./council-stage";

describe("stageIndexForAgent", () => {
  it("maps team, reviewer and lead agents onto stage rows", () => {
    expect(stageIndexForAgent("Trend Ekibi")).toBe(2);
    expect(stageIndexForAgent("Trend Hakemi")).toBe(2);
    expect(stageIndexForAgent("Finans Ekibi")).toBe(3);
    expect(stageIndexForAgent("Pazarlama Hakemi")).toBe(4);
    expect(stageIndexForAgent("Operasyon Ekibi")).toBe(5);
    expect(stageIndexForAgent("Uyum Hakemi")).toBe(6);
    expect(stageIndexForAgent("Yaratıcı Ekip")).toBe(7);
    expect(stageIndexForAgent("Müdür Sentezi")).toBe(8);
    expect(stageIndexForAgent("Bağımsız Denetçi")).toBe(9);
  });

  it("returns -1 for unknown agents so the UI can ignore them", () => {
    expect(stageIndexForAgent("Market Scanner")).toBe(-1);
  });
});

describe("stageIndexForStage", () => {
  it("maps the two global stages", () => {
    expect(stageIndexForStage("pipeline:start")).toBe(COUNCIL_STAGE_START);
    expect(stageIndexForStage("signals:collected")).toBe(COUNCIL_STAGE_SIGNALS);
    expect(stageIndexForStage("pipeline:complete")).toBe(-1);
  });
});

describe("nextStageIndex", () => {
  it("never moves the progress bar backwards", () => {
    expect(nextStageIndex(4, 2)).toBe(4);
    expect(nextStageIndex(4, 7)).toBe(7);
    expect(nextStageIndex(-1, 0)).toBe(0);
  });
});
