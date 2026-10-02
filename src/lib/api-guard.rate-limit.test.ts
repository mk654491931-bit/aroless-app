// İstek sınırının dayanağı: veritabanı RPC'si yoksa ne olmalı?
//
// Ölçülen canlı hata: `[rate-limit] rpc failed Could not find the function
// public.bump_rate_limit(_bucket, _limit, _window_seconds) in the schema cache`
// — yani `supabase/migrations/20260824013156_*.sql` canlı projeye uygulanmamış.
//
// Eski davranış iki hatalıydı: sınır HİÇ uygulanmadan istekler geçiyordu ve
// her istekte log'a hata yazılıyordu. Yeni davranış: sınır bu instance içinde
// devam eder, uyarı bir kez basılır, durum `/health` üzerinden görünür.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

/** Testler arasında sayaç ve uyarı bayrakları sıfırlansın diye modülü tazele. */
async function freshModule() {
  vi.resetModules();
  vi.clearAllMocks();
  return import("./api-guard.server");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Migration uygulanmamış DB'nin verdiği hata. */
const MISSING_RPC = {
  data: null,
  error: {
    message:
      "rpc failed: Could not find the function public.bump_rate_limit(_bucket, _limit, _window_seconds) in the schema cache",
  },
};

describe("rateLimit — veritabanı RPC'si varken", () => {
  it("sınır dolmadıysa null döner ve arka uç veritabanıdır", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue({ data: true, error: null });
    await expect(mod.rateLimit("b:1", 5, 60)).resolves.toBeNull();
    expect(mod.rateLimitBackendStatus().backend).toBe("database");
    expect(rpcMock).toHaveBeenCalledWith("bump_rate_limit", {
      _bucket: "b:1",
      _limit: 5,
      _window_seconds: 60,
    });
  });

  it("sınır dolduysa 429 döner", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue({ data: false, error: null });
    const response = await mod.rateLimit("b:2", 5, 60);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
  });
});

describe("rateLimit — RPC yoksa (migration uygulanmamış)", () => {
  it("sınırı SÜREÇ İÇİNDE uygular, yani isteği açıkça geçirmez", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue(MISSING_RPC);

    const ilk = await mod.rateLimit("b:3", 2, 60);
    const ikinci = await mod.rateLimit("b:3", 2, 60);
    const ucuncu = await mod.rateLimit("b:3", 2, 60);

    expect(ilk).toBeNull();
    expect(ikinci).toBeNull();
    // Sınır yine de çalışır: eski davranışta bu istek de geçerdi (fail-open).
    expect(ucuncu?.status).toBe(429);
    expect(mod.rateLimitBackendStatus().backend).toBe("memory");
  });

  it("kovalar birbirini etkilemez", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue(MISSING_RPC);
    await mod.rateLimit("b:a", 1, 60);
    // Farklı kova kendi sayacıyla başlar.
    await expect(mod.rateLimit("b:b", 1, 60)).resolves.toBeNull();
    await expect(mod.rateLimit("b:a", 1, 60)).resolves.toMatchObject({ status: 429 });
  });

  it("RPC hatasını HER istekte log'lamaz, uyarıyı bir kez basar", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue(MISSING_RPC);
    for (let i = 0; i < 25; i += 1) await mod.rateLimit(`b:${i}`, 100, 60);

    const warnings = vi.mocked(console.warn).mock.calls;
    const errors = vi.mocked(console.error).mock.calls;
    expect(warnings).toHaveLength(1);
    expect(errors).toHaveLength(0);
    // Uyarı düzeltilebilir olmalı: migration dosyasının adı geçiyor.
    expect(String(warnings[0]?.[0])).toContain("20260824013156");
  });

  it("RPC tamamen çöktüğünde de çökmmez", async () => {
    const mod = await freshModule();
    rpcMock.mockRejectedValue(new Error("fetch failed"));
    await expect(mod.rateLimit("b:4", 10, 60)).resolves.toBeNull();
    expect(mod.rateLimitBackendStatus().backend).toBe("memory");
  });

  it("teşhis bilgisi sır içermez", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue(MISSING_RPC);
    await mod.rateLimit("b:5", 5, 60);
    const status = mod.rateLimitBackendStatus();
    expect(status.backend).toBe("memory");
    expect(status.fallbackReason ?? "").toContain("bump_rate_limit");
    expect(JSON.stringify(status)).not.toContain("service_role");
  });
});

describe("guardPublic — RPC yokken de sınırlar", () => {
  it("IP kovasıyla sınır uygular", async () => {
    const mod = await freshModule();
    rpcMock.mockResolvedValue(MISSING_RPC);
    const request = new Request("https://ornek.test/api/public/tool", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    await expect(mod.guardPublic(request, "tool", 1, 60)).resolves.toBeNull();
    await expect(mod.guardPublic(request, "tool", 1, 60)).resolves.toMatchObject({ status: 429 });
  });
});