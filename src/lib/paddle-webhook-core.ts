/**
 * Paddle Billing v2 webhook — platform-bağımsız çekirdek mantık.
 *
 * Bu modül HTTP platformundan bağımsızdır: hem TanStack Start route'u
 * (/api/public/paddle-webhook) hem de Vercel fonksiyonu (api/webhook.ts)
 * aynı çekirdeği kullanır. Böylece doğrulama, olay yönetimi ve veritabanı
 * senkronizasyonu iki girişte de birebir aynı davranır.
 *
 * Güvenlik:
 *   - Paddle-Signature: ts=<unix>;h1=<hex> → HMAC-SHA256(secret, "ts:body")
 *   - İmza doğrulama başarısız → 400
 *   - Replay penceresi 5 dakika + event_id idempotency (paddle_webhook_events)
 *
 * Ele alınan olaylar:
 *   - transaction.completed   → aboneliği aktifleştir / süresini uzat
 *   - subscription.updated    → paket yükseltme/düşürme + durum senkronizasyonu
 *   - subscription.canceled   → erişimi kısıtla (tier → Free)
 *   - subscription.created    → updated ile aynı akış
 *   - subscription.expired / paused → canceled ile aynı akış
 */

import { z } from "zod";
import type { Database } from "../integrations/supabase/types";
import { planForPriceId, verifyPaddleWebhook, type PaddlePlan } from "./paddle.server";
import {
  cancelReferralSubscription,
  createCommissionForPayment,
  reverseCommissionsForPayment,
  type AffDb,
} from "./affiliate/affiliate.service";

export const MAX_PAYLOAD_BYTES = 1_000_000;

