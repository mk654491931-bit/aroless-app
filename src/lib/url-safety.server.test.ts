import { describe, expect, it } from "vitest";
import { checkExternalUrl, fetchExternalText, UnsafeUrlError } from "./url-safety.server";

describe("checkExternalUrl", () => {
  it("accepts ordinary public https URLs", () => {
    for (const url of [
      "https://example.com",
      "https://shop.example-store.com/products/1?x=2",
      "http://example.org/page",
      "https://sub.domain.co.uk.",
    ]) {
      expect(checkExternalUrl(url).ok, url).toBe(true);
    }
  });

  it("rejects non-http protocols and embedded credentials", () => {
    expect(checkExternalUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "protocol" });
    expect(checkExternalUrl("gopher://example.com")).toEqual({ ok: false, reason: "protocol" });
    expect(checkExternalUrl("https://user:pass@example.com")).toEqual({
      ok: false,
      reason: "credentials",
    });
    expect(checkExternalUrl("not a url")).toEqual({ ok: false, reason: "invalid" });
  });

  it("blocks loopback and cloud metadata hostnames", () => {
    expect(checkExternalUrl("http://localhost:5432")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
    expect(checkExternalUrl("http://LOCALHOST/admin")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
    expect(checkExternalUrl("http://metadata.google.internal/computeMetadata/v1/")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
    expect(checkExternalUrl("http://db.internal/")).toEqual({ ok: false, reason: "blocked_host" });
    expect(checkExternalUrl("http://printer.local/")).toEqual({
      ok: false,
      reason: "blocked_host",
    });
  });

  it("blocks private, loopback and link-local IP literals", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.9.9",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "198.18.0.1",
    ]) {
      expect(checkExternalUrl(`http://${ip}/`), ip).toEqual({ ok: false, reason: "blocked_ip" });
    }
  });

  it("blocks IPv6 loopback / unique-local / link-local literals", () => {
    for (const ip of ["[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[ff02::1]"]) {
      expect(checkExternalUrl(`http://${ip}/`), ip).toEqual({ ok: false, reason: "blocked_ip" });
    }
  });

  it("blocks IPv4-mapped IPv6 literals in both notations", () => {
    // The URL parser rewrites ::ffff:127.0.0.1 into the hex form, so both spellings
    // must be caught — otherwise this is a metadata/loopback bypass.
    for (const ip of ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:169.254.169.254]"]) {
      expect(checkExternalUrl(`http://${ip}/`), ip).toEqual({ ok: false, reason: "blocked_ip" });
    }
  });

  it("blocks the integer form of loopback (http://2130706433/)", () => {
    expect(checkExternalUrl("http://2130706433/")).toEqual({ ok: false, reason: "blocked_ip" });
  });

  it("still allows public IP literals", () => {
    expect(checkExternalUrl("https://93.184.216.34/").ok).toBe(true);
    expect(checkExternalUrl("https://[2606:4700:4700::1111]/").ok).toBe(true);
  });

  it("rejects absurdly long URLs", () => {
    expect(checkExternalUrl(`https://example.com/${"a".repeat(3000)}`)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("fetchExternalText", () => {
  it("refuses to fetch a blocked URL before any network call", async () => {
    await expect(fetchExternalText("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(fetchExternalText("http://localhost:8080/")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });
});
