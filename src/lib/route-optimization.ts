/**
 * Route-Based Code Splitting & Optimization
 * Her route'u ayrı chunk'a böl ve preload et
 */

import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

interface RouteOptimizationConfig {
  preloadDistance?: number; // Kaç ms sonra preload başlasın
  prefetchOnHover?: boolean; // Link hover'da prefetch et
  prefetchDelay?: number; // Prefetch için delay (ms)
}

const defaultConfig: RouteOptimizationConfig = {
  preloadDistance: 50,
  prefetchOnHover: true,
  prefetchDelay: 100,
};

/**
 * Route chunk preloading
 */
export function useRoutePreloading(config = defaultConfig) {
  const router = useRouterState();
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!router.location) return;

    const preload = () => {
      // Sonraki route'ları tahmin et ve preload et
      const links = document.querySelectorAll("a[href]");
      const promises: Promise<any>[] = [];

      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (!href || href.startsWith("http")) return;

        // Link zaten cache'de mi kontrol et
        if (window.__routeCache?.has(href)) return;

        // Route'u preload et
        const preloadLink = document.createElement("link");
        preloadLink.rel = "prefetch";
        preloadLink.href = href;
        document.head.appendChild(preloadLink);

        if (config.prefetchOnHover) {
          link.addEventListener("mouseenter", () => {
            const preloadScript = document.createElement("script");
            preloadScript.type = "module";
            preloadScript.src = href;
            preloadScript.async = true;
          });
        }
      });

      return promises;
    };

    if (config.preloadDistance && config.preloadDistance > 0) {
      timeoutRef.current = setTimeout(preload, config.preloadDistance);
    } else {
      preload();
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [router.location, config]);
}

/**
 * Link prefetching on hover/touch
 */
export function useLinkPrefetch() {
  const prefetchRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const handleLinkEnter = (e: Event) => {
      const link = e.target as HTMLAnchorElement;
      const href = link.getAttribute("href");

      if (!href || href.startsWith("http") || prefetchRef.current.has(href)) {
        return;
      }

      prefetchRef.current.set(href, true);

      // requestIdleCallback ile prefetch
      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(() => {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.href = href;
          document.head.appendChild(link);
        });
      } else {
        setTimeout(() => {
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.href = href;
          document.head.appendChild(link);
        }, 200);
      }
    };

    const handleTouchStart = (e: Event) => {
      const link = e.target as HTMLAnchorElement;
      if (!link.matches("a")) return;
      handleLinkEnter(e);
    };

    document.addEventListener("mouseenter", handleLinkEnter, true);
    document.addEventListener("touchstart", handleTouchStart, true);

    return () => {
      document.removeEventListener("mouseenter", handleLinkEnter, true);
      document.removeEventListener("touchstart", handleTouchStart, true);
    };
  }, []);
}

/**
 * Cache store for routes
 */
if (typeof window !== "undefined" && !window.__routeCache) {
  (window as any).__routeCache = new Set<string>();
  (window as any).__routePreloadQueue = new Map<string, Promise<any>>();
}

/**
 * Dynamic route chunk loader
 */
export async function preloadRouteChunk(routePath: string): Promise<any> {
  if ((window as any).__routeCache.has(routePath)) {
    return (window as any).__routePreloadQueue.get(routePath);
  }

  const promise = import(/* @vite-ignore */ routePath).catch((error) => {
    console.warn(`Failed to preload route chunk: ${routePath}`, error);
    return null;
  });

  (window as any).__routeCache.add(routePath);
  (window as any).__routePreloadQueue.set(routePath, promise);

  return promise;
}

/**
 * Performance observer for route transitions
 */
export function useRoutePerformanceMonitoring() {
  const routerState = useRouterState();

  useEffect(() => {
    const startTime = performance.now();
    const route = routerState.location.pathname;

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Performance API'ye kaydet
      if ("PerformanceObserver" in window && "mark" in performance) {
        performance.mark(`route-end-${route}`, { startTime });
        performance.measure(
          `route-navigation-${route}`,
          `route-end-${route}`,
          undefined
        );

        if (duration > 1000) {
          console.warn(`Slow route transition detected: ${route} (${duration}ms)`);
        }
      }

      // Analytics'e gönder
      if ((window as any).__analytics) {
        (window as any).__analytics.trackEvent("route_transition", {
          route,
          duration,
          timestamp: new Date().toISOString(),
        });
      }
    };
  }, [routerState.location.pathname]);
}

/**
 * Batch route preloading for better performance
 */
export function batchPreloadRoutes(routes: string[], options = { delay: 100 }) {
  if (!("requestIdleCallback" in window)) {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      routes.forEach((route) => preloadRouteChunk(route));
    }, options.delay);
    return;
  }

  (window as any).requestIdleCallback(
    () => {
      routes.forEach((route, index) => {
        setTimeout(
          () => preloadRouteChunk(route),
          index * (options.delay / routes.length)
        );
      });
    },
    { timeout: 5000 }
  );
}
