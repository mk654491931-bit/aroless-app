import { describe, it, expect } from "vitest";
import {
  ADMIN_FEATURE_LIMIT,
  UNLIMITED,
  USAGE_FEATURES,
  isExhausted,
  isFreeUnlimited,
  normalizeUsageSnapshot,
  parseConsumeResult,
  quotaExceededMessage,
  usageLabel,
  usageLimitFor,
  usagePercent,
  type UsageEntry,
} from "./usage";
import { enforceUsage } from "./usage.server";

const entry = (used: number, limit: number, unlimited = false): UsageEntry => ({
  used,
  limit,
  unlimited,
});

describe("usageLimitFor", () => {
  it("mirrors the published package limits", () => {
    expect(usageLimitFor("Starter", false, "product_finder")).toBe(8);
    expect(usageLimitFor("Starter", false, "ai_tools")).toBe(30);
    expect(usageLimitFor("Starter", false, "council")).toBe(2);
    expect(usageLimitFor("Starter", false, "trend_radar")).toBe(6);

    expect(usageLimitFor("Pro", false, "product_finder")).toBe(15);
    expect(usageLimitFor("Pro", false, "ai_tools")).toBe(90);
    expect(usageLimitFor("Pro", false, "council")).toBe(6);
    expect(usageLimitFor("Pro", false, "trend_radar")).toBe(20);

    expect(usageLimitFor("Business", false, "product_finder")).toBe(50);
    expect(usageLimitFor("Business", false, "ai_tools")).toBe(300);
    expect(usageLimitFor("Business", false, "council")).toBe(20);
    expect(usageLimitFor("Business", false, "trend_radar")).toBe(60);
  });

  it("gives admins 250 per feature regardless of plan", () => {
    for (const feature of USAGE_FEATURES.filter((f) => !f.freeUnlimited)) {
      expect(usageLimitFor("Starter", true, feature.key)).toBe(ADMIN_FEATURE_LIMIT);
      expect(usageLimitFor(null, true, feature.key)).toBe(ADMIN_FEATURE_LIMIT);
    }
  });

  it("keeps academy and simulation free and unlimited for everyone", () => {
    expect(usageLimitFor("Starter", false, "academy")).toBe(UNLIMITED);
    expect(usageLimitFor("Business", false, "simulation")).toBe(UNLIMITED);
    expect(usageLimitFor(null, false, "simulation")).toBe(UNLIMITED);
    expect(usageLimitFor(null, true, "academy")).toBe(UNLIMITED);
    expect(isFreeUnlimited("academy")).toBe(true);
    expect(isFreeUnlimited("council")).toBe(false);
  });
});

describe("normalizeUsageSnapshot", () => {
  it("fills every feature from the plan config when the RPC payload is empty", () => {
    const snapshot = normalizeUsageSnapshot(null, "Pro", false);

    expect(snapshot.tier).toBe("Pro");
    expect(snapshot.isAdmin).toBe(false);
    expect(snapshot.features.ai_tools).toEqual(entry(0, 90));
    expect(snapshot.features.council).toEqual(entry(0, 6));
    expect(snapshot.features.academy).toEqual(entry(0, UNLIMITED, true));
    expect(snapshot.features.simulation.unlimited).toBe(true);
  });

  it("uses the server payload when present and never drops unknown keys", () => {
    const snapshot = normalizeUsageSnapshot({
      tier: "Business",
      is_admin: true,
      period_start: "2026-09-01",
      period_end: "2026-10-01",
      features: {
        product_finder: { used: 12, limit: 50, unlimited: false },
        academy: { used: 999, limit: -1, unlimited: true },
      },
    });

    expect(snapshot.isAdmin).toBe(true);
    expect(snapshot.periodEnd).toBe("2026-10-01");
    expect(snapshot.features.product_finder).toEqual(entry(12, 50));
    expect(snapshot.features.academy.unlimited).toBe(true);
    // The payload marks the user as admin, so unlisted features fall back to
    // the 250-per-feature admin allowance instead of the Business quota.
    expect(snapshot.features.trend_radar).toEqual(entry(0, ADMIN_FEATURE_LIMIT));
  });
});

describe("usage helpers", () => {
  it("reports percent, exhaustion and label", () => {
    expect(usagePercent(entry(12, 30))).toBe(40);
    expect(usagePercent(entry(0, 0))).toBe(0);
    expect(usagePercent(entry(999, UNLIMITED, true))).toBe(0);

    expect(isExhausted(entry(30, 30))).toBe(true);
    expect(isExhausted(entry(29, 30))).toBe(false);
    expect(isExhausted(entry(999, UNLIMITED, true))).toBe(false);

    expect(usageLabel(entry(12, 30))).toBe("12 / 30 kullanıldı");
    expect(usageLabel(entry(999, UNLIMITED, true))).toBe("Ücretsiz / Sınırsız");
  });

  it("parses consume results including limit_reached", () => {
    expect(parseConsumeResult({ ok: true, used: 5, limit: 30, remaining: 25 })).toEqual({
      ok: true,
      used: 5,
      limit: 30,
      remaining: 25,
      unlimited: false,
    });

    const blocked = parseConsumeResult({ ok: false, error: "limit_reached", used: 6, limit: 6 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toBe("limit_reached");
      expect(blocked.limit).toBe(6);
    }

    const unknown = parseConsumeResult("nope");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe("unavailable");
  });

  it("builds an upgrade message naming the feature and allowance", () => {
    expect(quotaExceededMessage("council", 6)).toContain("AI Konsey");
    expect(quotaExceededMessage("council", 6)).toContain("6");
    expect(quotaExceededMessage("council", 6)).toContain("Paketini yükselterek");
  });
});

describe("enforceUsage", () => {
  const clientWith = (data: unknown, error: { message: string } | null = null) => ({
    rpc: async () => ({ data, error }),
  });

  it("reports success and the remaining allowance", async () => {
    const result = await enforceUsage(
      clientWith({ ok: true, used: 1, limit: 2, remaining: 1 }),
      "council",
    );
    expect(result).toEqual({ ok: true, used: 1, limit: 2, unlimited: false });
  });

  it("blocks only on an explicit limit_reached", async () => {
    const result = await enforceUsage(
      clientWith({ ok: false, error: "limit_reached", used: 2, limit: 2 }),
      "council",
    );
    expect(result).toEqual({ ok: false, reason: "limit_reached", used: 2, limit: 2 });
  });

  it("degrades open when the RPC is missing or failing", async () => {
    expect(await enforceUsage(undefined, "council")).toEqual({ ok: false, reason: "unavailable" });
    expect(await enforceUsage(clientWith(null, { message: "boom" }), "council")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      await enforceUsage(
        {
          rpc: async () => {
            throw new Error("network");
          },
        },
        "council",
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});
