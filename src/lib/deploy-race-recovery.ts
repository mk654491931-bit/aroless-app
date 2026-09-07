/**
 * Deploy-race recovery for hashed chunk files.
 *
 * Every publish renames the content-hashed JS chunks emitted under /js (see
 * vite.config.ts: manualChunks + "[name].[hash:8].js"). A browser that is
 * still running the previous page — cached HTML, back/forward cache, or a tab
 * that was open before the publish — will request chunk files the new
 * deployment no longer contains. Those requests 404 and the router's lazy
 * route import rejects with "Failed to fetch dynamically imported module",
 * which used to leave a blank/white page until a manual hard refresh.
 *
 * When such a stale-chunk failure is detected we perform one guarded full
 * reload (throttled, offline-aware). The reload fetches fresh SSR HTML, which
 * points at the current chunk names, so the app recovers on its own.
 *
 * Client-only module; safe to import from server-rendered files (all window
 * access is gated behind typeof checks).
 */

const CHUNK_RE = /(?:^|\/)(?:js|assets)\/[^?#]*\.js/i;

/** True when the URL points at one of this app's hashed JS chunks. */
export function isHashedChunkUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let path = url;
  try {
    // Resolve relative paths ("/js/x.js") against a throwaway base.
    path = new URL(url, "https://invalid.local").pathname;
  } catch {
    /* not URL-parseable → match the raw string */
  }
  return CHUNK_RE.test(path);
}

const STALE_IMPORT_SIGNATURES = [
  "Failed to fetch dynamically imported module", // Chromium
  "Importing a module script failed", // Chromium (static module scripts)
  "error loading dynamically imported module", // WebKit / Gecko
  "Loading chunk ", // webpack-style chunk loaders
];

function extractUrlFromMessage(message: string): string | undefined {
  const quoted = message.match(/['"](https?:\/\/[^'"]+)['"]/);
  if (quoted) return quoted[1];
  const bare = message.match(/https?:\/\/\S+/);
  return bare?.[0];
}

/** True when an error looks like a chunk load that 404'd after a deploy. */
export function isStaleChunkError(error: unknown): boolean {
  if (error == null) return false;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (message && STALE_IMPORT_SIGNATURES.some((sig) => message.includes(sig))) {
    return true;
  }
  // Some browsers only surface the failing module URL.
  const url = message ? extractUrlFromMessage(message) : undefined;
  return url ? isHashedChunkUrl(url) : false;
}

const RELOAD_STAMP_KEY = "aroless.deploy-race-reload";
const RELOAD_THROTTLE_MS = 20_000;

let reloadPending = false;

/**
 * One guarded full-page reload per stale-chunk detection window.
 * Returns true when a reload was triggered.
 */
export function reloadOnceForStaleChunk(error: unknown): boolean {
  if (!isStaleChunkError(error)) return false;
  if (typeof window === "undefined" || import.meta.env.DEV) return false;
  if (!navigator.onLine) return false; // Offline: chunk 404s repeat — reloading would not help.
  if (reloadPending) return false;

  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
    if (Date.now() - last < RELOAD_THROTTLE_MS) return false;
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    /* storage unavailable → still allow a single reload */
  }

  reloadPending = true;
  console.warn(
    "[deploy-race] stale hashed chunk detected — reloading to pick up the latest app build",
  );
  window.location.reload();
  return true;
}

let listenersInstalled = false;

/**
 * Installs global listeners that catch chunk-load failures the router does not
 * surface (e.g. the pre-hydration lazy import that currently dies with a blank
 * page). Idempotent; call as early as possible on the client, before the
 * router starts importing route chunks.
 */
export function installStaleChunkRecovery(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  if (typeof window === "undefined" || import.meta.env.DEV) return;

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reloadOnceForStaleChunk(event.reason);
  };
  const onResourceError = (event: Event) => {
    const target = event.target;
    const url =
      target instanceof HTMLScriptElement
        ? target.src
        : target instanceof HTMLLinkElement
          ? target.href
          : null;
    if (url && isHashedChunkUrl(url)) {
      reloadOnceForStaleChunk(url);
    }
  };
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("error", onResourceError, true);
}
