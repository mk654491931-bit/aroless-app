/** Shared (client-safe) AI engine definitions for the finder search bar. */
export const HF_TOKEN_STORAGE_KEY = "omni.hf_token";

export const ENGINES = [
  { id: "default", label: "Default AI", hint: "Gemini hybrid consensus", model: "Gemini hybrid", etaMs: 4000 },
  { id: "llama", label: "HF: Llama 3.1", hint: "Fast product generation & copy", model: "meta-llama/Llama-3.1-8B-Instruct", etaMs: 4000 },
  { id: "qwen", label: "HF: Qwen 2.5", hint: "Deep market research & reasoning", model: "Qwen/Qwen2.5-7B-Instruct", etaMs: 5000 },
  { id: "hybrid", label: "Hybrid (All at Once)", hint: "Parallel engines, synthesized results", model: "Llama 3.1 + Qwen 2.5", etaMs: 7000 },
] as const;

export const MARKETPLACES = [
  { id: "global", labelKey: "ui.market_global", country: "GLOBAL", currency: "USD" },
  { id: "turkey", labelKey: "ui.market_tr", country: "TR", currency: "TRY" },
] as const;
export type MarketplaceId = (typeof MARKETPLACES)[number]["id"];


export type EngineId = (typeof ENGINES)[number]["id"];

export function engineLabel(id: EngineId) {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

export function storedHfToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const v = window.localStorage.getItem(HF_TOKEN_STORAGE_KEY);
  return v && v.trim() ? v.trim() : undefined;
}
