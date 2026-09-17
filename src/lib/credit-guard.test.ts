import { afterEach, describe, expect, it, vi } from "vitest";
import { creditDeductError, refundCredit, withCreditRefund } from "./credit-guard.server";

const USER = "11111111-2222-3333-4444-555555555555";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("creditDeductError", () => {
  it("maps a missing-credit failure to NO_CREDITS", () => {
    expect(creditDeductError("no_credits").message).toBe("NO_CREDITS");
    expect(creditDeductError("ERROR: no_credits").message).toBe("NO_CREDITS");
  });

  it("never leaks the raw database message for other failures", () => {
    const error = creditDeductError("permission denied for function deduct_credit");
    expect(error.message).toBe("CREDIT_DEDUCT_FAILED");
    expect(error.message).not.toContain("permission denied");
  });
});

describe("refundCredit", () => {
  it("resolves to false instead of throwing when the admin client is unavailable", async () => {
    // Test ortamında SUPABASE_SERVICE_ROLE_KEY yok: iade denemesi sessizce
    // başarısız olmalı, kullanıcı akışını kırmamalı.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(refundCredit(USER, 1, "test")).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("withCreditRefund", () => {
  it("returns the result untouched when the analysis succeeds", async () => {
    const result = await withCreditRefund(USER, async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it("re-throws the original error after attempting a refund", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("AI motoru yanıt vermedi");
    await expect(
      withCreditRefund(USER, async () => {
        throw failure;
      }),
    ).rejects.toThrow(failure);
    // İade denemesi yapıldı (env yok → loglanır), asıl hata korunur.
    expect(errorSpy).toHaveBeenCalled();
  });
});
