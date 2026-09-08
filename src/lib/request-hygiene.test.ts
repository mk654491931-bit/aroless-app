import { describe, it, expect } from "vitest";
import {
  byteLength,
  declaredContentLength,
  isWithinByteLimit,
  pickClientIp,
  sanitizeLine,
  sanitizeText,
  UNKNOWN_IP,
} from "@/lib/request-hygiene";

function headers(map: Record<string, string>) {
  return (name: string) => map[name.toLowerCase()] ?? null;
}

describe("pickClientIp", () => {
  it("prefers the platform header", () => {
    expect(
      pickClientIp(
        headers({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }),
      ),
    ).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip", () => {
    expect(pickClientIp(headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("uses only the first x-forwarded-for entry", () => {
    expect(pickClientIp(headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1, 10.0.0.2" }))).toBe(
      "3.3.3.3",
    );
  });

  it("ignores cf-connecting-ip by default", () => {
    // No Cloudflare in front of a Vercel deployment, so this header is just
    // client input. Trusting it lets one caller mint unlimited rate buckets.
    expect(
      pickClientIp(headers({ "cf-connecting-ip": "6.6.6.6", "x-real-ip": "2.2.2.2" })),
    ).toBe("2.2.2.2");
  });

  it("honours cf-connecting-ip when Cloudflare is trusted", () => {
    expect(
      pickClientIp(headers({ "cf-connecting-ip": "6.6.6.6", "x-real-ip": "2.2.2.2" }), {
        trustCloudflare: true,
      }),
    ).toBe("6.6.6.6");
  });

  it("does not let a spoofed cf header create a second bucket", () => {
    const a = pickClientIp(headers({ "x-real-ip": "2.2.2.2", "cf-connecting-ip": "7.0.0.1" }));
    const b = pickClientIp(headers({ "x-real-ip": "2.2.2.2", "cf-connecting-ip": "7.0.0.2" }));
    expect(a).toBe(b);
  });

  it("returns the unknown marker when nothing is present", () => {
    expect(pickClientIp(headers({}))).toBe(UNKNOWN_IP);
  });

  it("treats blank headers as absent", () => {
    expect(pickClientIp(headers({ "x-real-ip": "   ", "x-forwarded-for": "4.4.4.4" }))).toBe(
      "4.4.4.4",
    );
  });
});

describe("byteLength / isWithinByteLimit", () => {
  it("counts ascii as one byte", () => {
    expect(byteLength("abc")).toBe(3);
  });

  it("counts Turkish characters as two bytes", () => {
    expect(byteLength("ş")).toBe(2);
  });

  it("counts emoji as four bytes", () => {
    expect(byteLength("\u{1F600}")).toBe(4);
  });

  it("rejects a payload that passes a UTF-16 length check but exceeds the byte cap", () => {
    const body = "ş".repeat(40);
    expect(body.length).toBe(40);
    expect(byteLength(body)).toBe(80);
    expect(isWithinByteLimit(body, 64)).toBe(false);
  });

  it("accepts a payload exactly at the cap", () => {
    expect(isWithinByteLimit("a".repeat(64), 64)).toBe(true);
  });
});

describe("declaredContentLength", () => {
  it("reads a numeric content-length", () => {
    expect(declaredContentLength(headers({ "content-length": "128" }))).toBe(128);
  });

  it("returns null when absent", () => {
    expect(declaredContentLength(headers({}))).toBeNull();
  });

  it("returns null for a non-numeric value", () => {
    expect(declaredContentLength(headers({ "content-length": "lots" }))).toBeNull();
  });

  it("returns null for a negative value", () => {
    expect(declaredContentLength(headers({ "content-length": "-1" }))).toBeNull();
  });
});

describe("sanitizeText", () => {
  it("returns an empty string for non-strings", () => {
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(42)).toBe("");
    expect(sanitizeText({})).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeText("  mug  ")).toBe("mug");
  });

  it("strips null bytes and control characters", () => {
    expect(sanitizeText("mu\u0000g\u0007")).toBe("mug");
  });

  it("strips zero-width and bidi-override characters", () => {
    expect(sanitizeText("mu\u200Bg\u202Eevil")).toBe("mugevil");
  });

  it("keeps newlines and tabs", () => {
    expect(sanitizeText("line one\nline two")).toBe("line one\nline two");
  });

  it("keeps Turkish characters intact", () => {
    expect(sanitizeText("ışteğiüöç İŞTEĞİÜÖÇ")).toBe("ışteğiüöç İŞTEĞİÜÖÇ");
  });

  it("keeps punctuation and quotes, because queries are not markup", () => {
    expect(sanitizeText("o'ring \"seal\" 3mm & 5mm")).toBe("o'ring \"seal\" 3mm & 5mm");
  });

  it("collapses runs of spaces", () => {
    expect(sanitizeText("led    strip")).toBe("led strip");
  });

  it("caps the length", () => {
    expect(sanitizeText("a".repeat(5000))).toHaveLength(2000);
  });

  it("honours a custom cap", () => {
    expect(sanitizeText("abcdef", 3)).toBe("abc");
  });
});

describe("sanitizeLine", () => {
  it("folds newlines into spaces", () => {
    expect(sanitizeLine("mug\n\nholder")).toBe("mug holder");
  });

  it("caps at 200 characters by default", () => {
    expect(sanitizeLine("a".repeat(500))).toHaveLength(200);
  });

  it("strips a smuggled control character", () => {
    expect(sanitizeLine("code\u0000123")).toBe("code123");
  });
});
