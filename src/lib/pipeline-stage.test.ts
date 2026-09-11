import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, stageIndexForPipelineStage } from "./pipeline-stage";

describe("PIPELINE_STAGES", () => {
  it("does not exceed the row count used by the progress list", () => {
    expect(PIPELINE_STAGES.length).toBeGreaterThanOrEqual(3);
  });
});

describe("stageIndexForPipelineStage", () => {
  it("maps the retriever phase to the first row", () => {
    expect(stageIndexForPipelineStage("pipeline:start")).toBe(0);
    expect(stageIndexForPipelineStage("tier:1:start")).toBe(0);
  });

  it("moves to the council row once the retriever finishes", () => {
    expect(stageIndexForPipelineStage("tier:1:complete")).toBe(1);
    expect(stageIndexForPipelineStage("tier:2:start")).toBe(1);
  });

  it("moves to synthesis when the chain completes", () => {
    expect(stageIndexForPipelineStage("tier:2:complete")).toBe(2);
    expect(stageIndexForPipelineStage("pipeline:complete")).toBe(2);
  });

  it("ignores unknown stages so the UI keeps its current row", () => {
    expect(stageIndexForPipelineStage("tier:3:start")).toBe(-1);
    expect(stageIndexForPipelineStage("cache:hit")).toBe(-1);
  });
});
