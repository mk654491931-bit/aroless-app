/**
 * PADDLE — ABONELİĞİ DÖNEM SONUNDA İPTAL ETME (sunucu).
 *
 * NEDEN VAR: Ayarlar'da ücretli kullanıcı için "Aboneliği iptal et" düğmesi
 * yoktu; kullanıcı ya desteğe yazmak zorundaydı ya da aboneliği hiç
 * durduramıyordu. Ürün kuralı nettir:
 *   • bu ay için ödenen ücret İADE EDİLMEZ,
 *   • gelecek ay TAHSİLAT YAPILMAZ.
 * Paddle'ın `POST /subscriptions/{id}/cancel` ucu `effective_from:
 * "next_billing_period"` ile tam olarak bunu yapar: dönem sonuna kadar erişim
 * sürer, sonraki yenileme iptal edilir. "immediately" ASLA kullanılmaz —
 * kullanıcı ayın geri kalanı için ödeme yapmıştır.
 *
 * BAĞIMLILIK ENJEKSİYONU: Paddle istemcisi ve veritabanı bu dosyaya
 * gömülmez; çağıran (paddle.functions.ts) enjekte eder. Böylece ağ olmadan
 * test edilebilir ve "hangi seçenekle iptal ediliyor" sözleşmesi testte
 * kilitlenir.
 */

import {
  planForSnapshot,
  subscriptionSnapshot,
  type PaddleEventCommand,
  type PaddleSettings,
  type PaddleSubscriptionSnapshot,
  type PlanId,
} from "./paddle.server";

/** Paddle'ın iptal çağrısında kullanılan (ve ASLA değişmemesi gereken) seçenek. */
export const CANCEL_EFFECTIVE_FROM = "next_billing_period" as const;

/** İptal edilebilir bir aboneliğin Paddle nesnesinden okunan alanları. */
export type CancelableSubscription = {
  id?: string | null;
  status?: string | null;
  customerId?: string | null;
  nextBilledAt?: string | null;
  scheduledChange?: { action?: string | null } | null;
  currentBillingPeriod?: { startsAt?: string | null; endsAt?: string | null } | null;
  items?: Array<{ price?: { id?: string | null; productId?: string | null } | null }> | null;
  customData?: Record<string, unknown> | null;
};

export type CancelSubscriptionDeps = {
  settings: PaddleSettings | null;
  /** Profilde kayıtlı abonelik kimliğinden CANLI kaydı okur (varsa). */
  getSubscription?: (subscriptionId: string) => Promise<CancelableSubscription | null>;
  /** Profilde müşteri kimliği yoksa e-posta ile aranır. */
  findCustomerIdByEmail: (email: string) => Promise<string | null>;
  /** Müşterinin iptal edilebilir (active/trialing/past_due) aboneliği. */
  fetchActionableSubscription: (customerId: string) => Promise<CancelableSubscription | null>;
  /**
   * Paddle iptal çağrısı. Seçenek burada AÇIKÇA geçirilir; çağıranın
   * "immediately" göndermesi tip düzeyinde de mümkün değildir.
   */
  cancelSubscription: (
    subscriptionId: string,
    options: { effectiveFrom: typeof CANCEL_EFFECTIVE_FROM },
  ) => Promise<CancelableSubscription>;
  /** Komutu veritabanına yazar; başarılıysa true. Opsiyonel (test/teşhis). */
  persist?: (command: PaddleEventCommand) => Promise<boolean>;
};

export type CancelSubscriptionInput = {
  userId: string;
  email?: string | null;
  /** `profiles.paddle_subscription_id` (varsa) — en güçlü kimlik. */
  subscriptionId?: string | null;
  /** `profiles.paddle_customer_id` (varsa). */
  customerId?: string | null;
  /** `profiles.subscription_tier` — plan Paddle kimliğinden çözülemezse. */
  tierHint?: string | null;
  now?: Date;
};

export type CancelSubscriptionReason =
  | "scheduled"
  | "already_scheduled"
  | "not_configured"
  | "no_customer"
  | "no_live_subscription"
  | "already_ended"
  | "api_failed";

export type CancelSubscriptionResult = {
  ok: boolean;
  reason: CancelSubscriptionReason;
  subscriptionId?: string;
  tier?: PlanId | null;
  /** Erişimin bittiği tarih (ISO) — istemci bunu gösterir. */
  periodEnd?: string | null;
  /** Komut DB'ye yazıldı mı? (false → Paddle iptali yine de geçerli.) */
  persisted?: boolean;
  message?: string;
};

const ENDED_STATUSES = new Set(["canceled", "cancelled", "ended", "expired"]);

function normalizePlan(value: string | null | undefined): PlanId | null {
  const tier = String(value ?? "")
    .trim()
    .toLowerCase();
  if (tier === "starter") return "Starter";
  if (tier === "pro") return "Pro";
  if (tier === "business") return "Business";
  return null;
}

/**
 * Veritabanına yazılacak tier. Plan çözülemezse profildeki değer AYNEN korunur;
 * `null` göndermek `process_paddle_event` içinde varsayılan 'Pro'ya düşer ve
 * ücretsiz bir profili iptal sırasında YÜKSELTİRDİ.
 */
function tierForCommand(value: string | null | undefined): PlanId | "Free" | null {
  const plan = normalizePlan(value);
  if (plan) return plan;
  return String(value ?? "")
    .trim()
    .toLowerCase() === "free"
    ? "Free"
    : null;
}

