// ============================================================================
// Velora deep-analysis stage mapping (client-safe, pure)
//
// Maps the bus events streamed by `/api/public/agent` in default (`pipeline`)
// mode onto the deep-analysis progress rows. Tier 1 is the Product Retriever,
// tier 2 is the sequential 14-agent council chain, and the final synthesis is
// produced once the chain resolves.
// ============================================================================

export const PIPELINE_STAGES = [
  "Product Retriever — canlı pazar adayları toplanıyor",
  "14 ajanlı konsey zinciri sırayla çalışıyor",
  "Final sentez, fingerprint ve skorlama",
] as const;

/** Returns the stage index for a bus stage event, or `-1` when it maps to none. */
export function stageIndexForPipelineStage(stage: string): number {
  switch (stage) {
    case "pipeline:start":
    case "signals:collected":
    case "tier:1:start":
      return 0;
    case "tier:1:complete":
    case "tier:2:start":
      return 1;
    case "tier:2:complete":
    case "pipeline:complete":
      return 2;
    default:
      return -1;
  }
}
