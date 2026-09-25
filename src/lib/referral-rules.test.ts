// Unit tests for the referral claim rules (pure logic, no DB).
import { describe, expect, it } from "vitest";
import {
  isTerminalClaim,
  isWithinClaimWindow,
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_CLAIM_WINDOW_MS,
  storedRefAction,
  type ReferralClaimCode,
} from "./referral-rules";

describe("isWithinClaimWindow", () => {
  it("allows a brand new account", () => {
    expect(isWithinClaimWindow(0)).toBe(true);
    expect(isWithinClaimWindow(REFERRAL_CLAIM_WINDOW_MS - 1)).toBe(true);
  });

  it("closes the window after 30 days", () => {
    expect(REFERRAL_CLAIM_WINDOW_DAYS).toBe(30);
    expect(isWithinClaimWindow(REFERRAL_CLAIM_WINDOW_MS)).toBe(false);
    expect(isWithinClaimWindow(REFERRAL_CLAIM_WINDOW_MS + 1)).toBe(false);
  });

  it("treats an unknown age as outside the window", () => {
    expect(isWithinClaimWindow(null)).toBe(false);
    expect(isWithinClaimWindow(undefined)).toBe(false);
    expect(isWithinClaimWindow(Number.NaN)).toBe(false);
  });
});

describe("storedRefAction", () => {
  it("clears the stored code once it is used", () => {
    expect(storedRefAction("ok")).toBe("clear");
  });

  it("retries while the profile row is still missing", () => {
    // Yeni kayıtta profil (DB trigger) geç oluşur; kod SİLİNMEMELİ.
    expect(storedRefAction("profile_missing")).toBe("retry");
  });

  it("clears the code for permanent rejections", () => {
    const permanent: ReferralClaimCode[] = [
      "self",
      "already_used",
      "not_found",
      "referrer_limit",
      "window_closed",
    ];
    for (const code of permanent) {
      expect(storedRefAction(code)).toBe("clear");
      expect(isTerminalClaim(code)).toBe(true);
    }
  });

  it("keeps the code for transient failures so the next visit can retry", () => {
    const transient: ReferralClaimCode[] = ["insert_failed", "credit_failed"];
    for (const code of transient) {
      expect(storedRefAction(code)).toBe("keep");
      expect(isTerminalClaim(code)).toBe(false);
    }
  });
});
