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
 *                                       accepted for Vite deployments. Legacy PADDLE_*_PRODUCT_ID and
 *                                       PADDLE_PRODUCT_ID are still honoured for backwards compatibility.
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
  priceIds: Partial<Record<PlanId, string>>;
  /**
   * Plan → Paddle ÜRÜN ID'si.
   *
   * NEDEN AYRI TUTULUR (ölçülen hatanın kaynağı): eskiden ürün ID'leri, fiyat
   * ID'si bulunamadığında AYNI sözlüğe yazılıyordu. Sonucu iki yönlü bir
   * bozulmaydı:
   *   • Checkout, ürün ID'sini “fiyat ID'si” sanıp Paddle'dan hata alıyor ve
   *     tarayıcı ham (customData'sız, `discountCode`'suz) akışa düşüyordu.
   *   • Webhook, olaydaki GERÇEK fiyat ID'siyle karşılaştırma yaptığı için
   *     hiçbir zaman eşleşme bulamıyor, paket tanımlanmıyor ve kullanıcı satın
   *     alma yapmasına rağmen "Free" görünüyordu (indirim koduyla alınan paket).
   * Artık ikisi ayrı sözlüktür ve eşleştirme İKİSİNE birden bakar.
   */
  productIds: Partial<Record<PlanId, string>>;
};

/** Yalnız FİYAT ID'si sağlayan değişkenler. */
const PLAN_PRICE_ENV: Record<PlanId, readonly string[]> = {
  Starter: ["PADDLE_STARTER_PRICE_ID", "VITE_PADDLE_PRICE_STARTER_MONTHLY"],
  Pro: ["PADDLE_PRO_PRICE_ID", "VITE_PADDLE_PRICE_PRO_MONTHLY"],
  Business: ["PADDLE_BUSINESS_PRICE_ID", "VITE_PADDLE_PRICE_BUSINESS_MONTHLY"],
};

/** Yalnız ÜRÜN ID'si sağlayan değişkenler (eski/değişken şemaları). */
const PLAN_PRODUCT_ENV: Record<PlanId, readonly string[]> = {
  Starter: ["PADDLE_STARTER_PRODUCT_ID"],
  Pro: ["PADDLE_PRO_PRODUCT_ID", "PADDLE_PRODUCT_ID"],
  Business: ["PADDLE_BUSINESS_PRODUCT_ID"],
};

