/**
 * Paddle Billing v2 — Vercel Serverless Function webhook handler.
 *
 * Webhook endpoint (Paddle dashboard):
 *   https://<your-domain>/api/webhook
 *
 * Supported events:
 *   - transaction.completed
 *   - subscription.created
 *   - subscription.updated
 *   - subscription.canceled
 *
 * Security: HMAC-SHA256 signature verification via PADDLE_WEBHOOK_SECRET.
 * Database: Supabase (service-role) — updates profiles subscription fields.
 *
 * Required env vars:
 *   PADDLE_WEBHOOK_SECRET     — Paddle webhook signing secret
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (server-only)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/* ─── Helpers ──────────────────────────────────────────────── */

function json(res: VercelResponse, status: number, body: unknown) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .setHeader("X-Content-Type-Options", "nosniff")
    .json(body);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ─── HMAC-SHA256 Signature Verification ───────────────────── */

async function verifySignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(atob(signatureHeader), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(rawBody));
  } catch {
    return false;
  }
}

/* ─── Type Definitions ─────────────────────────────────────── */

interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  data?: {
    id?: string;
    status?: string;
    subscription_id?: string;
    customer?: { id?: string; email?: string };
    items?: Array<{
      price?: { id?: string; name?: string };
      quantity?: number;
    }>;
    billing_period?: { start?: string; finish?: string };
    custom_data?: Record<string, unknown>;
    totals?: { total?: string | number; currency?: string };
  };
}

/* ─── UUID guard (injection prevention) ────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── Handler ──────────────────────────────────────────────── */

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // 1. Method check — only POST
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  // 2. Configuration check
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET not set");
    json(res, 500, { error: "Webhook not configured" });
    return;
  }

  // 3. Read raw body for signature verification
  let raw: string;
  try {
    raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } catch {
    json(res, 400, { error: "Bad request body" });
    return;
  }

  if (raw.length > 1_000_000) {
    json(res, 413, { error: "Payload too large" });
    return;
  }

  // 4. Verify Paddle signature (HMAC-SHA256)
  const signatureHeader = (req.headers["paddle-signature"] as string) ?? "";
  if (!signatureHeader) {
    json(res, 401, { error: "Missing signature" });
    return;
  }

  const valid = await verifySignature(raw, signatureHeader);
  if (!valid) {
    console.error("[paddle-webhook] invalid signature");
    json(res, 401, { error: "Invalid signature" });
    return;
  }

  // 5. Parse event payload
  let event: PaddleEvent;
  try {
    event = JSON.parse(raw) as PaddleEvent;
  } catch {
    json(res, 400, { error: "Bad JSON" });
    return;
  }

  const eventType = event.event_type ?? "";
  const data = event.data ?? {};
  const customData = data.custom_data ?? {};

  // 6. Extract user_id (UUID validation)
  const userId = typeof customData.user_id === "string" ? customData.user_id : undefined;
  if (userId && !UUID_RE.test(userId)) {
    json(res, 400, { error: "Bad user id" });
    return;
  }

  // 7. Handle event types
  switch (eventType) {
    case "transaction.completed": {
      if (!userId) {
        json(res, 200, { ok: true });
        return;
      }
      await handleTransactionCompleted(userId, data);
      json(res, 200, { ok: true });
      return;
    }

    case "subscription.created":
    case "subscription.updated": {
      if (!userId) {
        json(res, 200, { ok: true });
        return;
      }
      await handleSubscriptionActive(userId, data, eventType);
      json(res, 200, { ok: true });
      return;
    }

    case "subscription.canceled": {
      if (!userId) {
        json(res, 200, { ok: true });
        return;
      }
      await handleSubscriptionCanceled(userId);
      json(res, 200, { ok: true });
      return;
    }

    default:
      // Unknown events — acknowledge silently
      json(res, 200, { ok: true });
      return;
  }
}

/* ─── Event Handlers ───────────────────────────────────────── */

async function handleTransactionCompleted(
  userId: string,
  data: NonNullable<PaddleEvent["data"]>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rawTotal = data.totals?.total;
  const totalCents =
    typeof rawTotal === "number"
      ? Math.round(rawTotal * 100)
      : Math.round((parseFloat(String(rawTotal ?? "0")) || 0) * 100);

  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    email: data.customer?.email ?? null,
    amount_cents: totalCents,
    currency: data.totals?.currency ?? "USD",
    payment_method: "card",
    provider: "paddle",
    provider_event: "transaction.completed",
    external_id: data.subscription_id ?? data.id ?? null,
  });

  if (error) {
    console.error("[paddle-webhook] transaction insert failed", error);
  }
}

async function handleSubscriptionActive(
  userId: string,
  data: NonNullable<PaddleEvent["data"]>,
  eventType: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const priceId = data.items?.[0]?.price?.id ?? null;
  const customerId = data.customer?.id ?? null;
  const subscriptionId = data.subscription_id ?? data.id ?? null;
  const periodEnd = data.billing_period?.finish ?? null;

  const subscriptionStatus = eventType === "subscription.created" ? "active" : "active";

  // Build update payload — only set fields that are present
  const updatePayload: Record<string, unknown> = {
    subscription_status: subscriptionStatus,
    updated_at: new Date().toISOString(),
  };
  if (priceId) updatePayload.price_id = priceId;
  if (customerId) updatePayload.paddle_customer_id = customerId;
  if (periodEnd) updatePayload.current_period_end = periodEnd;
  if (subscriptionId) updatePayload.paddle_subscription_id = subscriptionId;

  const { error: profileError } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId);

  if (profileError) {
    console.error("[paddle-webhook] profile update failed", profileError);
  }
}

async function handleSubscriptionCanceled(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("profiles")
    .update({
      subscription_status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("[paddle-webhook] cancel update failed", error);
  }
}
