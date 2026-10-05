import { describe, it, expect } from "vitest";
import { isNoCreditsError, isJwtError, classifyServerError } from "./error-helpers";

describe("isNoCreditsError", () => {
  it("returns true for no_credits error message", () => {
    expect(isNoCreditsError({ message: "no_credits_remaining" })).toBe(true);
  });

  it("returns true for error containing no_credits", () => {
    expect(isNoCreditsError({ message: "User has no_credits left" })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isNoCreditsError({ message: "Connection failed" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isNoCreditsError(null)).toBe(false);
    expect(isNoCreditsError(undefined)).toBe(false);
  });

  it("returns false for error without message", () => {
    expect(isNoCreditsError({})).toBe(false);
  });
});

describe("isJwtError", () => {
  it("returns true for JWT errors", () => {
    expect(isJwtError(new Error("JWT issued at future"))).toBe(true);
    expect(isJwtError("jwt token expired")).toBe(true);
  });

  it("returns false for non-JWT errors", () => {
    expect(isJwtError(new Error("Connection timeout"))).toBe(false);
    expect(isJwtError("network error")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isJwtError(null)).toBe(false);
    expect(isJwtError(undefined)).toBe(false);
  });
});

describe("classifyServerError", () => {
  it("classifies NO_CREDITS error", () => {
    const result = classifyServerError(new Error("NO_CREDITS"));
    expect(result.type).toBe("no_credits");
    expect(result.message).toContain("credits");
    expect(result.shouldRefund).toBe(false);
  });

  it("classifies JWT error", () => {
    const result = classifyServerError(new Error("JWT issued at future"));
    expect(result.type).toBe("jwt");
    expect(result.message).toContain("refresh");
    expect(result.shouldRefund).toBe(true);
  });

  it("classifies unknown errors", () => {
    const result = classifyServerError(new Error("Something went wrong"));
    expect(result.type).toBe("unknown");
    expect(result.message).toBe("Something went wrong");
    expect(result.shouldRefund).toBe(false);
  });

  it("handles string errors", () => {
    const result = classifyServerError("no_credits remaining");
    expect(result.type).toBe("no_credits");
  });

  it("handles null/undefined errors", () => {
    const result = classifyServerError(null);
    expect(result.type).toBe("unknown");
    expect(result.message).toBe("Unknown error");
  });

  it("handles non-Error objects", () => {
    const result = classifyServerError({ message: "JWT invalid" });
    expect(result.type).toBe("jwt");
  });
});