async function quietly<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * İptal komutunu üretir (SAF).
 *
 * Kredi YOKTUR: iptal bir ödeme değildir; `process_paddle_event` kredi
 * eklemez. Olay kimliği abonelik + dönem sonuna bağlıdır; aynı dönemde
 * düğmeye iki kez basmak aynı kimliği üretir ve veritabanı ikinciyi
 * tekilleştirir (idempotent).
 */
export function cancelEventCommand(args: {
  snapshot: PaddleSubscriptionSnapshot;
  tier: PlanId | "Free" | null;
  userId: string;
  occurredAt: string;
}): PaddleEventCommand {
  const { snapshot, tier, userId, occurredAt } = args;
  return {
    eventId: `cancel-schedule:${snapshot.subscriptionId}:${snapshot.periodEnd ?? "-"}`,
    // Kayıtlarda (processed_webhook_events) kaynağın webhook DEĞİL, kullanıcının
    // ayarlar ekranından yaptığı iptal olduğu görülür.
    eventType: "subscription.cancel.scheduled",
    occurredAt,
    userId,
    customerId: snapshot.customerId,
    tier,
    status: snapshot.status ?? "active",
    paddleSubscriptionId: snapshot.subscriptionId,
    priceId: snapshot.priceId,
    productId: snapshot.productId,
    transactionId: null,
    currency: null,
    amountCents: null,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    // İptalden sonra Paddle sıradaki tahsilatı temizler; DB tarafı COALESCE
    // kullandığı için eski değeri silmeye çalışmıyoruz.
    nextBilledAt: null,
    cancelAtPeriodEnd: true,
    searchCredits: 0,
    simCredits: 0,
  };
}

/**
 * Aboneliği DÖNEM SONUNDA iptal eder (yenilemeyi durdurur).
 *
 * SIRA:
 *   1. Profildeki abonelik kimliğiyle Paddle kaydı okunur (past_due dahil).
 *   2. Yoksa müşteri kimliği/e-posta ile iptal edilebilir abonelik aranır.
 *   3. Zaten iptal planlıysa Paddle'a İKİNCİ istek atılmaz.
 *   4. `cancel(effectiveFrom: next_billing_period)` çağrılır.
 *   5. Sonuç (kredisiz) `process_paddle_event` ile yazılır ki webhook gecikse
 *      bile arayüz doğru durumu göstersin.
 */
export async function scheduleSubscriptionCancellation(
  deps: CancelSubscriptionDeps,
  input: CancelSubscriptionInput,
): Promise<CancelSubscriptionResult> {
  const { settings } = deps;
  if (!settings) return { ok: false, reason: "not_configured" };

  let subscription: CancelableSubscription | null = null;
  const hintedId = String(input.subscriptionId ?? "").trim();

  if (hintedId && deps.getSubscription) {
    const fetched = await quietly(() => deps.getSubscription!(hintedId));
    if (fetched?.id) {
      const status = String(fetched.status ?? "").toLowerCase();
      if (ENDED_STATUSES.has(status)) {
        return {
          ok: false,
          reason: "already_ended",
          subscriptionId: fetched.id,
          periodEnd: fetched.currentBillingPeriod?.endsAt ?? null,
        };
      }
      subscription = fetched;
    }
    // Okunamadıysa (ağ/izin) müşteri yoluna düşülür — kullanıcıyı hatayla
    // bırakmak yerine ikinci bir kimlikle denenir.
  }

  if (!subscription) {
    let customerId = String(input.customerId ?? "").trim() || null;
    if (!customerId && input.email) {
      customerId = await quietly(() => deps.findCustomerIdByEmail(input.email!));
    }
    if (!customerId) return { ok: false, reason: "no_customer" };

    const found = await quietly(() => deps.fetchActionableSubscription(customerId));
    if (!found?.id) return { ok: false, reason: "no_live_subscription" };
    subscription = found;
  }

  const snapshot = subscriptionSnapshot(subscription);
  if (!snapshot) return { ok: false, reason: "no_live_subscription" };

  const tier = planForSnapshot(settings, snapshot) ?? normalizePlan(input.tierHint);
  const base = { subscriptionId: snapshot.subscriptionId, tier };

  if (snapshot.cancelAtPeriodEnd) {
    return {
      ok: true,
      reason: "already_scheduled",
      ...base,
      periodEnd: snapshot.periodEnd,
      persisted: true,
    };
  }

  let canceled: CancelableSubscription;
  try {
    canceled = await deps.cancelSubscription(snapshot.subscriptionId, {
      effectiveFrom: CANCEL_EFFECTIVE_FROM,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "api_failed",
      ...base,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // API çağrısı BAŞARILI: iptal kesindir. Paddle yanıtı `scheduledChange`
  // taşımasa bile yenileme artık yapılmayacak; bu yüzden bayrak açık yazılır.
  const confirmed: PaddleSubscriptionSnapshot = {
    ...(subscriptionSnapshot(canceled) ?? snapshot),
    cancelAtPeriodEnd: true,
  };
  const command = cancelEventCommand({
    snapshot: confirmed,
    // Plan Paddle kimliğinden çözülemediyse profildeki tier korunur; `null`
    // göndermek DB'de 'Pro' varsayılanına düşerdi.
    tier: tier ?? tierForCommand(input.tierHint),
    userId: input.userId,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });

  let persisted = false;
  if (deps.persist) {
    try {
      persisted = await deps.persist(command);
    } catch {
      persisted = false;
    }
  }

  return {
    ok: true,
    reason: "scheduled",
    ...base,
    periodEnd: confirmed.periodEnd,
    persisted,
  };
}
