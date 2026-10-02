// Platform algılama ve istek bütçeleri — 504 sınıfı hataların tek kaynağı.
//
// Bu testler her platform varyantını (Vercel / kalıcı Node / dev)
// ayrı ayrı sabitler: yanlış algılama ya ağır işi istek içine geri taşır
// (504) ya da kalıcı süreçte gereksiz kısıtlar (kullanıcı beklemesi).
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INTERACTIVE_BUDGET_MS,
  DEFAULT_WARM_WAIT_MS,
  MAX_LONG_LIVED_SECONDS,
  REQUEST_BUDGET_EXCEEDED_CODE,
  VERCEL_DEFAULT_FUNCTION_SECONDS,
  backgroundJobTimeoutMs,
  budgetExceededPayload,
  detectHostRuntime,
  hostRuntimeSummary,
  interactiveRequestBudgetMs,
  platformDurationSeconds,
  readEnvValue,
  requestDeadlineMs,
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
    // sessizce 900 sn'ye çıkardı.
    expect(runsOnPersistentHost({})).toBe(false);
    expect(platformDurationSeconds({})).toBe(300);
  });

  it("kendi Node sunucusunu (VPS) kalıcı kabul eder", () => {
    const env = { NITRO_PRESET: "node-server" };
    const runtime = detectHostRuntime(env);
    expect(runtime.name).toBe("node");
    expect(runtime.serverless).toBe(false);
    expect(runtime.persistent).toBe(true);
    expect(runtime.backgroundJobs).toBe(true);
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

  it("sunucusuz ortam, kalıcı Node preset'inden önce gelir", () => {
    // Göçten kalmış bir preset, ortamı asla sunucusuzdan çeviremez: aksi halde
    // 504 korumasının tamamı sessizce kapanırdı.
    const env = { NITRO_PRESET: "node-server", VERCEL_URL: "x.vercel.app" };
    expect(detectHostRuntime(env).name).toBe("vercel");
  });

  it("BACKGROUND_JOBS ile arka plan işi zorla açılıp kapatılabilir", () => {
    expect(detectHostRuntime({ VERCEL: "1", BACKGROUND_JOBS: "1" }).backgroundJobs).toBe(true);
    expect(detectHostRuntime({ BACKGROUND_JOBS: "false" }).backgroundJobs).toBe(false);
  });
});

describe("platformDurationSeconds", () => {
  it("kalıcı süreçte 900 sn verir ve eski Vercel değişkenini yok sayar", () => {
    const env = { NITRO_PRESET: "node-server", VERCEL_FUNCTION_MAX_DURATION: "60" };
    expect(platformDurationSeconds(env)).toBe(900);
  });

  it("Vercel'de ayarlanabilir ve 900'e kırpılır", () => {
    // Marker olmasa bile Vercel değişkeni bir üst sınır olarak saygı görür
    // (eski davranış: `functionMaxDurationSeconds` ile aynı).
    expect(platformDurationSeconds({ VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(300);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(300);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "5000" })).toBe(900);
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "5" })).toBe(300);
    // Eski varsayılanı isteyen kurulumlar env ile daraltabilir (fast profil).
    expect(platformDurationSeconds({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "60" })).toBe(60);
  });
});

describe("interactiveRequestBudgetMs (504 üst sınırı)", () => {
  it("kalıcı süreçte varsayılan 45 sn", () => {
    expect(interactiveRequestBudgetMs({ NITRO_PRESET: "node-server" })).toBe(
      DEFAULT_INTERACTIVE_BUDGET_MS,
    );
  });

  it("REQUEST_BUDGET_MS ile ayarlanır ve güvenli aralığa kırpılır", () => {
    const base = { NITRO_PRESET: "node-server" };
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "30000" })).toBe(30_000);
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "1000" })).toBe(5_000);
    expect(interactiveRequestBudgetMs({ ...base, REQUEST_BUDGET_MS: "999999" })).toBe(120_000);
  });

  it("Vercel'de fonksiyon limitinin 8 sn altını alır", () => {
    // Vercel Hobby güncel limiti 300 sn → istek bütçesi 292 sn.
    expect(interactiveRequestBudgetMs({ VERCEL: "1" })).toBe(292_000);
    expect(interactiveRequestBudgetMs({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "300" })).toBe(
      292_000,
    );
    expect(interactiveRequestBudgetMs({ VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "60" })).toBe(
      52_000,
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

// 504'ün yapısal olarak imkânsız olması bu fonksiyona bağlıdır: sunucusuz
// platformda yanıt, platform işi öldürmeden ÖNCE üretilmek zorundadır.
describe("requestDeadlineMs (504'ü imkânsız kılan kesme noktası)", () => {
  it("Vercel'de fonksiyon limitinin altında bir kesme noktası verir", () => {
    const env = { VERCEL: "1", VERCEL_URL: "aroless.vercel.app" };
    const deadline = requestDeadlineMs(env);
    expect(deadline).toBe((VERCEL_DEFAULT_FUNCTION_SECONDS - 8) * 1000);
    expect(deadline).toBe(292_000);
    // Sözün tamamı: kesme noktası platform limitinden KÜÇÜK olmalı, yoksa
    // yanıt yarışı kaybeder ve kullanıcı yine 504 görür.
    expect(deadline!).toBeLessThan(platformDurationSeconds(env) * 1000);
  });

  it("daraltılmış fonksiyon limitini izler", () => {
    const env = { VERCEL: "1", VERCEL_FUNCTION_MAX_DURATION: "60" };
    expect(requestDeadlineMs(env)).toBe(52_000);
    expect(requestDeadlineMs(env)!).toBeLessThan(60_000);
  });

  it("kalıcı süreçte global kesme YOK (uç nokta bütçeleri yeterli)", () => {
    // Kendi Node sunucumuzda iş isteği platform kesmez; burada 45 sn'lik bir
    // global tavan uzun analizleri haksız yere keserdi.
    expect(requestDeadlineMs({ NITRO_PRESET: "node-server" })).toBeUndefined();
    // Dev sunucusu da kalıcıdır.
    expect(requestDeadlineMs({})).toBeUndefined();
  });

  it("bütçe dolduğunda dönen gövde hata değil durum bildirir", () => {
    const payload = budgetExceededPayload();
    expect(payload.code).toBe(REQUEST_BUDGET_EXCEEDED_CODE);
    expect(payload.status).toBe("warming");
    // Yeniden denenebilir olması, 504 yerine 503 dönmenin tek sebebidir.
    expect(payload.retryable).toBe(true);
    expect(payload.error.length).toBeGreaterThan(10);
  });
});

describe("hostRuntimeSummary", () => {
  it("/health için sır içermeyen özet üretir", () => {
    const summary = hostRuntimeSummary({ NITRO_PRESET: "node-server" });
    expect(summary).toEqual({
      runtime: "node",
      serverless: false,
      persistent: true,
      backgroundJobs: true,
      interactiveBudgetMs: DEFAULT_INTERACTIVE_BUDGET_MS,
      platformSeconds: MAX_LONG_LIVED_SECONDS,
      warmingWaitMs: DEFAULT_WARM_WAIT_MS,
    });
    expect(JSON.stringify(summary)).not.toContain("node-server");
  });
});
