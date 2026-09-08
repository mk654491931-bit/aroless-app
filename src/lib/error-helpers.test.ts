import { describe, it, expect, vi } from "vitest";
import {
  isNoCreditsError,
  isJwtError,
  classifyServerError,
  tryRefundCredit,
} from "./error-helpers";

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

describe("tryRefundCredit", () => {
  it("calls refund_engine_credits with default payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await tryRefundCredit({ rpc }, "user-1", 2);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("refund_engine_credits", {
      _search_credits: 1,
      _sim_credits: 0,
      _reason: "engine_failure",
      _idempotency_key: null,
    });
  });

  it("sanitizes and forwards custom refund options", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await tryRefundCredit({ rpc }, "user-1", 2, {
      search: 1.8,
      sim: -2,
      reason: "manual_retry",
      idempotencyKey: "op-123",
    });

    expect(rpc).toHaveBeenCalledWith("refund_engine_credits", {
      _search_credits: 2,
      _sim_credits: 0,
      _reason: "manual_retry",
      _idempotency_key: "op-123",
    });
  });

  it("returns early when no refund amount is requested", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await tryRefundCredit({ rpc }, "user-1", 2, { search: 0, sim: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws when rpc is missing or fails", async () => {
    await expect(tryRefundCredit({}, "user-1", 2)).resolves.toBeUndefined();
    const rpc = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(tryRefundCredit({ rpc }, "user-1", 2)).resolves.toBeUndefined();
  });
});
