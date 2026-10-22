import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIpFromHeaders } from "./client-ip";
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

describe("clientIpFromHeaders (IP sahteciliği)", () => {
  it("X-Forwarded-For'un istemci eklediği İLK halkasını yok sayar", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("cf-connecting-ip'ye cf-ray yokken güvenmez", () => {
    const headers = new Headers({ "cf-connecting-ip": "9.9.9.9" });
    expect(clientIpFromHeaders(headers)).toBe("");
  });

  it("cf-ray varsa Cloudflare başlığını kullanır", () => {
    const headers = new Headers({ "cf-ray": "abc123", "cf-connecting-ip": "9.9.9.9" });
    expect(clientIpFromHeaders(headers)).toBe("9.9.9.9");
  });

  it("IPv4:port biçimini porttan arındırır", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7:4433" });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("Vercel başlığı diğerlerinden önce gelir", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.1",
      "x-forwarded-for": "1.1.1.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.5");
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

const ROUND2_MIGRATION = "supabase/migrations/20261023000000_security_lockdown_round2.sql";

/**
 * JETON İADESİ — İSTEMCİYE KAPALI OLMALI.
 *
 * Bulgu: `refund_product_finder_credit_for_job(uuid)` `authenticated` rolüne
 * açıktı. Kullanıcı kendi BAŞARILI araması için iade çağırıp jetonunu geri
 * alabiliyor, arama yine tamamlanıyordu → sınırsız bedava kullanım.
 */
describe("iade RPC'si istemciye kapalı", () => {
  const sql = readFileSync(ROUND2_MIGRATION, "utf8");

  it("authenticated/anon EXECUTE yetkisi kaldırılmış", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.refund_product_finder_credit_for_job\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.refund_product_finder_credit_for_job\(uuid\)\s*\n\s*TO service_role;/,
    );
  });

  it("yetki geri verilse bile yalnız BAŞARISIZ iş iade edilir", () => {
    expect(sql).toContain("job_status IS DISTINCT FROM 'failed'");
  });

  it("promosyon sayacı atomik ve sınır kontrollü", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.increment_promo_redemption");
    expect(sql).toMatch(/COALESCE\(times_redeemed, 0\) < max_redemptions/);
  });

  it("promo_redemptions istemci yazımına kapalı", () => {
    expect(sql).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.promo_redemptions FROM authenticated, anon;",
    );
  });
});

/**
 * ZAMANLAMA SALDIRISI — paylaşılan sır `!==` ile karşılaştırılırsa yanıt
 * süresinden karakter tahmini yapılabilir. Tüm sır yolları sabit zamanlı
 * karşılaştırmayı kullanmalıdır.
 */
describe("trend-radar webhook sırrı sabit zamanlı", () => {
  const source = readFileSync("src/routes/api/public/trend-radar.ts", "utf8");

  it("timingSafeEqualString kullanır", () => {
    expect(source).toContain("timingSafeEqualString(provided, secret)");
  });

  it("sır yoksa fail-closed davranır", () => {
    expect(source).toMatch(/if \(!secret \|\| !timingSafeEqualString\(provided, secret\)\)/);
  });
});

/**
 * DIŞ VERİ → URL: para birimi kodu doğrulanmadan dış servise giden adrese
 * yazılırsa path/query enjeksiyonu mümkün olur.
 */
describe("country ucu döviz kodunu doğrular", () => {
  const source = readFileSync("src/routes/api/public/country.ts", "utf8");
  it("yalnız 3 harfli ISO kodu geçer", () => {
    expect(source).toContain("/^[A-Z]{3}$/.test(cur)");
  });
});
