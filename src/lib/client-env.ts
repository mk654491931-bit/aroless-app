/**
 * Allowlisted browser configuration for Vite/TanStack Start.
 *
 * Client code reads only the build-injected public object below. The Vite
 * config creates that object from the VITE_* allowlist; server credentials
 * (AI, Paddle API, service-role and webhook secrets) are never included.
 *
 * Keeping this boundary free of framework-specific environment APIs also makes
 * the browser bundle compatible with the managed Freebuff runtime.
 */

export type PublicClientEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  turnstileSiteKey: string;
  apiBaseUrl: string;
  appUrl: string;
  paddleClientToken: string;
  paddleEnvironment: "sandbox" | "production";
  paddlePriceStarterMonthly: string;
  paddlePriceProMonthly: string;
  paddlePriceBusinessMonthly: string;
  mode: string;
};

/** Vite replaces this identifier with the allowlisted object at build time. */
declare const __AROLESS_PUBLIC_ENV__: Partial<PublicClientEnv> | undefined;

const EMPTY_PUBLIC_ENV: PublicClientEnv = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  turnstileSiteKey: "",
  apiBaseUrl: "",
  appUrl: "",
  paddleClientToken: "",
  paddleEnvironment: "sandbox",
  paddlePriceStarterMonthly: "",
  paddlePriceProMonthly: "",
  paddlePriceBusinessMonthly: "",
  mode: "",
};

const injectedEnv: Partial<PublicClientEnv> | undefined =
  typeof __AROLESS_PUBLIC_ENV__ === "undefined" ? undefined : __AROLESS_PUBLIC_ENV__;

export const publicClientEnv: PublicClientEnv = Object.freeze({
  ...EMPTY_PUBLIC_ENV,
  ...(injectedEnv ?? {}),
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
  return publicClientEnv.mode === "development";
}
