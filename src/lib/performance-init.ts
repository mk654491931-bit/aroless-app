/**
 * Performance Initialization Module
 * Tüm optimizasyonları başlat ve koordine et
 */

import { initializeWebVitalsTracking } from "./advanced-performance";
import { sessionManager, deviceDetection, networkAwareness } from "./session-persistence";
import { mobileOptimization } from "./mobile-optimization";

export interface PerformanceInitOptions {
  enableWebVitals?: boolean;
  enableSessionPersistence?: boolean;
  enableMobileOptimizations?: boolean;
  enableNetworkAwareness?: boolean;
  onMetric?: (metric: {
    name: string;
    value: number;
    rating: "good" | "needs-improvement" | "poor";
  }) => void;
  debug?: boolean;
}

/**
 * Ana performans başlatıcı
 */
export function initializePerformanceOptimizations(
  options: PerformanceInitOptions = {},
): () => void {
  const {
    enableWebVitals = true,
    enableSessionPersistence = true,
    enableMobileOptimizations = true,
    enableNetworkAwareness = true,
    onMetric,
    debug = false,
  } = options;

  const cleanups: Array<() => void> = [];

  if (debug) {
    console.log("🚀 Initializing performance optimizations...");
  }

  // 1. Session Persistence Başlat
  if (enableSessionPersistence) {
    const session = sessionManager.getSession();
    if (session && debug) {
      console.log("✅ Session restored:", session);
    }
  }

  // 2. Web Vitals Tracking — idle'a ertelenir, ana thread bloklanmaz
  if (enableWebVitals && typeof window !== "undefined") {
    let unsubscribeVitals: (() => void) | null = null;
    let vitalsIdle: number | null = null;
    const pendingVitals: Record<string, number> = {};
    let vitalsFlushTimer: number | null = null;
    const flushVitals = () => {
      vitalsFlushTimer = null;
      if (Object.keys(pendingVitals).length === 0) return;
      const snapshot = { ...pendingVitals };
      for (const k of Object.keys(pendingVitals)) delete pendingVitals[k];
      const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const doWrite = () => {
        try {
          sessionManager.updateField("lastWebVitals", snapshot as unknown as Record<string, number>);
        } catch { /* yoksay */ }
      };
      if (typeof idle === "function") idle(doWrite, { timeout: 2000 });
      else setTimeout(doWrite, 300);
    };
    const scheduleIdle = (cb: () => void) => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === "function") return ric(cb, { timeout: 2500 });
      return window.setTimeout(cb, 900) as unknown as number;
    };
    const cancelIdle = (id: number) => {
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (typeof cic === "function") cic(id);
      else clearTimeout(id);
    };
    vitalsIdle = scheduleIdle(() => {
      vitalsIdle = null;
      unsubscribeVitals = initializeWebVitalsTracking((metric) => {
        if (debug) {
          console.log(`📊 ${metric.name}: ${metric.value.toFixed(2)}ms (${metric.rating})`);
        }
        onMetric?.(metric);
        if (enableSessionPersistence) {
          pendingVitals[metric.name] = metric.value;
          if (vitalsFlushTimer === null) vitalsFlushTimer = window.setTimeout(flushVitals, 1200) as unknown as number;
        }
      });
    });
    cleanups.push(() => {
      if (vitalsIdle !== null) cancelIdle(vitalsIdle);
      if (vitalsFlushTimer !== null) clearTimeout(vitalsFlushTimer);
      unsubscribeVitals?.();
    });
  }

  // 3. Mobile Optimizations
  if (enableMobileOptimizations && typeof document !== "undefined") {
    mobileOptimization.setupViewport();
    mobileOptimization.optimizeTouchActions();

    const unsubscribeDoubleClick = mobileOptimization.preventDoubleClickZoom();
    const unsubscribeScroll = mobileOptimization.enablePassiveScrollListener();

    cleanups.push(unsubscribeDoubleClick);
    cleanups.push(unsubscribeScroll);

    if (debug && deviceDetection.isMobile()) {
      console.log("📱 Mobile optimizations enabled");
      console.log("  Device:", {
        type: deviceDetection.getDeviceType(),
        isTouch: deviceDetection.isTouchDevice(),
        pixelRatio: deviceDetection.getPixelRatio(),
        dataSaver: deviceDetection.isDataSaver(),
      });
    }
  }

  // 4. Network Awareness
  if (enableNetworkAwareness && typeof navigator !== "undefined") {
    const unsubscribe = networkAwareness.onConnectionChange((isOnline) => {
      if (debug) {
        console.log(isOnline ? "📡 Back online" : "📡 Offline");
      }

      if (enableSessionPersistence) {
        sessionManager.updateField("isOnline", isOnline);
      }
    });

    cleanups.push(unsubscribe);

    if (debug) {
      console.log("🌐 Network Info:", {
        isOnline: networkAwareness.isOnline(),
        effectiveType: networkAwareness.getEffectiveType(),
        isSlowNetwork: networkAwareness.isSlowNetwork(),
      });
    }
  }

  // 5. Long-task observer — sadece debug'ta ve idle'da kurulur (prod'da kapalı)
  if (debug && typeof window !== "undefined" && "performance" in window && "PerformanceObserver" in window) {
    let ltIdle: number | null = null;
    let ltObserver: PerformanceObserver | null = null;
    const ric2 = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const setup = () => {
      ltIdle = null;
      try {
        ltObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 200) console.warn(`⚠️ Long task: ${entry.name} (${entry.duration.toFixed(0)}ms)`);
          }
        });
        ltObserver.observe({ type: "longtask", buffered: true });
      } catch { /* desteklenmiyor */ }
    };
    if (typeof ric2 === "function") ltIdle = ric2(setup, { timeout: 4000 });
    else ltIdle = window.setTimeout(setup, 1500) as unknown as number;
    cleanups.push(() => {
      if (ltIdle !== null) {
        const cic2 = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cic2 === "function") cic2(ltIdle);
        else clearTimeout(ltIdle);
      }
      ltObserver?.disconnect();
    });
  }

  // 6. Cleanup function
  return () => {
    cleanups.forEach((cleanup) => cleanup());
    if (debug) {
      console.log("🛑 Performance optimizations cleaned up");
    }
  };
}

