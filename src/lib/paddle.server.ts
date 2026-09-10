/**
 * Paddle Billing v2 — Server-side integration (official @paddle/paddle-node-sdk).
 *
 * This module is server-only. Never import it statically from a file that ships
 * to the browser — always `await import("@/lib/paddle.server")` inside server
 * handlers (see paddle.functions.ts, routes/api/checkout.ts and the webhook).
 *
 * Environment variables (server-side):
 *   PADDLE_API_KEY                      required — Billing API key (pl_...)
 *   PADDLE_WEBHOOK_SECRET_KEY           required — webhook endpoint secret (falls back to PADDLE_WEBHOOK_SECRET)
 *   PADDLE_CLIENT_TOKEN                 required — client-side token for Paddle.js (public by design, proxied to the browser)
 *                                       VITE_PADDLE_CLIENT_TOKEN is also accepted for Vite deployments.
 *   PADDLE_ENV                          optional — "sandbox" | "production" (auto-detected from key/token prefix when absent)
 *                                       VITE_PADDLE_ENV is the browser-side equivalent.
 *   PADDLE_STARTER_PRICE_ID / PADDLE_PRO_PRICE_ID / PADDLE_BUSINESS_PRICE_ID
 *                                       price IDs for each plan. VITE_PADDLE_PRICE_*_MONTHLY aliases are
 *                                       accepted for Vite deployments. Product IDs are never accepted as
 *                                       checkout items; Paddle price IDs must begin with `pri_`.
 */

import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { PLANS } from "@/lib/plans";

export type PlanId = "Starter" | "Pro" | "Business";

/** Catalog unit prices in minor units (cents) — single source of truth is plans.ts. */
const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  Starter: Math.round(PLANS.find((p) => p.id === "Starter")!.usd * 100),
  Pro: Math.round(PLANS.find((p) => p.id === "Pro")!.usd * 100),
  Business: Math.round(PLANS.find((p) => p.id === "Business")!.usd * 100),
};
export type PaddleEnvironment = "sandbox" | "production";

export type PaddleSettings = {
  apiKey: string;
  environment: PaddleEnvironment;
  clientToken: string;
  webhookSecret: string;
  priceIds: Record<PlanId, string>;
};

const PLAN_PRICE_ENV: Record<PlanId, readonly string[]> = {
  Starter: ["PADDLE_STARTER_PRICE_ID", "VITE_PADDLE_PRICE_STARTER_MONTHLY"],
  Pro: ["PADDLE_PRO_PRICE_ID", "VITE_PADDLE_PRICE_PRO_MONTHLY"],
  Business: ["PADDLE_BUSINESS_PRICE_ID", "VITE_PADDLE_PRICE_BUSINESS_MONTHLY"],
};

