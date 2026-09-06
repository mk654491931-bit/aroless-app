/**
 * Environment-Specific Optimizations
 * Development, staging, production'a göre farklı ayarlar
 */

export type Environment = "development" | "staging" | "production";

export interface EnvironmentConfig {
  enableDebugger: boolean;
  enablePerformanceLogging: boolean;
  enableLongTaskWarnings: boolean;
  chunkSize: number;
  cacheStrategy: "aggressive" | "moderate" | "conservative";
  imageQuality: number;
  enableServiceWorker: boolean;
  enableAnalytics: boolean;
}

const envConfigs: Record<Environment, EnvironmentConfig> = {
  development: {
    enableDebugger: true,
    enablePerformanceLogging: true,
    enableLongTaskWarnings: true,
    chunkSize: 200 * 1024,
    cacheStrategy: "conservative",
    imageQuality: 85,
    enableServiceWorker: false,
    enableAnalytics: false,
  },
  staging: {
    enableDebugger: false,
    enablePerformanceLogging: true,
    enableLongTaskWarnings: true,
    chunkSize: 300 * 1024,
    cacheStrategy: "moderate",
    imageQuality: 80,
    enableServiceWorker: true,
    enableAnalytics: true,
  },
  production: {
    enableDebugger: false,
    enablePerformanceLogging: false,
    enableLongTaskWarnings: false,
    chunkSize: 500 * 1024,
    cacheStrategy: "aggressive",
    imageQuality: 75,
    enableServiceWorker: true,
    enableAnalytics: true,
  },
};

/**
 * Environment Configuration Manager
 */
export const envManager = {
  getCurrentEnvironment(): Environment {
    if (typeof process === "undefined") return "production";

    const env = process.env.NODE_ENV;
    if (env === "development" || env === "staging") return env;
    return "production";
  },

  getConfig(): EnvironmentConfig {
    return envConfigs[envManager.getCurrentEnvironment()];
  },

  isProduction(): boolean {
    return envManager.getCurrentEnvironment() === "production";
  },

  isDevelopment(): boolean {
    return envManager.getCurrentEnvironment() === "development";
  },

  isStaging(): boolean {
    return envManager.getCurrentEnvironment() === "staging";
  },
};

/**
 * Runtime Performance Optimization
 */
export const runtimeOptimization = {
  /**
   * RequestIdleCallback shim
   */
  requestIdleCallback(
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions,
  ): number {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      return window.requestIdleCallback(callback, options);
    }

    // Fallback to setTimeout
    const start = Date.now();
    return setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 0) as any;
  },

  /**
   * CancelIdleCallback
   */
  cancelIdleCallback(id: number): void {
    if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  },

  /**
   * Scheduled microtask
   */
  scheduleTask(
    callback: () => void,
    priority: "high" | "normal" | "low" = "normal",
  ): () => void {
    if (priority === "high") {
      // High priority: hemen çalıştır
      Promise.resolve().then(callback);
      return () => {};
    }

    if (priority === "normal" && typeof window !== "undefined" && "setTimeout" in window) {
      const id = setTimeout(callback, 0);
      return () => clearTimeout(id);
    }

    // Low priority: requestIdleCallback
    const id = runtimeOptimization.requestIdleCallback(() => callback());
    return () => runtimeOptimization.cancelIdleCallback(id);
  },
};

/**
 * React Hook - Environment Awareness
 */
import { useEffect, useRef } from "react";

export function useEnvironmentConfig() {
  const config = envManager.getConfig();

  useEffect(() => {
    if (config.enablePerformanceLogging) {
      console.log("📋 Environment Config:", {
        env: envManager.getCurrentEnvironment(),
        ...config,
      });
    }
  }, [config]);

  return config;
}

/**
 * Async Task Scheduler
 */
export class TaskScheduler {
  private taskQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private config: EnvironmentConfig;

  constructor(config?: EnvironmentConfig) {
    this.config = config || envManager.getConfig();
  }

  /**
   * Kuyruğa görev ekle
   */
  async schedule(task: () => Promise<void>): Promise<void> {
    this.taskQueue.push(task);
    return this.process();
  }

  /**
   * Görevleri işle
   */
  private async process(): Promise<void> {
    if (this.isProcessing || this.taskQueue.length === 0) return;

    this.isProcessing = true;

    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        try {
          await task();
        } catch (error) {
          console.error("Task execution failed:", error);
        }
      }

      // Yield to browser for other tasks
      await new Promise((resolve) => {
        runtimeOptimization.scheduleTask(resolve, "low");
      });
    }

    this.isProcessing = false;
  }

  /**
   * Kuyruğu temizle
   */
  clear(): void {
    this.taskQueue = [];
  }

  /**
   * Kuyruk boyutu
   */
  getSize(): number {
    return this.taskQueue.length;
  }
}

/**
 * Global Task Scheduler Instance
 */
export const globalScheduler = new TaskScheduler();
