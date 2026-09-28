import { describe, expect, it } from "vitest";
import {
  creditGrantDecision,
  mapPaddleEvent,
  planForAsset,
  type PaddleSettings,
} from "./paddle.server";

/**
 * Contract tests for the Paddle webhook → database command mapping.
 *
 * These lock down the edge-case behavior that keeps billing correct:
 *  - plan resolution (price first, then tamper-proof server-side customData)
 *  - revoking events (canceled / past_due / paused) downgrade to Free
 *  - renewal payments keep credits flowing (recurring grants)
 *  - one-time / non-catalog purchases never touch entitlements
 *  - out-of-order safety: mapping is pure — ordering is enforced later by the
 *    atomic process_paddle_event() dedupe, which has its own tests upstream.
 */

function settings(): PaddleSettings {
  return {
    apiKey: "pl_test_key",
    environment: "sandbox",
    clientToken: "test_token",
    webhookSecret: "whsec_test",
    priceIds: {
      Starter: "pri_starter",
      Pro: "pri_pro",
      Business: "pri_business",
    },
    // Ürün ID'leri AYRI sözlüktür (fiyat ID'si bulunamazsa plan yine çözülür).
    productIds: {
      Starter: "pro_starter",
      Pro: "pro_pro",
      Business: "pro_business",
    },
  };
}

function completedPayment(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "transaction.completed",
    data: {
      id: "txn_123",
      subscriptionId: "sub_456",
      currencyCode: "USD",
      customerId: "cus_789",
      details: { totals: { grandTotal: "2900.00" } },
      billingPeriod: { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
      items: [{ price: { id: "pri_pro" } }],
      customData: { userId: "11111111-1111-1111-1111-111111111111", plan: "Pro" },
      ...overrides,
    },
  };
}

describe("mapPaddleEvent — successful payments", () => {
  it("maps a Pro renewal to the Pro tier with recurring credit grants", () => {
    const cmd = mapPaddleEvent(settings(), "transaction.completed", completedPayment().data);
    expect(cmd).not.toBeNull();
    expect(cmd!.tier).toBe("Pro");
    expect(cmd!.searchCredits).toBe(20);
    expect(cmd!.simCredits).toBe(10);
    expect(cmd!.amountCents).toBe(2900);
    expect(cmd!.currency).toBe("USD");
    expect(cmd!.transactionId).toBe("txn_123");
    expect(cmd!.paddleSubscriptionId).toBe("sub_456");
    expect(cmd!.status).toBe("active");
  });

  it("derives the tier from the price first, then server-side customData", () => {
    const byPrice = mapPaddleEvent(settings(), "transaction.completed", completedPayment().data);
    expect(byPrice!.tier).toBe("Pro");

    // Price unknown but customData.plan present (checkout flow) → tier from customData.
    const byCustomData = mapPaddleEvent(
      settings(),
      "transaction.completed",
      completedPayment({ items: [{ price: { id: "pri_unknown" } }] }).data,
    );
    expect(byCustomData!.tier).toBe("Pro");
  });

  it("never maps one-time / non-subscription purchases", () => {
    const oneTime = mapPaddleEvent(
      settings(),
      "transaction.completed",
      completedPayment({ subscriptionId: null, customData: {} }).data,
    );
    expect(oneTime).toBeNull();
  });

  it("keeps amountCents null when grandTotal is missing (defensive)", () => {
    const cmd = mapPaddleEvent(
      settings(),
      "transaction.completed",
      completedPayment({ details: { totals: {} } }).data,
    );
    expect(cmd).not.toBeNull();
    expect(cmd!.amountCents).toBeNull();
  });
});

describe("mapPaddleEvent — lifecycle events (refunds, cancels, out-of-order)", () => {
  it("maps subscription.canceled to Free tier (revoking)", () => {
    const cmd = mapPaddleEvent(settings(), "subscription.canceled", {
      id: "sub_456",
      status: "canceled",
      customerId: "cus_789",
      items: [{ price: { id: "pri_pro" } }],
      customData: {},
    });
    expect(cmd).not.toBeNull();
    expect(cmd!.tier).toBe("Free");
    expect(cmd!.status).toBe("canceled");
    expect(cmd!.paddleSubscriptionId).toBe("sub_456");
  });

  it("maps past_due and paused to Free tier (payment failing)", () => {
    for (const status of ["past_due", "paused"]) {
      const cmd = mapPaddleEvent(settings(), "subscription.updated", {
        id: "sub_456",
        status,
        items: [{ price: { id: "pri_pro" } }],
        customData: {},
      });
      expect(cmd!.tier).toBe("Free");
      expect(cmd!.status).toBe(status);
    }
  });

  it("keeps active/trialing entitlements with the price tier", () => {
    const active = mapPaddleEvent(settings(), "subscription.updated", {
      id: "sub_456",
      status: "active",
      items: [{ price: { id: "pri_business" } }],
      customData: {},
    });
    expect(active!.tier).toBe("Business");

    const trialing = mapPaddleEvent(settings(), "subscription.trialing", {
      id: "sub_456",
      status: "trialing",
      items: [{ price: { id: "pri_starter" } }],
      customData: {},
    });
    expect(trialing!.tier).toBe("Starter");
    expect(trialing!.status).toBe("trialing");
  });

  it("flags cancel_at_period_end from scheduledChange", () => {
    const cmd = mapPaddleEvent(settings(), "subscription.updated", {
      id: "sub_456",
      status: "active",
      items: [{ price: { id: "pri_pro" } }],
      scheduledChange: { action: "cancel" },
      customData: {},
    });
    expect(cmd!.cancelAtPeriodEnd).toBe(true);

    const resumed = mapPaddleEvent(settings(), "subscription.updated", {
      id: "sub_456",
      status: "active",
      items: [{ price: { id: "pri_pro" } }],
      scheduledChange: { action: "reactivate" },
      customData: {},
    });
    expect(resumed!.cancelAtPeriodEnd).toBe(false);
  });

  it("ignores events outside the handled catalog (ack without side effects)", () => {
    expect(mapPaddleEvent(settings(), "customer.updated", {})).toBeNull();
    expect(mapPaddleEvent(settings(), "address.created", {})).toBeNull();
    expect(mapPaddleEvent(settings(), "transaction.updated", {})).toBeNull();
  });
});

