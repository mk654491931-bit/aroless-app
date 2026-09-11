import { describe, expect, it } from "vitest";
import { clientIp, hashValue, readJsonBody } from "./api-guard.server";

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api", { method: "POST", body, headers });
}

describe("readJsonBody", () => {
  it("parses a small JSON body", async () => {
    expect(await readJsonBody(request(JSON.stringify({ plan: "Pro" })))).toEqual({ plan: "Pro" });
  });

  it("returns null for malformed JSON", async () => {
    expect(await readJsonBody(request("{broken"))).toBeNull();
  });

  it("rejects a declared oversized body without consuming it", async () => {
    expect(
      await readJsonBody(request(JSON.stringify({ a: 1 }), { "content-length": "9999999" })),
    ).toBeNull();
  });

  it("stops a streamed body that grows past the cap", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // No Content-Length on purpose: the reader itself must enforce the cap.
        for (let i = 0; i < 20; i++) controller.enqueue(encoder.encode("x".repeat(1024)));
        controller.close();
      },
    });
    const oversized = new Request("https://app.test/api", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as unknown as RequestInit);

    expect(await readJsonBody(oversized, 2048)).toBeNull();
  });

  it("accepts a streamed body inside the cap", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"ok":'));
        controller.enqueue(encoder.encode("true}"));
        controller.close();
      },
    });
    const chunked = new Request("https://app.test/api", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as unknown as RequestInit);

    expect(await readJsonBody(chunked, 1024)).toEqual({ ok: true });
  });
});

describe("clientIp", () => {
  it("prefers Cloudflare, then x-real-ip, then the first forwarded hop", () => {
    expect(clientIp(request("", { "cf-connecting-ip": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(request("", { "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(request("", { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(request(""))).toBe("unknown");
  });
});

describe("hashValue", () => {
  it("is stable, hex and never leaks the raw value", async () => {
    const hashed = await hashValue("203.0.113.7");
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
    expect(hashed).toBe(await hashValue("203.0.113.7"));
    expect(hashed).not.toContain("203");
  });
});
