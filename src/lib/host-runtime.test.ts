// Platform algılama ve istek bütçeleri — 504 sınıfı hataların tek kaynağı.
//
// Bu testler her platform varyantını (Render / Vercel / kalıcı Node / dev)
// ayrı ayrı sabitler: yanlış algılama ya ağır işi istek içine geri taşır
// (504) ya da kalıcı süreçte gereksiz kısıtlar (kullanıcı beklemesi).
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INTERACTIVE_BUDGET_MS,
  DEFAULT_WARM_WAIT_MS,
  MAX_LONG_LIVED_SECONDS,
  backgroundJobTimeoutMs,
  detectHostRuntime,
  hostRuntimeSummary,
  interactiveRequestBudgetMs,
  platformDurationSeconds,
  readEnvValue,
  runsOnPersistentHost,
  warmingWaitMs,
  withDeadlineOutcome,
} from "./host-runtime.server";

describe("detectHostRuntime", () => {
  it("varsayılan olarak yerel (dev) süreç kabul eder", () => {
    const runtime = detectHostRuntime({});
    expect(runtime.name).toBe("local");
    expect(runtime.serverless).toBe(false);
    expect(runtime.backgroundJobs).toBe(true);
    // Önemli: "local" kalıcı servis sayılmaz, aksi halde Vercel varsayılanı
    // (60 sn) sessizce 900 sn'ye çıkardı.
    expect(runsOnPersistentHost({})).toBe(false);
    expect(platformDurationSeconds({})).toBe(60);
  });

  it("Render'ı RENDER_SERVICE_ID ile tanır", () => {
    const env = { RENDER_SERVICE_ID: "srv-123" };
    const runtime = detectHostRuntime(env);
    expect(runtime.name).toBe("render");
    expect(runtime.serverless).toBe(false);
    expect(runtime.backgroundJobs).toBe(true);
    expect(runsOnPersistentHost(env)).toBe(true);
  });

  it("Render'ı NITRO_PRESET=render_com ile tanır", () => {
    expect(detectHostRuntime({ NITRO_PRESET: "render_com" }).name).toBe("render");
    expect(detectHostRuntime({ NITRO_PRESET: "render-com" }).name).toBe("render");
  });

  it("kendi Node sunucusunu (VPS) kalıcı kabul eder", () => {
    const env = { NITRO_PRESET: "node-server" };
    expect(detectHostRuntime(env).name).toBe("node");
    expect(runsOnPersistentHost(env)).toBe(true);
    expect(platformDurationSeconds(env)).toBe(MAX_LONG_LIVED_SECONDS);
  });

  it("Vercel'de arka plan işi kapatır", () => {
    const env = { VERCEL: "1", VERCEL_URL: "aroless.vercel.app" };
    const runtime = detectHostRuntime(env);
    expect(runtime.name).toBe("vercel");
    expect(runtime.serverless).toBe(true);
    expect(runtime.backgroundJobs).toBe(false);
    expect(runsOnPersistentHost(env)).toBe(false);
  });

  it("Render marker'ı Vercel değişkenlerinden önce gelir", () => {
    const env = { RENDER_SERVICE_ID: "srv-1", VERCEL_URL: "x.vercel.app" };
    expect(detectHostRuntime(env).name).toBe("render");
  });

  it("BACKGROUND_JOBS ile arka plan işi zorla açılıp kapatılabilir", () => {
    expect(detectHostRuntime({ VERCEL: "1", BACKGROUND_JOBS: "1" }).backgroundJobs).toBe(true);
    expect(detectHostRuntime({ BACKGROUND_JOBS: "false" }).backgroundJobs).toBe(false);
  });
});

describe("platformDurationSeconds", () => {
  it("Render'da 900 sn verir ve eski Vercel değişkenini yok sayar", () => {
    const env = { RENDER_SERVICE_ID: "srv-1", VERCEL_FUNCTION_MAX_DURATION: "60" };
    expect(platformDurationSeconds(env)).toBe(900);
  });

  it("Vercel'de ayarlanabilir ve 900'e kırpılır", () => {
    // Marker olmasa bile Vercel değişkeni bir üst sınır olarak saygı görür
    // (eski davranış: `functionMaxDurationSeconds` ile aynı).
    expect(platformDurationSeconds({ VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(300);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(300);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "5000" })).toBe(900);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "5" })).toBe(60);
  });
});

