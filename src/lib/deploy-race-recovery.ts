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
 * reload per browser session (offline-aware). The reload fetches fresh SSR HTML, which
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
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (message && STALE_IMPORT_SIGNATURES.some((sig) => message.includes(sig))) {
    return true;
  }
  // Some browsers only surface the failing module URL.
  const url = message ? extractUrlFromMessage(message) : undefined;
  return url ? isHashedChunkUrl(url) : false;
}

const RELOAD_FLAG_KEY = "aroless.deploy-race-reloaded";

let reloadPending = false;

/**
 * One guarded full-page reload per browser session.
 *
 * The flag is written before navigation. If the fresh document still points at
 * a broken deployment, no second automatic reload is attempted; the route
 * error boundary can then offer an explicit manual retry instead.
 */
export function reloadOnceForStaleChunk(error: unknown): boolean {
  if (!isStaleChunkError(error)) return false;
  if (typeof window === "undefined" || import.meta.env.DEV) return false;
  if (!navigator.onLine) return false; // Offline: chunk 404s repeat — reloading would not help.
  if (reloadPending) return false;

  try {
    if (window.sessionStorage.getItem(RELOAD_FLAG_KEY) === "1") return false;
    window.sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
  } catch {
    // Fail closed when sessionStorage is unavailable; without a durable flag,
    // an automatic reload could become an infinite loop.
    return false;
  }

  reloadPending = true;
  console.warn(
    "[deploy-race] stale hashed chunk detected — reloading to pick up the latest app build",
  );
  window.location.reload();
  return true;
}

/**
 * Inline `<head>` bootstrap. Runs while the document is parsed, i.e. before a
 * single hashed chunk is requested, so it also catches failures inside the
 * entry script's own dynamic imports — the case that leaves a blank page today,
 * because router.tsx (which calls installStaleChunkRecovery) never gets to
 * execute when the entry's import of the route chunk 404s.
 *
 * Deliberately a dependency-free string: it is inlined into the document, so it
 * cannot import anything from the bundle. The session flag is shared with
 * reloadOnceForStaleChunk so the two guards never fight each other.
 */
export const STALE_CHUNK_BOOTSTRAP_SCRIPT = `(function(){
  var KEY="${RELOAD_FLAG_KEY}";
  function isChunk(url){
    if(typeof url!=="string"||url.length===0)return false;
    var path=url;
    try{path=new URL(url,location.href).pathname;}catch(e){}
    if(path.indexOf("/js/")<0&&path.indexOf("/assets/")<0)return false;
    return path.slice(-3)===".js";
  }
  function firstUrl(msg){
    var start=msg.indexOf("http");
    if(start<0)return "";
    var tail=msg.slice(start),stop=tail.length;
    for(var i=0;i<tail.length;i++){
      var c=tail.charAt(i),code=c.charCodeAt(0);
      if(c===" "||c==="'"||c===")"||c===","||code===10||code===34){stop=i;break;}
    }
    return tail.slice(0,stop);
  }
  function looksStale(msg){
    if(typeof msg!=="string"||msg.length===0)return false;
    if(msg.indexOf("dynamically imported module")>-1)return true;
    if(msg.indexOf("Importing a module script failed")>-1)return true;
    if(msg.indexOf("Loading chunk")>-1)return true;
    return isChunk(firstUrl(msg));
  }
  function trigger(why){
    try{
      if(sessionStorage.getItem(KEY)==="1")return; // build genuinely broken: stop looping
      sessionStorage.setItem(KEY,"1");
    }catch(e){return;} // fail closed: never reload without a durable guard
    try{console.warn("[deploy-race] "+why+" \u2192 reloading to pick up the current build");}catch(e){}
    location.reload();
  }
  window.addEventListener("unhandledrejection",function(event){
    var reason=event&&event.reason;
    var msg=reason?(typeof reason==="string"?reason:reason.message||""):"";
    if(looksStale(msg))trigger("module import failed (stale page session)");
  });
  window.addEventListener("error",function(event){
    var target=event&&event.target;
    var url=target&&(target.src||target.href);
    if(url&&isChunk(url)){trigger("missing chunk "+url);return;}
    if(looksStale((event&&event.message)||""))trigger("module load error");
  },true);
})();`;

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
