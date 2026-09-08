/**
 * Paddle refund / chargeback / payment-failure event mapping.
 *
 * Kept in its own module for two reasons:
 *  1. paddle.server.ts is already large; this avoids growing it further.
 *  2. This module has ZERO runtime imports (only a type-only import, which is
 *     erased at compile time), so it can be unit-tested without touching the
 *     Paddle SDK, environment variables or the network.
 *
 * Paddle Billing v2 does not emit a "transaction.refunded" event. Refunds,
 * chargebacks and credits all arrive as `adjustment.created` /
 * `adjustment.updated` with an `action` discriminator, and failed renewals
 * arrive as `transaction.payment_failed`.
 */

import type { PaddleSettings } from "@/lib/paddle.server";

/** Adjustment events carrying refund/chargeback information. */
export const ADJUSTMENT_EVENTS = new Set([
  "adjustment.created",
  "adjustment.updated",
]);

export const PAYMENT_FAILED_EVENT = "transaction.payment_failed";

/**
 * Adjustment actions that take money back from us and therefore may require a
 * credit clawback. `credit` and `credit_reverse` never do: they adjust an
 * unbilled balance rather than reversing a completed payment.
 */
const REVOKING_ACTIONS = new Set(["refund", "chargeback"]);

/** Adjustment statuses that mean "this did not actually happen". */
const INERT_STATUSES = new Set(["rejected", "pending_approval"]);

export type PaddleRefundKind =
  /** Money was taken back — reverse commission and possibly claw back credits. */
  | "refund"
  /** Recorded for audit/idempotency only; no entitlement change. */
  | "audit";

export type PaddleRefundCommand = {
  kind: PaddleRefundKind;
  eventId: string;
  eventType: string;
  occurredAt: string;
  /** Raw customData userId when present (adjustments usually lack customData). */
  userId: string | null;
  /** Primary attribution path for adjustments — resolved to a user by the route. */
  customerId: string | null;
  transactionId: string | null;
  subscriptionId: string | null;
  action: string;
  status: string | null;
  /** Absolute value of the amount taken back, in minor units. */
  amountCents: number | null;
  currency: string | null;
  /**
   * True only for a full reversal. Partial refunds reverse commission but keep
   * the customer's credits, because they kept part of the delivered value.
   */
  fullReversal: boolean;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Paddle sends minor units as strings; they may be negative on adjustments. */
function minorUnits(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(Math.round(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.abs(Math.round(parsed));
  }
  return null;
}

/**
 * Map a verified Paddle adjustment / payment-failure webhook to a refund
 * command. Returns null for events this module does not own, so the caller can
 * fall through to its existing handling and still ack with 200.
 *
 * `settings` is accepted for signature symmetry with mapPaddleEvent() and for
 * future price-based resolution; it is intentionally unused today.
 */
export function mapPaddleRefundEvent(
  _settings: PaddleSettings,
  eventType: string,
  // Event data differs per event type; narrowed structurally below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): PaddleRefundCommand | null {
  const customData =
    data && typeof data === "object" && data.customData && typeof data.customData === "object"
      ? data.customData
      : {};

  const base = {
    eventId: "",
    eventType,
    occurredAt: "",
    userId: str(customData.userId),
    customerId: str(data?.customerId),
    transactionId: null as string | null,
    subscriptionId: str(data?.subscriptionId),
    action: "",
    status: str(data?.status),
    amountCents: null as number | null,
    currency: str(data?.currencyCode),
    fullReversal: false,
  };

  // ---- Failed renewal payments -------------------------------------
  // No credits were granted, so nothing to claw back. Recorded for audit only;
  // the actual entitlement change arrives as subscription.past_due.
  if (eventType === PAYMENT_FAILED_EVENT) {
    return {
      ...base,
      kind: "audit",
      action: "payment_failed",
      transactionId: str(data?.id),
      status: str(data?.status),
      amountCents: minorUnits(data?.details?.totals?.grandTotal),
    };
  }

  if (!ADJUSTMENT_EVENTS.has(eventType)) return null;

  const action = str(data?.action) ?? "";
  const status = str(data?.status);
  const transactionId = str(data?.transactionId);
  const amountCents = minorUnits(data?.totals?.total ?? data?.payoutTotals?.total);

  // An adjustment we cannot attach to a transaction is unusable.
  if (!transactionId) return null;

  const takesMoneyBack = REVOKING_ACTIONS.has(action) && !INERT_STATUSES.has(status ?? "");

  if (!takesMoneyBack) {
    // credit / credit_reverse / chargeback_reverse / rejected — audit only, but
    // still worth recording so a redelivery is a cheap no-op.
    return {
      ...base,
      kind: "audit",
      action: action || "unknown",
      status,
      transactionId,
      amountCents,
    };
  }

  // A full reversal is one where the adjustment covers the whole transaction.
  // Paddle marks these with type "full"; otherwise compare against the
  // transaction total when it is available on the payload.
  const adjustmentType = str(data?.type);
  const transactionTotal = minorUnits(
    data?.transactionDetails?.totals?.total ?? data?.transactionDetails?.totals?.grandTotal,
  );
  const fullReversal =
    adjustmentType === "full" ||
    action === "chargeback" ||
    (amountCents !== null && transactionTotal !== null && amountCents >= transactionTotal);

  return {
    ...base,
    kind: "refund",
    action,
    status,
    transactionId,
    amountCents,
    fullReversal,
  };
}
