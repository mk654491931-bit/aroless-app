/**
 * Paddle Billing v2 — sunucu tarafı yardımcıları.
 *
 * Ortam değişkenleri:
 *   PADDLE_API_KEY          — Paddle Billing API anahtarı (Bearer auth)
 *   PADDLE_CLIENT_TOKEN     — İstemci tarafı token (Paddle.Initialize)
 *   PADDLE_WEBHOOK_SECRET_KEY — Webhook imza doğrulama anahtarı
 *                            (eski ad PADDLE_WEBHOOK_SECRET de çalışır)
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
  // PADDLE_WEBHOOK_SECRET_KEY kanonik ad; PADDLE_WEBHOOK_SECRET geriye dönük uyumluluk.
  const webhookSecret =
    process.env["PADDLE_WEBHOOK_SECRET_KEY"] ?? process.env["PADDLE_WEBHOOK_SECRET"];
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
 * Paddle Price ID'sini plan adına eşler (webhook'ta tier belirlemek için).
 * custom_data.plan her zaman güvenilir olmadığından önce price ID eşlemesine bakılır.
 */
export function planForPriceId(priceId: string | null | undefined): PaddlePlan | null {
  if (!priceId) return null;
  const map: Array<[string, PaddlePlan]> = [
    [process.env["PADDLE_PRICE_STARTER"] ?? "", "Starter"],
    [process.env["PADDLE_PRICE_PRO"] ?? "", "Pro"],
    [process.env["PADDLE_PRICE_BUSINESS"] ?? "", "Business"],
  ];
  for (const [envPriceId, plan] of map) {
    if (envPriceId && priceId === envPriceId) return plan;
  }
  return null;
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
 * Paddle Billing v2 webhook imzasını doğrular.
 *
 * Paddle v2 formatı:
 *   Paddle-Signature: ts=<unix-zaman>;h1=<hex-hmac-sha256>
 * İmza şunun üzerine alınır: HMAC-SHA256(secret, `${ts}:${rawBody}`)
 *
 * Ayrıca replay saldırılarına karşı zaman damgası kontrolü yapılır
 * (varsayılan 5 dakika — Paddle'ın önerdiği üst sınır).
 */
export const PADDLE_SIGNATURE_MAX_AGE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = hexToBytes(a);
  const bb = hexToBytes(b);
  if (ba.length === 0 || ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

/** `ts=...;h1=...` başlığını ayrıştırır; geçersizse null döner. */
export function parsePaddleSignatureHeader(
  header: string,
): { ts: number; h1: string } | null {
  const parts = header.split(";").map((p) => p.trim());
  let ts: number | null = null;
  let h1: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) ts = n;
    } else if (key === "h1") {
      h1 = value;
    }
  }
  if (ts === null || !h1) return null;
  return { ts, h1 };
}

export async function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string,
  /** Test edilebilirlik için; gerçek çağrıda Date.now() kullanılır. */
  nowSeconds: number = Math.floor(Date.now() / 1000),
  /** Doğrulama anahtarı; verilmezse PADDLE_WEBHOOK_SECRET kullanılır. */
  secret: string =
    process.env["PADDLE_WEBHOOK_SECRET_KEY"] ?? process.env["PADDLE_WEBHOOK_SECRET"] ?? "",
): Promise<boolean> {
  if (!secret) return false;

  const parsed = parsePaddleSignatureHeader(signatureHeader);
  if (!parsed) return false;

  // Replay koruması: zaman damgası çok eskiyse reddet.
  const age = nowSeconds - parsed.ts;
  if (!Number.isFinite(age) || age < -60 || age > PADDLE_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${parsed.ts}:${rawBody}`),
    );
    const expected = [...new Uint8Array(mac)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return timingSafeEqualHex(expected, parsed.h1);
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