function firstDefined(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Paddle product IDs (`pro_*`) are not valid checkout line items. */
export function isPaddlePriceId(value: unknown): value is string {
  return typeof value === "string" && /^pri_[A-Za-z0-9_-]+$/.test(value.trim());
}

function isPlanId(value: unknown): value is PlanId {
  return value === "Starter" || value === "Pro" || value === "Business";
}

/** Normalize "sandbox"/"production"/"test" (or key/token prefixes) into a Paddle environment. */
export function resolvePaddleEnvironment(): PaddleEnvironment {
  const raw = (process.env["PADDLE_ENV"] ?? process.env["VITE_PADDLE_ENV"] ?? "").toLowerCase();
  if (raw === "sandbox" || raw === "test" || raw === "dev") return "sandbox";
  if (raw === "production" || raw === "prod" || raw === "live") return "production";
  // Auto-detect: sandbox keys/tokens carry test markers.
  const probe = [
    process.env["PADDLE_API_KEY"],
    process.env["PADDLE_CLIENT_TOKEN"],
    process.env["VITE_PADDLE_CLIENT_TOKEN"],
  ]
    .filter(Boolean)
    .join(" ");
  return /test_|_sdbx_|sandbox/i.test(probe) ? "sandbox" : "production";
}

/**
 * Load and validate the Paddle configuration. Returns null (and logs the missing
 * variables) when the integration is not configured — callers decide how to fail.
 */
export function paddleSettings(): PaddleSettings | null {
  const apiKey = process.env["PADDLE_API_KEY"];
  const webhookSecret = firstDefined("PADDLE_WEBHOOK_SECRET_KEY", "PADDLE_WEBHOOK_SECRET");
  // Client tokens and price IDs are public Vite configuration. Keep the
  // server-only API key and webhook secret on their unprefixed names.
  const clientToken = firstDefined("PADDLE_CLIENT_TOKEN", "VITE_PADDLE_CLIENT_TOKEN");

  const priceIds: Partial<Record<PlanId, string>> = {};
  const invalidPriceIds: string[] = [];
  for (const plan of ["Starter", "Pro", "Business"] as const) {
    const id = firstDefined(...PLAN_PRICE_ENV[plan]);
    if (!id) continue;
    if (isPaddlePriceId(id)) priceIds[plan] = id;
    else invalidPriceIds.push(plan);
  }

  if (
    !apiKey ||
    !webhookSecret ||
    !clientToken ||
    !priceIds.Starter ||
    !priceIds.Pro ||
    !priceIds.Business ||
    invalidPriceIds.length > 0
  ) {
    const missing = [
      ...(!apiKey ? ["PADDLE_API_KEY"] : []),
      ...(!webhookSecret ? ["PADDLE_WEBHOOK_SECRET_KEY"] : []),
      ...(!clientToken ? ["PADDLE_CLIENT_TOKEN"] : []),
      ...(!priceIds.Starter ? ["PADDLE_STARTER_PRICE_ID"] : []),
      ...(!priceIds.Pro ? ["PADDLE_PRO_PRICE_ID"] : []),
      ...(!priceIds.Business ? ["PADDLE_BUSINESS_PRICE_ID"] : []),
      ...(invalidPriceIds.length ? [`invalid price ID for ${invalidPriceIds.join(", ")}`] : []),
    ];
    console.error(`[Paddle] Missing environment variable(s): ${missing.join(", ")}`);
    return null;
  }

  return {
    apiKey,
    environment: resolvePaddleEnvironment(),
    clientToken,
    webhookSecret,
    priceIds: priceIds as Record<PlanId, string>,
  };
}

/** Paddle price ID configured for a plan, or the configured price that matches a given Paddle price ID. */
export function priceIdForPlan(settings: PaddleSettings, plan: PlanId): string {
  return settings.priceIds[plan];
}

export function planForPriceId(settings: PaddleSettings, priceId?: string | null): PlanId | null {
  if (!priceId) return null;
  const entry = (Object.entries(settings.priceIds) as [PlanId, string][]).find(
    ([, id]) => id === priceId,
  );
  return entry?.[0] ?? null;
}

const paddleClients = new Map<string, Paddle>();

/** Memoized Paddle API client for the current env/key pair. */
export function getPaddleClient(): Paddle {
  const settings = paddleSettings();
  if (!settings) {
    throw new Error(
      "Paddle yapılandırılmamış. PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET_KEY, PADDLE_CLIENT_TOKEN ve plan price ID'leri eksik.",
    );
  }
  const cacheKey = `${settings.environment}:${settings.apiKey}`;
  let client = paddleClients.get(cacheKey);
  if (!client) {
    client = new Paddle(settings.apiKey, {
      environment:
        settings.environment === "sandbox" ? Environment.sandbox : Environment.production,
    });
    paddleClients.set(cacheKey, client);
  }
  return client;
}

export type CheckoutSession = {
  transactionId: string;
  clientToken: string;
  environment: PaddleEnvironment;
  plan: PlanId;
  priceId: string;
  amountCents: number;
  currency: string;
};

export type CheckoutSessionError = {
  error: true;
  plan: PlanId;
  paddleMessage?: string;
  message: string;
};

export type CheckoutSessionResult = CheckoutSession | CheckoutSessionError;

/**
 * Create a server-side Paddle transaction for a plan and return the data needed to
 * open the Paddle.js overlay checkout (transactionId + client-side token).
 *
 * customData is attached server-side — it cannot be tampered with by the browser —
 * and Paddle copies it onto the subscription and every renewal transaction, which
 * is what lets the webhook attribute payments to the right user.
 *
 * When the account is misconfigured (for example no default payment link) or the
 * request is rejected by Paddle, this function returns a `{ error: true }` result
 * instead of throwing, so the API and client layers can decide how to surface it.
 */
export async function createPaddleCheckoutSession(opts: {
  userId: string;
  email?: string | null;
  plan?: PlanId;
}): Promise<CheckoutSessionResult> {
  const plan = isPlanId(opts.plan) ? opts.plan : "Pro";
  const settings = paddleSettings();
  if (!settings) {
    return {
      error: true,
      plan,
      message:
        "Ödeme sağlayıcısı yapılandırılmamış (Paddle env değişkenleri eksik). Lütfen yöneticiyle iletişime geçin.",
    } satisfies CheckoutSessionError;
  }

  const priceId = priceIdForPlan(settings, plan);
  const paddle = getPaddleClient();

  try {
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customData: { userId: opts.userId, plan, source: "aroless-web" },
    });

    if (!transaction?.id) {
      return {
        error: true,
        plan,
        message: "Paddle transaction oluşturulamadı (yanıtta id yok).",
      } satisfies CheckoutSessionError;
    }

    const amountCents = PLAN_PRICE_CENTS[plan];
    return {
      transactionId: transaction.id,
      clientToken: settings.clientToken,
      environment: settings.environment,
      plan,
      priceId,
      amountCents,
      currency: "USD",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Paddle] Checkout transaction creation failed:", error);

    const isMisconfigured =
      typeof message === "string" && message.toLowerCase().includes("no default payment link");

    return {
      error: true,
      plan,
      paddleMessage: typeof message === "string" ? message : undefined,
      message: isMisconfigured
        ? "Paddle Checkout ayarları eksik. Lütfen pano ayarlarını kontrol edin."
        : "Paddle checkout tetiklenemedi. Lütfen sonrasında tekrar deneyin.",
    } satisfies CheckoutSessionError;
  }
}