function firstDefined(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
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
 *
 * KATALOG KISMİ OLUR (ölçülen hatanın kaynağı): `apiKey`/`webhookSecret`/
 * `clientToken` olmadan Paddle ile konuşulamaz, bu yüzden bunlar ZORUNLUDUR.
 * Fiyat ID'leri ise ZORUNLU DEĞİLDİR: bir planın fiyat ID'si eksik olduğünde
 * önceden tüm entegrasyon `null` dönüyordu. Bunun ölçülen sonucu şuydu:
 * checkout sunucu yolundan düşüyor, tarayıcı `customData`sız ham fiyat
 * checkout'una geçiyor ve webhook ödemeyi hiçbir kullanıcıya bağlayamadığı için
 * "satın alma var, pakette ne?" durumu oluşuyordu — yani TEK eksik fiyat ID'si
 * TÜM ödemeleri sahipsiz bırakıyordu.
 *
 * Artık yalnız gerçekten konuşulamaz durumda `null` döner; eksik fiyat ID'leri
 * loglanır ve yalnız O planın checkout'u reddedilir.
 */
export function paddleSettings(): PaddleSettings | null {
  const apiKey = process.env["PADDLE_API_KEY"];
  const webhookSecret = firstDefined("PADDLE_WEBHOOK_SECRET_KEY", "PADDLE_WEBHOOK_SECRET");
  // Client tokens and price IDs are public Vite configuration. Keep the
  // server-only API key and webhook secret on their unprefixed names.
  const clientToken = firstDefined("PADDLE_CLIENT_TOKEN", "VITE_PADDLE_CLIENT_TOKEN");

  const priceIds: Partial<Record<PlanId, string>> = {};
  const productIds: Partial<Record<PlanId, string>> = {};
  for (const plan of ["Starter", "Pro", "Business"] as const) {
    const price = firstDefined(...PLAN_PRICE_ENV[plan]);
    if (price) priceIds[plan] = price;
    const product = firstDefined(...PLAN_PRODUCT_ENV[plan]);
    if (product) productIds[plan] = product;
  }

  // Eksik sayılan plan: HİÇBİR kimliği olmayan plan. Yalnız ürün ID'si tanımlı
  // bir plan satın alınabilir kalır (fiyatı API'den çözülür).
  const missingPlans = (["Starter", "Pro", "Business"] as const).filter(
    (plan) => !priceIds[plan] && !productIds[plan],
  );
  if (missingPlans.length) {
    // Katalog eksik ama ödeme altyapısı ayakta: yalnız bu planlar satın
    // alınamaz. Webhook ÇALIŞMAYA DEVAM EDER — aksi hâlde tek bir eksik fiyat
    // ID'si daha önce olduğu gibi bütün ödemeleri sahipsiz bırakıyordu.
    console.warn(
      `[Paddle] Missing price id(s) for: ${missingPlans.join(", ")} — only those plans cannot be checked out.`,
    );
  }

  if (!apiKey || !webhookSecret || !clientToken) {
    const missing = [
      ...(!apiKey ? ["PADDLE_API_KEY"] : []),
      ...(!webhookSecret ? ["PADDLE_WEBHOOK_SECRET_KEY"] : []),
      ...(!clientToken ? ["PADDLE_CLIENT_TOKEN"] : []),
    ];
    console.error(`[Paddle] Missing environment variable(s): ${missing.join(", ")}`);
    return null;
  }

  return {
    apiKey,
    environment: resolvePaddleEnvironment(),
    clientToken,
    webhookSecret,
    priceIds,
    productIds,
  };
}

/**
 * İşlemde UYGULANMIŞ indirim kodunun kimliği (yoksa `null`).
 *
 * NEDEN VAR: sahibi “%100 indirim kodu kullandım ama Paddle bunu doğrulamadı”
 * diye bildirdi. Paddle indirimi `details.discounts[].discount_id` (bazı
 * olaylarda düz `discount_id`) alanında taşır. Bu işlev YALNIZ gerçekten
 * yazılmış kimliği okur; alan yoksa `null` döner — uydurma değer basılmaz.
 * Ham gövde zaten `process_paddle_event` içinde `_payload` ile saklanır, yani
 * bu değer log/denetim için okunabilir bir alan sağlar.
 */
export function appliedDiscountId(data: unknown): string | null {
  const record = (data ?? {}) as Record<string, unknown>;
  const details = record["details"] as Record<string, unknown> | undefined;
  const list = Array.isArray(record["discounts"])
    ? (record["discounts"] as unknown[])
    : Array.isArray(details?.["discounts"])
      ? (details["discounts"] as unknown[])
      : [];
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = item["discount_id"] ?? item["id"];
    if (typeof id === "string" && id) return id;
  }
  const direct = record["discount_id"];
  return typeof direct === "string" && direct ? direct : null;
}

/** Bir planın tanımlı fiyat ID'si (yoksa `null`). */
export function priceIdForPlan(settings: PaddleSettings, plan: PlanId): string | null {
  return settings.priceIds[plan] ?? null;
}

/** Yalnız fiyat ID'siyle eşleştirir (geriye dönük uyum için korunur). */
export function planForPriceId(settings: PaddleSettings, priceId?: string | null): PlanId | null {
  if (!priceId) return null;
  const entry = (Object.entries(settings.priceIds) as [PlanId, string][]).find(
    ([, id]) => id === priceId,
  );
  return entry?.[0] ?? null;
}

/**
 * Paddle olayındaki KİMLİKLERDEN planı çözer — fiyat VE ürün ID'sine bakar.
 *
 * NEDEN İKİSİ: Paddle işlem satırı `price.id` (fiyat) ve `price.productId`
 * (ürün) taşır. Kurulumda hangi tür kimliğin tanımlı olduğu dağıtıma göre
 * değişir; tek türe bakmak, eşleşme bulunamadığı için paketin hiç
 * tanımlanmamasına (kullanıcı ödeme yapmış ama "Free" görünüyor) yol açıyordu.
 * Sıra ÖNEMLİ: fiyat ID'si daha özgüldür (aynı ürünün aylık/yıllık fiyatları
 * farklı olabilir), bu yüzden önce o aranır.
 */
