/**
 * Performance Optimization Utilities
 * React Query, memoization, ve bundle size iyileştirmeleri
 */

import { useMemo, useCallback, memo, useState, useEffect, useRef } from "react";

/**
 * React Query Global Configuration - Caching ve Stale-While-Revalidate
 */
export const getDefaultQueryConfig = () => ({
  staleTime: 1000 * 60 * 5, // 5 dakika
  gcTime: 30 * 60 * 1000, // 30 dakika (eski: cacheTime)
  retry: 1,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  refetchOnWindowFocus: false,
  refetchOnReconnect: "stale", // Bağlantı sağlandığında stale veriyi yenile
  refetchOnMount: false, // Mount'da tekrar fetch etme
});

/**
 * Mutation Options - Optimistic Updates ve Error Handling
 */
export const getDefaultMutationConfig = () => ({
  retry: 1,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  networkMode: "online", // Mutation sadece online modda çalışsın
});

/**
 * Memoized Component Wrapper - Props Equality Check
 */
export function memoized<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean,
) {
  return memo(Component, propsAreEqual);
}

/**
 * useImmutableMemo - Dependencies bağlı olmayan memoization
 */
export function useImmutableMemo<T>(value: T): T {
  return useMemo(() => value, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * useAsyncMemo - Async işlemler için memoization
 */
export function useAsyncMemo<T>(
  factory: () => Promise<T>,
  deps: React.DependencyList,
  initialValue: T,
): T {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    let mounted = true;
    void factory().then((result) => {
      if (mounted) setValue(result);
    });
    return () => {
      mounted = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return value;
}

/**
 * useStableCallback - Callback stability, deps gerektirmez
 */
export function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
  const ref = useRef<T>(callback);

  useEffect(() => {
    ref.current = callback;
  }, [callback]);

  return useCallback((...args: any[]) => ref.current(...args), []) as unknown as T;
}

/**
 * useDeferredValue - Slow renders için deferred state
 */
export function useDeferredValue<T>(value: T, initialValue?: T): T {
  const [deferred, setDeferred] = useState<T>(initialValue ?? value);

  useEffect(() => {
    const timer = setTimeout(() => setDeferred(value), 50);
    return () => clearTimeout(timer);
  }, [value]);

  return deferred;
}

/**
 * Performance Monitoring - Web Vitals tracking
 */
export function trackWebVitals(onMetric?: (name: string, value: number, id: string) => void): void {
  if (typeof window === "undefined") return;

  // CLS (Cumulative Layout Shift)
  let cls = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if ((entry as LayoutShiftEntry).hadRecentInput) return;
      cls += (entry as LayoutShiftEntry).value;
      onMetric?.("CLS", cls, entry.name);
    }
  });
  observer.observe({ type: "layout-shift", buffered: true });

  // LCP (Largest Contentful Paint) ve FID (First Input Delay)
  if ("PerformanceObserver" in window) {
    const observerLcp = new PerformanceObserver((list) => {
      const lastEntry = list.getEntries().pop() as LargestContentfulPaintEntry;
      if (lastEntry) {
        onMetric?.("LCP", lastEntry.renderTime || lastEntry.loadTime, lastEntry.id || "");
      }
    });
    observerLcp.observe({ type: "largest-contentful-paint", buffered: true });

    const observerFid = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        onMetric?.("FID", (entry as any).duration, entry.name);
      }
    });
    observerFid.observe({ type: "first-input", buffered: true });
  }
}

/**
 * Image Optimization Hook
 */
export function useOptimizedImage(
  src: string,
  options?: { width?: number; quality?: number; format?: "webp" | "jpg" | "png" },
) {
  return useMemo(() => {
    if (!src) return src;

    // Cloudflare Image Optimization kullanıyorsa
    if (src.includes("cloudflare")) {
      const params = new URLSearchParams({
        w: String(options?.width ?? 800),
        q: String(options?.quality ?? 75),
        f: options?.format ?? "auto",
      });
      return `${src}?${params}`;
    }

    return src;
  }, [src, options?.width, options?.quality, options?.format]);
}

// Type definitions
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface LargestContentfulPaintEntry extends PerformanceEntry {
  renderTime: number;
  loadTime: number;
  id: string;
}
