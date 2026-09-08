import { describe, it, expect } from "vitest";
import {
  DEFAULT_REDIRECT,
  initialAuthMode,
  passwordStrength,
  referralCodeFromSearch,
  safeRedirectPath,
  STRENGTH_LABELS,
  strengthLabel,
} from "@/lib/auth-redirect";

describe("safeRedirectPath", () => {
  it("returns the default when there is no redirect param", () => {
    expect(safeRedirectPath("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("?mode=signup")).toBe(DEFAULT_REDIRECT);
  });

  it("keeps a same-origin absolute path", () => {
    expect(safeRedirectPath("?redirect=/dashboard")).toBe("/dashboard");
  });

  it("preserves nested paths, query and hash", () => {
    expect(safeRedirectPath("?redirect=%2Fstudio%3Fproduct%3Dmug%23top")).toBe(
      "/studio?product=mug#top",
    );
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("?redirect=//evil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects a backslash protocol-relative URL", () => {
    // Browsers resolve /\evil.com like //evil.com, so blocking only "//"
    // would leave an open redirect. This is the case the old inline check missed.
    expect(safeRedirectPath("?redirect=%2F%5Cevil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects absolute external URLs", () => {
    expect(safeRedirectPath("?redirect=https%3A%2F%2Fevil.com")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects a javascript: payload", () => {
    expect(safeRedirectPath("?redirect=javascript%3Aalert(1)")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects a relative path with no leading slash", () => {
    expect(safeRedirectPath("?redirect=dashboard")).toBe(DEFAULT_REDIRECT);
  });

  it("treats an empty redirect as absent", () => {
    expect(safeRedirectPath("?redirect=")).toBe(DEFAULT_REDIRECT);
  });

  it("allows a bare slash", () => {
    expect(safeRedirectPath("?redirect=%2F")).toBe("/");
  });

  it("works with a leading search string without the question mark", () => {
    expect(safeRedirectPath("redirect=/pricing")).toBe("/pricing");
  });
});

describe("initialAuthMode", () => {
  it("opens the signup tab for mode=signup", () => {
    expect(initialAuthMode("?mode=signup")).toBe("signup");
  });

  it("defaults to signin", () => {
    expect(initialAuthMode("")).toBe("signin");
    expect(initialAuthMode("?mode=register")).toBe("signin");
    expect(initialAuthMode("?mode=SIGNUP")).toBe("signin");
  });

  it("ignores unrelated params", () => {
    expect(initialAuthMode("?redirect=/dashboard&ref=ABC1")).toBe("signin");
  });
});

describe("referralCodeFromSearch", () => {
  it("upper-cases and trims the code", () => {
    expect(referralCodeFromSearch("?ref=+abc123+")).toBe("ABC123");
  });

  it("returns an empty string when absent", () => {
    expect(referralCodeFromSearch("")).toBe("");
    expect(referralCodeFromSearch("?mode=signup")).toBe("");
  });

  it("returns an empty string for a whitespace-only code", () => {
    expect(referralCodeFromSearch("?ref=+++")).toBe("");
  });
});

describe("passwordStrength", () => {
  it("scores an empty password as zero", () => {
    expect(passwordStrength("")).toBe(0);
  });

  it("scores a short password as zero", () => {
    expect(passwordStrength("abc")).toBe(0);
  });

  it("gives one point at the six character minimum", () => {
    expect(passwordStrength("abcdef")).toBe(1);
  });

  it("rewards mixed case", () => {
    expect(passwordStrength("abcDef")).toBe(2);
  });

  it("rewards digits", () => {
    expect(passwordStrength("abcde1")).toBe(2);
  });

  it("rewards symbols the same as digits", () => {
    expect(passwordStrength("abcde!")).toBe(2);
  });

  it("reaches the maximum for a long mixed password", () => {
    expect(passwordStrength("Abcdef1234!")).toBe(4);
  });

  it("never exceeds the label range", () => {
    const score = passwordStrength("A".repeat(80) + "a1!");
    expect(score).toBe(4);
    expect(STRENGTH_LABELS[score]).toBe("strong");
  });
});

describe("strengthLabel", () => {
  it("maps every score to a defined label", () => {
    expect(strengthLabel("")).toBe("weak");
    expect(strengthLabel("abcdef")).toBe("weak");
    expect(strengthLabel("abcDef")).toBe("fair");
    expect(strengthLabel("abcDef123")).toBe("good");
    expect(strengthLabel("Abcdef1234!")).toBe("strong");
  });

  it("has a label for each reachable score", () => {
    expect(STRENGTH_LABELS).toHaveLength(5);
  });
});
