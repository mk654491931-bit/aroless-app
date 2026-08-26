/** Lemon Squeezy sunucu yardımcıları — ortam okuma, checkout, imza doğrulama. */

export type LemonEnv = {
  apiKey: string;
  storeId: string;
  variantId: string;
};

/** Yeni (LEMON_SQUEEZY_*) ve eski (LEMONSQUEEZY_*) isimlendirmeyi birlikte destekler. */
export function lemonEnv(plan: "Pro" | "Starter" | "Business" = "Pro"): LemonEnv | null {
  const apiKey = process.env["LEMON_SQUEEZY_API_KEY"] || process.env["LEMONSQUEEZY_API_KEY"];
  const storeId = process.env["LEMON_SQUEEZY_STORE_ID"] || process.env["LEMONSQUEEZY_STORE_ID"];
  const perPlan =
    plan === "Starter"
      ? process.env["LEMON_SQUEEZY_STARTER_VARIANT_ID"] ||
        process.env["LEMONSQUEEZY_STARTER_VARIANT_ID"]
      : plan === "Business"
        ? process.env["LEMON_SQUEEZY_BUSINESS_VARIANT_ID"] ||
          process.env["LEMONSQUEEZY_BUSINESS_VARIANT_ID"]
        : process.env["LEMON_SQUEEZY_PRO_VARIANT_ID"] || process.env["LEMONSQUEEZY_PRO_VARIANT_ID"];
  const variantId =
    perPlan || process.env["LEMON_SQUEEZY_VARIANT_ID"] || process.env["LEMONSQUEEZY_VARIANT_ID"];
  if (!apiKey || !storeId || !variantId) return null;
  return { apiKey, storeId, variantId };
}

export function lemonWebhookSecret(): string | undefined {
  return process.env["LEMON_SQUEEZY_WEBHOOK_SECRET"] || process.env["LEMONSQUEEZY_WEBHOOK_SECRET"];
}

/** Kullanıcıya bağlı bir Lemon Squeezy ödeme bağlantısı üretir. */
export async function createLemonCheckout(opts: {
  userId: string;
  email?: string | null;
  plan?: "Pro" | "Starter" | "Business";
  redirectUrl?: string;
}): Promise<string> {
  const plan = opts.plan ?? "Pro";
  const env = lemonEnv(plan);
  if (!env) throw new Error("Lemon Squeezy yapılandırılmamış (API key / store / variant eksik).");

  const body = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: opts.email ?? undefined,
          custom: { user_id: opts.userId, plan },
        },
        checkout_options: { embed: false, dark: true },
        product_options: opts.redirectUrl ? { redirect_url: opts.redirectUrl } : {},
      },
      relationships: {
        store: { data: { type: "stores", id: String(env.storeId) } },
        variant: { data: { type: "variants", id: String(env.variantId) } },
      },
    },
  };

  const resp = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${env.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Lemon Squeezy ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const json = (await resp.json()) as { data?: { attributes?: { url?: string } } };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Checkout bağlantısı alınamadı.");
  return url;
}
