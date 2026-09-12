import { describe, it, expect } from "vitest";
import { PLANS, PLAN_BY_ID, tierLevel, planForLevel, quotaFor, ALL_MODULES } from "./plans";

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
  it("returns small trial quota for level 0 (Free)", () => {
    const quota = quotaFor(0);
    expect(quota.credits).toBe(1);
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
});
