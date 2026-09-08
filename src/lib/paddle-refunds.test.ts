import { describe, expect, it } from "vitest";
import {
  mapPaddleRefundEvent,
  type PaddleRefundCommand,
} from "@/lib/paddle-refunds.server";
import type { PaddleSettings } from "@/lib/paddle.server";

// mapPaddleRefundEvent ignores settings today, but we pass a realistic object
// so the test keeps compiling if that changes.
const settings = {
  apiKey: "pl_test_key",
  environment: "sandbox",
  clientToken: "test_token",
  webhookSecret: "pdl_ntfset_test",
  priceIds: { Starter: "pri_starter", Pro: "pri_pro", Business: "pri_biz" },
} as PaddleSettings;

function map(eventType: string, data: unknown): PaddleRefundCommand | null {
  return mapPaddleRefundEvent(settings, eventType, data);
}

const fullRefund = {
  id: "adj_01",
  action: "refund",
  type: "full",
  status: "approved",
  transactionId: "txn_01",
  subscriptionId: "sub_01",
  customerId: "ctm_01",
  currencyCode: "USD",
  totals: { total: "2900" },
};

describe("mapPaddleRefundEvent", () => {
  it("ignores events it does not own", () => {
    expect(map("subscription.activated", { id: "sub_01" })).toBeNull();
    expect(map("transaction.completed", { id: "txn_01" })).toBeNull();
    expect(map("customer.updated", { id: "ctm_01" })).toBeNull();
  });

  it("maps an approved full refund as a reversal", () => {
    const cmd = map("adjustment.created", fullRefund);
    expect(cmd).not.toBeNull();
    expect(cmd!.kind).toBe("refund");
    expect(cmd!.action).toBe("refund");
    expect(cmd!.fullReversal).toBe(true);
    expect(cmd!.transactionId).toBe("txn_01");
    expect(cmd!.subscriptionId).toBe("sub_01");
    expect(cmd!.customerId).toBe("ctm_01");
    expect(cmd!.amountCents).toBe(2900);
    expect(cmd!.currency).toBe("USD");
  });

  it("treats a partial refund as a reversal that keeps credits", () => {
    const cmd = map("adjustment.created", {
      ...fullRefund,
      type: "partial",
      totals: { total: "500" },
      transactionDetails: { totals: { total: "2900" } },
    });
    expect(cmd!.kind).toBe("refund");
    expect(cmd!.fullReversal).toBe(false);
    expect(cmd!.amountCents).toBe(500);
  });

  it("treats a partial adjustment covering the whole total as full", () => {
    const cmd = map("adjustment.created", {
      ...fullRefund,
      type: "partial",
      totals: { total: "2900" },
      transactionDetails: { totals: { total: "2900" } },
    });
    expect(cmd!.fullReversal).toBe(true);
  });

  it("always treats a chargeback as a full reversal", () => {
    const cmd = map("adjustment.created", {
      ...fullRefund,
      action: "chargeback",
      type: "partial",
      totals: { total: "100" },
      transactionDetails: { totals: { total: "2900" } },
    });
    expect(cmd!.kind).toBe("refund");
    expect(cmd!.fullReversal).toBe(true);
  });

  it("does not revoke anything for a rejected adjustment", () => {
    const cmd = map("adjustment.created", { ...fullRefund, status: "rejected" });
    expect(cmd!.kind).toBe("audit");
    expect(cmd!.fullReversal).toBe(false);
  });

  it("does not revoke anything while approval is pending", () => {
    const cmd = map("adjustment.created", { ...fullRefund, status: "pending_approval" });
    expect(cmd!.kind).toBe("audit");
  });

  it("treats credit and reversal actions as audit-only", () => {
    for (const action of ["credit", "credit_reverse", "chargeback_reverse"]) {
      const cmd = map("adjustment.created", { ...fullRefund, action });
      expect(cmd!.kind, action).toBe("audit");
      expect(cmd!.action, action).toBe(action);
    }
  });

  it("handles adjustment.updated the same way as adjustment.created", () => {
    const cmd = map("adjustment.updated", fullRefund);
    expect(cmd!.kind).toBe("refund");
  });

  it("drops adjustments with no transaction to attach to", () => {
    expect(map("adjustment.created", { ...fullRefund, transactionId: null })).toBeNull();
    expect(map("adjustment.created", { ...fullRefund, transactionId: "" })).toBeNull();
  });

  it("maps payment_failed as audit-only", () => {
    const cmd = map("transaction.payment_failed", {
      id: "txn_02",
      status: "past_due",
      customerId: "ctm_01",
      subscriptionId: "sub_01",
      currencyCode: "USD",
      details: { totals: { grandTotal: "2900" } },
    });
    expect(cmd!.kind).toBe("audit");
    expect(cmd!.action).toBe("payment_failed");
    expect(cmd!.transactionId).toBe("txn_02");
    expect(cmd!.fullReversal).toBe(false);
  });

  it("normalises negative and numeric amounts to positive minor units", () => {
    expect(map("adjustment.created", { ...fullRefund, totals: { total: "-2900" } })!.amountCents)
      .toBe(2900);
    expect(map("adjustment.created", { ...fullRefund, totals: { total: 2900 } })!.amountCents)
      .toBe(2900);
  });

  it("tolerates missing, empty and malformed fields without throwing", () => {
    expect(() => map("adjustment.created", null)).not.toThrow();
    expect(() => map("adjustment.created", undefined)).not.toThrow();
    expect(() => map("transaction.payment_failed", {})).not.toThrow();
    expect(map("adjustment.created", {})).toBeNull();

    const cmd = map("adjustment.created", {
      transactionId: "txn_03",
      action: "refund",
      status: "approved",
      totals: { total: "not-a-number" },
    });
    expect(cmd!.amountCents).toBeNull();
    expect(cmd!.currency).toBeNull();
    expect(cmd!.customerId).toBeNull();
  });

  it("picks up customData.userId when Paddle forwards it", () => {
    const cmd = map("adjustment.created", {
      ...fullRefund,
      customData: { userId: "3d4d872b-594c-8167-a55b-0002ca195620" },
    });
    expect(cmd!.userId).toBe("3d4d872b-594c-8167-a55b-0002ca195620");
  });

  it("leaves userId null when customData is absent or malformed", () => {
    expect(map("adjustment.created", fullRefund)!.userId).toBeNull();
    expect(map("adjustment.created", { ...fullRefund, customData: "nope" })!.userId).toBeNull();
    expect(map("adjustment.created", { ...fullRefund, customData: { userId: 42 } })!.userId)
      .toBeNull();
  });

  it("falls back to payoutTotals when totals is absent", () => {
    const cmd = map("adjustment.created", {
      ...fullRefund,
      totals: undefined,
      payoutTotals: { total: "1500" },
    });
    expect(cmd!.amountCents).toBe(1500);
  });

  it("labels an unknown action rather than dropping the event", () => {
    const cmd = map("adjustment.created", { ...fullRefund, action: null });
    expect(cmd!.kind).toBe("audit");
    expect(cmd!.action).toBe("unknown");
  });
});
