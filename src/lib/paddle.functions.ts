import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CancelableSubscription, CancelSubscriptionResult } from "@/lib/paddle-cancel.server";
import {
  mySubscriptionView,
  type MySubscriptionView,
  type SubscriptionLedgerRowView,
} from "@/lib/subscription-cancel";

const InputSchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]).default("Pro"),
});

/**
 * Oturum açmış kullanıcı için sunucu tarafında bir Paddle transaction oluşturur
 * ve overlay checkout'u açmak için gereken oturum bilgisini döner.
 *
 * customData (userId + plan) transaction'a SUNUCUDA yazılır — istemci müdahale
 * edemez; Paddle bu veriyi aboneliğe ve yenileme ödemelerine kopyalar, böylece
 * webhook her ödemeyi doğru kullanıcıya bağlayabilir.
 */
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createPaddleCheckoutSession } = await import("@/lib/paddle.server");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const session = await createPaddleCheckoutSession({
      userId: context.userId,
      email: profile?.email ?? null,
      plan: data.plan,
    });

    return {
      transactionId: session.transactionId,
      clientToken: session.clientToken,
      environment: session.environment,
      plan: session.plan,
      priceId: session.priceId,
      amountCents: session.amountCents,
      currency: session.currency,
      email: profile?.email ?? null,
    };
  });

/**
 * ÖDEME SONRASI YETKİ TAZELEME — "Paddle abonelik başladı diyor ama
 * uygulamada başlamıyor" şikâyetinin yapısal çözümü.
 *
 * Aktivasyon webhook'a bağlıdır; webhook adresi/imza yanlışsa ya da teslimat
 * gecikirse kullanıcı "Free" kalır. Bu işlev Paddle'ın KENDİ kaydını okur ve
 * webhook'un yazacağı aynı komutu (`process_paddle_event`) yazar. Yani webhook
 * gelmese de yetki doğru hâle gelir; webhook gelmişse aynı durum tekrar
 * yazılmaz (olay kimliği tekilleştirilir).
 *
 * Idempotentlik ÜÇ katmanda korunur:
 *   • `event_id` = `reconcile:<abonelik>:<durum>:<dönem>` → aynı durum bir kez.
 *   • Kredi, işlem (`transactions.external_id`) başına bir kez verilir —
 *     webhook'un kendi kuralı yeniden kullanılır.
 *   • Abonelik defteri `paddle_subscription_id` üzerinden upsert edilir.
 */
