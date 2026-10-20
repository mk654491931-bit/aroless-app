import { describe, expect, it } from "vitest";
import { profileSummary, type ProfileRow } from "@/lib/profile-summary";

describe("profileSummary", () => {
  it("eksik sütunları null yapar, bakiyeyi gizlemez", () => {
    // Uygulanmamış bir migration: `public_id` ve `finder_credits` satırda YOK.
    const row = { id: "u1", credits: 7, credits_spent: 3 } as unknown as Partial<ProfileRow>;
    const summary = profileSummary(row);
    expect(summary.credits).toBe(7);
    expect(summary.credits_spent).toBe(3);
    expect(summary.public_id).toBeNull();
    expect(summary.finder_credits).toBeNull();
    expect(summary.subscription_tier).toBeNull();
  });

  it("tam satırı olduğu gibi taşır", () => {
    const row = {
      email: "a@b.co",
      public_id: "12345678",
      credits: 10,
      finder_credits: 2,
      sim_credits: 5,
      credits_spent: 4,
      subscription_tier: "pro",
      language: "tr",
      currency: "TRY",
      notifications_enabled: false,
      created_at: "2026-01-02T03:04:05.000Z",
    } as Partial<ProfileRow>;
    expect(profileSummary(row)).toEqual({
      email: "a@b.co",
      public_id: "12345678",
      credits: 10,
      finder_credits: 2,
      sim_credits: 5,
      credits_spent: 4,
      subscription_tier: "pro",
      language: "tr",
      currency: "TRY",
      notifications_enabled: false,
      created_at: "2026-01-02T03:04:05.000Z",
    });
  });

  it("boş satırda patlamaz", () => {
    expect(profileSummary({})).toMatchObject({ credits: null, finder_credits: null });
  });
});
