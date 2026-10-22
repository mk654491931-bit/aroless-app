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
    resolveDiscountCode,
    refundSignal,
    SUBSCRIPTION_CREDIT_GRANTS,
  } = await import("@/lib/paddle.server");
  // Saf modül (sunucu bağımlılığı yok): istemci değerlendirmesinde sorun çıkarmaz.
  const { shouldNotifyCommission } = await import("@/lib/affiliate-payout");
  const { MIN_PAYOUT_CENTS } = await import("@/lib/affiliate");

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

    // 4b. İADE / CHARGEBACK → affiliate komisyonu mahsubu.
    //     İade edilen ödemenin komisyonu influencer'da kalmamalı. İade olayları
    //     normal entitlement akışından geçmez (mapPaddleEvent bilinçli olarak
    //     null döner), bu yüzden ayrı ve idempotent bir RPC çalıştırılır:
    //     event_id dedupe + işleme bağlı komisyonun 'reversed' işaretlenmesi.
    const refund = refundSignal(event.eventType, event.data);
    if (refund.isRefund) {
      const rpc = supabaseAdmin.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string; code?: string } | null }>;

      let lastRefundError: { message: string; code?: string } | null = null;
      for (let attempt = 0; attempt < MAX_RPC_RETRIES; attempt++) {
        const res = await rpc("process_paddle_refund", {
          _event_id: event.eventId,
          _event_type: event.eventType,
          _occurred_at: event.occurredAt,
          _transaction_id: refund.transactionId,
          _reason: refund.reason,
          _payload: auditPayload,
        });
        if (!res.error) {
          console.log(
            `[Paddle Webhook] ↺ ${event.eventType} (${event.eventId}) → komisyon mahsubu ` +
              `(işlem ${refund.transactionId ?? "-"}, sebep ${refund.reason})`,
          );
          return text("ok", 200);
        }
        // Migration uygulanmamışsa iade olayı sonsuz 500 döngüsü yaratmasın:
        // fonksiyon yoksa ack'le ve durumu logla.
        if (/could not find the function|does not exist|schema cache/i.test(res.error.message)) {
          console.warn(
            `[Paddle Webhook] process_paddle_refund bulunamadı — migration uygulanmamış olabilir.`,
          );
          return text("ok", 200);
        }
        lastRefundError = res.error;
        const transient =
          /timeout|connection|temporarily|deadlock|serialization/i.test(res.error.message) ||
          (res.error as { code?: string }).code === "54000";
        if (!transient || attempt === MAX_RPC_RETRIES - 1) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
      }
      console.error(
        `[Paddle Webhook] process_paddle_refund failed (${event.eventId}):`,
        lastRefundError?.message,
      );
      // Mahsup başarısız → Paddle yeniden denesin.
      return text("Webhook islenemedi", 500);
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

    // 7b. KREDİ KARARI — "sistem kendi kendine sürekli kredi tanımlıyor" ve
    //     "abonelik başladı ama jeton eklenmedi" şikâyetlerinin ortak noktası.
    //
    //     Paddle aynı ÖDEME için birden çok olay gönderir (`transaction.completed`
    //     + her değişiklikte `transaction.updated`) ve her olayın KENDİ
    //     `event_id`si vardır. Tek seferlik olmayı artık VERİTABANI garanti eder:
    //     `process_paddle_event`, krediyi `credit_ledger` üzerindeki
    //     `paddle:<işlem kimliği>` anahtarıyla bir kez talep eder.
    //
    //     BURADA `transactions` satırına BAKILMAZ (eski hata): ilk olay paketi
    //     çözemediğinde 0 jetonla yazılıyor ama `transactions` satırı yine
    //     oluşuyordu; sonraki olaylar "zaten kayıtlı" deyip jetonu sonsuza kadar
    //     reddediyordu. Ödeme kaydedilmiş, jeton hiç verilmemiş kalıyordu.
    if (command.searchCredits || command.simCredits) {
      const decision = creditGrantDecision({
        eventType: event.eventType,
        transactionStatus: (event.data as Record<string, unknown> | null)?.["status"] as
          string | null | undefined,
        transactionId: command.transactionId,
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

    // 10. AFFİLİATE KOMİSYONU + BİLDİRİM.
    //
    //     İKİ YOL BİRDİR ve çakışmazlar:
    //       a) Profil atfı: kullanıcı kodu kayıtta (veya giriş sonrası
    //          `claimPromoCode` ile) bağladıysa komisyon `process_paddle_event`
    //          içinde yazılır. Bu satır varsa aşağıda YALNIZ bildirim yapılır.
    //       b) İndirim kodu atfı: kullanıcı kodu YALNIZ Paddle ödeme ekranında
    //          girmişse profil boştur; uygulanan indirimin KODU Paddle'dan okunur,
    //          koda bağlı affiliate komisyonu `record_affiliate_commission` ile
    //          yazılır ve tekrar `referred_by` bağlanır (yenilemeler de sayılsın).
    //
    //     Her iki yolda da aynı işlem için EN FAZLA BİR komisyon satırı ve EN
    //     FAZLA BİR e-posta çıkar (`transaction_id` UNIQUE + `duplicate` kontrolü).
    if (result !== "duplicate" && command.tier && command.tier !== "Free") {
      await attributeAndNotifyCommissions({
        supabaseAdmin,
        userId,
        transactionId: command.transactionId,
        subscriptionId: command.paddleSubscriptionId,
        tier: command.tier,
        amountCents: command.amountCents,
        discountId,
        eventType: event.eventType,
        resolveDiscountCode,
        shouldNotifyCommission,
        minPayoutCents: MIN_PAYOUT_CENTS,
      });
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

/**
 * Affiliate komisyonu + bildirim — webhook'un son adımı.
 *
 * Profil atfı ile yazılmış satır varsa doğrudan bildirime geçer; yoksa indirim
 * kodunu çözüp komisyonu yazar. HİÇBİR HATA ödeme akışını düşürmez: bu adım
 * yalnızca influencer tarafını ilgilendirir, bu yüzden tümü try/catch içindedir
 * ve başarısızlık loglanır.
 */
async function attributeAndNotifyCommissions(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any;
  userId: string;
  transactionId: string | null;
  subscriptionId: string | null;
  tier: string;
  amountCents: number | null;
  discountId: string | null;
  eventType: string;
  resolveDiscountCode: (discountId: string | null) => Promise<string | null>;
  shouldNotifyCommission: (o: {
    result: string | null | undefined;
    status?: string | null;
    eventType?: string | null;
  }) => boolean;
  minPayoutCents: number;
}): Promise<void> {
  const { supabaseAdmin } = args;
  if (!args.transactionId) return;

  /** Bildirim kararı TEK yerde: yalnız yeni yazılmış `pending` satır için. */
  const notifyIfNew = async (commission: CommissionRowForNotice, result: string): Promise<void> => {
    if (
      !args.shouldNotifyCommission({
        result,
        status: commission.status,
        eventType: args.eventType,
      })
    ) {
      return;
    }
    await notifyCommission(supabaseAdmin, commission, args.minPayoutCents);
  };

  try {
    // a) Profil atfıyla yazılmış komisyon (kayıtta/`claimPromoCode` ile kod bağlı).
    const commission = await readCommission(supabaseAdmin, args.transactionId);
    if (commission) {
      await notifyIfNew(commission, "ok");
      return;
    }

    // Profil atfı yok → indirim kodundan affiliate çöz.
    const code = await args.resolveDiscountCode(args.discountId);
    if (!code) return;

    const { data: promo } = await supabaseAdmin
      .from("promo_codes")
      .select("code, affiliate_id")
      .eq("code", code)
      .maybeSingle();
    const affiliateId = (promo as { affiliate_id?: string | null } | null)?.affiliate_id ?? null;
    if (!affiliateId) return;

    const { data: recorded, error } = await supabaseAdmin.rpc("record_affiliate_commission", {
      _affiliate_id: affiliateId,
      _user_id: args.userId,
      _subscription_id: args.subscriptionId,
      _tier: args.tier,
      _amount_cents: args.amountCents ?? 0,
      _transaction_id: args.transactionId,
      _source: `discount:${code}`,
    });

    if (error) {
      // Migration uygulanmamışsa ödeme akışı bozulmamalı (yalnız log).
      console.warn(
        `[Paddle Webhook] record_affiliate_commission çağrılamadı (${code}): ${error.message}`,
      );
      return;
    }

    // PENCERE DOLMASI bir hata DEĞİLDİR (müşteri 12 ayı tamamladı): satır
    // yazılmaz, bildirim gönderilmez, ödeme akışı etkilenmez. Ayrı loglanır ki
    // "komisyon neden yazılmadı" sorusu loglardan yanıtlanabilsin.
    if (String(recorded) === "cap_reached") {
      console.log(`[Paddle Webhook] komisyon penceresi doldu, yeni komisyon yok (kod “${code}”)`);
      return;
    }

    console.log(
      `[Paddle Webhook] indirim kodu “${code}” → affiliate komisyonu (${String(recorded)})`,
    );

    const written = await readCommission(supabaseAdmin, args.transactionId);
    if (written) await notifyIfNew(written, String(recorded));
  } catch (e) {
    console.error("[Paddle Webhook] affiliate komisyon adımı hatası:", e);
  }
}

type CommissionRowForNotice = {
  affiliate_id: string;
  commission_cents: number;
  gross_amount_cents: number;
  tier: string | null;
  status: string;
};

/** İşlem için yazılmış komisyon satırını okur (yoksa null). */
async function readCommission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  transactionId: string,
): Promise<CommissionRowForNotice | null> {
  const { data, error } = await supabaseAdmin
    .from("affiliate_commissions")
    .select("affiliate_id, commission_cents, gross_amount_cents, tier, status")
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (error) {
    console.warn(`[Paddle Webhook] komisyon satırı okunamadı: ${error.message}`);
    return null;
  }
  return (data as CommissionRowForNotice | null) ?? null;
}

/**
 * Affiliate'e komisyon bildirimi gönderir.
 *
 * ZAMAN BÜTÇESİ: e-posta gönderimi kısa bir yarışla sınırlanır. Paddle 2xx
 * beklemediğinde olayı yeniden gönderdiği için webhook yanıtı e-posta yüzünden
 * gecikmemelidir; bütçe aşılırsa gönderim arka planda kalır ve durum loglanır.
 */
async function notifyCommission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  commission: CommissionRowForNotice,
  minPayoutCents: number,
): Promise<void> {
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", commission.affiliate_id)
      .maybeSingle();
    const email = (profile as { email?: string | null } | null)?.email ?? null;
    if (!email || !email.includes("@")) return;

    const { data: ownedCode } = await supabaseAdmin
      .from("promo_codes")
      .select("code")
      .eq("affiliate_id", commission.affiliate_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Bakiye bilgisi (bekleme süresiyle birlikte) varsa eklenir; okunamazsa
    // e-posta yine gönderilir (bilgi eksik kalır, bildirim kaybolmaz).
    let payableCents: number | undefined;
    let heldCents: number | undefined;
    try {
      const { data: summary } = await supabaseAdmin.rpc("affiliate_payout_summary");
      const row = ((summary ?? []) as Array<Record<string, unknown>>).find(
        (r) => r["affiliate_id"] === commission.affiliate_id,
      );
      if (row) {
        payableCents = Number(row["payable_cents"] ?? 0);
        heldCents = Number(row["held_cents"] ?? 0);
      }
    } catch {
      /* özet okunamazsa e-posta yine gider */
    }

    const { sendAffiliateCommissionEmail } = await import("@/lib/email-service");
    const send = sendAffiliateCommissionEmail(email, {
      commissionCents: commission.commission_cents,
      grossCents: commission.gross_amount_cents,
      tier: commission.tier,
      promoCode: (ownedCode as { code?: string | null } | null)?.code ?? null,
      ...(payableCents === undefined ? {} : { payableCents }),
      ...(heldCents === undefined ? {} : { heldCents }),
      minPayoutCents,
    });
    const outcome = await Promise.race([
      send,
      new Promise<{ sent: boolean; reason?: string }>((resolve) =>
        setTimeout(() => resolve({ sent: false, reason: "webhook_time_budget" }), 4_000),
      ),
    ]);
    if (!outcome.sent) {
      console.warn(`[Paddle Webhook] komisyon bildirimi gönderilemedi: ${outcome.reason}`);
    }
  } catch (e) {
    console.error("[Paddle Webhook] komisyon bildirimi hatası:", e);
  }
}