describe("planForAsset — ürün ID'siyle plan çözümü", () => {
  it("fiyat ID'si eşleşmese bile ÜRÜN ID'siyle planı bulur", () => {
    // ÖLÇÜLEN HATA: env'de ürün ID'si tanımlı bir kurulumda webhook yalnız fiyat
    // ID'sine bakıyordu, eşleşme bulamıyordu ve paket hiç tanımlanmıyordu
    // (kullanıcı ödeme yaptığı hâlde "Free" kalıyordu).
    expect(planForAsset(settings(), "pri_bilinmeyen", "pro_business")).toBe("Business");
  });

  it("fiyat ID'si ürün ID'sinden önce gelir (daha özgül)", () => {
    expect(planForAsset(settings(), "pri_pro", "pro_business")).toBe("Pro");
  });

  it("hiçbir kimlik eşleşmezse null döner (uydurma plan yok)", () => {
    expect(planForAsset(settings(), "pri_yok", "pro_yok")).toBeNull();
    expect(planForAsset(settings(), null, null)).toBeNull();
  });

  it("işlem olayında ürün ID'siyle çözülen plan kredi verir", () => {
    const cmd = mapPaddleEvent(
      settings(),
      "transaction.completed",
      completedPayment({
        items: [{ price: { id: "pri_bilinmeyen", productId: "pro_pro" } }],
        customData: { userId: "11111111-1111-1111-1111-111111111111" },
      }).data,
    );
    expect(cmd!.tier).toBe("Pro");
    expect(cmd!.searchCredits).toBe(20);
    expect(cmd!.productId).toBe("pro_pro");
  });
});

describe("creditGrantDecision — kredi işlem başına bir kez", () => {
  it("tamamlanan ödemede krediyi geçirir", () => {
    const d = creditGrantDecision({
      eventType: "transaction.completed",
      transactionStatus: "completed",
      alreadyRecorded: false,
      searchCredits: 20,
      simCredits: 10,
    });
    expect(d).toMatchObject({ granted: true, search: 20, sim: 10 });
  });

  it("AYNI işlem için ikinci olayda kredi VERMEZ (kendi kendine kredi şikâyeti)", () => {
    const d = creditGrantDecision({
      eventType: "transaction.updated",
      transactionStatus: "completed",
      alreadyRecorded: true,
      searchCredits: 20,
      simCredits: 10,
    });
    expect(d).toMatchObject({ granted: false, search: 0, sim: 0, reason: "already-granted" });
  });

  it("ödenmemiş durum güncellemesi kredi doğurmaz", () => {
    const d = creditGrantDecision({
      eventType: "transaction.updated",
      transactionStatus: "ready",
      alreadyRecorded: false,
      searchCredits: 20,
      simCredits: 10,
    });
    expect(d).toMatchObject({ granted: false, reason: "not-paid" });
  });

  it("kredisiz olayda hiçbir şey yapmaz", () => {
    const d = creditGrantDecision({
      eventType: "transaction.completed",
      alreadyRecorded: false,
      searchCredits: 0,
      simCredits: 0,
    });
    expect(d).toMatchObject({ granted: false, reason: "no-grant-mapped" });
  });
});

describe("mapPaddleEvent — attribution safety", () => {
  it("carries the server-side userId from customData untouched", () => {
    const cmd = mapPaddleEvent(settings(), "subscription.activated", {
      id: "sub_456",
      status: "active",
      customerId: "cus_789",
      items: [{ price: { id: "pri_pro" } }],
      customData: { userId: "22222222-2222-2222-2222-222222222222" },
    });
    expect(cmd!.userId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("falls back to null userId when customData is missing or malformed", () => {
    const noCustomData = mapPaddleEvent(settings(), "subscription.activated", {
      id: "sub_456",
      status: "active",
      items: [{ price: { id: "pri_pro" } }],
    });
    expect(noCustomData!.userId).toBeNull();

    const malformed = mapPaddleEvent(settings(), "subscription.activated", {
      id: "sub_456",
      status: "active",
      customData: { userId: 12345 },
      items: [{ price: { id: "pri_pro" } }],
    });
    expect(malformed!.userId).toBeNull();
  });
});