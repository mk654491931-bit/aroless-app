/**
 * Environment-Specific Optimizations
 * Development, staging, production'a göre farklı ayarlar
 */

import { useEffect } from "react";
import {
  cancelIdleTask,
  requestIdleTask,
  scheduleTask as scheduleSharedTask,
} from "@/lib/runtime-scheduling";

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
    return requestIdleTask(callback, options);
  },

  /**
   * CancelIdleCallback
   */
  cancelIdleCallback(id: number): void {
    cancelIdleTask(id);
  },

  /**
   * Scheduled microtask
   */
  scheduleTask(callback: () => void, priority: "high" | "normal" | "low" = "normal"): () => void {
    return scheduleSharedTask(callback, priority);
  },
};

export function useEnvironmentConfig() {
  const config = envManager.getConfig();

  useEffect(() => {
    if (config.enablePerformanceLogging) {
      console.log("📋 Environment Config:", {
        env: envManager.getCurrentEnvironment(),
        ...config,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return config;
}

/**
 * Async Task Scheduler
 */
export class TaskScheduler {
  private taskQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;

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
      await new Promise<void>((resolve) => {
        runtimeOptimization.scheduleTask(() => resolve(), "low");
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
