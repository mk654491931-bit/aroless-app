/**
 * Client-side API configuration status.
 *
 * Provider credentials intentionally stay on the server. The browser cannot
 * determine whether an OpenRouter key exists and must call same-origin server
 * functions instead of reading a secret from Vite env.
 */
export function isOpenRouterConfigured(): boolean {
  return false;
}

export type ApiStatus = { configured: boolean; label: string };

export function openRouterStatus(): ApiStatus {
  return {
    configured: false,
    label: "Server-routed API (key is not exposed)",
  };
}
