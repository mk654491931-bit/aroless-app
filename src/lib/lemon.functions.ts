import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ plan: z.enum(["Starter", "Pro", "Business"]) });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const variantId =
      data.plan === "Starter"
        ? process.env.LEMONSQUEEZY_STARTER_VARIANT_ID
        : data.plan === "Pro"
          ? process.env.LEMONSQUEEZY_PRO_VARIANT_ID
          : process.env.LEMONSQUEEZY_BUSINESS_VARIANT_ID;
    if (!apiKey || !storeId || !variantId) throw new Error("Lemon Squeezy not configured");

    // Get user email
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const body = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: profile?.email ?? undefined,
            custom: { user_id: context.userId, plan: data.plan },
          },
          product_options: { redirect_url: process.env.APP_URL || "" },
        },
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    };

    const resp = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Lemon Squeezy error: ${resp.status} ${t.slice(0, 300)}`);
    }
    const json = (await resp.json()) as { data?: { attributes?: { url?: string } } };
    const url = json.data?.attributes?.url;
    if (!url) throw new Error("No checkout URL returned");
    return { url };
  });
