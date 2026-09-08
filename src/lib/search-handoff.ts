// ============================================================================
// Finder search handoff.
//
// One place owns the `?q=` contract between any surface that wants to start a
// product search (dashboard recent searches, notifications, deep links, an
// external campaign URL) and the finder that actually runs it.
//
// Dependency-free on purpose: no React, no router, no direct `window` access in
// the pure helpers. Storage is injected, so every rule below is unit-testable
// without a browser.
// ============================================================================

/** Query-string parameter carrying the handed-off search term. */
export const SEARCH_HANDOFF_PARAM = "q";

/** Storage key used to park a term across the navigation. */
export const SEARCH_HANDOFF_STORAGE_KEY = "aroless.search-handoff";

/** Window event fired when a term is parked, so a mounted finder can react. */
export const SEARCH_HANDOFF_EVENT = "aroless:search-handoff";

/**
 * Upper bound on an accepted term. The finder sends this straight to the AI
 * engines, so an unbounded URL parameter is both a cost and a prompt-injection
 * surface.
 */
export const MAX_HANDOFF_QUERY_LENGTH = 200;

/** The slice of the Web Storage API this module needs. */
export type HandoffStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/**
 * Accept a candidate term or reject it.
 *
 * Control characters are stripped rather than escaped: a term arriving from a
 * URL should never be able to inject newlines into a prompt. Whitespace is
 * collapsed so "  led   lamp " and "led lamp" are one cache entry, not two.
 */
export function normalizeHandoffQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed === "") return null;
  if (collapsed.length <= MAX_HANDOFF_QUERY_LENGTH) return collapsed;
  return collapsed.slice(0, MAX_HANDOFF_QUERY_LENGTH).trim();
}

/** Read the handoff term out of a `location.search` string. */
export function readHandoffFromSearch(search: unknown): string | null {
  if (typeof search !== "string" || search === "") return null;
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return normalizeHandoffQuery(params.get(SEARCH_HANDOFF_PARAM));
  } catch {
    return null;
  }
}

/**
 * Remove the handoff parameter from a path+search string, preserving every
 * other parameter and the hash. Used so a refresh does not re-run the search
 * and so the address bar stays clean.
 */
export function stripHandoffParam(href: unknown): string {
  if (typeof href !== "string" || href === "") return "/";
  try {
    const url = new URL(href, "https://handoff.invalid");
    if (!url.searchParams.has(SEARCH_HANDOFF_PARAM)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    url.searchParams.delete(SEARCH_HANDOFF_PARAM);
    const rest = url.searchParams.toString();
    return `${url.pathname}${rest ? `?${rest}` : ""}${url.hash}`;
  } catch {
    return href;
  }
}

/**
 * Park a term for the finder to pick up. Returns the normalized term, or null
 * if it was rejected. Storage failures (Safari private mode, quota) are
 * swallowed: a failed handoff must never break navigation.
 */
export function parkHandoff(query: unknown, storage: HandoffStorage | null): string | null {
  const normalized = normalizeHandoffQuery(query);
  if (normalized === null) return null;
  if (storage) {
    try {
      storage.setItem(SEARCH_HANDOFF_STORAGE_KEY, normalized);
    } catch {
      /* non-fatal */
    }
  }
  return normalized;
}

/**
 * Read and clear the parked term. One-shot by design: a handoff must fire once,
 * never again on the next mount or a later refresh.
 */
export function consumeHandoff(storage: HandoffStorage | null): string | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SEARCH_HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
  try {
    storage.removeItem(SEARCH_HANDOFF_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
  return normalizeHandoffQuery(raw);
}

/** Discard a parked term without consuming it (e.g. on sign-out). */
export function clearHandoff(storage: HandoffStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SEARCH_HANDOFF_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

/**
 * Build the finder link for a term. Callers must use this instead of
 * hand-writing `?q=`, so encoding and validation live in one place.
 */
export function buildFinderPath(query: unknown, basePath = "/"): string {
  const normalized = normalizeHandoffQuery(query);
  if (normalized === null) return basePath;
  return `${basePath}?${SEARCH_HANDOFF_PARAM}=${encodeURIComponent(normalized)}`;
}
