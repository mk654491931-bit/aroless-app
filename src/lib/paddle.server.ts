/**
 * Paddle Billing v2 — Server-side integration
 * Handles API calls, checkout creation, webhook signature verification
 */

import { createHmac } from "crypto";

export type PaddleEnv = {
  apiKey: string;
  vendorId: string;
  publicKey: string;
  clientToken: string;
  webhookSecret: string;
  productId: string;
};

/**
 * Paddle ortam değişkenlerini yükle.
 * Her zaman null dönüşü hata ile müdahale et, tanımlanmış olması kritiktir.
 */
export function paddleEnv(plan: "Starter" | "Pro" | "Business" = "Pro"): PaddleEnv | null {
  const apiKey = process.env["PADDLE_API_KEY"];
  const vendorId = process.env["PADDLE_VENDOR_ID"];
  const publicKey = process.env["PADDLE_PUBLIC_KEY"];
  const clientToken = process.env["PADDLE_CLIENT_TOKEN"];
  const webhookSecret = process.env["PADDLE_WEBHOOK_SECRET"];

  // Varsayılan ürün ID'si veya plan-bazlı
  let productId = process.env["PADDLE_PRODUCT_ID"];
  if (!productId) {
    switch (plan) {
      case "Starter":
        productId = process.env["PADDLE_STARTER_PRODUCT_ID"];
        break;
      case "Business":
        productId = process.env["PADDLE_BUSINESS_PRODUCT_ID"];
        break;
      case "Pro":
      default:
        productId = process.env["PADDLE_PRO_PRODUCT_ID"] || process.env["PADDLE_PRODUCT_ID"];
        break;
    }
  }

  if (!apiKey || !vendorId || !publicKey || !clientToken || !webhookSecret || !productId) {
    const missing = [
      ...(!apiKey ? ["PADDLE_API_KEY"] : []),
      ...(!vendorId ? ["PADDLE_VENDOR_ID"] : []),
      ...(!publicKey ? ["PADDLE_PUBLIC_KEY"] : []),
      ...(!clientToken ? ["PADDLE_CLIENT_TOKEN"] : []),
      ...(!webhookSecret ? ["PADDLE_WEBHOOK_SECRET"] : []),
      ...(!productId ? ["PADDLE_PRODUCT_ID"] : []),
    ];
    console.error(`[Paddle] Missing env: ${missing.join(", ")}`);
    return null;
  }

  return { apiKey, vendorId, publicKey, clientToken, webhookSecret, productId };
}

/**
 * Paddle API'ye istek yap (POST).
 * Generic type desteği ve error handling ile.
 */
async function callPaddleAPI<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const url = `https://api.paddle.com/v1${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `[Paddle API] ${response.status} ${response.statusText}: ${detail.slice(0, 200)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * Paddle checkout linki oluştur.
 * User ID, email ve plan bilgisine dayanarak.
 */
export async function createPaddleCheckout(opts: {
  userId: string;
  email?: string | null;
  plan?: "Pro" | "Starter" | "Business";
  redirectUrl?: string;
}): Promise<{ checkoutUrl: string; checkoutId: string }> {
  const plan = opts.plan ?? "Pro";
  const env = paddleEnv(plan);

  if (!env) {
    throw new Error(
      "Paddle yapılandırılmamış (API key / vendor / public key / client token / webhook secret / product ID eksik).",
    );
  }

  // Paddle v2 API: checkout session oluştur
  interface CheckoutCreateResponse {
    data?: {
      id?: string;
      checkout_url?: string;
    };
  }

  const body = {
    items: [
      {
        priceId: env.productId,
        quantity: 1,
      },
    ],
    customData: {
      userId: opts.userId,
      plan,
    },
    customerEmail: opts.email ?? undefined,
    returnUrl: opts.redirectUrl ?? undefined,
  };

  try {
    const result = await callPaddleAPI<CheckoutCreateResponse>(
      "/checkout",
      body,
      env.apiKey,
    );

    const checkoutId = result.data?.id;
    const checkoutUrl = result.data?.checkout_url;

    if (!checkoutId || !checkoutUrl) {
      throw new Error(
        "Paddle checkout cevabı beklenen alanları içermiyor (id, checkout_url)",
      );
    }

    return { checkoutUrl, checkoutId };
  } catch (error) {
    console.error("[Paddle] Checkout creation failed:", error);
    throw error;
  }
}

/**
 * Webhook signature verification — Paddle v2 HMAC-SHA256
 */
export function verifyPaddleWebhookSignature(
  rawBody: string,
  paddleSignature: string,
  webhookSecret: string,
): boolean {
  try {
    // Paddle kullanır: HMAC-SHA256(raw_body, secret) = hex digest
    const expectedSignature = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    // Timing-safe comparison
    const sig = Buffer.from(paddleSignature);
    const exp = Buffer.from(expectedSignature);

    if (sig.length !== exp.length) return false;

    let result = 0;
    for (let i = 0; i < sig.length; i++) {
      result |= sig[i] ^ exp[i];
    }

    return result === 0;
  } catch (error) {
    console.error("[Paddle] Signature verification error:", error);
    return false;
  }
}

/**
 * Subscription tier'ı Paddle event'ine göre belirle.
 */
export function getPaddleSubscriptionTier(
  eventType: string,
  status: string,
  productId?: string,
): string | null {
  // Paddle event types: subscription.created, subscription.updated, subscription.cancelled
  switch (eventType) {
    case "subscription.created":
      // Yeni subscription = aktif
      return status === "active" || status === "trial" ? "Pro" : null;

    case "subscription.updated":
      // Status değişikliği takip et
      if (status === "active" || status === "trial") {
        // Hangi tier olduğunu product ID'den belirle (opsiyonel)
        return "Pro"; // Veya productId'ye göre tier belirle
      }
      // Diğer durumlar (paused, pastdue) → Free
      return "Free";

    case "subscription.cancelled":
    case "subscription.deleted":
    case "subscription.past_due":
      return "Free";

    default:
      return null;
  }
}
