import { describe, expect, it, beforeEach } from "vitest";
import { FakeDb } from "./fake-db";
import {
  attributeSignupToAffiliate,
  cancelReferralSubscription,
  countClicksForAffiliate,
  createCommissionForPayment,
  ensureAffiliateAdmin,
  listCommissionsForAffiliate,
  listReferralsForAffiliate,
  payCommissions,
  recordAffiliateClick,
  resolveReferralByCustomer,
  reverseCommissionsByIds,
  reverseCommissionsForPayment,
} from "./affiliate.service";

let db: FakeDb;

function iso(y: number, m: number, d = 15): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

beforeEach(() => {
  db = new FakeDb(
    {
      profiles: [
        { id: "ua", email: "partner-a@aroless.test" },
        { id: "ub", email: "partner-b@aroless.test" },
        { id: "uc", email: "inactive-partner@aroless.test" },
        { id: "c1", email: "customer1@example.com" },
        { id: "c2", email: "customer2@example.com" },
        { id: "c3", email: "customer3@example.com" },
        { id: "c4", email: "customer4@example.com" },
        { id: "c5", email: "customer5@example.com" },
        { id: "c6", email: "customer6@example.com" },
      ],
      affiliates: [
        {
          id: "affA",
          user_id: "ua",
          display_name: "Partner A",
          referral_code: "AAA111",
          commission_rate_pct: 30,
          commission_duration_months: 12,
          status: "active",
          created_at: iso(2026, 1),
          updated_at: iso(2026, 1),
        },
        {
          id: "affB",
          user_id: "ub",
          display_name: "Partner B",
          referral_code: "BBB222",
          commission_rate_pct: 30,
          commission_duration_months: 12,
          status: "active",
          created_at: iso(2026, 1),
          updated_at: iso(2026, 1),
        },
        {
          id: "affC",
          user_id: "uc",
          display_name: "Inactive Partner",
          referral_code: "CCC333",
          commission_rate_pct: 30,
          commission_duration_months: 12,
          status: "inactive",
          created_at: iso(2026, 1),
          updated_at: iso(2026, 1),
        },
      ],
    },
    { admins: ["root"] },
  );
});

/** A partner için signup + ilk ödeme yardımcısı. */
async function signupAndPay(
  customerId: string,
  code: string,
  amountCents: number,
  plan: string,
  opts: { month?: number; sub?: string } = {},
) {
  const att = await attributeSignupToAffiliate(db, { code, customerId });
  expect(att.ok).toBe(true);
  const month = opts.month ?? 0;
  const sub = opts.sub ?? `sub-${customerId}`;
  return createCommissionForPayment(db, {
    customerId,
    paymentId: `pay-${customerId}-${month}`,
    subscriptionId: sub,
    plan,
    subscriptionAmountCents: amountCents,
    periodStart: iso(2026, 1 + month),
    periodEnd: iso(2026, 2 + month),
  });
}

describe("1. Referral click → signup", () => {
  it("records a unique click and attributes the signup", async () => {
    await recordAffiliateClick(db, {
      code: "AAA111",
      affiliateId: "affA",
      visitorKey: "visitor-1",
      landingPath: "/",
    });
    // Aynı ziyaretçi aynı linki tekrar tıklarsa click sayısı artmaz.
    await recordAffiliateClick(db, {
      code: "AAA111",
      affiliateId: "affA",
      visitorKey: "visitor-1",
    });
    expect(await countClicksForAffiliate(db, "affA")).toBe(1);

    const att = await attributeSignupToAffiliate(db, { code: "AAA111", customerId: "c1" });
    expect(att).toMatchObject({ ok: true, affiliate: { id: "affA", code: "AAA111" } });

    const referral = await resolveReferralByCustomer(db, "c1");
    expect(referral?.affiliate_id).toBe("affA");
    expect(referral?.status).toBe("referred");
  });

  it("never re-attributes an already attributed customer to another affiliate", async () => {
    await attributeSignupToAffiliate(db, { code: "AAA111", customerId: "c1" });
    const second = await attributeSignupToAffiliate(db, { code: "BBB222", customerId: "c1" });
    expect(second.ok).toBe(false);
    const referral = await resolveReferralByCustomer(db, "c1");
    expect(referral?.affiliate_id).toBe("affA");
  });
});

