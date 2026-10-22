import { afterEach, describe, expect, it, vi } from "vitest";

import { appOrigin, verifyWorkerRequest } from "./discovery-jobs.server";
import { timingSafeEqualString } from "./safe-compare";
import { veloraRunStatus } from "./velora-orchestrator.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("timingSafeEqualString", () => {
  it("eşit sırları kabul eder", () => {
    expect(timingSafeEqualString("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("farklı uzunluk/biçimleri reddeder", () => {
    expect(timingSafeEqualString("s3cret-value", "s3cret-valuE")).toBe(false);
    expect(timingSafeEqualString("short", "longer-secret")).toBe(false);
    expect(timingSafeEqualString("", "x")).toBe(false);
  });
});

describe("appOrigin (host header enjeksiyonu)", () => {
  it("yapılandırılmış adres varken istemci başlıklarını yok sayar", () => {
    vi.stubEnv("APP_URL", "https://app.aroless.test");
    const request = new Request("https://real.example.com/api/start", {
      headers: { "x-forwarded-host": "attacker.example.net" },
    });
    expect(appOrigin(request)).toBe("https://app.aroless.test");
  });

  it("yapılandırma yokken x-forwarded-host'u kullanmaz", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    const request = new Request("https://real.example.com/api/start", {
      headers: { "x-forwarded-host": "attacker.example.net" },
    });
    expect(appOrigin(request)).toBe("https://real.example.com");
  });
});

describe("verifyWorkerRequest", () => {
  it("sır yoksa fail-closed davranır", () => {
    vi.stubEnv("JOB_WORKER_SECRET", "");
    vi.stubEnv("WORKER_SECRET", "");
    const request = new Request("https://app.test/api/worker", {
      headers: { "x-job-secret": "anything" },
    });
    expect(verifyWorkerRequest(request)).toBe(false);
  });

  it("doğru sırrı kabul eder, yanlış sırrı reddeder", () => {
    vi.stubEnv("JOB_WORKER_SECRET", "worker-secret-123");
    const ok = new Request("https://app.test/api/worker", {
      headers: { "x-job-secret": "worker-secret-123" },
    });
    const bad = new Request("https://app.test/api/worker", {
      headers: { "x-job-secret": "worker-secret-124" },
    });
    expect(verifyWorkerRequest(ok)).toBe(true);
    expect(verifyWorkerRequest(bad)).toBe(false);
  });
});

describe("veloraRunStatus — sahiplik kapısı (IDOR)", () => {
  const state = {
    runId: "run-owner-check",
    requestedBy: "user-a",
    status: "running",
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    phases: [],
  } as never;

  const deps = {
    store: {
      saveState: async () => {},
      loadState: async () => state,
      pushWinners: async () => ({ ok: true as const, ids: [] }),
      fetchWinners: async () => [],
      fetchRunWinners: async () => [],
    },
  };

  it("sahibi koşuyu okuyabilir", async () => {
    const status = await veloraRunStatus("run-owner-check", deps, { requestedBy: "user-a" });
    expect(status.status).toBe("running");
  });

  it("başka kullanıcı durum/karne göremez", async () => {
    const status = await veloraRunStatus("run-owner-check", deps, { requestedBy: "user-b" });
    expect(status.status).toBe("unknown");
    expect(status.dossier).toBeNull();
    expect(status.notes).toContain("RUN_NOT_FOUND");
  });
});
