/**
 * Memory Leak Prevention & Monitoring
 * Subscriptions, event listeners, intervals otomatik temizle
 */

import { useEffect, useRef, useCallback } from "react";

/**
 * Memory leak prevention context manager
 */
export class MemoryManager {
  private subscriptions: Set<() => void> = new Set();
  private intervals: Set<number> = new Set();
  private timeouts: Set<number> = new Set();
  private eventListeners: Array<{
    target: EventTarget;
    event: string;
    handler: EventListener;
  }> = [];
  private observers: Set<MutationObserver | ResizeObserver | IntersectionObserver> =
    new Set();

  /**
   * Register cleanup function
   */
  registerCleanup(cleanup: () => void) {
    this.subscriptions.add(cleanup);
    return cleanup;
  }

  /**
   * Safe setInterval - otomatik cleanup
   */
  setInterval(callback: () => void, interval: number): number {
    const id = window.setInterval(callback, interval);
    this.intervals.add(id);
    return id;
  }

  /**
   * Safe setTimeout - otomatik cleanup
   */
  setTimeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      callback();
      this.timeouts.delete(id);
    }, delay);
    this.timeouts.add(id);
    return id;
  }

  /**
   * Safe addEventListener - otomatik cleanup
   */
  addEventListener(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: EventListenerOptions
  ) {
    target.addEventListener(event, handler, options);
    this.eventListeners.push({ target, event, handler });
  }

  /**
   * Register observer
   */
  registerObserver(observer: MutationObserver | ResizeObserver | IntersectionObserver) {
    this.observers.add(observer);
    return observer;
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    // Subscriptions
    this.subscriptions.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.error("Cleanup error:", error);
      }
    });
    this.subscriptions.clear();

    // Intervals
    this.intervals.forEach((id) => window.clearInterval(id));
    this.intervals.clear();

    // Timeouts
    this.timeouts.forEach((id) => window.clearTimeout(id));
    this.timeouts.clear();

    // Event listeners
    this.eventListeners.forEach(({ target, event, handler }) => {
      try {
        target.removeEventListener(event, handler);
      } catch (error) {
        console.error("Event listener removal error:", error);
      }
    });
    this.eventListeners = [];

    // Observers
    this.observers.forEach((observer) => {
      try {
        observer.disconnect();
      } catch (error) {
        console.error("Observer disconnect error:", error);
      }
    });
    this.observers.clear();
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      subscriptions: this.subscriptions.size,
      intervals: this.intervals.size,
      timeouts: this.timeouts.size,
      eventListeners: this.eventListeners.length,
      observers: this.observers.size,
    };
  }
}

/**
 * useMemoryManager hook - Component cleanup automatic
 */
export function useMemoryManager() {
  const managerRef = useRef<MemoryManager>(new MemoryManager());

  useEffect(() => {
    return () => {
      managerRef.current.cleanup();
    };
  }, []);

  return managerRef.current;
}

/**
 * useAutoCleanup hook - Async effects'i otomatik temizle
 */
export function useAutoCleanup(
  effect: (manager: MemoryManager) => void | (() => void),
  deps?: React.DependencyList
) {
  const manager = useMemoryManager();

  useEffect(() => {
    const cleanup = effect(manager);
    return () => {
      if (cleanup) cleanup();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Detect memory leaks in development
 */
export function setupMemoryLeakDetection() {
  if (process.env.NODE_ENV !== "development") return;

  const threshold = 50 * 1024 * 1024; // 50MB
  let previousMemory = 0;

  const checkMemory = () => {
    if (!performance.memory) return;

    const currentMemory = performance.memory.usedJSHeapSize;
    const diff = currentMemory - previousMemory;

    if (diff > threshold) {
      console.warn(
        `⚠️ Potential memory leak detected: +${(diff / 1024 / 1024).toFixed(2)}MB`
      );
    }

    previousMemory = currentMemory;
  };

  // Check every 5 seconds
  const interval = window.setInterval(checkMemory, 5000);
  return () => window.clearInterval(interval);
}

/**
 * Weak reference based cache (otomatik garbage collection)
 */
export class WeakCache<T> {
  private cache = new WeakMap<object, T>();

  set(key: object, value: T) {
    this.cache.set(key, value);
  }

  get(key: object): T | undefined {
    return this.cache.get(key);
  }

  has(key: object): boolean {
    return this.cache.has(key);
  }
}

/**
 * Memory-efficient resource pool
 */
export class ResourcePool<T> {
  private available: T[] = [];
  private inUse: Set<T> = new Set();
  private factory: () => T;
  private reset: (item: T) => void;
  private maxSize: number;

  constructor(factory: () => T, reset: (item: T) => void, maxSize: number = 10) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;

    // Pre-allocate
    for (let i = 0; i < maxSize; i++) {
      this.available.push(factory());
    }
  }

  acquire(): T {
    let item = this.available.pop();
    if (!item) {
      item = this.factory();
    }
    this.inUse.add(item);
    return item;
  }

  release(item: T) {
    if (!this.inUse.has(item)) return;
    this.inUse.delete(item);

    if (this.available.length < this.maxSize) {
      this.reset(item);
      this.available.push(item);
    }
  }

  getStats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }
}

/**
 * Detach DOM nodes safely
 */
export function safeDetachDOM(element: Element | null) {
  if (!element) return;

  // Remove event listeners
  const clone = element.cloneNode(true);
  element.replaceWith(clone);

  // Clear references
  element = null;
}

/**
 * Clear large objects
 */
export function clearLargeObject(obj: any) {
  if (!obj) return;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      obj[key] = undefined;
      delete obj[key];
    }
  }
}

/**
 * CSS-in-JS memory optimization
 */
export class StyleCache {
  private cache = new Map<string, CSSStyleSheet>();
  private maxSize = 20;

  addStyle(id: string, css: string): CSSStyleSheet | null {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    if (typeof document === "undefined") return null;

    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);

    const sheet = style.sheet as CSSStyleSheet;
    if (sheet) {
      this.cache.set(id, sheet);
    }

    // Memory management
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      const firstStyle = document.getElementById(firstKey);
      if (firstStyle) firstStyle.remove();
      this.cache.delete(firstKey);
    }

    return sheet || null;
  }

  removeStyle(id: string) {
    const style = document.getElementById(id);
    if (style) style.remove();
    this.cache.delete(id);
  }

  clear() {
    this.cache.forEach((_, id) => {
      const style = document.getElementById(id);
      if (style) style.remove();
    });
    this.cache.clear();
  }
}

export const styleCache = new StyleCache();