describe("2. Referral signup → paid customer", () => {
  it("turns the referral into an active paying customer on first charge", async () => {
    const res = await signupAndPay("c1", "AAA111", 3900, "Starter");
    expect(res.ok).toBe(true);
    const referral = await resolveReferralByCustomer(db, "c1");
    expect(referral?.status).toBe("active");
    expect(referral?.plan).toBe("Starter");
    expect(referral?.commission_rate_pct).toBe(30);
    expect(referral?.first_paid_at).not.toBeNull();
    const commissions = await listCommissionsForAffiliate(db, "affA");
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ status: "pending", commission_amount_cents: 1170 });
  });
});

describe("3-5. Plan amounts → commission amounts", () => {
  it("Starter $39 → $11.70", async () => {
    const res = await signupAndPay("c1", "AAA111", 3900, "Starter");
    expect(res.ok).toBe(true);
    expect((await listCommissionsForAffiliate(db, "affA"))[0]?.commission_amount_cents).toBe(1170);
  });

  it("Pro $59 → $17.70", async () => {
    const res = await signupAndPay("c2", "AAA111", 5900, "Pro");
    expect(res.ok).toBe(true);
    expect((await listCommissionsForAffiliate(db, "affA"))[0]?.commission_amount_cents).toBe(1770);
  });

  it("Business $109 → $32.70", async () => {
    const res = await signupAndPay("c3", "AAA111", 10900, "Business");
    expect(res.ok).toBe(true);
    expect((await listCommissionsForAffiliate(db, "affA"))[0]?.commission_amount_cents).toBe(3270);
  });
});

describe("6. Recurring payment → new commission, no duplicates", () => {
  it("creates a commission per billing period", async () => {
    await signupAndPay("c4", "AAA111", 5900, "Pro", { month: 0 });
    const second = await createCommissionForPayment(db, {
      customerId: "c4",
      paymentId: "pay-c4-1",
      subscriptionId: "sub-c4",
      plan: "Pro",
      subscriptionAmountCents: 5900,
      periodStart: iso(2026, 2),
      periodEnd: iso(2026, 3),
    });
    expect(second.ok).toBe(true);
    expect(await listCommissionsForAffiliate(db, "affA")).toHaveLength(2);
  });

  it("10. duplicate webhook (same payment id) never creates a second commission", async () => {
    await signupAndPay("c4", "AAA111", 5900, "Pro", { month: 0 });
    const dup = await createCommissionForPayment(db, {
      customerId: "c4",
      paymentId: "pay-c4-0",
      subscriptionId: "sub-c4",
      plan: "Pro",
      subscriptionAmountCents: 5900,
      periodStart: iso(2026, 1),
      periodEnd: iso(2026, 2),
    });
    expect(dup).toMatchObject({ ok: true, duplicate: true, skipped: "payment_exists" });
    expect(await listCommissionsForAffiliate(db, "affA")).toHaveLength(1);
  });
});

describe("7. Customer cancellation → future commissions stop", () => {
  it("blocks new commissions for the canceled subscription", async () => {
    await signupAndPay("c1", "AAA111", 5900, "Pro", { month: 0 });
    await cancelReferralSubscription(db, { customerId: "c1", subscriptionId: "sub-c1" });
    const referral = await resolveReferralByCustomer(db, "c1");
    expect(referral?.status).toBe("canceled");

    const later = await createCommissionForPayment(db, {
      customerId: "c1",
      paymentId: "pay-c1-1",
      subscriptionId: "sub-c1",
      plan: "Pro",
      subscriptionAmountCents: 5900,
      periodStart: iso(2026, 2),
      periodEnd: iso(2026, 3),
    });
    expect(later).toMatchObject({ ok: false, reason: "subscription_canceled" });
    expect(await listCommissionsForAffiliate(db, "affA")).toHaveLength(1);
  });

  it("resumes commissions when the customer reactivates with a new subscription", async () => {
    await signupAndPay("c1", "AAA111", 5900, "Pro", { month: 0 });
    await cancelReferralSubscription(db, { customerId: "c1", subscriptionId: "sub-c1" });
    const res = await createCommissionForPayment(db, {
      customerId: "c1",
      paymentId: "pay-c1-new1",
      subscriptionId: "sub-c1-new",
      plan: "Pro",
      subscriptionAmountCents: 5900,
      periodStart: iso(2026, 2),
      periodEnd: iso(2026, 3),
    });
    expect(res.ok).toBe(true);
    expect((await resolveReferralByCustomer(db, "c1"))?.status).toBe("active");
  });
});

