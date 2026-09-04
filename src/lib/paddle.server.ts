/**
 * Paddle Billing v2 — sunucu tarafı yardımcıları.
 *
 * Ortam değişkenleri:
 *   PADDLE_API_KEY          — Paddle Billing API anahtarı (Bearer auth)
 *   PADDLE_CLIENT_TOKEN     — İstemci tarafı token (Paddle.Initialize)
 *   PADDLE_WEBHOOK_SECRET   — Webhook imza doğrulama anahtarı
 *   PADDLE_ENV              — "sandbox" veya "production" (varsayılan: sandbox)
 *   PADDLE_VENDOR_ID        — Vendor ID (isteğe bağlı, Price ID'lerden okunur)
 *
 * Fiyat ID'leri (Paddle dashboard'dan):
 *   PADDLE_PRICE_STARTER    — Starter plan aylık price ID
 *   PADDLE_PRICE_PRO        — Pro plan aylık price ID
 *   PADDLE_PRICE_BUSINESS   — Business plan aylık price ID
 */

export type PaddlePlan = "Starter" | "Pro" | "Business";

export type PaddleEnv = {
  apiKey: string;
  clientToken: string;
  webhookSecret: string;
  env: "sandbox" | "production";
};

/** Tüm Paddle ortam değişkenlerini okur. Eksikse null döner. */
export function getPaddleEnv(): PaddleEnv | null {
  const apiKey = process.env["PADDLE_API_KEY"];
  const clientToken = process.env["PADDLE_CLIENT_TOKEN"];
  const webhookSecret = process.env["PADDLE_WEBHOOK_SECRET"];
  if (!apiKey || !clientToken || !webhookSecret) return null;
  const env = (process.env["PADDLE_ENV"] || "sandbox") as "sandbox" | "production";
  return { apiKey, clientToken, webhookSecret, env };
}

/** Plan adından Paddle Price ID'sine eşleme. */
export function priceIdForPlan(plan: PaddlePlan): string | null {
  switch (plan) {
    case "Starter":
      return process.env["PADDLE_PRICE_STARTER"] || null;
    case "Pro":
      return process.env["PADDLE_PRICE_PRO"] || null;
    case "Business":
      return process.env["PADDLE_PRICE_BUSINESS"] || null;
  }
}

/**
 * Paddle Billing v2 Checkout API ile yeni bir ödeme bağlantısı üretir.
 *流式 API kullanarak S2S (Server-to-Server) checkout oluşturur.
 */
export async function createPaddleCheckout(opts: {
  userId: string;
  email?: string | null;
  plan: PaddlePlan;
  redirectUrl?: string;
  /** 0-100 arası yüzdelik indirim. 0 veya tanımsızsa indirim uygulanmaz. */
  discountPct?: number;
  /** İndirim için referans kodu (webhook'ta takip için). */
  promoCode?: string;
}): Promise<string> {
  const paddleEnv = getPaddleEnv();
  if (!paddleEnv) {
    throw new Error(
      "Paddle yapılandırılmamış (PADDLE_API_KEY / PADDLE_CLIENT_TOKEN / PADDLE_WEBHOOK_SECRET eksik).",
    );
  }

  const priceId = priceIdForPlan(opts.plan);
  if (!priceId) {
    throw new Error(`Paddle fiyat bilgisi bulunamadı: ${opts.plan}`);
  }

  const baseUrl =
    paddleEnv.env === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

  const body: Record<string, unknown> = {
    items: [
      {
        priceId,
        quantity: 1,
      },
    ],
    customData: {
      user_id: opts.userId,
      plan: opts.plan,
      ...(opts.promoCode ? { promo_code: opts.promoCode } : {}),
      ...(opts.discountPct ? { discount_pct: opts.discountPct } : {}),
    },
    settings: {
      successUrl: opts.redirectUrl || `${process.env.APP_URL || ""}/settings?checkout=success`,
    },
  };

  // Paddle v2 adjustments: yüzdelik indirim varsa line item'a uygula
  if (opts.discountPct && opts.discountPct > 0 && opts.discountPct < 100) {
    (body.items as Record<string, unknown>[])[0] = {
      ...(body.items as Record<string, unknown>[])[0],
      adjustments: [
        {
          type: "percentage",
          amount: opts.discountPct,
          description: opts.promoCode
            ? `Promosyon kodu: ${opts.promoCode} (-%${opts.discountPct})`
            : `İndirim (-%${opts.discountPct})`,
        },
      ],
    };
  }

  if (opts.email) {
    body.customer = { email: opts.email };
  }

  // Retry logic: 502/503/429 durumlarında 2 kez yeniden dene
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(`${baseUrl}/checkout/sessions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${paddleEnv.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timeout);

      if (resp.status === 429 || resp.status === 502 || resp.status === 503) {
        const detail = (await resp.text()).slice(0, 200);
        lastError = new Error(`Paddle checkout ${resp.status}: ${detail}`);
        // Üstel geri çekilme
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 400));
        continue;
      }

      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 300);
        throw new Error(`Paddle checkout ${resp.status}: ${detail}`);
      }

      const json = (await resp.json()) as {
        data?: { id?: string; url?: string };
      };

      const url = json.data?.url;
      if (!url) throw new Error("Paddle checkout bağlantısı alınamadı.");
      return url;
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof Error && e.name === "AbortError") {
        lastError = new Error("Paddle checkout isteği zaman aşımına uğradı.");
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw e; // Abort以外 hataları anında fırlat
    }
  }
  throw lastError ?? new Error("Paddle checkout başarısız (3 deneme)");
}

/**
 * Paddle webhook imzasını doğrular (HMAC-SHA256, base64).
 * Paddle v2 webhook signing秘密钥ı ile imza doğrulama.
 */
export async function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const paddleEnv = getPaddleEnv();
  if (!paddleEnv) return false;

  try {
    const secretBytes = new TextEncoder().encode(paddleEnv.webhookSecret);
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const dataBytes = new TextEncoder().encode(rawBody);
    // Paddle v2: base64 encoded HMAC-SHA256 signature
    const sigBytes = Uint8Array.from(atob(signatureHeader), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
  } catch {
    return false;
  }
}

/** Plan adını Paddle pricing sayfası metnine çevirir. */
export function paddlePlanPrice(plan: PaddlePlan): { monthlyUsd: number; yearlyUsd: number } {
  switch (plan) {
    case "Starter":
      return { monthlyUsd: 39, yearlyUsd: 390 };
    case "Pro":
      return { monthlyUsd: 59, yearlyUsd: 590 };
    case "Business":
      return { monthlyUsd: 199, yearlyUsd: 1990 };
  }
}
