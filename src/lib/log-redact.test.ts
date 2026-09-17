import { describe, expect, it } from "vitest";
import { maskEmail, maskEmails, maskIp } from "./log-redact";

describe("maskEmail", () => {
  it("keeps the domain but hides the local part", () => {
    const masked = maskEmail("ayse.yilmaz@ornek.com");
    expect(masked).toBe("ay*********@ornek.com");
    expect(masked).not.toContain("yilmaz");
    expect(masked.endsWith("@ornek.com")).toBe(true);
  });

  it("never leaks a single-letter local part", () => {
    expect(maskEmail("a@b.com")).toBe("a*@b.com");
  });

  it("degrades safely for empty or malformed input", () => {
    expect(maskEmail("")).toBe("***");
    expect(maskEmail(null)).toBe("***");
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("trailing@")).toBe("***");
  });
});

describe("maskEmails", () => {
  it("masks each recipient and never returns raw addresses", () => {
    const masked = maskEmails(["first@a.com", "second@b.com"]);
    expect(masked).toBe("fi***@a.com, se****@b.com");
    expect(masked).not.toContain("first@");
  });

  it("handles a single value and an empty list", () => {
    expect(maskEmails("solo@a.com")).toBe("so**@a.com");
    expect(maskEmails([])).toBe("***");
  });
});

describe("maskIp", () => {
  it("keeps only the network part of an IPv4 address", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.*.*");
    expect(maskIp("203.0.113.42")).not.toContain("113");
  });

  it("truncates IPv6 addresses", () => {
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:*");
  });

  it("degrades safely for unknown input", () => {
    expect(maskIp("")).toBe("***");
    expect(maskIp("unknown")).toBe("***");
  });
});
