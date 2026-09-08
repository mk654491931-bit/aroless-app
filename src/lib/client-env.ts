/**
 * Allowlisted browser configuration for Vite/TanStack Start.
 *
 * This is the only application-runtime module that reads `import.meta.env`.
 * Vite exposes only VITE_* values to the browser; server credentials (AI,
 * Paddle, service-role and webhook secrets) must never be added here.
 */

const viteEnv = import.meta.env as ImportMetaEnv & Record<string, unknown>;

function readPublicEnv(name: string): string {
  const value = viteEnv[name];
  return typeof value === "string" ? value.trim() : "";
}

export const publicClientEnv = Object.freeze({
  supabaseUrl: readPublicEnv("VITE_SUPABASE_URL"),
  supabasePublishableKey: readPublicEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  turnstileSiteKey: readPublicEnv("VITE_TURNSTILE_SITE_KEY"),
  apiBaseUrl: readPublicEnv("VITE_API_BASE_URL"),
  appUrl: readPublicEnv("VITE_APP_URL"),
});

/** Names are safe to report; values are deliberately never logged. */
export function missingPublicClientEnv(): string[] {
  return [
    ["VITE_SUPABASE_URL", publicClientEnv.supabaseUrl],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", publicClientEnv.supabasePublishableKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

export function warnMissingPublicClientEnv(): void {
  const missing = missingPublicClientEnv();
  if (missing.length > 0) {
    console.error(
      `[client-env] Missing public environment variable(s): ${missing.join(", ")}. ` +
        "Set these names in Vercel for both Preview and Production, then redeploy.",
    );
  }
}

/** Use same-origin API routes by default; support an explicit public API base when needed. */
export function clientApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || !publicClientEnv.apiBaseUrl) return path;
  try {
    return new URL(path, publicClientEnv.apiBaseUrl).toString();
  } catch {
    console.error("[client-env] VITE_API_BASE_URL is invalid; using the requested path.");
    return path;
  }
}

export function isClientDevelopment(): boolean {
  return viteEnv.DEV === true;
}
