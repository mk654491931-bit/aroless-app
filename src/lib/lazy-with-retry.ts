import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { isStaleChunkError, reloadOnceForStaleChunk } from "@/lib/deploy-race-recovery";

export type DynamicImport<T> = () => Promise<T>;

export interface LazyRetryOptions {
  /** Optional label used only in the diagnostic log. */
  label?: string;
}

/**
 * Loads a dynamic module and recovers from a deploy-race chunk failure.
 *
 * A tab can retain HTML from build A while the CDN serves build B. If the
 * requested hashed chunk only exists in A, the browser rejects the import and
 * React.lazy otherwise bubbles that rejection into a blank route. The shared
 * deploy guard uses sessionStorage/throttling and refuses to reload forever;
 * after it declines, the original error is rethrown for the ErrorBoundary.
 */
export function importWithRetry<T>(
  importer: DynamicImport<T>,
  options: LazyRetryOptions = {},
): Promise<T> {
  return importer().catch((error: unknown) => {
    if (!isStaleChunkError(error)) throw error;

    const reloaded = reloadOnceForStaleChunk(error);
    if (!reloaded) {
      const label = options.label ? ` (${options.label})` : "";
      console.error(`[lazy] chunk could not be loaded${label}; reload guard declined`, error);
    }

    // If a reload was triggered this rejection is only for the current render.
    // If the guard declined, the ErrorBoundary presents a retryable fallback.
    throw error;
  });
}

/**
 * Safe React.lazy wrapper for route/component imports.
 *
 * Use this instead of `lazy(() => import(...))` for every app-managed lazy
 * import. The returned component keeps normal Suspense semantics while stale
 * deploy chunks are recovered automatically.
 */
export function lazyWithRetry<P extends object>(
  importer: DynamicImport<{ default: ComponentType<P> }>,
  options: LazyRetryOptions = {},
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => importWithRetry(importer, options));
}
