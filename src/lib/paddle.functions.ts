import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .inputValidator((input: unknown) => InputSchema.parse(input))
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
