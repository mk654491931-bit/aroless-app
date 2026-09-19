// Unit tests for the platform-aware discovery job budgets (pure logic — no network).
//
// Bu bütçeler 504 sınıfı hataların tek kaynağıdır: yanlış hesaplanırsa uzun
// Render işi ya çok erken kesilir (istemci zaman aşımı) ya da Vercel'in 60 sn
// limiti aşılır. Bu yüzden her platform varyantı ayrı ayrı sabitlenir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JOB_POLL_INTERVAL_MS,
  clientWaitMs,
  functionMaxDurationSeconds,
  jobPollingPlan,
  qstashTimeoutSeconds,
  runsOnLongLivedHost,
  workerBudgetMs,
  workerTargetIsLongLived,
} from "./discovery-jobs.server";

const MANAGED_KEYS = [
  "NITRO_PRESET",
  "RENDER_SERVICE_ID",
  "DISCOVERY_WORKER_URL",
  "QSTASH_TIMEOUT_SECONDS",
  "VERCEL_FUNCTION_MAX_DURATION",
];

/** Clear every budget input so each test states its own platform explicitly. */
function clearBudgetEnv() {
  for (const key of MANAGED_KEYS) vi.stubEnv(key, "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  clearBudgetEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("functionMaxDurationSeconds", () => {
  it("keeps the Vercel 60s function ceiling by default", () => {
    expect(runsOnLongLivedHost()).toBe(false);
    expect(functionMaxDurationSeconds()).toBe(60);
  });

  it("uses the Render persistent-service budget via NITRO_PRESET", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(runsOnLongLivedHost()).toBe(true);
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("also detects Render from RENDER_SERVICE_ID", () => {
    vi.stubEnv("RENDER_SERVICE_ID", "srv-abc123");
    expect(runsOnLongLivedHost()).toBe(true);
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("honours VERCEL_FUNCTION_MAX_DURATION on Vercel", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "300");
    expect(functionMaxDurationSeconds()).toBe(300);
  });

  it("ignores a stale VERCEL_FUNCTION_MAX_DURATION on Render", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "60");
    expect(functionMaxDurationSeconds()).toBe(900);
  });

  it("clamps the configured value to 900s and falls back below 10s", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "5000");
    expect(functionMaxDurationSeconds()).toBe(900);
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "5");
    expect(functionMaxDurationSeconds()).toBe(60);
  });
});

describe("workerBudgetMs / clientWaitMs", () => {
  it("keeps the Vercel fast profile", () => {
    expect(workerBudgetMs()).toBe(44_000);
    expect(clientWaitMs()).toBe(52_000);
  });

  it("gives a Render worker the full-depth budget", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(workerBudgetMs()).toBe(884_000);
    expect(clientWaitMs()).toBe(892_000);
  });

  it("never drops below the safety floors", () => {
    vi.stubEnv("VERCEL_FUNCTION_MAX_DURATION", "10");
    expect(workerBudgetMs()).toBe(25_000);
    expect(clientWaitMs()).toBe(20_000);
  });
});

describe("jobPollingPlan", () => {
  it("hands the browser the platform budget instead of a hardcoded wait", () => {
    expect(jobPollingPlan()).toEqual({
      pollMaxMs: 52_000,
      pollIntervalMs: JOB_POLL_INTERVAL_MS,
    });
    expect(JOB_POLL_INTERVAL_MS).toBe(2_000);
  });

  it("lets the browser keep polling past the old 6-minute client cap on Render", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    const plan = jobPollingPlan();
    expect(plan.pollMaxMs).toBe(892_000);
    expect(plan.pollMaxMs).toBeGreaterThan(6 * 60_000);
    // Worker bütçesi yoklamadan kısa olmalı ki istemci sonucu görmeden pes etmesin.
    expect(plan.pollMaxMs).toBeGreaterThan(workerBudgetMs());
  });
});

describe("qstashTimeoutSeconds", () => {
  it("stays inside the Vercel limit by default", () => {
    expect(qstashTimeoutSeconds()).toBe(58);
  });

  it("uses 890s on Render", () => {
    vi.stubEnv("NITRO_PRESET", "render_com");
    expect(qstashTimeoutSeconds()).toBe(890);
  });

  it("follows the worker when only DISCOVERY_WORKER_URL is set (hybrid setup)", () => {
    vi.stubEnv("DISCOVERY_WORKER_URL", "https://aroless.tech/api/worker");
    expect(workerTargetIsLongLived()).toBe(true);
    // Tetikleyici hâlâ Vercel'de: kendi istek bütçesi 60 sn kalır...
    expect(functionMaxDurationSeconds()).toBe(60);
    // ...ama QStash işçiye göre beklemeli, yoksa 504 döner.
    expect(qstashTimeoutSeconds()).toBe(890);
  });

  it("accepts an explicit override", () => {
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "120");
    expect(qstashTimeoutSeconds()).toBe(120);
  });

  it("clamps the override to 900s and ignores values below 15s", () => {
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "5000");
    expect(qstashTimeoutSeconds()).toBe(900);
    vi.stubEnv("QSTASH_TIMEOUT_SECONDS", "5");
    expect(qstashTimeoutSeconds()).toBe(58);
  });
});