/* ------------------------------------------------------------------ */
/* Webhook event → database command mapping                             */
/* ------------------------------------------------------------------ */

/**
 * Credit grants applied on each successful subscription payment, mirroring the
 * legacy apply_subscription_credits() behaviour (Starter 10/5, Pro 20/10,
 * Business 50/25). "Search" credits map to profiles.credits, sim to sim_credits.
 */
export const SUBSCRIPTION_CREDIT_GRANTS: Record<PlanId, { search: number; sim: number }> = {
  Starter: { search: 10, sim: 5 },
  Pro: { search: 20, sim: 10 },
  Business: { search: 50, sim: 25 },
};

/** Subscription lifecycle events that map to a database command. */
const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.activated",
  "subscription.trialing",
  "subscription.updated",
  "subscription.resumed",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
]);

/** Transaction events handled for payment attribution / credit grants. */
const TRANSACTION_EVENTS = new Set(["transaction.completed", "transaction.updated"]);

/** Statuses that must revoke entitlements (payment stopped / failing). */
const REVOKING_STATUSES = new Set(["canceled", "past_due", "paused", "refunded", "reversed"]);

/** True for refund / chargeback / reversal payloads that must never grant credits. */
export function isRefundPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const status = typeof d["status"] === "string" ? (d["status"] as string).toLowerCase() : "";
  if (["refunded", "reversed", "failed"].includes(status)) return true;
  const details = d["details"] as Record<string, unknown> | undefined;
  const totals = details?.["totals"] as Record<string, unknown> | undefined;
  const gt = totals?.["grandTotal"];
  if (typeof gt === "string" && gt.trim().startsWith("-")) return true;
  if (typeof gt === "number" && gt < 0) return true;
  const adj = d["adjustment"] as Record<string, unknown> | undefined;
  if (adj && typeof adj["type"] === "string" && adj["type"].toLowerCase().includes("refund"))
    return true;
  return false;
}

export type PaddleEventCommand = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  /** Raw customData userId (validated/resolved by the webhook route). */
  userId: string | null;
  customerId: string | null;
  /** Tier to grant; null = preserve existing (DB resolves). */
  tier: PlanId | "Free" | null;
  status: string | null;
  paddleSubscriptionId: string | null;
  priceId: string | null;
  transactionId: string | null;
  currency: string | null;
  amountCents: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  nextBilledAt: string | null;
  cancelAtPeriodEnd: boolean;
  searchCredits: number;
  simCredits: number;
};

/**
 * Map a verified Paddle webhook to a database command. Returns null for events
 * this integration deliberately ignores (always ack them with 200).
 */
