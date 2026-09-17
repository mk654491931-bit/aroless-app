import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  HSTS_VALUE,
  isSecureRequest,
  SECURITY_HEADERS,
} from "./security-headers";

describe("applySecurityHeaders", () => {
  it("adds the standard hardening headers to every response", () => {
    const response = applySecurityHeaders(new Response("ok"));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps the status, body and pre-existing headers intact", () => {
    const original = new Response("payload", {
      status: 404,
      headers: { "content-type": "text/plain", "referrer-policy": "no-referrer" },
    });
    const response = applySecurityHeaders(original);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/plain");
    // Var olan bir başlık ezilmez.
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sends HSTS only for HTTPS responses", () => {
    const plain = applySecurityHeaders(new Response("ok"));
    expect(plain.headers.get("strict-transport-security")).toBeNull();

    const secure = applySecurityHeaders(new Response("ok"), { secure: true });
    expect(secure.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });

  it("never sends a CSP that would break inline styles or CDN assets", () => {
    const csp = SECURITY_HEADERS["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("style-src");
    expect(csp).not.toContain("img-src");
  });
});

describe("isSecureRequest", () => {
  it("detects https URLs and proxied schemes", () => {
    expect(isSecureRequest(new Request("https://aroless.com/"))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:8080/"))).toBe(false);
    expect(
      isSecureRequest(
        new Request("http://localhost:8080/", { headers: { "x-forwarded-proto": "https" } }),
      ),
    ).toBe(true);
    expect(
      isSecureRequest(
        new Request("http://localhost:8080/", { headers: { "x-forwarded-proto": "http" } }),
      ),
    ).toBe(false);
  });
});