const PaddleEventSchema = z.object({
  event_id: z.string().optional(),
  event_type: z.string().optional(),
  occurred_at: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      /** transaction.completed payload'ında abonelik referansı. */
      subscription_id: z.string().optional(),
      customer: z
        .object({
          email: z.string().optional(),
          id: z.string().optional(),
        })
        .optional(),
      custom_data: z
        .object({
          user_id: z.string().optional(),
          plan: z.string().optional(),
        })
        .optional(),
      action: z.string().optional(),
      /** adjustment.* olaylarında geri iade edilen işlemin kimliği. */
      transaction_id: z.string().optional(),
      items: z
        .array(
          z.object({
            price: z
              .object({
                id: z.string().optional(),
                name: z.string().optional(),
                product_id: z.string().optional(),
              })
              .optional(),
            quantity: z.number().optional(),
            billing_period: z
              .object({
                starts_at: z.string().optional(),
                ends_at: z.string().optional(),
              })
              .optional(),
          }),
        )
        .optional(),
      totals: z
        .object({
          total: z.string().optional(),
          currency: z.string().optional(),
        })
        .optional(),
      billing_period: z
        .object({
          start: z.string().optional(),
          finish: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

type PaddleEvent = z.infer<typeof PaddleEventSchema>;

/** Supabase update payload'ı için tipli yardımcı. */
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/** UUID formatı kontrolü — injection engellemek için. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paddle abonelik durumu → profile'a yazılan durum. */
const STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  paused: "paused",
  canceled: "canceled",
  cancelled: "canceled",
  expired: "expired",
};

/** Erişim kilidi: bu durumlarda plan erişimi kısıtlanır. */
const RESTRICTED_STATUSES = new Set(["past_due", "paused", "canceled", "expired"]);

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function ok(body: Record<string, unknown> = { ok: true }): WebhookResult {
  return { status: 200, body };
}

function fail(status: number, body: Record<string, unknown>): WebhookResult {
  return { status, body };
}

function logInfo(eventId: string, msg: string, extra?: unknown): void {
  console.info(`[paddle-webhook]${eventId ? ` [${eventId}]` : ""} ${msg}`, extra ?? "");
}

function logError(eventId: string, msg: string, extra?: unknown): void {
  console.error(`[paddle-webhook]${eventId ? ` [${eventId}]` : ""} ${msg}`, extra ?? "");
}

/** Plan metnini PaddlePlan'a normalize eder. */
export function asPlan(value: string | undefined): PaddlePlan | null {
  if (!value) return null;
  const n = value.toLowerCase();
  if (n === "starter") return "Starter";
  if (n === "pro") return "Pro";
  if (n === "business") return "Business";
  return null;
}

/** Paddle durumuna göre erişim kısıtı var mı? */
export function isRestrictedStatus(status: string): boolean {
  return RESTRICTED_STATUSES.has(status);
}

/**
 * Webhook çekirdeği: imzalı ham gövde + başlık → HTTP yanıt özeti.
 * Supabase erişimi `supabase` ile enjekte edilir; her iki platform girişi de
 * aynı çekirdeği kullanır.
 */
export async function processPaddleWebhook(input: {
  raw: string;
  signatureHeader: string;
  supabase: SupabaseLike;
  /** Test edilebilirlik için; gerçek çağrıda şu anki zaman kullanılır. */
  nowSeconds?: number;
}): Promise<WebhookResult> {
  const { raw, signatureHeader, supabase, nowSeconds } = input;

  // 1. İmza doğrulama
  const valid = await verifyPaddleWebhook(raw, signatureHeader, nowSeconds);
  if (!valid) {
    logError("", "invalid signature");
    return fail(400, { error: "Invalid signature" });
  }

  // 2. JSON parse + şema doğrulama
  let payload: PaddleEvent;
  try {
    payload = PaddleEventSchema.parse(JSON.parse(raw));
  } catch (e) {
    logError("", "bad payload", e);
    return fail(400, { error: "Bad JSON or invalid schema" });
  }

  const eventId = payload.event_id ?? "";
  const eventType = payload.event_type ?? "";
  const data = payload.data ?? {};

  // 3. custom_data.user_id doğrulama (varsa)
  const userId = data.custom_data?.user_id ?? "";
  if (userId && !UUID_REGEX.test(userId)) {
    logError(eventId, "bad user id");
    return fail(400, { error: "Bad user id" });
  }

  // 4. Idempotency: aynı event_id daha önce işlendi mi?
  if (eventId) {
    const { data: existing, error: dedupeErr } = await supabase
      .from("paddle_webhook_events")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!dedupeErr && existing) {
      logInfo(eventId, "duplicate event — skipped");
      return ok({ ok: true, duplicate: true });
    }
    if (dedupeErr) {
      // Tablo henüz migrate edilmemiş olabilir; akışı bozmayalım.
      logError(eventId, "idempotency check failed (continuing)", dedupeErr);
    }
  }

  // 5. Olay yönlendirme
  let result: WebhookResult;
  switch (eventType) {
    case "transaction.completed":
      result = await handleTransactionCompleted({ eventId, userId, data, supabase });
      break;
    case "subscription.updated":
    case "subscription.created":
      result = await handleSubscriptionUpdated({ eventId, userId, data, supabase });
      break;
    case "subscription.canceled":
    case "subscription.expired":
    case "subscription.paused":
      result = await handleSubscriptionCanceled({ eventId, userId, data, supabase });
      break;
    case "adjustment.created":
    case "adjustment.updated":
      // Refund/chargeback → ilgili komisyonlar otomatik tersine çevrilir.
      result = await handleAdjustment({ eventId, data, supabase });
      break;
    default:
      logInfo(eventId, `unhandled event type: ${eventType || "(none)"}`);
      result = ok();
  }

  // 6. Başarıyla işlendiyse idempotency kaydını yaz (hata olursa Paddle retry edebilsin).
  if (result.status === 200 && !result.body["duplicate"]) {
    await recordProcessedEvent(supabase, eventId, eventType);
  }
  return result;
}

/** transaction.completed → aboneliği aktifleştir / süresini uzat. */
async function handleTransactionCompleted(input: {
  eventId: string;
  userId: string;
  data: NonNullable<PaddleEvent["data"]>;
  supabase: SupabaseLike;
}): Promise<WebhookResult> {
  const { eventId, userId, data, supabase } = input;

  const priceId = data.items?.[0]?.price?.id ?? null;
  const customerId = data.customer?.id ?? null;
  const subscriptionId = data.subscription_id ?? null;
  const periodEnd = data.billing_period?.finish ?? null;
  const status = STATUS_MAP[data.status ?? ""] ?? "active";

  const resolved = await resolveUserId({
    userId,
    customerId,
    subscriptionId,
    supabase,
    eventId,
  });
  if ("response" in resolved) return resolved.response;
  const resolvedUserId = resolved.userId;
  if (!resolvedUserId) {
    logInfo(eventId, "no resolvable user — acknowledged");
    return ok();
  }

  // Plan: önce price_id eşlemesi, sonra custom_data.plan.
  const plan: PaddlePlan | null = planForPriceId(priceId) ?? asPlan(data.custom_data?.plan);

  const update: ProfileUpdate = {
    paddle_subscription_status: status,
    updated_at: new Date().toISOString(),
  };
  if (customerId) update.paddle_customer_id = customerId;
  if (subscriptionId) update.paddle_subscription_id = subscriptionId;
  if (priceId) update.paddle_price_id = priceId;
  if (periodEnd) update.paddle_current_period_end = periodEnd;
  if (plan) update.subscription_tier = plan;

  const { error } = await supabase.from("profiles").update(update).eq("id", resolvedUserId);
  if (error) {
    logError(eventId, "profile update failed", error);
    return fail(500, { error: "Webhook processing failed" });
  }
  logInfo(eventId, `profile activated user=${resolvedUserId} plan=${plan ?? "-"}`);

  // Kredi uygulama (RPC yoksa sessizce atlanır).
  if (plan) {
    const tierCredits = plan === "Business" ? 50 : plan === "Pro" ? 15 : plan === "Starter" ? 8 : 0;
    if (tierCredits > 0) {
      try {
        await supabase.rpc("apply_subscription_credits", {
          _user_id: resolvedUserId,
          _tier: plan,
          _credits: tierCredits,
          _customer_id: customerId ?? "",
          _subscription_id: subscriptionId ?? "",
        });
      } catch (e) {
        logError(eventId, "credit application failed", e);
      }
    }
  }

  // Transaction kaydı (faturalama raporları için).
  const totalCents = Math.round((parseFloat(data.totals?.total ?? "0") || 0) * 100);
  try {
    await supabase.from("transactions").insert({
      user_id: resolvedUserId,
      email: data.customer?.email ?? null,
      tier: plan ?? null,
      amount_cents: totalCents,
      currency: data.totals?.currency ?? "USD",
      payment_method: "card",
      provider: "paddle",
      provider_event: "transaction.completed",
      external_id: subscriptionId ?? data.id ?? null,
    });
  } catch (e) {
    logError(eventId, "transaction record failed", e);
  }

  // Affiliate: her başarılı ödeme için komisyon (backend attribution + idempotency).
  if (plan && totalCents > 0 && resolvedUserId) {
    const bpStart =
      data.billing_period?.start ??
      data.items?.[0]?.billing_period?.starts_at ??
      new Date().toISOString();
    const bpEnd =
      data.billing_period?.finish ?? data.items?.[0]?.billing_period?.ends_at ?? bpStart;
    await tryAffiliate(supabase, (aff) =>
      createCommissionForPayment(aff, {
        customerId: resolvedUserId,
        // Idempotency anahtarı: Paddle transaction id (data.id) her ödeme için benzersizdir.
        paymentId: data.id ?? `${subscriptionId ?? "sub"}:${bpStart}`,
        subscriptionId: subscriptionId ?? "",
        plan,
        subscriptionAmountCents: totalCents,
        currency: data.totals?.currency ?? "USD",
        periodStart: bpStart,
        periodEnd: bpEnd,
        paidAt: new Date().toISOString(),
      }),
    );
  }

  return ok();
}

/** subscription.updated → paket yükseltme/düşürme + durum senkronizasyonu. */
async function handleSubscriptionUpdated(input: {
  eventId: string;
  userId: string;
  data: NonNullable<PaddleEvent["data"]>;
  supabase: SupabaseLike;
}): Promise<WebhookResult> {
  const { eventId, userId, data, supabase } = input;

  const priceId = data.items?.[0]?.price?.id ?? null;
  const customerId = data.customer?.id ?? null;
  const subscriptionId = data.id ?? null;
  const periodEnd = data.billing_period?.finish ?? null;
  const status = STATUS_MAP[data.status ?? ""] ?? "active";

  const resolved = await resolveUserId({
    userId,
    customerId,
    subscriptionId,
    supabase,
    eventId,
  });
  if ("response" in resolved) return resolved.response;
  const resolvedUserId = resolved.userId;
  if (!resolvedUserId) {
    logInfo(eventId, "no resolvable user — acknowledged");
    return ok();
  }

  const plan = planForPriceId(priceId) ?? asPlan(data.custom_data?.plan);
  const restricted = isRestrictedStatus(status);

  const update: ProfileUpdate = {
    paddle_subscription_status: status,
    updated_at: new Date().toISOString(),
  };
  if (customerId) update.paddle_customer_id = customerId;
  if (priceId) update.paddle_price_id = priceId;
  if (periodEnd) update.paddle_current_period_end = periodEnd;
  if (subscriptionId) update.paddle_subscription_id = subscriptionId;

  // Durum kısıtlıysa tier → Free; aktifse ve plan biliniyorsa plan yazılır.
  if (restricted) {
    update.subscription_tier = "Free";
  } else if (plan) {
    update.subscription_tier = plan;
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", resolvedUserId);
  if (error) {
    logError(eventId, "profile update failed", error);
    return fail(500, { error: "Webhook processing failed" });
  }
  logInfo(
    eventId,
    `subscription updated user=${resolvedUserId} plan=${plan ?? "-"} status=${status}`,
  );
  return ok();
}

/** subscription.canceled → erişimi kısıtla. */
async function handleSubscriptionCanceled(input: {
  eventId: string;
  userId: string;
  data: NonNullable<PaddleEvent["data"]>;
  supabase: SupabaseLike;
}): Promise<WebhookResult> {
  const { eventId, userId, data, supabase } = input;

  const subscriptionId = data.id ?? null;
  const periodEnd = data.billing_period?.finish ?? null;

  const resolved = await resolveUserId({
    userId,
    customerId: null,
    subscriptionId,
    supabase,
    eventId,
  });
  if ("response" in resolved) return resolved.response;
  const resolvedUserId = resolved.userId;
  if (!resolvedUserId) {
    logInfo(eventId, "no resolvable user — acknowledged");
    return ok();
  }

  const update: ProfileUpdate = {
    paddle_subscription_status: "canceled",
    subscription_tier: "Free",
    updated_at: new Date().toISOString(),
  };
  if (periodEnd) update.paddle_current_period_end = periodEnd;

  const { error } = await supabase.from("profiles").update(update).eq("id", resolvedUserId);
  if (error) {
    logError(eventId, "cancel update failed", error);
    return fail(500, { error: "Webhook processing failed" });
  }
  logInfo(eventId, `subscription canceled user=${resolvedUserId}`);

  // Affiliate: müşteri iptal etti → gelecekteki komisyonlar durur.
  if (subscriptionId && resolvedUserId) {
    await tryAffiliate(supabase, (aff) =>
      cancelReferralSubscription(aff, {
        customerId: resolvedUserId,
        subscriptionId,
      }),
    );
  }
  return ok();
}

/**
 * adjustment.created / adjustment.updated — refund ve chargeback olayları.
 * İlgili işlem veya abonelikle eşleşen komisyonlar otomatik olarak
 * "reversed" yapılır (kayıt silinmez; denetim izi korunur).
 */
async function handleAdjustment(input: {
  eventId: string;
  data: NonNullable<PaddleEvent["data"]>;
  supabase: SupabaseLike;
}): Promise<WebhookResult> {
  const { eventId, data, supabase } = input;
  const action = String(data.action ?? "").toLowerCase();
  const isMoneyBack = action.includes("refund") || action.includes("chargeback");
  if (!isMoneyBack) {
    logInfo(eventId, `adjustment action ignored: ${action || "(none)"}`);
    return ok();
  }

  const paymentId = data.transaction_id ?? "";
  const subscriptionId = data.subscription_id ?? "";
  if (!paymentId && !subscriptionId) {
    logInfo(eventId, "adjustment without transaction/subscription ref — acknowledged");
    return ok();
  }

  await tryAffiliate(supabase, (aff) =>
    reverseCommissionsForPayment(aff, {
      paymentId: paymentId || undefined,
      subscriptionId: paymentId ? undefined : subscriptionId || undefined,
      reason: action === "chargeback" ? "chargeback" : "refund",
    }),
  );
  logInfo(eventId, `adjustment processed action=${action}`);
  return ok();
}

/**
 * Affiliate senkronizasyonu her zaman opsiyoneldir: tablolar henüz migrate
 * edilmemişse veya beklenmedik bir hata olursa webhook akışı bozulmaz.
 */
async function tryAffiliate(
  supabase: SupabaseLike,
  fn: (db: AffDb) => Promise<unknown>,
): Promise<void> {
  try {
    await fn(supabase as unknown as AffDb);
  } catch (e) {
    logError("", "affiliate sync failed (ignored)", e);
  }
}

/**
 * Kullanıcı çözümleme: custom_data.user_id → customer_id → subscription_id.
 * Hiçbiri eşleşmezse { userId: "" } döner; çağıran taraf ack eder.
 */
async function resolveUserId(input: {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  supabase: SupabaseLike;
  eventId: string;
}): Promise<{ userId: string } | { response: WebhookResult }> {
  const { userId, customerId, subscriptionId, supabase, eventId } = input;
  if (userId) return { userId };

  if (customerId) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("paddle_customer_id", customerId)
      .maybeSingle();
    if (error) {
      logError(eventId, "customer lookup failed", error);
      return { response: fail(500, { error: "Webhook processing failed" }) };
    }
    if (profile) {
      logInfo(eventId, `user resolved via paddle_customer_id → ${profile.id ?? ""}`);
      return { userId: profile.id ?? "" };
    }
  }

  if (subscriptionId) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("paddle_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) {
      logError(eventId, "subscription lookup failed", error);
      return { response: fail(500, { error: "Webhook processing failed" }) };
    }
    if (profile) {
      logInfo(eventId, `user resolved via paddle_subscription_id → ${profile.id ?? ""}`);
      return { userId: profile.id ?? "" };
    }
  }

  return { userId: "" };
}

/**
 * Supabase client şekli (yapısal tip) — çekirdek yalnızca bu yüzeyi kullanır.
 * select<T> projeksiyonu hem { id } hem { event_id } okumalarını karşılar.
 */
export interface SupabaseLike {
  from(table: string): {
    select<T = { id?: string; event_id?: string }>(
      columns: string,
    ): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: T | null; error: { message: string } | null }>;
      };
    };
    update(values: unknown): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
    insert(values: unknown): PromiseLike<{ error: { message: string } | null }>;
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { message: string } | null }>;
}

/** Idempotency kaydı: event_id'yi işlendi olarak işaretle (hata akışı bozmaz). */
export async function recordProcessedEvent(
  supabase: SupabaseLike,
  eventId: string,
  eventType: string,
): Promise<void> {
  if (!eventId) return;
  try {
    await supabase
      .from("paddle_webhook_events")
      .insert({ event_id: eventId, event_type: eventType });
  } catch (e) {
    logError(eventId, "idempotency record failed (continuing)", e);
  }
}