export const reconcileMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReconcileResult> => {
    const {
      paddleSettings,
      findPaddleCustomerIdByEmail,
      fetchLiveSubscription,
      fetchLastCompletedTransaction,
      reconcileCommand,
      creditGrantDecision,
    } = await import("@/lib/paddle.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const settings = paddleSettings();
    if (!settings) return { ok: false, reason: "not_configured" };

    // Tek sorgu: profil e-postası + varsa kayıtlı Paddle müşteri kimliği.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, subscription_tier, subscription_status, paddle_customer_id")
      .eq("id", context.userId)
      .maybeSingle();
    const row = profile as {
      email?: string | null;
      subscription_tier?: string | null;
      paddle_customer_id?: string | null;
    } | null;

    // Müşteri kimliği profilde kayıtlı olmayabilir (ham/yedek checkout yolu →
    // webhook hiç yazmamış olabilir): o durumda Paddle'dan e-posta ile aranır.
    let customerId = row?.paddle_customer_id ?? null;
    if (!customerId && row?.email) {
      customerId = await findPaddleCustomerIdByEmail(row.email);
    }
    if (!customerId) return { ok: false, reason: "no_customer" };

    const snapshot = await fetchLiveSubscription(customerId);
    if (!snapshot) {
      return {
        ok: false,
        reason: "no_live_subscription",
        tier: row?.subscription_tier ?? null,
      };
    }

    const transaction = await fetchLastCompletedTransaction(snapshot.subscriptionId);
    const command = reconcileCommand({
      settings,
      snapshot,
      transaction,
      userId: context.userId,
      occurredAt: new Date().toISOString(),
    });
    if (!command) {
      return { ok: false, reason: "plan_unresolved", status: snapshot.status };
    }

    // Kredi: webhook ile AYNI kural — işlem başına bir kez.
    let alreadyRecorded = false;
    if (command.transactionId) {
      const { data: already } = await supabaseAdmin
        .from("transactions")
        .select("id")
        .eq("external_id" as never, command.transactionId)
        .maybeSingle();
      alreadyRecorded = Boolean(already);
    }
    const decision = creditGrantDecision({
      eventType: "transaction.completed",
      transactionStatus: "completed",
      alreadyRecorded,
      searchCredits: command.searchCredits,
      simCredits: command.simCredits,
    });

    // RPC, TypeScript tiplerinde tanımlı değildir (migration'la gelir): webhook
    // ile AYNI imza kullanılır, böylece iki yol tek sözleşmeye bağlı kalır.
    const rpc = supabaseAdmin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>;
    const { data: result, error } = await rpc("process_paddle_event", {
      _event_id: command.eventId,
      _event_type: command.eventType,
      _occurred_at: command.occurredAt,
      _user_id: context.userId,
      _tier: command.tier,
      _status: command.status,
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
      _search_credits: decision.search,
      _sim_credits: decision.sim,
      _payload: { source: "reconcile", subscriptionId: snapshot.subscriptionId },
    });

    if (error) {
      console.error("[Paddle] Yetki tazeleme yazılamadı:", error.message);
      return { ok: false, reason: "write_failed", tier: command.tier };
    }

    // Sunucu dosyalarında yalnız warn/error loglanır (lint kuralı); başarı
    // durumu istemciye dönen `result` ile zaten kanıtlanır. `result`
    // 'duplicate' ise tazeleme daha önce yazılmış demektir — yine başarıdır.
    void result;

    return {
      ok: true,
      reason: "reconciled",
      tier: command.tier,
      status: snapshot.status,
      creditsGranted: decision.granted,
      subscriptionId: snapshot.subscriptionId,
    };
  });

/* ========================================================================== */
/* ABONELİK DURUMU + İPTAL (dönem sonunda)                                     */
/* ========================================================================== */

export type { MySubscriptionView };

/**
 * Ayarlar kartının okuduğu durum.
 *
 * `cancel_at_period_end` profil aynasında DEĞİL abonelik defterinde tutulur;
 * bu yüzden defter satırı okunur. Profildeki abonelik kimliğiyle eşleşmeyen
 * satır "iptal planlı" sayılmaz — eski bir deneme aboneliğinin bayrağı canlı
 * aboneliğe taşınmaz.
 */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySubscriptionView> => {
    // Kullanıcı istemcisi (RLS) yeterlidir: profil ve abonelik defterinin
    // "kendi satırını oku" politikası vardır. Servis rolü gerekmez.
    const { data: profileData } = await context.supabase
      .from("profiles")
      .select(
        "subscription_tier, subscription_status, current_period_end, next_billed_at, paddle_subscription_id",
      )
      .eq("id", context.userId)
      .maybeSingle();
    const profile = profileData as {
      subscription_tier?: string | null;
      subscription_status?: string | null;
      current_period_end?: string | null;
      next_billed_at?: string | null;
      paddle_subscription_id?: string | null;
    } | null;

    // `subscriptions` tablosu generated tiplerde yok (migration sonradan
    // eklendi): yalnız ihtiyaç duyulan alanlarla dar bir istemci tipi kullanılır.
    type LedgerQuery = Promise<{
      data: SubscriptionLedgerRowView[] | null;
      error: { message: string } | null;
    }>;
    const ledgerClient = context.supabase as unknown as {
      from(table: "subscriptions"): {
        select(columns: string): {
          eq(
            column: "user_id",
            value: string,
          ): {
            order(
              column: "updated_at",
              options: { ascending: boolean },
            ): { limit(count: number): LedgerQuery };
          };
        };
      };
    };

    let rows: SubscriptionLedgerRowView[] = [];
    try {
      const { data } = await ledgerClient
        .from("subscriptions")
        .select(
          "paddle_subscription_id, status, tier, cancel_at_period_end, current_period_end, next_billed_at, updated_at",
        )
        .eq("user_id", context.userId)
        .order("updated_at", { ascending: false })
        .limit(5);
      rows = data ?? [];
    } catch {
      // Defter okunamazsa yalnız profil aynası gösterilir; iptal bayrağı
      // `false` kalır (uydurma "iptal edildi" metni basılmaz).
      rows = [];
    }

    return mySubscriptionView(profile, rows);
  });