describe("8. 12-month cap", () => {
  it("stops creating commissions after the 12th month", async () => {
    await attributeSignupToAffiliate(db, { code: "AAA111", customerId: "c5" });
    // Ay 0..11 → 12 komisyon
    for (let m = 0; m < 12; m++) {
      const res = await createCommissionForPayment(db, {
        customerId: "c5",
        paymentId: `pay-c5-${m}`,
        subscriptionId: "sub-c5",
        plan: "Starter",
        subscriptionAmountCents: 3900,
        periodStart: iso(2026, 1 + m),
        periodEnd: iso(2026, 2 + m),
      });
      expect(res.ok).toBe(true);
    }
    const month12 = await createCommissionForPayment(db, {
      customerId: "c5",
      paymentId: "pay-c5-12",
      subscriptionId: "sub-c5",
      plan: "Starter",
      subscriptionAmountCents: 3900,
      periodStart: iso(2027, 1),
      periodEnd: iso(2027, 2),
    });
    expect(month12.ok).toBe(false);
    expect(month12).toMatchObject({ reason: "window_exceeded" });
    expect(await listCommissionsForAffiliate(db, "affA")).toHaveLength(12);
  });
});

describe("9. Refund → commission reversed", () => {
  it("reverses the linked commission and keeps the record immutable", async () => {
    await signupAndPay("c1", "AAA111", 5900, "Pro", { month: 0 });
    const res = await reverseCommissionsForPayment(db, { paymentId: "pay-c1-0", reason: "refund" });
    expect(res.reversed).toBe(1);
    const commissions = await listCommissionsForAffiliate(db, "affA");
    expect(commissions[0]?.status).toBe("reversed");
    expect(commissions[0]?.commission_amount_cents).toBe(1770); // değişmez

    // Reversed kayıt yeniden ödenemez.
    expect(await payCommissions(db, { ids: [commissions[0]!.id] })).toEqual({ paid: 0 });
    // Tekrar ters çevirme ikinci komisyon üretmez.
    expect(
      (await reverseCommissionsForPayment(db, { paymentId: "pay-c1-0", reason: "refund" }))
        .reversed,
    ).toBe(0);
  });

  it("admin manual reversal works by ids", async () => {
    await signupAndPay("c1", "AAA111", 3900, "Starter", { month: 0 });
    const row = (await listCommissionsForAffiliate(db, "affA"))[0]!;
    const res = await reverseCommissionsByIds(db, { ids: [row.id], reason: "manual check" });
    expect(res.reversed).toBe(1);
    expect((await listCommissionsForAffiliate(db, "affA"))[0]?.reversed_reason).toBe(
      "manual check",
    );
  });
});

describe("11. Affiliate isolation (IDOR/BOLA)", () => {
  it("a partner can only ever list their own referrals and commissions", async () => {
    await signupAndPay("c1", "AAA111", 5900, "Pro", { month: 0 }); // affA
    await signupAndPay("c2", "BBB222", 3900, "Starter", { month: 0 }); // affB
    await signupAndPay("c3", "BBB222", 3900, "Starter", { month: 0 }); // affB

    const forA = await listReferralsForAffiliate(db, "affA");
    const forB = await listReferralsForAffiliate(db, "affB");
    expect(forA.map((r) => r.customer_id)).toEqual(["c1"]);
    expect(forB.map((r) => r.customer_id).sort()).toEqual(["c2", "c3"]);

    const commissionsA = await listCommissionsForAffiliate(db, "affA");
    expect(commissionsA.every((c) => c.affiliate_id === "affA")).toBe(true);
    expect(commissionsA).toHaveLength(1);
    // affA, B'nin müşteri verisini göremez.
    expect(forA.some((r) => r.customer_id === "c2" || r.customer_id === "c3")).toBe(false);
  });
});