export function planForAsset(
  settings: PaddleSettings,
  priceId?: string | null,
  productId?: string | null,
): PlanId | null {
  const byPrice = planForPriceId(settings, priceId);
  if (byPrice) return byPrice;
  if (!productId) return null;
  const entry = (Object.entries(settings.productIds) as [PlanId, string][]).find(
    ([, id]) => id === productId,
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

/**
 * Create a server-side Paddle transaction for a plan and return the data needed to
 * open the Paddle.js overlay checkout (transactionId + client-side token).
 *
 * customData is attached server-side — it cannot be tampered with by the browser —
 * and Paddle copies it onto the subscription and every renewal transaction, which
 * is what lets the webhook attribute payments to the right user.
 */
export async function createPaddleCheckoutSession(opts: {
  userId: string;
  email?: string | null;
  plan?: PlanId;
}): Promise<CheckoutSession> {
  const plan = isPlanId(opts.plan) ? opts.plan : "Pro";
  const settings = paddleSettings();
  if (!settings) {
    throw new Error(
      "Ödeme sağlayıcısı yapılandırılmamış (Paddle env değişkenleri eksik). Lütfen yöneticiyle iletişime geçin.",
    );
  }

  const paddle = getPaddleClient();
  // Fiyat öncelikli; yalnız ÜRÜN ID'si tanımlıysa ürünün aktif fiyatı Paddle'dan
  // çözülür. Aksi hâlde ürün ID'sini fiyat yerine göndermek Paddle'dan hata
  // alır ve checkout (ölçüldüğü gibi) customData'sız ham akışa düşerdi.
  const configuredPrice = priceIdForPlan(settings, plan);
  const productId = settings.productIds[plan] ?? null;
  const priceId =
    configuredPrice ?? (productId ? await resolveProductPriceId(paddle, productId) : null);
  if (!priceId) {
    throw new Error(
      `"${plan}" planı için Paddle fiyat/ürün ID'si tanımlı değil ` +
        `(${PLAN_PRICE_ENV[plan][0]} veya ${PLAN_PRODUCT_ENV[plan][0]}).`,
    );
  }

  try {
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customData: { userId: opts.userId, plan, source: "aroless-web" },
    });

    if (!transaction?.id) {
      throw new Error("Paddle transaction oluşturulamadı (yanıtta id yok).");
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
    console.error("[Paddle] Checkout transaction creation failed:", error);
    throw error;
  }
}

/**
 * Bir ÜRÜN'ün aktif fiyat ID'sini Paddle'dan çözer.
 *
 * Neden gerekli: bazı kurulumlar yalnız `PADDLE_*_PRODUCT_ID` tanımlar (eski
 * şema). `transactions.create` ise fiyat ID'si ister; ürün ID'sini fiyat yerine
 * göndermek isteği reddettirir. Bu yüzden ürünün ilk AKTİF fiyatı sorulur.
 */
async function resolveProductPriceId(paddle: Paddle, productId: string): Promise<string | null> {
  try {
    const prices = await paddle.prices.list({
      productId: [productId],
      status: ["active" as never],
      perPage: 1,
    });
    // `Collection` bir AsyncIterable'dır; ilk sayfa `next()` ile alınır.
    const [first] = await prices.next();
    return first?.id ?? null;
  } catch (error) {
    console.error("[Paddle] Ürünün fiyatı çözülemedi:", error);
    return null;
  }
}

/**
 * ABONELİK/İŞLEM kimliklerinden Paddle'ın KENDİ kaydını okuyup planı çözer.
 *
 * NEDEN GEREKLİ (ölçülen hata): webhook yalnız olay gövdesindeki fiyat ID'sini
 * çevre değişkenleriyle karşılaştırıyordu. Env tarafında ürün ID'si tanımlıysa
 * eşleşme HİÇ bulunamıyor, paket tanımlanmıyor ve kullanıcı ödeme yapmasına
 * rağmen "Free" kalıyordu — %100 indirim koduyla alınan pakette tam olarak bu
 * yaşandı. Paddle'ın kendi kaydı TEK yetkili doğruluk kaynağıdır: oradan
 * okunan `price.id`/`price.productId` ile plan kesin olarak çözülür.
 *
 * AĞ HATASI İŞİ BOZMAZ: erişilemezse `null` döner ve çağıran, elindeki olay
 * verisiyle devam eder (kullanıcıyı hatalı plana yazmaktansa hiç yazmamak
 * yeğdir).
 */
export async function resolvePaddleEntitlement(
  settings: PaddleSettings,
  ids: { transactionId?: string | null; subscriptionId?: string | null },
): Promise<{
  priceId: string | null;
  productId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  plan: PlanId | null;
} | null> {
  let paddle: Paddle;
  try {
    paddle = getPaddleClient();
  } catch {
    return null;
  }

  try {
    if (ids.transactionId) {
      const txn = await paddle.transactions.get(ids.transactionId);
      const priceId = txn.items?.[0]?.price?.id ?? null;
      const productId = txn.items?.[0]?.price?.productId ?? null;
      return {
        priceId,
        productId,
        customerId: txn.customerId ?? null,
        subscriptionId: txn.subscriptionId ?? null,
        status: txn.status ?? null,
        plan: planForAsset(settings, priceId, productId),
      };
    }
    if (ids.subscriptionId) {
      const sub = await paddle.subscriptions.get(ids.subscriptionId);
      const priceId = sub.items?.[0]?.price?.id ?? null;
      const productId = sub.items?.[0]?.price?.productId ?? null;
      return {
        priceId,
        productId,
        customerId: sub.customerId ?? null,
        subscriptionId: sub.id ?? null,
        status: sub.status ?? null,
        plan: planForAsset(settings, priceId, productId),
      };
    }
  } catch (error) {
    console.warn(
      "[Paddle] Yetki çözümlemesi API'den okunamadı:",
      error instanceof Error ? error.message : error,
    );
  }
  return null;
}

/**
 * Bir müşteri ID'sinden e-posta adresini okur (sahiplik çözümlemesi için).
 *
 * NEDEN: `customData.userId` yalnız sunucu tarafında oluşturulan işlemlerde
 * bulunur. Tarayıcı bir kez ham checkout'a düştüyse (ya da eski bir abonelik
 * yenileniyorsa) olay gövdesinde kullanıcı kimliği yoktur ve ödeme SAHİPSİZ
 * kalır. Paddle müşterisinin e-postası ile `profiles.email` eşleştirilerek
 * ödeme doğru hesaba bağlanır.
 */
export async function resolvePaddleCustomerEmail(customerId: string): Promise<string | null> {
  try {
    const paddle = getPaddleClient();
    const customer = await paddle.customers.get(customerId);
    const email = customer?.email ?? null;
    return email && email.includes("@") ? email : null;
  } catch (error) {
    console.warn(
      "[Paddle] Müşteri e-postası okunamadı:",
      error instanceof Error ? error.message : error,
    );
    return null;
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
  /** Olaydaki ürün ID'si — plan çözümlemesi fiyat ID'siyle birlikte bakar. */
  productId: string | null;
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
  const items: Array<{ price?: { id?: string; productId?: string } | null }> = Array.isArray(
    data?.items,
  )
    ? data.items
    : [];
  const priceId: string | null = items[0]?.price?.id ?? null;
  const productId: string | null = items[0]?.price?.productId ?? null;
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
    productId,
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
    // Plan: ÖNCE olaydaki fiyat/ürün kimliği (Paddle'ın gerçek kaydı), sonra
    // `customData.plan`. Yalnız fiyat ID'sine bakmak, env'de ürün ID'si tanımlı
    // kurulumlarda paketin hiç tanımlanmamasına yol açıyordu.
    const tier: PlanId | "Free" | null = revoking
      ? "Free"
      : active
        ? (planForAsset(settings, priceId, productId) ?? requestedPlan ?? null)
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
    const tier: PlanId | null = planForAsset(settings, priceId, productId) ?? requestedPlan ?? null;

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
    if (typeof (data as Record<string, unknown>)["status"] === "string") {
      const s = String((data as Record<string, unknown>)["status"]).toLowerCase();
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
 * ÖDEME OLAYININ KREDİ DOĞURUP DOĞURMADIĞI — saf karar (ağ/DB yok).
 *
 * NEDEN VAR (ölçülen hata): Paddle AYNI ödeme için birden çok olay gönderir
 * (`transaction.completed`, ardından her değişiklikte `transaction.updated`) ve
 * her olayın KENDİ `event_id`si olur. RPC yalnız `event_id` bazında
 * tekilleştirdiği için paket kredisi HER olayda yeniden ekleniyordu — kullanıcı
 * "sistem kendi kendine sürekli kredi tanımlıyor" diye bildirdi.
 *
 * KURAL: kredi İŞLEM başına bir kez verilir. Aynı işlem için ikinci olay
 * (`alreadyRecorded`) ve ödeme bildirmeyen durum güncellemeleri kredi üretmez.
 */
export function creditGrantDecision(args: {
  eventType: string;
  /** Olaydaki işlem durumu (`transaction.updated` için belirleyici). */
  transactionStatus?: string | null;
  /** Bu işlem için zaten bir `transactions` satırı var mı? */
  alreadyRecorded: boolean;
  searchCredits: number;
  simCredits: number;
}): { search: number; sim: number; granted: boolean; reason: string } {
  const none = { search: 0, sim: 0, granted: false };
  if (args.searchCredits <= 0 && args.simCredits <= 0) {
    return { ...none, reason: "no-grant-mapped" };
  }
  const status = String(args.transactionStatus ?? "").toLowerCase();
  const paid = args.eventType === "transaction.completed" || status === "completed";
  if (!paid) {
    // Durum bildirimi (ör. `ready` → `completed`), yeni bir satın alma değildir.
    return { ...none, reason: "not-paid" };
  }
  if (args.alreadyRecorded) {
    return { ...none, reason: "already-granted" };
  }
  return {
    search: Math.max(0, args.searchCredits),
    sim: Math.max(0, args.simCredits),
    granted: true,
    reason: "granted",
  };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
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
