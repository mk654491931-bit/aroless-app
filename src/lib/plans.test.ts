import { describe, it, expect } from "vitest";
import {
  PLANS,
  PLAN_BY_ID,
  tierLevel,
  planForLevel,
  quotaFor,
  ALL_MODULES,
  ADMIN_PERIOD_MONTHS,
  normalizePlanId,
  addMonths,
  adminGrantFor,
  daysLeft,
  isPlanExpired,
} from "./plans";

describe("PLANS", () => {
  it("has 3 plans", () => {
    expect(PLANS).toHaveLength(3);
  });

  it("has Starter, Pro, and Business plans", () => {
    const ids = PLANS.map((p) => p.id);
    expect(ids).toContain("Starter");
    expect(ids).toContain("Pro");
    expect(ids).toContain("Business");
  });

  it("Pro has highest highlight", () => {
    const pro = PLANS.find((p) => p.id === "Pro");
    expect(pro?.highlight).toBe(true);
  });

  it("plans are sorted by level", () => {
    const levels = PLANS.map((p) => p.level);
    expect(levels).toEqual([1, 2, 3]);
  });

  it("credits increase with level", () => {
    expect(PLANS[0].credits).toBeLessThan(PLANS[1].credits);
    expect(PLANS[1].credits).toBeLessThan(PLANS[2].credits);
  });

  it("prices increase with level", () => {
    expect(PLANS[0].usd).toBeLessThan(PLANS[1].usd);
    expect(PLANS[1].usd).toBeLessThan(PLANS[2].usd);
  });

  it("ALL_MODULES is 9", () => {
    expect(ALL_MODULES).toBe(9);
  });
});

describe("PLAN_BY_ID", () => {
  it("has all plan IDs", () => {
    expect(PLAN_BY_ID.Starter).toBeDefined();
    expect(PLAN_BY_ID.Pro).toBeDefined();
    expect(PLAN_BY_ID.Business).toBeDefined();
  });

  it("references same plans as PLANS array", () => {
    expect(PLAN_BY_ID.Starter).toBe(PLANS[0]);
    expect(PLAN_BY_ID.Pro).toBe(PLANS[1]);
    expect(PLAN_BY_ID.Business).toBe(PLANS[2]);
  });
});

describe("tierLevel", () => {
  it("returns 0 for Free/undefined/null", () => {
    expect(tierLevel("Free")).toBe(0);
    expect(tierLevel(undefined)).toBe(0);
    expect(tierLevel(null)).toBe(0);
    expect(tierLevel("")).toBe(0);
  });

  it("returns 1 for Starter", () => {
    expect(tierLevel("Starter")).toBe(1);
    expect(tierLevel("starter")).toBe(1);
  });

  it("returns 2 for Pro", () => {
    expect(tierLevel("Pro")).toBe(2);
    expect(tierLevel("pro")).toBe(2);
  });

  it("returns 3 for Business/Enterprise/Ultra", () => {
    expect(tierLevel("Business")).toBe(3);
    expect(tierLevel("business")).toBe(3);
    expect(tierLevel("enterprise")).toBe(3);
    expect(tierLevel("ultra")).toBe(3);
  });

  it("returns 0 for unknown tiers", () => {
    expect(tierLevel("Unknown")).toBe(0);
    expect(tierLevel("Gold")).toBe(0);
  });
});

describe("planForLevel", () => {
  it("returns Starter for level 1", () => {
    expect(planForLevel(1).id).toBe("Starter");
  });

  it("returns Pro for level 2", () => {
    expect(planForLevel(2).id).toBe("Pro");
  });

  it("returns Business for level 3", () => {
    expect(planForLevel(3).id).toBe("Business");
  });

  it("clamps to Starter for level 0", () => {
    expect(planForLevel(0).id).toBe("Starter");
  });

  it("clamps to Business for level > 3", () => {
    expect(planForLevel(5).id).toBe("Business");
  });
});

