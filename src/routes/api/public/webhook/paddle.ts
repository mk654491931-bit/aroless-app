// NOTE: do not statically import @paddle/paddle-node-sdk here — this route
// module is also evaluated client-side for the route tree. All SDK usage goes
// through the dynamic import of @/lib/paddle.server inside the handler.
import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 1_000_000;
const TRANSACTION_EVENTS = new Set(["transaction.completed", "transaction.updated"]);
const MAX_RPC_RETRIES = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Paddle Billing v2 webhook handler.
 *
 * Security & reliability model:
 *  - Signature verified with the official SDK (HMAC + timestamp) — invalid
 *    requests are rejected before any processing.
 *  - Replay/idempotency protection is enforced ATOMICALLY inside a single
 *    Postgres function (process_paddle_event): dedupe insert, profile update,
 *    subscription ledger upsert, transaction record, credit grant and promo
 *    conversion all commit (or all roll back) together. A duplicated event is
 *    a no-op, and a partially failed attempt is fully retried by Paddle.
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
          if (!command) {
            // Known-but-unhandled event (address.created, customer.updated, …).
            console.log(`[Paddle Webhook] Ignored ${event.eventType} (${event.eventId})`);
            return text("ok", 200);
          }
          command.eventId = event.eventId;
          command.occurredAt = event.occurredAt;

          // 6. Attribute the event to a user: customData userId first, then the
          //    Paddle customer id recorded on the profile (renewal fallback).
          let userId: string | null = command.userId && UUID_RE.test(command.userId)
            ? command.userId
            : null;

          if (!userId && command.customerId) {
            const { data: byCustomer } = await supabaseAdmin
              .from("profiles")
              .select("id, subscription_tier")
              .eq("paddle_customer_id" as never, command.customerId)
              .maybeSingle();
            if (byCustomer?.id) userId = byCustomer.id as string;
          }

          if (!userId) {
            console.warn(
              `[Paddle Webhook] ${event.eventType}: no matching user (userId=${command.userId}, customerId=${command.customerId})`,
            );
            return text("ok", 200);
          }

          // 7. For successful payments where the price/customData didn't reveal the
          //    plan (defensive), fall back to the user's current profile tier.
          //    Covers both transaction.completed and transaction.updated (self-healing).
          if (
            TRANSACTION_EVENTS.has(event.eventType) &&
            (!command.tier || command.tier === "Free") &&
            (command.amountCents ?? 0) > 0
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
              command.tier = planKey;
              command.searchCredits = SUBSCRIPTION_CREDIT_GRANTS[planKey].search;
              command.simCredits = SUBSCRIPTION_CREDIT_GRANTS[planKey].sim;
            }
          }

          // 8. Atomic, idempotent database processing — single transaction.
          //    Self-healing: transient DB / network errors are retried with backoff;
          //    a duplicate event_id returns 'duplicate' and is a no-op (idempotent).
          const rpc = supabaseAdmin.rpc as unknown as (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: string | null; error: { message: string; code?: string } | null }>;

          const args = {
            _event_id: command.eventId,
            _event_type: command.eventType,
            _occurred_at: command.occurredAt,
            _user_id: userId,
            _tier: command.tier ?? null,
            _status: command.status ?? null,
            _paddle_subscription_id: command.paddleSubscriptionId,
            _paddle_customer_id: command.customerId,
            _price_id: command.priceId,
            _currency: command.currency,
            _amount_cents: command.amountCents,
            _period_start: command.periodStart,
            _period_end: command.periodEnd,
            _next_billed_at: command.nextBilledAt,
            _transaction_id: command.transactionId,
            _cancel_at_period_end: command.cancelAtPeriodEnd,
            _search_credits: command.searchCredits,
            _sim_credits: command.simCredits,
            _payload: auditPayload,
          } as Record<string, unknown>;

          let lastDbError: { message: string } | null = null;
          let result: string | null = null;
          for (let attempt = 0; attempt < MAX_RPC_RETRIES; attempt++) {
            const res = await rpc("process_paddle_event", args);
            if (!res.error) {
              result = res.data;
              lastDbError = null;
              break;
            }
            lastDbError = res.error;
            // Duplicate is a success (idempotent) — never retry.
            if (res.data === "duplicate") {
              result = res.data;
              lastDbError = null;
              break;
            }
            // Only retry on transient errors (connection / timeout / 5xx).
            const transient =
              /timeout|connection|temporarily|deadlock|serialization/i.test(res.error.message) ||
              (res.error as { code?: string }).code === "54000";
            if (!transient || attempt === MAX_RPC_RETRIES - 1) break;
            await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
          }

          if (lastDbError) {
            console.error(
              `[Paddle Webhook] process_paddle_event failed (${event.eventId}):`,
              lastDbError.message,
            );
            return text("Webhook islenemedi", 500);
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
