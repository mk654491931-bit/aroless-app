import { useEffect, useRef } from "react";

import {
  consumeHandoff,
  parkHandoff,
  readHandoffFromSearch,
  SEARCH_HANDOFF_EVENT,
  stripHandoffParam,
  type HandoffStorage,
} from "@/lib/search-handoff";

/**
 * sessionStorage, not localStorage: a handed-off search belongs to this tab and
 * this visit. A term parked in localStorage would fire again in another tab, or
 * tomorrow, and silently spend a credit the user did not ask to spend.
 */
function handoffStorage(): HandoffStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Capture side. Mounted once at the router root.
 *
 * Reads `?q=`, parks it, then removes the parameter from the address bar. That
 * removal is the important part: leaving it in place means a refresh, a
 * back-navigation or a shared link re-runs a credit-consuming AI search.
 *
 * history.replaceState is used rather than a router navigation so no remount,
 * no loader re-run and no scroll reset happens -- the visible page never
 * flickers for a URL housekeeping change.
 */
export function useCaptureSearchHandoff(pathname: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const term = readHandoffFromSearch(window.location.search);
    if (term === null) return;

    parkHandoff(term, handoffStorage());

    try {
      const next = stripHandoffParam(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      window.history.replaceState(window.history.state, "", next);
    } catch {
      /* a blocked history write must not lose the handoff */
    }

    // Let an already-mounted finder react without waiting for a remount.
    try {
      window.dispatchEvent(new CustomEvent(SEARCH_HANDOFF_EVENT, { detail: term }));
    } catch {
      /* CustomEvent unavailable -> the mount-time consume path still works */
    }
  }, [pathname]);
}

/**
 * Consume side. Call this in the finder with the function that starts a search.
 *
 *   useSearchHandoff((query) => {
 *     setQuery(query);
 *     void runSearch(query);
 *   });
 *
 * Delivers at most one term per mount, whether it was parked before this
 * component mounted or arrives while it is on screen. The callback is held in a
 * ref so an inline arrow function does not re-subscribe on every render.
 */
export function useSearchHandoff(onQuery: (query: string) => void): void {
  const handler = useRef(onQuery);
  handler.current = onQuery;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let delivered = false;
    const deliver = (query: string | null) => {
      if (delivered || query === null) return;
      delivered = true;
      handler.current(query);
    };

    // Parked before this component mounted (the normal dashboard -> finder path).
    deliver(consumeHandoff(handoffStorage()));

    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Clear the parked copy so a later mount cannot replay this term.
      consumeHandoff(handoffStorage());
      deliver(typeof detail === "string" ? detail : null);
    };

    window.addEventListener(SEARCH_HANDOFF_EVENT, onHandoff);
    return () => window.removeEventListener(SEARCH_HANDOFF_EVENT, onHandoff);
  }, []);
}