/**
 * "ABONELİĞİ İPTAL ET" — yenilemeyi durdurur, bu ayı iade ETMEZ.
 *
 * Paddle `effective_from: next_billing_period` ile çağrılır: kullanıcı dönem
 * sonuna kadar paketi kullanır, sonraki tahsilat yapılmaz. Sonuç webhook'u
 * beklemeden yazılır (webhook gecikirse kart yine doğruyu gösterir).
 */
export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelSubscriptionResult> => {
    const {
      paddleSettings,
      getPaddleClient,
      findPaddleCustomerIdByEmail,
      fetchActionableSubscription,
    } = await import("@/lib/paddle.server");
    const { scheduleSubscriptionCancellation } = await import("@/lib/paddle-cancel.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const settings = paddleSettings();
    if (!settings) return { ok: false, reason: "not_configured" };

    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("email, subscription_tier, paddle_subscription_id, paddle_customer_id")
      .eq("id", context.userId)
      .maybeSingle();
    const profile = profileData as {
      email?: string | null;
      subscription_tier?: string | null;
      paddle_subscription_id?: string | null;
      paddle_customer_id?: string | null;
    } | null;

    const paddle = getPaddleClient();
    type SdkSubscription = Awaited<ReturnType<typeof paddle.subscriptions.get>>;

    // SDK sınıfı yerine yalnız gereken alanlar aktarılır: test edilebilir
    // sözleşme (`CancelableSubscription`) ile birebir eşleşir.
    const toCancelable = (sub: SdkSubscription): CancelableSubscription => ({
      id: sub.id,
      status: sub.status,
      customerId: sub.customerId,
      nextBilledAt: sub.nextBilledAt,
      scheduledChange: sub.scheduledChange ? { action: sub.scheduledChange.action } : null,
      currentBillingPeriod: sub.currentBillingPeriod
        ? {
            startsAt: sub.currentBillingPeriod.startsAt,
            endsAt: sub.currentBillingPeriod.endsAt,
          }
        : null,
      items: (sub.items ?? []).map((item) => ({
        price: item.price ? { id: item.price.id, productId: item.price.productId } : null,
      })),
      customData: (sub.customData ?? null) as Record<string, unknown> | null,
    });

    const rpc = supabaseAdmin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>;

    return scheduleSubscriptionCancellation(
      {
        settings,
        getSubscription: async (id) => toCancelable(await paddle.subscriptions.get(id)),
        findCustomerIdByEmail: findPaddleCustomerIdByEmail,
        fetchActionableSubscription: async (customerId) => {
          const found = await fetchActionableSubscription(customerId);
          return found ? toCancelable(found) : null;
        },
        cancelSubscription: async (id, options) =>
          toCancelable(await paddle.subscriptions.cancel(id, options)),
        persist: async (command) => {
          const { data, error } = await rpc("process_paddle_event", {
            _event_id: command.eventId,
            _event_type: command.eventType,
            _occurred_at: command.occurredAt,
            _user_id: context.userId,
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
            _payload: {
              source: "settings-cancel",
              subscriptionId: command.paddleSubscriptionId,
            },
          });
          if (error) {
            console.error("[Paddle] İptal kaydı yazılamadı:", error.message);
            return false;
          }
          return data !== null;
        },
      },
      {
        userId: context.userId,
        email: profile?.email ?? null,
        subscriptionId: profile?.paddle_subscription_id ?? null,
        customerId: profile?.paddle_customer_id ?? null,
        tierHint: profile?.subscription_tier ?? null,
      },
    );
  });

/** Tazelemenin sonucu — "başladı" demek için ölçülmüş bir dayanak şart. */
export type ReconcileResult = {
  ok: boolean;
  /** not_configured | no_customer | no_live_subscription | plan_unresolved | write_failed | reconciled */
  reason: string;
  tier?: string | null;
  status?: string | null;
  creditsGranted?: boolean;
  subscriptionId?: string;
};
