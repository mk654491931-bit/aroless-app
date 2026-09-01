/**
 * Geriye dönük uyumluluk köprüsü — eski import'ları Paddle'a yönlendirir.
 * Tüm yeni kod paddle.server.ts import etmelidir.
 */

export type LemonEnv = {
  apiKey: string;
  storeId: string;
  variantId: string;
};

/** Artık kullanılmıyor — Paddle'a geçildi. Null döner. */
export function lemonEnv(_plan?: "Pro" | "Starter" | "Business"): LemonEnv | null {
  return null;
}

/** Artık kullanılmıyor — Paddle'a geçildi. Undefined döner. */
export function lemonWebhookSecret(): string | undefined {
  return undefined;
}

/**
 * Geriye dönük uyumluluk — Paddle checkout'a yönlendirir.
 */
export async function createLemonCheckout(opts: {
  userId: string;
  email?: string | null;
  plan?: "Pro" | "Starter" | "Business";
  redirectUrl?: string;
}): Promise<string> {
  const { createPaddleCheckout, getPaddleEnv } = await import("@/lib/paddle.server");
  const env = getPaddleEnv();
  if (!env) throw new Error("Paddle yapılandırılmamış.");
  return createPaddleCheckout({
    userId: opts.userId,
    email: opts.email,
    plan: opts.plan ?? "Pro",
    redirectUrl: opts.redirectUrl,
  });
}
