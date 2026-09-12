/**
 * Shared AI env-key scanner (server only).
 *
 * Every AI feature used to hardcode its own env names and stopped at low
 * suffixes — e.g. gemini pools read only GEMINI_API_KEY_1.._3, OpenRouter only
 * _1.._2 — so real deployments that store keys as GEMINI_API_KEY_4,
 * OPENROUTER_API_KEY_4, GROQ_API_KEY_4 or HF_TOKEN_5 were silently ignored and
 * every chain returned empty.
 *
 * This module centralizes discovery: each provider is scanned across every
 * naming convention this project has ever used (BASE, BASE_N, BASE_N_ …) for
 * slots 1..8, so whatever suffix a user actually stores under is picked up.
 * Only reads happen here — no key material is ever exported.
 */

function readEnv(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

type KeySpec = {
  /** Plain (unnumbered) env names, in priority order. */
  base?: string[];
  /** Numbered conventions, each a function of the slot (1-based). */
  patterns?: Array<(slot: number) => string>;
  /** Highest slot to scan (default 8). */
  max?: number;
};

/** Collects env values in spec order, skipping empty/duplicate entries. */
function collectEnvKeys(spec: KeySpec): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (!name) return;
    const value = readEnv(name);
    if (value) out.push(value);
  };
  for (const b of spec.base ?? []) push(b);
  const max = spec.max ?? 8;
  for (let slot = 1; slot <= max; slot++) {
    for (const pattern of spec.patterns ?? []) push(pattern(slot));
  }
  return Array.from(new Set(out));
}

/** Gemini: GEMINI_API_KEY, GEMINI_API_KEY_1..8, GEMINI_1_API_KEY..8_API_KEY. */
export function geminiEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["GEMINI_API_KEY"],
    patterns: [(i) => `GEMINI_API_KEY_${i}`, (i) => `GEMINI_${i}_API_KEY`],
  });
}

/** Groq: GROQ_API_KEY, GROQ_API_KEY_1..8, GROQ_1_API_KEY…, GROQ_API_KEY1… */
export function groqEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["GROQ_API_KEY"],
    patterns: [(i) => `GROQ_API_KEY_${i}`, (i) => `GROQ_${i}_API_KEY`, (i) => `GROQ_API_KEY${i}`],
  });
}

/** OpenRouter: OPENROUTER_API_KEY, _1..8, OPENROUTER_API_KEY1…, OPENROUTER_1_API_KEY… */
export function openRouterEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["OPENROUTER_API_KEY"],
    patterns: [
      (i) => `OPENROUTER_API_KEY_${i}`,
      (i) => `OPENROUTER_API_KEY${i}`,
      (i) => `OPENROUTER_${i}_API_KEY`,
    ],
  });
}

/** Hugging Face: HF_TOKEN, HUGGING_FACE_API_KEY…, HF_TOKEN_1..8, HUGGING_FACE_API_KEY_1..8 / KEY1… */
export function hfEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["HF_TOKEN", "HUGGING_FACE_API_KEY", "HUGGING_FACE_TOKEN"],
    patterns: [
      (i) => `HF_TOKEN_${i}`,
      (i) => `HUGGING_FACE_API_KEY_${i}`,
      (i) => `HUGGING_FACE_API_KEY${i}`,
    ],
  });
}

/** Cerebras: CEREBRAS_API_KEY, CEREBRAS_API_KEY_1..8 */
export function cerebrasEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["CEREBRAS_API_KEY"],
    patterns: [(i) => `CEREBRAS_API_KEY_${i}`],
  });
}

/** SambaNova: SAMBANOVA_API_KEY, SAMBANOVA_API_KEY_1..8 */
export function sambanovaEnvKeys(): string[] {
  return collectEnvKeys({
    base: ["SAMBANOVA_API_KEY"],
    patterns: [(i) => `SAMBANOVA_API_KEY_${i}`],
  });
}

/**
 * True when ANY AI provider credential is configured — gateway or any of the
 * project's own key pools. Used by env-check so the warning is accurate no
 * matter which suffix the user stored keys under.
 */
export function anyAiKeyConfigured(): boolean {
  const gateway = process.env["AI_GATEWAY_API_KEY"] || process.env["LOVABLE_API_KEY"];
  if (gateway?.trim()) return true;
  return (
    geminiEnvKeys().length > 0 ||
    groqEnvKeys().length > 0 ||
    openRouterEnvKeys().length > 0 ||
    hfEnvKeys().length > 0 ||
    cerebrasEnvKeys().length > 0 ||
    sambanovaEnvKeys().length > 0
  );
}
