/**
 * Advanced Performance Monitoring & Analytics
 * Web Vitals, user interaction, ve kaynak kullanımını takip et
 */

/**
 * Web Vitals Tracking
 */
export interface WebVitalsMetric {
  name: "LCP" | "FID" | "CLS" | "INP" | "TTFB";
  value: number;
  id: string;
  rating: "good" | "needs-improvement" | "poor";
  delta?: number;
}

const vitalsThresholds = {
  LCP: { good: 2500, needsImprovement: 4000 },
  FID: { good: 100, needsImprovement: 300 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  INP: { good: 200, needsImprovement: 500 },
  TTFB: { good: 600, needsImprovement: 1800 },
};

function getRating(
  metricName: keyof typeof vitalsThresholds,
  value: number,
): "good" | "needs-improvement" | "poor" {
  const threshold = vitalsThresholds[metricName];
  if (value <= threshold.good) return "good";
  if (value <= threshold.needsImprovement) return "needs-improvement";
  return "poor";
}

/**
 * Performance Observer Setup
 */
export function initializeWebVitalsTracking(
  callback?: (metric: WebVitalsMetric) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const unsubscribes: Array<() => void> = [];

  // Cumulative Layout Shift (CLS)
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as LayoutShift;
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value;
          callback?.({
            name: "CLS",
            value: clsValue,
            id: entry.name,
            rating: getRating("CLS", clsValue),
          });
        }
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
    unsubscribes.push(() => clsObserver.disconnect());
  } catch (e) {
    console.debug("CLS tracking not supported");
  }

  // Largest Contentful Paint (LCP)
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const lastEntry = list.getEntries().at(-1) as LargestContentfulPaint | undefined;
      if (lastEntry) {
        const value = lastEntry.renderTime || lastEntry.loadTime;
        callback?.({
          name: "LCP",
          value,
          id: lastEntry.id || lastEntry.url,
          rating: getRating("LCP", value),
        });
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    unsubscribes.push(() => lcpObserver.disconnect());
  } catch (e) {
    console.debug("LCP tracking not supported");
  }

  // First Input Delay (FID) / Interaction to Next Paint (INP)
  try {
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const interaction = entry as FirstInput | PerformanceEventTiming;
        const duration = "processingDuration" in interaction
          ? interaction.processingDuration
          : interaction.duration;
        callback?.({
          name: "FID",
          value: duration,
          id: entry.name,
          rating: getRating("FID", duration),
        });
      }
    });
    fidObserver.observe({ type: "first-input", buffered: true });
    unsubscribes.push(() => fidObserver.disconnect());
  } catch (e) {
    console.debug("FID tracking not supported");
  }

  // Time to First Byte (TTFB)
  try {
    const ttfbObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const nav = entry as PerformanceNavigationTiming;
        if (nav.responseStart > 0) {
          const ttfb = nav.responseStart - nav.requestStart;
          callback?.({
            name: "TTFB",
            value: ttfb,
            id: nav.name,
            rating: getRating("TTFB", ttfb),
          });
        }
      }
    });
    ttfbObserver.observe({ type: "navigation", buffered: true });
    unsubscribes.push(() => ttfbObserver.disconnect());
  } catch (e) {
    console.debug("TTFB tracking not supported");
  }

  return () => {
    unsubscribes.forEach((u) => u());
  };
}

/**
 * Resource Timing Analysis
 */
export interface ResourceMetrics {
  name: string;
  type: string;
  duration: number;
  size: number;
  cached: boolean;
}

export function getResourceMetrics(): ResourceMetrics[] {
  if (typeof window === "undefined" || !window.performance) return [];

  const resources = performance.getEntriesByType("resource");
  return resources.map((entry) => ({
    name: entry.name,
    type: entry.entryType,
    duration: (entry as PerformanceResourceTiming).duration,
    size: (entry as PerformanceResourceTiming).transferSize || 0,
    cached: (entry as PerformanceResourceTiming).transferSize === 0 &&
      (entry as PerformanceResourceTiming).decodedBodySize > 0,
  }));
}

