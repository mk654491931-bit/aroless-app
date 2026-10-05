// ============================================================================
// PADDLE BILLING v2 WEBHOOK — TEK UYGULAMA, İKİ YOL.
//
// Bu dosya iş mantığının TEK kaynağıdır. İki rota dosyası ince birer çağrı
// katmanıdır:
//   • /api/public/webhook/paddle  ← kanonik yol (belgelenen bu)
//   • /api/webhooks/paddle        ← uyumluluk yolu (aşağıdaki gerekçe)
//
// NEDEN İKİ YOL: Paddle panelinde webhook adresi elle yazılır. Ölçülen hata,
// panelde `/api/webhooks/paddle` yazılıyken uygulamanın yalnız
// `/api/public/webhook/paddle` sunmasıydı: istek hiç işleyiciye ULAŞMIYOR,
// 404 dönüyor, "abonelikler veritabanında aktif olmuyor" belirtisi ise
// YANLIŞ SEBEBELE bağlanıyordu. İmza doğrulaması, event işleme ve veritabanı
// yazımı sağlamdı — sadece adres yanlıştı. İki yol da aynı işleyiciyi
// çağırdığı için bu, iki kopyala değil tek uygulamadır.
//
// NOT (client-side değerlendirme): bu modül route ağacı üretimi sırasında
// İSTEMCİ tarafında da değerlendirilebilir. Bu yüzden `@paddle/paddle-node-sdk`
// statik import EDİLMEZ; tüm SDK erişimi işleyici gövdesindeki dinamik
// import'tan gelir (paddle.server ile aynı kural).
// ============================================================================

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
export async function handlePaddleWebhook(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const {
    paddleSettings,
    verifyPaddleWebhook,
    mapPaddleEvent,
    appliedDiscountId,
    creditGrantDecision,
    planForAsset,
    resolvePaddleEntitlement,
    resolvePaddleCustomerEmail,
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
    //    401 (401 Unauthorized), 400 değil: istek kimliği doğrulanamadı ve
    //    "401 Unauthorized" olarak raporlanması doğru HTTP anlamıdır. Paddle
    //    2xx dışı HER yanıtta yeniden dener; sahte imzalı bir istek zaten
    //    kalıcı olarak başarısızdır, ama yeniden deneme kuyruğunu kirletmemek
    //    için gövde/yanıt bilgilendirici değildir.
    const signature = request.headers.get("paddle-signature") ?? "";
    let event: { eventId: string; eventType: string; occurredAt: string; data: unknown };
    try {
      event = await verifyPaddleWebhook(raw, signature);
    } catch (err) {
      console.warn("[Paddle Webhook] Signature verification failed:", err);
      return text("Invalid signature", 401);
    }

    // 4. Parse raw JSON once for the audit log (kept small).
    let auditPayload: unknown = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      auditPayload =
        JSON.stringify(parsed).length > 50_000
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

    // 5b. AUTHORITATIVE TIER RESOLUTION (Paddle API).
    //     Ölçülen hata: olay gövdesindeki fiyat ID'si env'de tanımlı
    //     değerle eşleşmediğinde (env'de ürün ID'si tanımlıysa, ya da
    //     indirimli/yenilenen bir işlemde kalem farklıysa) paket HİÇ
    //     tanımlanmıyordu; kullanıcı satın aldığı hâlde "Free" kalıyordu.
    //     Paddle'ın kendi kaydı tek yetkili kaynaktır: oradan okunan
    //     fiyat/ürün kimliğiyle plan kesin çözülür.
    //
    //     Yalnız GEREKTİĞİNDE çağrılır (tier çözülemediyse) — normal
    //     akışta ek bir ağ gecikmesi yaratmaz.
    if (!command.tier || command.tier === "Free") {
      const entitlement = await resolvePaddleEntitlement(settings, {
        transactionId: command.transactionId,
        subscriptionId: command.paddleSubscriptionId,
      });
      if (entitlement) {
        if (!command.customerId && entitlement.customerId)
          command.customerId = entitlement.customerId;
        if (!command.paddleSubscriptionId && entitlement.subscriptionId)
          command.paddleSubscriptionId = entitlement.subscriptionId;
        if (!command.priceId && entitlement.priceId) command.priceId = entitlement.priceId;
        const plan = entitlement.plan ?? planForAsset(settings, command.priceId, command.productId);
        if (plan) {
          command.tier = plan;
          command.searchCredits = SUBSCRIPTION_CREDIT_GRANTS[plan].search;
          command.simCredits = SUBSCRIPTION_CREDIT_GRANTS[plan].sim;
          console.log(
            `[Paddle Webhook] ${event.eventType}: plan Paddle API'sinden çözüldü → ${plan}`,
          );
        }
      }
    }

    // 6. Attribute the event to a user: customData userId first, then the
    //    Paddle customer id recorded on the profile, then the customer's
    //    E-MAIL (ham checkout'a düşen ödemeler sahipsiz kalmasın).
    let userId: string | null =
      command.userId && UUID_RE.test(command.userId) ? command.userId : null;

    if (!userId && command.customerId) {
      const { data: byCustomer } = await supabaseAdmin
        .from("profiles")
        .select("id, subscription_tier")
        .eq("paddle_customer_id" as never, command.customerId)
        .maybeSingle();
      if (byCustomer?.id) userId = byCustomer.id as string;
    }

    if (!userId && command.customerId) {
      const email = await resolvePaddleCustomerEmail(command.customerId);
      if (email) {
        const { data: byEmail } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("email" as never, email)
          .maybeSingle();
        if (byEmail?.id) {
          userId = byEmail.id as string;
          console.log(
            `[Paddle Webhook] ${event.eventType}: ödeme e-posta ile sahiplendirildi (${email})`,
          );
        }
      }
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
    //
    //    ÖNEMLİ: burada "tutar > 0" koşulu ARTIK ARANMAZ. Ölçülen hata tam
    //    buradaydı: %100 indirim koduyla alınan pakette `grandTotal` 0
    //    olduğu için kendi kendini onarma yolu devre dışı kalıyor, paket
    //    tanımlanmıyor ve hesap "Free" görünüyordu. İndirim kodu kullanıldığı
    //    hâlde ücret ödenmemiş olmak bir hata değil, meşru bir alışveriş.
    if (TRANSACTION_EVENTS.has(event.eventType) && (!command.tier || command.tier === "Free")) {
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
      } else if (appliedDiscountId(event.data)) {
        // İndirimli ama plansız bir işlem: sessizce "Free" bırakıp
        // kaybolmak yerine kayda geçirilir. Yönetici gerçek nedeni görür.
        console.warn(
          `[Paddle Webhook] ${event.eventType}: indirimli işlemde plan çözülemedi ` +
            `(priceId=${command.priceId ?? "-"}), paket tanımlanmadı.`,
        );
      }
    }

    // 7b. KREDİ İDEMPOTANSİYETİ — "sistem kendi kendine sürekli kredi
    //     tanımlıyor" şikâyetinin kökü.
    //
    //     Paddle aynı ÖDEME için birden çok olay gönderir
    //     (`transaction.completed` + her değişiklikte `transaction.updated`)
    //     ve her olayın KENDİ `event_id`si vardır. RPC yalnız `event_id`
    //     bazında tekilleştirir; yani tek bir ödeme, o olayların her
    //     birinde paket kredisini YENİDEN ekliyordu. Kredi artık İŞLEM
    //     başına bir kez verilir: `transactions.external_id` tekil
    //     yazıldığı için ikinci ve sonraki olaylarda kredi sıfırlanır.
    if (command.searchCredits || command.simCredits) {
      // `transactions.external_id` tekil yazıldığı için "bu işlem zaten
      // kayıtlı mı?" sorusu kredi idempotansının anahtarıdır.
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
        eventType: event.eventType,
        transactionStatus: (event.data as Record<string, unknown> | null)?.["status"] as
          string | null | undefined,
        alreadyRecorded,
        searchCredits: command.searchCredits,
        simCredits: command.simCredits,
      });
      command.searchCredits = decision.search;
      command.simCredits = decision.sim;
      if (!decision.granted) {
        console.log(
          `[Paddle Webhook] kredi verilmedi (${decision.reason}) — işlem ${command.transactionId ?? "-"}`,
        );
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

    const discountId = appliedDiscountId(event.data);

    // 9. İNDİRİM/PROMOSYON KAYDI.
    //
    //    SORUN (kullanıcı bildirimi): "%100 indirim kodu kullandım ama
    //    Paddle o kodu kullanılmış olarak doğrulamadı." RPC'nin kendi
    //    kuralı promosyonu yalnız `tutar > 0` iken işaretler; %100
    //    indirimde tutar 0'dır, yani alışveriş panelde HİÇ KULLANILMAMIŞ
    //    görünüyordu. Burada indirimli (0 tutarlı) alışveriş de kayda
    //    geçirilir; koşul `purchased_at IS NULL` olduğu için RPC'nin
    //    yazdığı satır ikinci kez güncellenmez (idempotent).
    if (result !== "duplicate" && command.tier && command.tier !== "Free") {
      const { error: promoError } = await supabaseAdmin
        .from("promo_redemptions")
        .update({
          purchased_tier: command.tier,
          purchased_at: new Date().toISOString(),
          amount_cents: Math.max(0, command.amountCents ?? 0),
        } as never)
        .eq("user_id" as never, userId)
        .is("purchased_at" as never, null);
      if (promoError) {
        // Promosyon tablosu olmayan kurulumlar hatayı hak etmez.
        console.warn(`[Paddle Webhook] promosyon kaydı yazılamadı: ${promoError.message}`);
      }
    }

    console.log(
      `[Paddle Webhook] ✓ ${event.eventType} (${event.eventId}) → ${result ?? "ok"} ` +
        `for user ${userId} · plan=${command.tier ?? "-"} · ` +
        `tutar=${command.amountCents ?? "-"} · indirim=${discountId ?? "-"}`,
    );
    return text("ok", 200);
  } catch (err) {
    console.error("[Paddle Webhook] Unhandled error:", err);
    // Never leak internals to the caller; Paddle retries on non-2xx.
    return text("Webhook islenemedi", 500);
  }
}

function text(payload: string, status: number) {
  return new Response(payload, { status });
}