describe("interactiveRequestBudgetMs (504 üst sınırı)", () => {
  it("Render'da varsayılan 45 sn", () => {
    expect(interactiveRequestBudgetMs({ RENDER_SERVICE_ID: "srv-1" })).toBe(
      DEFAULT_INTERACTIVE_BUDGET_MS,
    );
  });

  it("REQUEST_BUDGET_MS ile ayarlanır ve güvenli aralığa kırpılır", () => {
    const base = { RENDER_SERVICE_ID: "srv-1" };
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "30000" })).toBe(30_000);
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "1000" })).toBe(5_000);
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "999999" })).toBe(120_000);
  });

  it("Vercel'de fonksiyon limitinin 8 sn altını alır", () => {
    expect(interactiveRequestBudgetMs({ VERCEL: "1" })).toBe(52_000);
    expect(interactiveRequestBudgetMs({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(
      292_000,
    );
  });
});

describe("warmingWaitMs / backgroundJobTimeoutMs", () => {
  it("soğuk önbellekte bekleme süresi 3-25 sn arasında kalır", () => {
    expect(warmingWaitMs({})).toBe(DEFAULT_WARM_WAIT_MS);
    expect(warmingWaitMs({ WARM_WAIT_MS: "1000" })).toBe(3_000);
    expect(warmingWaitMs({ WARM_WAIT_MS: "60000" })).toBe(25_000);
    expect(warmingWaitMs({ WARM_WAIT_MS: "abc" })).toBe(DEFAULT_WARM_WAIT_MS);
  });

  it("arka plan işi zaman aşımı 15 dk ve sınırları var", () => {
    expect(backgroundJobTimeoutMs({})).toBe(900_000);
    expect(backgroundJobTimeoutMs({ BACKGROUND_JOB_TIMEOUT_MS: "10" })).toBe(30_000);
    expect(backgroundJobTimeoutMs({ BACKGROUND_JOB_TIMEOUT_MS: "99999999" })).toBe(1_800_000);
  });
});

describe("readEnvValue", () => {
  it("boş ve whitespace değerleri yok sayar, değeri kırpar", () => {
    expect(readEnvValue({ A: "  x  " }, "A")).toBe("x");
    expect(readEnvValue({ A: "   " }, "A")).toBeUndefined();
    expect(readEnvValue({ A: "" }, "A")).toBeUndefined();
    expect(readEnvValue({}, "A")).toBeUndefined();
  });
});

describe("withDeadlineOutcome", () => {
  it("süresi içinde biten sözün değerini döner", async () => {
    await expect(withDeadlineOutcome(Promise.resolve("ok"), 50)).resolves.toEqual({
      kind: "value",
      value: "ok",
    });
  });

  it("süre aşılırsa 'pending' döner (bekleyip 504 olmaz)", async () => {
    vi.useFakeTimers();
    try {
      const pending = withDeadlineOutcome(new Promise<string>(() => {}), 1_000);
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(pending).resolves.toEqual({ kind: "pending" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("hata ile 'pending' ayırt edilir (sonsuz warming olmasın)", async () => {
    await expect(withDeadlineOutcome(Promise.reject(new Error("boom")), 50)).resolves.toEqual({
      kind: "rejected",
    });
  });
});

describe("hostRuntimeSummary", () => {
  it("/health için sır içermeyen özet üretir", () => {
    const summary = hostRuntimeSummary({ RENDER_SERVICE_ID: "srv-1" });
    expect(summary).toEqual({
      runtime: "render",
      serverless: false,
      persistent: true,
      backgroundJobs: true,
      interactiveBudgetMs: DEFAULT_INTERACTIVE_BUDGET_MS,
      platformSeconds: MAX_LONG_LIVED_SECONDS,
      warmingWaitMs: DEFAULT_WARM_WAIT_MS,
    });
    expect(JSON.stringify(summary)).not.toContain("srv-1");
  });
});