describe("quotaFor", () => {
  it("returns small trial quota for level 0 (Free) — Find Winner 2 jeton (klasik düzen)", () => {
    const quota = quotaFor(0);
    expect(quota.credits).toBe(2);
    expect(quota.toolRuns).toBe(3);
    expect(quota.councilRuns).toBe(0);
    expect(quota.radarScans).toBe(1);
  });

  it("returns Starter quotas for level 1", () => {
    const quota = quotaFor(1);
    expect(quota.credits).toBe(8);
    expect(quota.toolRuns).toBe(30);
    expect(quota.councilRuns).toBe(2);
    expect(quota.radarScans).toBe(6);
  });

  it("returns Pro quotas for level 2", () => {
    const quota = quotaFor(2);
    expect(quota.credits).toBe(15);
    expect(quota.toolRuns).toBe(90);
    expect(quota.councilRuns).toBe(6);
    expect(quota.radarScans).toBe(20);
  });

  it("returns Business quotas for level 3", () => {
    const quota = quotaFor(3);
    expect(quota.credits).toBe(50);
    expect(quota.toolRuns).toBe(300);
    expect(quota.councilRuns).toBe(20);
    expect(quota.radarScans).toBe(60);
  });

  it("quotas increase with level", () => {
    const q0 = quotaFor(0);
    const q1 = quotaFor(1);
    const q2 = quotaFor(2);
    const q3 = quotaFor(3);

    expect(q0.credits).toBeLessThan(q1.credits);
    expect(q1.credits).toBeLessThan(q2.credits);
    expect(q2.credits).toBeLessThan(q3.credits);
  });

  it("ADMIN_QUOTA is 250 on every bucket", async () => {
    const { ADMIN_QUOTA } = await import("./plans");
    expect(ADMIN_QUOTA.credits).toBe(250);
    expect(ADMIN_QUOTA.toolRuns).toBe(250);
    expect(ADMIN_QUOTA.councilRuns).toBe(250);
    expect(ADMIN_QUOTA.radarScans).toBe(250);
  });
});

describe("admin paket tanımlama yardımcıları", () => {
  it("ADMIN_PERIOD_MONTHS 1, 2, 3, 6 ve 12 ay seçeneklerini sunar", () => {
    expect([...ADMIN_PERIOD_MONTHS]).toEqual([1, 2, 3, 6, 12]);
    expect([...ADMIN_PERIOD_MONTHS].every((m) => m >= 1 && m <= 12)).toBe(true);
  });

  it("normalizePlanId büyük/küçük harf duyarsız paket döner", () => {
    expect(normalizePlanId("starter")).toBe("Starter");
    expect(normalizePlanId("PRO")).toBe("Pro");
    expect(normalizePlanId(" Business ")).toBe("Business");
    expect(normalizePlanId("enterprise")).toBe("Business");
  });

  it("normalizePlanId geçersiz değerlerde null döner", () => {
    expect(normalizePlanId("free")).toBeNull();
    expect(normalizePlanId("")).toBeNull();
    expect(normalizePlanId(undefined)).toBeNull();
    expect(normalizePlanId(null)).toBeNull();
    expect(normalizePlanId(42)).toBeNull();
  });

  it("addMonths 1 ve 2 aylık süreyi doğru hesaplar", () => {
    const start = "2026-01-15T10:00:00.000Z";
    expect(addMonths(start, 1)).toBe("2026-02-15T10:00:00.000Z");
    expect(addMonths(start, 2)).toBe("2026-03-15T10:00:00.000Z");
    expect(addMonths(start, 12)).toBe("2027-01-15T10:00:00.000Z");
  });

  it("addMonths ay sonu taşmasını kırpar (31 Oca + 1 ay → Şubat sonu)", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
    // Artık yıl: 2028 Şubat 29 gün.
    expect(addMonths("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z");
  });

  it("addMonths süreyi 1..36 ay aralığına sınırlar", () => {
    const start = "2026-06-01T00:00:00.000Z";
    expect(addMonths(start, 0)).toBe(addMonths(start, 1));
    expect(addMonths(start, 999)).toBe(addMonths(start, 36));
    expect(addMonths(start, 1.4)).toBe(addMonths(start, 1));
  });

  it("addMonths geçersiz tarihte hata verir", () => {
    expect(() => addMonths("bozuk-tarih", 1)).toThrow("INVALID_DATE");
  });

  it("adminGrantFor paket kredisini PLANS ile aynı tutar", () => {
    expect(adminGrantFor("Starter")).toEqual({ credits: 8, simCredits: 5 });
    expect(adminGrantFor("Pro")).toEqual({ credits: 15, simCredits: 10 });
    expect(adminGrantFor("Business")).toEqual({ credits: 50, simCredits: 25 });
  });

  it("daysLeft kalan günü yukarı yuvarlar ve geçmişte 0 döner", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    expect(daysLeft("2026-05-31T00:00:00.000Z", now)).toBe(30);
    expect(daysLeft("2026-05-01T12:00:00.000Z", now)).toBe(1);
    expect(daysLeft("2026-04-01T00:00:00.000Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft("bozuk", now)).toBeNull();
  });

  it("isPlanExpired süresi dolmuş paketi tespit eder", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    expect(isPlanExpired("2026-04-30T00:00:00.000Z", now)).toBe(true);
    expect(isPlanExpired("2026-06-01T00:00:00.000Z", now)).toBe(false);
    // Bitiş tarihi yoksa süresiz → dolmamış sayılır.
    expect(isPlanExpired(null, now)).toBe(false);
  });
});
