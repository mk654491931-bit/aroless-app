// NOTE: do not statically import @paddle/paddle-node-sdk here — this route
// module is also evaluated client-side for the route tree. All SDK usage goes
// through the dynamic import of @/lib/paddle.server inside the handler.
import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 1_000_000;
const TRANSACTION_COMPLETED = "transaction.completed";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loose Supabase RPC signature — the generated types don't cover our functions. */
type RpcCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: string | null; error: { message: string } | null }>;

/**
 * Paddle Billing v2 webhook handler.
 *
 * Security & reliability model:
 *  - Signature verified with the official SDK (HMAC + timestamp) — invalid
 *    requests are rejected before any processing.
 *  - Replay/idempotency protection is enforced ATOMICALLY inside a single
 *    Postgres function (process_paddle_event / process_paddle_refund): dedupe
 *    insert, profile update, subscription ledger upsert, transaction record,
 *    credit grant/clawback, commission reversal and promo conversion all commit
 *    (or all roll back) together. A duplicated event is a no-op, and a
 *    partially failed attempt is fully retried by Paddle.
 *  - Out-of-order deliveries are rejected by the last_event_at watermark inside
 *    process_paddle_event, which returns 'stale' instead of mutating state.
 *  - Events are mapped from Paddle's typed EventName set; anything outside the
 *    handled catalog is acknowledged without side effects.
 */