export function mapPaddleEvent(
  settings: PaddleSettings,
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): PaddleEventCommand | null {
  const customData =
    data && typeof data === "object" && data.customData && typeof data.customData === "object"
      ? data.customData
      : {};
  const items: Array<{ price?: { id?: string } | null }> = Array.isArray(data?.items)
    ? data.items
    : [];
  const priceId: string | null = items[0]?.price?.id ?? null;
  const customerId: string | null = typeof data?.customerId === "string" ? data.customerId : null;
  const requestedPlan: PlanId | null = isPlanId(customData.plan) ? customData.plan : null;
  const rawUserId: string | null =
    typeof customData.userId === "string" && customData.userId ? customData.userId : null;

  const base = {
    eventId: "",
    eventType,
    occurredAt: "",
    userId: rawUserId,
    customerId,
    tier: null as PlanId | "Free" | null,
    status: null as string | null,
    paddleSubscriptionId: null as string | null,
    priceId,
    transactionId: null as string | null,
    currency: null as string | null,
    amountCents: null as number | null,
    periodStart: null as string | null,
    periodEnd: null as string | null,
    nextBilledAt: null as string | null,
    cancelAtPeriodEnd: false,
    searchCredits: 0,
    simCredits: 0,
  };

  // ---- Subscription lifecycle --------------------------------------
  if (SUBSCRIPTION_EVENTS.has(eventType)) {
    const status: string | null = typeof data?.status === "string" ? data.status : null;
    const subId: string | null = typeof data?.id === "string" ? data.id : null;
    const period =
      data?.currentBillingPeriod && typeof data.currentBillingPeriod === "object"
        ? data.currentBillingPeriod
        : null;
    const scheduledChange =
      data?.scheduledChange && typeof data.scheduledChange === "object"
        ? data.scheduledChange
        : null;

    const revoking = status !== null && REVOKING_STATUSES.has(status);
    const active = status === "active" || status === "trialing";
    // Active (or paying) subscription → derive plan from the active price first,
    // then from customData. Revoking → downgrade (DB guards for other live subs).
    const tier: PlanId | "Free" | null = revoking
      ? "Free"
      : active
        ? (planForPriceId(settings, priceId) ?? requestedPlan ?? null)
        : null;

    return {
      ...base,
      paddleSubscriptionId: subId,
      tier,
      status: status ?? null,
      periodStart: period?.startsAt ?? null,
      periodEnd: period?.endsAt ?? null,
      nextBilledAt: typeof data?.nextBilledAt === "string" ? data.nextBilledAt : null,
      cancelAtPeriodEnd: scheduledChange?.action === "cancel",
    };
  }

  // ---- Refund / reversal guard (self-healing: never grant credits on refunds) ----
  if (isRefundPayload(data)) {
    // Acknowledge but produce no entitlement change — the subscription lifecycle
    // event (subscription.canceled / past_due) is the source of truth for
    // revocation. This prevents a refund retry from re-granting credits.
    // For transaction-scoped refunds we still want the transaction ledger row
    // without credit top-up — handled via the subscription event path.
    if (TRANSACTION_EVENTS.has(eventType)) return null;
  }

  // ---- Successful payments -----------------------------------------
  if (TRANSACTION_EVENTS.has(eventType)) {
    const subId: string | null =
      typeof data?.subscriptionId === "string" ? data.subscriptionId : null;
    const txnId: string | null = typeof data?.id === "string" ? data.id : null;
    const currency: string | null =
      typeof data?.currencyCode === "string" ? data.currencyCode : null;
    const grandTotal = data?.details?.totals?.grandTotal;
    const amountCents: number | null =
      typeof grandTotal === "string" && grandTotal !== ""
        ? Math.max(0, Math.round(Number(grandTotal)) || 0)
        : null;
    const period =
      data?.billingPeriod && typeof data.billingPeriod === "object" ? data.billingPeriod : null;

    // Tier is taken from the active price, then customData (copied to renewals by
    // Paddle), then left null so the DB preserves the user's current plan.
    const tier: PlanId | null = planForPriceId(settings, priceId) ?? requestedPlan ?? null;

    // Out-of-order guard: a refund/reversal that arrives with a positive
    // grandTotal due to Paddle's eventual consistency still must not mint
    // credits — the isRefundPayload check above already handled explicit
    // refund signals; this second net catches amount-less retries.
    if (eventType === "transaction.updated" && !subId && !requestedPlan) return null;

    const isSubscriptionPayment = Boolean(subId || requestedPlan);
    // One-time/non-subscription purchases are not part of the catalog.
    if (!isSubscriptionPayment) return null;
    // Self-healing: a retried transaction.completed that arrives after a
    // subscription.canceled must not resurrect entitlements — DB function
    // guards via the live-subscription lookup, but we avoid emitting a
    // credit-bearing command when the payload already looks revoked.
    if (typeof data?.status === "string") {
      const s = data.status.toLowerCase();
      if (REVOKING_STATUSES.has(s)) return null;
    }

    const grants = tier ? SUBSCRIPTION_CREDIT_GRANTS[tier] : null;

    return {
      ...base,
      paddleSubscriptionId: subId,
      tier,
      status: subId ? "active" : null,
      transactionId: txnId,
      currency,
      amountCents,
      periodStart: period?.startsAt ?? null,
      periodEnd: period?.endsAt ?? null,
      searchCredits: grants?.search ?? 0,
      simCredits: grants?.sim ?? 0,
    };
  }

  return null;
}

/**
 * Verify the Paddle-Signature header against the raw request body using the
 * official SDK. Returns the parsed event (id/type/timestamp/data) and throws
 * when the signature is invalid or the event is stale.
 */
export async function verifyPaddleWebhook(
  rawBody: string,
  paddleSignature: string,
): Promise<{
  eventId: string;
  eventType: string;
  occurredAt: string;
  // Event data differs per event type; handlers narrow it structurally.
  data: unknown;
}> {
  const settings = paddleSettings();
  if (!settings) {
    throw new Error("Paddle yapılandırılmamış (webhook secret eksik).");
  }
  if (!paddleSignature) {
    throw new Error("Missing paddle-signature header.");
  }
  const event = await getPaddleClient().webhooks.unmarshal(
    rawBody,
    settings.webhookSecret,
    paddleSignature,
  );
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    data: event.data,
  };
}