describe("12. Admin guard", () => {
  it("non-admin users cannot reach admin operations", async () => {
    await expect(ensureAffiliateAdmin(db, "ua")).rejects.toThrow(/Forbidden/);
    await expect(ensureAffiliateAdmin(db, "root")).resolves.toBeUndefined();
  });
});

describe("13-14. Invalid code / inactive affiliate", () => {
  it("rejects unknown or malformed codes", async () => {
    const unknown = await attributeSignupToAffiliate(db, { code: "ZZZZ99", customerId: "c1" });
    expect(unknown).toMatchObject({ ok: false, reason: "not_found" });
    const malformed = await attributeSignupToAffiliate(db, { code: "a1", customerId: "c2" });
    expect(malformed).toMatchObject({ ok: false, reason: "invalid_code" });
    expect(await listReferralsForAffiliate(db, "affA")).toHaveLength(0);
  });

  it("does not attribute or pay an inactive affiliate", async () => {
    const att = await attributeSignupToAffiliate(db, { code: "CCC333", customerId: "c1" });
    expect(att).toMatchObject({ ok: false, reason: "inactive" });

    // Aktifken atfedilmiş müşteri: affiliate sonradan pasife alınırsa yeni komisyon üretilmez.
    await signupAndPay("c2", "AAA111", 3900, "Starter", { month: 0 });
    await db.from("affiliates").update({ status: "inactive" }).eq("id", "affA");
    const later = await createCommissionForPayment(db, {
      customerId: "c2",
      paymentId: "pay-c2-1",
      subscriptionId: "sub-c2",
      plan: "Starter",
      subscriptionAmountCents: 3900,
      periodStart: iso(2026, 2),
      periodEnd: iso(2026, 3),
    });
    expect(later).toMatchObject({ ok: false, reason: "affiliate_inactive" });
    expect(await listCommissionsForAffiliate(db, "affA")).toHaveLength(1);
  });
});

describe("15. Rate changes never touch existing commission records", () => {
  it("keeps the snapshot rate for existing customers and old rows", async () => {
    await signupAndPay("c1", "AAA111", 3900, "Starter", { month: 0 }); // %30 → 1170
    const before = (await listCommissionsForAffiliate(db, "affA"))[0]!;
    expect(before).toMatchObject({ commission_rate_pct: 30, commission_amount_cents: 1170 });

    // Admin oranı %40'a çeker.
    await db.from("affiliates").update({ commission_rate_pct: 40 }).eq("id", "affA");

    // Eski müşteri snapshot oranıyla devam eder → kayıt bozulmaz.
    const oldCustomerRecurring = await createCommissionForPayment(db, {
      customerId: "c1",
      paymentId: "pay-c1-1",
      subscriptionId: "sub-c1",
      plan: "Starter",
      subscriptionAmountCents: 3900,
      periodStart: iso(2026, 2),
      periodEnd: iso(2026, 3),
    });
    expect(oldCustomerRecurring.ok).toBe(true);
    const rows = await listCommissionsForAffiliate(db, "affA");
    expect(rows.map((r) => r.commission_rate_pct)).toEqual([30, 30]);
    expect(rows.map((r) => r.commission_amount_cents)).toEqual([1170, 1170]);
    expect(rows[0]).toMatchObject({ commission_rate_pct: 30, commission_amount_cents: 1170 });

    // Yeni müşteri yeni orandan etkilenir.
    await attributeSignupToAffiliate(db, { code: "AAA111", customerId: "c6" });
    await createCommissionForPayment(db, {
      customerId: "c6",
      paymentId: "pay-c6-0",
      subscriptionId: "sub-c6",
      plan: "Starter",
      subscriptionAmountCents: 3900,
      periodStart: iso(2026, 1),
      periodEnd: iso(2026, 2),
    });
    const c6rows = await listCommissionsForAffiliate(db, "affA");
    expect(c6rows.find((r) => r.customer_id === "c6")).toMatchObject({
      commission_rate_pct: 40,
      commission_amount_cents: 1560,
    });
  });
});