export const Route = createFileRoute("/api/public/webhook/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          paddleSettings,
          verifyPaddleWebhook,
          mapPaddleEvent,
          SUBSCRIPTION_CREDIT_GRANTS,
        } = await import("@/lib/paddle.server");
        const { mapPaddleRefundEvent } = await import("@/lib/paddle-refunds.server");

        const rpc = supabaseAdmin.rpc as unknown as RpcCaller;

        /**
         * Attribute an event to a user: customData userId first, then the Paddle
         * customer id recorded on the profile. Adjustments carry no customData,
         * so for refunds the customer lookup is the primary path.
         */
        async function resolveUserId(
          rawUserId: string | null,
          customerId: string | null,
        ): Promise<string | null> {
          if (rawUserId && UUID_RE.test(rawUserId)) return rawUserId;
          if (!customerId) return null;

          const { data: byCustomer } = await supabaseAdmin
            .from("profiles")
            .select("id, subscription_tier")
            .eq("paddle_customer_id" as never, customerId)
            .maybeSingle();

          return (byCustomer?.id as string | undefined) ?? null;
        }

        try {
          // 1. Configuration guard — fail loudly (Paddle retries with backoff).
          const settings = paddleSettings();
          if (!settings) {
            console.error("[Paddle Webhook] Missing Paddle configuration");
            return text("Paddle not configured", 500);
          }

          // 2. Payload size guard (DoS protection).
          const declaredLength = Number(request.headers.get("content-length") ?? 0);
          if (declaredLength > MAX_BODY_BYTES) return text("Payload too large", 413);

          const raw = await request.text();
          if (raw.length > MAX_BODY_BYTES) return text("Payload too large", 413);

          // 3. Signature verification — must come before ANY business logic.
          const signature = request.headers.get("paddle-signature") ?? "";
          let event: { eventId: string; eventType: string; occurredAt: string; data: unknown };
          try {
            event = await verifyPaddleWebhook(raw, signature);
          } catch (err) {
            console.warn("[Paddle Webhook] Signature verification failed:", err);
            return text("Invalid signature", 400);
          }

          // 4. Parse raw JSON once for the audit log (kept small).
          let auditPayload: unknown = null;
          try {
            const parsed: unknown = JSON.parse(raw);
            auditPayload = JSON.stringify(parsed).length > 50_000
              ? { eventId: event.eventId, eventType: event.eventType, truncated: true }
              : parsed;
          } catch {
            /* raw body was validated by unmarshal already */
          }

          // 5. Map event → database command (structural, tolerant of optional fields).
          const command = mapPaddleEvent(settings, event.eventType, event.data);

          // 5b. Refunds, chargebacks and failed payments are a separate command
          //     family: they take money back instead of granting entitlements.
          const refundCommand = command
            ? null
            : mapPaddleRefundEvent(settings, event.eventType, event.data);

          if (!command && !refundCommand) {
            // Known-but-unhandled event (address.created, customer.updated, …).
            console.log(`[Paddle Webhook] Ignored ${event.eventType} (${event.eventId})`);
            return text("ok", 200);
          }

          // ---- Refund / chargeback / payment failure branch ----------------
          if (refundCommand) {
            refundCommand.eventId = event.eventId;
            refundCommand.occurredAt = event.occurredAt;

            const refundUserId = await resolveUserId(
              refundCommand.userId,
              refundCommand.customerId,
            );

            // Unattributable adjustments are still recorded, so a redelivery is
            // a no-op and the payload stays available for manual review.
            if (!refundUserId) {
              console.warn(
                `[Paddle Webhook] ${event.eventType}: no matching user (customerId=${refundCommand.customerId}, txn=${refundCommand.transactionId})`,
              );
            }

            const { data: refundResult, error: refundError } = await rpc(
              "process_paddle_refund",
              {
                _event_id: refundCommand.eventId,
                _event_type: refundCommand.eventType,
                _occurred_at: refundCommand.occurredAt,
                _user_id: refundUserId,
                _transaction_id: refundCommand.transactionId,
                _subscription_id: refundCommand.subscriptionId,
                _action: refundCommand.action,
                _status: refundCommand.status,
                _amount_cents: refundCommand.amountCents,
                _currency: refundCommand.currency,
                _full_reversal: refundCommand.fullReversal,
                _payload: auditPayload,
              },
            );

            if (refundError) {
              console.error(
                `[Paddle Webhook] process_paddle_refund failed (${event.eventId}):`,
                refundError.message,
              );
              return text("Webhook islenemedi", 500);
            }

            console.log(
              `[Paddle Webhook] ✓ ${event.eventType} (${event.eventId}) action=${refundCommand.action} full=${refundCommand.fullReversal} → ${refundResult ?? "ok"} for user ${refundUserId ?? "unknown"}`,
            );
            return text("ok", 200);
          }

          // ---- Subscription / payment branch -------------------------------
          // Non-null by construction: refundCommand is only mapped when command is null.
          const cmd = command!;
          cmd.eventId = event.eventId;
          cmd.occurredAt = event.occurredAt;

          // 6. Attribute the event to a user.
          const userId = await resolveUserId(cmd.userId, cmd.customerId);

          if (!userId) {
            console.warn(
              `[Paddle Webhook] ${event.eventType}: no matching user (userId=${cmd.userId}, customerId=${cmd.customerId})`,
            );
            return text("ok", 200);
          }

          // 7. For successful payments where the price/customData didn't reveal the
          //    plan (defensive), fall back to the user's current profile tier.
          if (
            event.eventType === TRANSACTION_COMPLETED &&
            (!cmd.tier || cmd.tier === "Free") &&
            (cmd.amountCents ?? 0) > 0
          ) {
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("subscription_tier")
              .eq("id", userId as never)
              .maybeSingle();
            const currentTier = (profile as { subscription_tier?: string } | null)?.subscription_tier;
            const planKey = (["Starter", "Pro", "Business"] as const).find(
              (p) => p.toLowerCase() === String(currentTier ?? "").toLowerCase(),
            );
            if (planKey) {
              cmd.tier = planKey;
              cmd.searchCredits = SUBSCRIPTION_CREDIT_GRANTS[planKey].search;
              cmd.simCredits = SUBSCRIPTION_CREDIT_GRANTS[planKey].sim;
            }
          }

          // 8. Atomic, idempotent database processing — single transaction.
          const { data: result, error: dbError } = await rpc("process_paddle_event", {
            _event_id: cmd.eventId,
            _event_type: cmd.eventType,
            _occurred_at: cmd.occurredAt,
            _user_id: userId,
            _tier: cmd.tier ?? null,
            _status: cmd.status ?? null,
            _paddle_subscription_id: cmd.paddleSubscriptionId,
            _paddle_customer_id: cmd.customerId,
            _price_id: cmd.priceId,
            _currency: cmd.currency,
            _amount_cents: cmd.amountCents,
            _period_start: cmd.periodStart,
            _period_end: cmd.periodEnd,
            _next_billed_at: cmd.nextBilledAt,
            _transaction_id: cmd.transactionId,
            _cancel_at_period_end: cmd.cancelAtPeriodEnd,
            _search_credits: cmd.searchCredits,
            _sim_credits: cmd.simCredits,
            _payload: auditPayload,
          });

          if (dbError) {
            console.error(
              `[Paddle Webhook] process_paddle_event failed (${event.eventId}):`,
              dbError.message,
            );
            return text("Webhook islenemedi", 500);
          }

          if (result === "stale") {
            console.warn(
              `[Paddle Webhook] ⏮ ${event.eventType} (${event.eventId}) arrived out of order — state preserved`,
            );
            return text("ok", 200);
          }

          // 9. Affiliate commission accrual — only for real money, and only once
          //    the entitlement work above has committed.
          //
          //    Deliberately non-fatal: the accrual is guarded in-database by
          //    UNIQUE(paddle_transaction_id, affiliate_user_id) and by the
          //    'verified' status check, so a Paddle retry cannot double-pay. A
          //    bookkeeping failure must never turn into a 500 that blocks the
          //    customer's credits.
          if (
            result !== "duplicate" &&
            event.eventType === TRANSACTION_COMPLETED &&
            cmd.transactionId &&
            (cmd.amountCents ?? 0) > 0
          ) {
            const { data: commissionResult, error: commissionError } = await rpc(
              "accrue_affiliate_commission",
              {
                _referred_user_id: userId,
                _transaction_id: cmd.transactionId,
                _subscription_id: cmd.paddleSubscriptionId,
                _amount_cents: cmd.amountCents,
                _currency: cmd.currency,
                _occurred_at: cmd.occurredAt,
              },
            );

            if (commissionError) {
              console.error(
                `[Paddle Webhook] accrue_affiliate_commission failed (${event.eventId}):`,
                commissionError.message,
              );
            } else if (commissionResult && commissionResult !== "accrued") {
              console.log(
                `[Paddle Webhook] commission skipped for ${cmd.transactionId}: ${commissionResult}`,
              );
            } else if (commissionResult === "accrued") {
              console.log(`[Paddle Webhook] commission accrued for ${cmd.transactionId}`);
            }
          }

          console.log(
            `[Paddle Webhook] ✓ ${event.eventType} (${event.eventId}) → ${result ?? "ok"} for user ${userId}`,
          );
          return text("ok", 200);
        } catch (err) {
          console.error("[Paddle Webhook] Unhandled error:", err);
          // Never leak internals to the caller; Paddle retries on non-2xx.
          return text("Webhook islenemedi", 500);
        }
      },
    },
  },
});

function text(payload: string, status: number) {
  return new Response(payload, { status });
}