/**
 * Performance Report Generator
 */
export async function generatePerformanceReport(options?: {
  includeResources?: boolean;
  includeMemory?: boolean;
}): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  // Device info
  if (typeof navigator !== "undefined") {
    report.device = {
      type: deviceDetection.getDeviceType(),
      isTouch: deviceDetection.isTouchDevice(),
      pixelRatio: deviceDetection.getPixelRatio(),
      userAgent: navigator.userAgent,
    };
  }

  // Network info
  if (typeof navigator !== "undefined") {
    report.network = {
      isOnline: networkAwareness.isOnline(),
      effectiveType: networkAwareness.getEffectiveType(),
      isSlowNetwork: networkAwareness.isSlowNetwork(),
    };
  }

  // Performance metrics
  if (typeof window !== "undefined" && "performance" in window) {
    const perfData = performance.timing;
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;

    report.performance = {
      pageLoadTime,
      domContentLoaded: perfData.domContentLoadedEventEnd - perfData.navigationStart,
      firstPaint: perfData.responseEnd - perfData.navigationStart,
    };

    if (options?.includeResources) {
      const resources = performance.getEntriesByType("resource");
      report.resources = {
        count: resources.length,
        totalSize: resources.reduce((sum, r) => sum + ((r as any).transferSize || 0), 0),
        totalDuration: resources.reduce((sum, r) => sum + r.duration, 0),
      };
    }
  }

  // Memory info
  if (typeof (performance as any).memory !== "undefined" && options?.includeMemory) {
    const memory = (performance as any).memory;
    report.memory = {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      percentUsed: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2),
    };
  }

  // Session info
  const session = sessionManager.getSession();
  if (session) {
    report.session = {
      lastRoute: session.lastRoute,
      theme: session.theme,
      language: session.language,
    };
  }

  return report;
}

/**
 * Performance Hints - Optimize etmek için öneriler
 */
export async function getPerformanceHints(): Promise<string[]> {
  const hints: string[] = [];

  // Network hints
  if (networkAwareness.isSlowNetwork()) {
    hints.push("🐢 Slow network detected - consider using lower quality images");
  }

  // Device hints
  if (deviceDetection.isMobile()) {
    hints.push("📱 Mobile device - ensure touch-friendly interactions");
  }

  if (deviceDetection.isDataSaver()) {
    hints.push("💾 Data saver mode enabled - use lower quality resources");
  }

  // Memory hints
  if (typeof (performance as any).memory !== "undefined") {
    const memory = (performance as any).memory;
    const percentUsed = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

    if (percentUsed > 80) {
      hints.push("⚠️ High memory usage - check for memory leaks");
    }
  }

  // Resource hints
  if (typeof window !== "undefined" && "performance" in window) {
    const resources = performance.getEntriesByType("resource");
    const slowResources = resources.filter((r) => r.duration > 1000);

    if (slowResources.length > 0) {
      hints.push(
        `⏱️ ${slowResources.length} slow resources detected - consider optimization`,
      );
    }
  }

  return hints;
}

/**
 * React Hook - Performance Init
 */
import { useEffect } from "react";

export function usePerformanceInit(options?: PerformanceInitOptions) {
  useEffect(() => {
    const cleanup = initializePerformanceOptimizations({
      ...options,
      debug: process.env.NODE_ENV === "development",
    });

    return cleanup;
  }, []);
}

/**
 * Development Helper - Performance Dashboard Data
 */
export async function getPerformanceDashboardData() {
  const report = await generatePerformanceReport({
    includeResources: true,
    includeMemory: true,
  });

  const hints = await getPerformanceHints();

  return {
    report,
    hints,
    summary: {
      lastRoute: sessionManager.getSession()?.lastRoute,
      performance: "good", // Heuristic olarak belirlenecek
      suggestions: hints.length,
    },
  };
}
