// Unit tests for the admin promo attribution rules (no DB required).
import { describe, expect, it } from "vitest";
import {
  buildAdminPromoUsers,
  myPromoPerformance,
  summarizePromoByCode,
  type AdminPromoUser,
  type PromoProfileRow,
  type PromoRedemptionRow,
  type PromoTransactionRow,
} from "./promo-attribution";

const redemption = (over: Partial<PromoRedemptionRow> = {}): PromoRedemptionRow => ({
  code: "VLRWELCOME",
  user_id: "u1",
  email: "buyer@example.com",
  signed_up_at: "2026-01-10T00:00:00.000Z",
  purchased_tier: null,
  purchased_at: null,
  amount_cents: 0,
  ...over,
});

const profile = (over: Partial<PromoProfileRow> = {}): PromoProfileRow => ({
  id: "u1",
  email: "buyer@example.com",
  subscription_tier: "Free",
  subscription_status: "inactive",
  ...over,
});

const tx = (over: Partial<PromoTransactionRow> = {}): PromoTransactionRow => ({
  user_id: "u1",
  tier: "Pro",
  amount_cents: 2900,
  created_at: "2026-01-12T00:00:00.000Z",
  ...over,
});

describe("buildAdminPromoUsers", () => {
  it("attributes a signup to its promo code", () => {
    const rows = buildAdminPromoUsers([redemption()], [profile()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      email: "buyer@example.com",
      code: "VLRWELCOME",
      current_tier: "Free",
      converted: false,
      revenue_cents: 0,
    });
  });

  it("normalises the code to upper case and trims it", () => {
    const rows = buildAdminPromoUsers([redemption({ code: "  vlrwinter " })], [], []);
    expect(rows[0].code).toBe("VLRWINTER");
  });

  it("skips redemptions without a code", () => {
    expect(buildAdminPromoUsers([redemption({ code: "  " })], [], [])).toEqual([]);
    expect(buildAdminPromoUsers([redemption({ code: null })], [], [])).toEqual([]);
  });

  it("records every plan the user paid for and the total revenue", () => {
    const rows = buildAdminPromoUsers(
      [redemption()],
      [profile({ subscription_tier: "Pro", subscription_status: "active" })],
      [
        tx({ tier: "Pro", amount_cents: 2900, created_at: "2026-01-12T00:00:00.000Z" }),
        tx({ tier: "Business", amount_cents: 7900, created_at: "2026-02-12T00:00:00.000Z" }),
      ],
    );
    expect(rows[0].plans).toEqual(["Pro", "Business"]);
    expect(rows[0].revenue_cents).toBe(10800);
    expect(rows[0].first_purchase_at).toBe("2026-01-12T00:00:00.000Z");
    expect(rows[0].converted).toBe(true);
    expect(rows[0].current_tier).toBe("Pro");
    expect(rows[0].subscription_status).toBe("active");
  });

  it("ignores zero-amount ledger rows (admin plan assignment is not revenue)", () => {
    const rows = buildAdminPromoUsers(
      [redemption()],
      [profile({ subscription_tier: "Business" })],
      [tx({ tier: "Business", amount_cents: 0 })],
    );
    expect(rows[0].revenue_cents).toBe(0);
    expect(rows[0].plans).toEqual([]);
    expect(rows[0].converted).toBe(false);
    // Paket profilde tanımlı olduğu için mevcut paket yine görünür.
    expect(rows[0].current_tier).toBe("Business");
  });

  it("uses the redemption tier when the profile row is gone", () => {
    const rows = buildAdminPromoUsers(
      [redemption({ purchased_tier: "Starter", purchased_at: "2026-01-11T00:00:00.000Z" })],
      [],
      [],
    );
    expect(rows[0].current_tier).toBe("Starter");
    expect(rows[0].plans).toEqual(["Starter"]);
    expect(rows[0].converted).toBe(true);
  });

  it("falls back to the redemption email when the profile has none", () => {
    const rows = buildAdminPromoUsers(
      [redemption({ email: "orphan@example.com" })],
      [profile({ email: null })],
      [],
    );
    expect(rows[0].email).toBe("orphan@example.com");
  });

  it("marks a paying user whose profile still says Free", () => {
    const rows = buildAdminPromoUsers([redemption()], [profile()], [tx({ tier: "Pro" })]);
    expect(rows[0].pending_activation).toBe(true);
  });

  it("keeps a single row per user and the earliest signup", () => {
    const rows = buildAdminPromoUsers(
      [
        redemption({ code: "OLD", signed_up_at: "2026-01-05T00:00:00.000Z" }),
        redemption({ code: "NEW", signed_up_at: "2026-02-05T00:00:00.000Z" }),
      ],
      [profile()],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("OLD");
    expect(rows[0].signed_up_at).toBe("2026-01-05T00:00:00.000Z");
  });

  it("sorts the newest signups first", () => {
    const rows = buildAdminPromoUsers(
      [
        redemption({ user_id: "old", signed_up_at: "2026-01-01T00:00:00.000Z" }),
        redemption({ user_id: "new", signed_up_at: "2026-03-01T00:00:00.000Z" }),
      ],
      [profile({ id: "old" }), profile({ id: "new" })],
      [],
    );
    expect(rows.map((r) => r.user_id)).toEqual(["new", "old"]);
  });
});

describe("summarizePromoByCode", () => {
  const users: AdminPromoUser[] = [
    {
      user_id: "u1",
      email: "a@example.com",
      code: "VLRWELCOME",
      signed_up_at: "2026-01-10T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: ["Pro"],
      revenue_cents: 2900,
      first_purchase_at: "2026-01-12T00:00:00.000Z",
      current_tier: "Pro",
      subscription_status: "active",
      converted: true,
      pending_activation: false,
    },
    {
      user_id: "u2",
      email: "b@example.com",
      code: "VLRWELCOME",
      signed_up_at: "2026-01-11T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: [],
      revenue_cents: 0,
      first_purchase_at: null,
      current_tier: "Free",
      subscription_status: "inactive",
      converted: false,
      pending_activation: false,
    },
    {
      user_id: "u3",
      email: "c@example.com",
      code: "VLRVIP",
      signed_up_at: "2026-01-09T00:00:00.000Z",
      purchased_tier: "Business",
      purchased_at: "2026-01-15T00:00:00.000Z",
      plans: ["Business"],
      revenue_cents: 7900,
      first_purchase_at: "2026-01-15T00:00:00.000Z",
      current_tier: "Business",
      subscription_status: "active",
      converted: true,
      pending_activation: false,
    },
  ];

  it("counts signups, conversions, plans and revenue per code", () => {
    const stats = summarizePromoByCode(users, {
      allCodes: ["VLRWELCOME", "VLRVIP", "VLRUNUSED"],
      discountByCode: { VLRWELCOME: 20, VLRVIP: 50 },
    });
    const welcome = stats.find((s) => s.code === "VLRWELCOME")!;
    expect(welcome).toMatchObject({
      discount_pct: 20,
      signups: 2,
      purchases: 1,
      revenue_cents: 2900,
      by_tier: { Pro: 1 },
    });

    const vip = stats.find((s) => s.code === "VLRVIP")!;
    expect(vip).toMatchObject({ signups: 1, purchases: 1, revenue_cents: 7900 });
  });

  it("keeps codes that were never redeemed", () => {
    const stats = summarizePromoByCode([], { allCodes: ["VLRUNUSED"] });
    expect(stats).toEqual([
      {
        code: "VLRUNUSED",
        discount_pct: 0,
        signups: 0,
        purchases: 0,
        revenue_cents: 0,
        by_tier: {},
      },
    ]);
  });

  it("sorts by signups then code", () => {
    const stats = summarizePromoByCode(users);
    expect(stats.map((s) => s.code)).toEqual(["VLRWELCOME", "VLRVIP"]);
  });

  it("end-to-end: redemptions + transactions produce the same totals", () => {
    const rows = buildAdminPromoUsers(
      [
        redemption({ user_id: "u1" }),
        redemption({ user_id: "u2", code: "VLRWELCOME" }),
        redemption({ user_id: "u3", code: "VLRVIP" }),
      ],
      [
        profile({ id: "u1", subscription_tier: "Pro" }),
        profile({ id: "u2" }),
        profile({ id: "u3", subscription_tier: "Business" }),
      ],
      [tx({ user_id: "u1" }), tx({ user_id: "u3", tier: "Business", amount_cents: 7900 })],
    );
    const stats = summarizePromoByCode(rows);
    expect(stats.find((s) => s.code === "VLRWELCOME")).toMatchObject({
      signups: 2,
      purchases: 1,
      revenue_cents: 2900,
    });
    expect(stats.find((s) => s.code === "VLRVIP")).toMatchObject({
      signups: 1,
      purchases: 1,
      revenue_cents: 7900,
    });
  });
});

describe("myPromoPerformance", () => {
  // Affiliate "u0" kendi koduyla (VLRWELCOME) kaydolmuş bir hesap.
  const users: AdminPromoUser[] = [
    {
      user_id: "u1",
      email: "a@example.com",
      code: "VLRWELCOME",
      signed_up_at: "2026-01-10T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: ["Pro"],
      revenue_cents: 2900,
      first_purchase_at: "2026-01-12T00:00:00.000Z",
      current_tier: "Pro",
      subscription_status: "active",
      converted: true,
      pending_activation: false,
    },
    {
      user_id: "u2",
      email: "b@example.com",
      code: "VLRWELCOME",
      signed_up_at: "2026-01-11T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: ["Starter", "Pro"],
      revenue_cents: 990,
      first_purchase_at: "2026-01-20T00:00:00.000Z",
      current_tier: "Pro",
      subscription_status: "active",
      converted: true,
      pending_activation: false,
    },
    {
      user_id: "u3",
      email: "c@example.com",
      code: "VLRWELCOME",
      signed_up_at: "2026-01-12T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: [],
      revenue_cents: 0,
      first_purchase_at: null,
      current_tier: "Free",
      subscription_status: "inactive",
      converted: false,
      pending_activation: false,
    },
    {
      user_id: "u9",
      email: "someone-else@example.com",
      code: "VLROTHER",
      signed_up_at: "2026-01-09T00:00:00.000Z",
      purchased_tier: null,
      purchased_at: null,
      plans: ["Business"],
      revenue_cents: 7900,
      first_purchase_at: "2026-01-09T00:00:00.000Z",
      current_tier: "Business",
      subscription_status: "active",
      converted: true,
      pending_activation: false,
    },
  ];

  it("returns null when the account has no promo code", () => {
    expect(myPromoPerformance(users, null)).toBeNull();
    expect(myPromoPerformance(users, "   ")).toBeNull();
  });

  it("aggregates only the account's own code", () => {
    const perf = myPromoPerformance(users, "vlrwelcome", "Pro")!;
    expect(perf.code).toBe("VLRWELCOME");
    expect(perf.signups).toBe(3);
    expect(perf.purchases).toBe(2);
    expect(perf.conversion_pct).toBe(67);
    expect(perf.revenue_cents).toBe(3890);
    // Başka bir kodun kullanıcısı (u9) HİÇ sayılmaz.
    expect(perf.by_tier).not.toContainEqual({ tier: "Business", users: 1 });
  });

  it("breaks the signups down by plan, most used first", () => {
    const perf = myPromoPerformance(users, "VLRWELCOME")!;
    expect(perf.by_tier).toEqual([
      { tier: "Pro", users: 2 },
      { tier: "Starter", users: 1 },
    ]);
  });

  it("reports the first and last signup dates", () => {
    const perf = myPromoPerformance(users, "VLRWELCOME")!;
    expect(perf.first_signup_at).toBe("2026-01-10T00:00:00.000Z");
    expect(perf.last_signup_at).toBe("2026-01-12T00:00:00.000Z");
  });

  it("falls back to Free when the account's own plan is unknown", () => {
    expect(myPromoPerformance(users, "VLRWELCOME")!.own_tier).toBe("Free");
    expect(myPromoPerformance(users, "VLRWELCOME", "Business")!.own_tier).toBe("Business");
  });

  it("handles a code that exists but has no signups", () => {
    const perf = myPromoPerformance([], "VLRNEW", "Starter")!;
    expect(perf).toMatchObject({
      signups: 0,
      purchases: 0,
      conversion_pct: 0,
      revenue_cents: 0,
      by_tier: [],
      first_signup_at: null,
      last_signup_at: null,
      own_tier: "Starter",
    });
  });

  it("leaks no user identity — only totals and plan counts", () => {
    const perf = myPromoPerformance(users, "VLRWELCOME")!;
    expect(Object.keys(perf).sort()).toEqual(
      [
        "by_tier",
        "code",
        "conversion_pct",
        "first_signup_at",
        "last_signup_at",
        "own_tier",
        "purchases",
        "revenue_cents",
        "signups",
      ].sort(),
    );
  });
});
