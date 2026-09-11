// ============================================================================
// Council stage mapping (client-safe, pure)
//
// Turns the live agent/stage events streamed by `/api/public/agent`
// (`mode: "council"`) into an index for the council page's stage list, so the UI
// reflects the real run instead of a timer.
// ============================================================================

/** Stage index shown while the request is being validated/started. */
export const COUNCIL_STAGE_START = 0;
/** Stage index for the data-source collection step. */
export const COUNCIL_STAGE_SIGNALS = 1;

const AGENT_STAGE_KEYWORDS: Array<[string, number]> = [
  ["Trend", 2],
  ["Finans", 3],
  ["Pazarlama", 4],
  ["Operasyon", 5],
  ["Uyum", 6],
  ["Yaratıcı", 7],
  ["Müdür", 8],
  ["Denetçi", 9],
];

/** Returns the stage index for an agent name, or `-1` when it is unknown. */
export function stageIndexForAgent(name: string): number {
  for (const [keyword, index] of AGENT_STAGE_KEYWORDS) {
    if (name.includes(keyword)) return index;
  }
  return -1;
}

/** Returns the stage index for a bus stage event, or `-1` when it maps to none. */
export function stageIndexForStage(stage: string): number {
  if (stage === "pipeline:start") return COUNCIL_STAGE_START;
  if (stage === "signals:collected") return COUNCIL_STAGE_SIGNALS;
  return -1;
}

/** Monotonic stage advance — the UI never jumps backwards mid-run. */
export function nextStageIndex(current: number, candidate: number): number {
  return candidate > current ? candidate : current;
}
