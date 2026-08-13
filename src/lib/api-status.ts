/**
 * Safe, read-only view of client-side API key configuration.
 * NEVER export, log, or render the key value itself — only whether it exists.
 */
export function isOpenRouterConfigured(): boolean {
  const raw = import.meta.env["VITE_OPENROUTER_API_KEY"];
  return typeof raw === "string" && raw.trim().length > 0;
}

export type ApiStatus = { configured: boolean; label: string };

export function openRouterStatus(): ApiStatus {
  const configured = isOpenRouterConfigured();
  return { configured, label: configured ? "API Connected" : "API Key Missing" };
}