/**
 * Memory Usage (Chrome DevTools uyumlu)
 */
export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  percentUsed: number;
}

export function getMemoryMetrics(): MemoryMetrics | null {
  if (typeof window === "undefined") return null;

  const memory = (performance as any).memory;
  if (!memory) return null;

  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    percentUsed: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
  };
}

/**
 * Long Task Detection
 */
export interface LongTaskMetric {
  name: string;
  duration: number;
  startTime: number;
}

export function trackLongTasks(callback?: (task: LongTaskMetric) => void): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        callback?.({
          name: entry.name,
          duration: entry.duration,
          startTime: entry.startTime,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    return () => observer.disconnect();
  } catch (e) {
    console.debug("Long task tracking not supported");
    return () => {};
  }
}

/**
 * React Hook - Web Vitals Monitoring
 */
import { useEffect, useState, useCallback } from "react";

export function useWebVitalsMonitoring() {
  const [metrics, setMetrics] = useState<WebVitalsMetric[]>([]);
  const [resourceMetrics, setResourceMetrics] = useState<ResourceMetrics[]>([]);
  const [memoryMetrics, setMemoryMetrics] = useState<MemoryMetrics | null>(null);

  useEffect(() => {
    // Web Vitals tracking
    const unsubscribeVitals = initializeWebVitalsTracking((metric) => {
      setMetrics((prev) => {
        const filtered = prev.filter((m) => m.name !== metric.name);
        return [...filtered, metric];
      });
    });

    // Resource metrics
    const resources = getResourceMetrics();
    setResourceMetrics(resources);

    // Memory metrics (her 5 saniyede)
    const memoryInterval = setInterval(() => {
      setMemoryMetrics(getMemoryMetrics());
    }, 5000);

    return () => {
      unsubscribeVitals();
      clearInterval(memoryInterval);
    };
  }, []);

  const getMetricByName = useCallback(
    (name: WebVitalsMetric["name"]) => metrics.find((m) => m.name === name),
    [metrics],
  );

  return { metrics, resourceMetrics, memoryMetrics, getMetricByName };
}

/**
 * Performance Report Generator
 */
export interface PerformanceReport {
  url: string;
  timestamp: number;
  vitals: Record<string, WebVitalsMetric | undefined>;
  resources: ResourceMetrics[];
  memory: MemoryMetrics | null;
  slowestResources: ResourceMetrics[];
  recommendations: string[];
}

export function generatePerformanceReport(): PerformanceReport {
  const metrics = initializeWebVitalsTracking();

  const vitalsMetrics: Record<string, WebVitalsMetric | undefined> = {
    LCP: undefined,
    FID: undefined,
    CLS: undefined,
    TTFB: undefined,
  };

  const resources = getResourceMetrics();
  const memory = getMemoryMetrics();

  // En yavaş 5 kaynağı bul
  const slowestResources = resources.sort((a, b) => b.duration - a.duration).slice(0, 5);

  // Öneriler oluştur
  const recommendations: string[] = [];

  if (slowestResources.length > 0) {
    recommendations.push(
      `Optimize ${slowestResources[0].name.split("/").pop()}: ${slowestResources[0].duration.toFixed(0)}ms`,
    );
  }

  if (memory && memory.percentUsed > 80) {
    recommendations.push("Memory usage high - check for memory leaks");
  }

  const uncachedResources = resources.filter((r) => !r.cached);
  if (uncachedResources.length > 5) {
    recommendations.push(`${uncachedResources.length} resources not cached - enable caching`);
  }

  return {
    url: typeof window !== "undefined" ? window.location.href : "",
    timestamp: Date.now(),
    vitals: vitalsMetrics,
    resources,
    memory,
    slowestResources,
    recommendations,
  };
}

// Type definitions
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface LargestContentfulPaint extends PerformanceEntry {
  renderTime: number;
  loadTime: number;
  id: string;
  url: string;
}

interface FirstInput extends PerformanceEntry {
  duration: number;
  processingStart: number;
  processingDuration: number;
}

interface PerformanceEventTiming extends PerformanceEntry {
  processingDuration: number;
  toJSON: () => object;
}
