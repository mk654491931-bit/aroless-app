import { afterEach, describe, expect, it, vi } from "vitest";
import { deductFinderCredit } from "./credits.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withEnv(): void {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deductFinderCredit", () => {
  it("reports the remaining balance on success", async () => {
    withEnv();
    const fetchImpl = vi.fn(async () => jsonResponse(7));

    const result = await deductFinderCredit("token", fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ ok: true, remaining: 7 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/deduct_product_finder_credit");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
  });

  it("flags an exhausted balance", async () => {
    withEnv();
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "no_credits" }, 400));

    const result = await deductFinderCredit("token", fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NO_CREDITS");
  });

  it("flags an invalid session", async () => {
    withEnv();
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "JWT expired" }, 401));

    const result = await deductFinderCredit("token", fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("AUTH");
  });

  it("degrades gracefully when the service is unreachable", async () => {
    withEnv();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await deductFinderCredit("token", fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("UNAVAILABLE");
  });

  it("refuses to call out without server configuration", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(1));

    const result = await deductFinderCredit("token", fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
