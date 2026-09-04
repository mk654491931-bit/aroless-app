import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPaddleCheckout, getPaddleEnv } from "@/lib/paddle.server";
import type { PaddlePlan } from "@/lib/paddle.server";

/** @deprecated Use paddle-checkout server route instead. Kept for backward compatibility. */

const InputSchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]),
  promoCode: z.string().trim().min(1).max(32).optional(),
});

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const paddleEnv = getPaddleEnv();
    if (!paddleEnv) {
      throw new Error("Ödeme sistemi yapılandırılmamış. Lütfen yöneticiyle iletişime geçin.");
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    // Promosyon kodu doğrulama
    let discountPct = 0;
    if (data.promoCode) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: promoRow } = await supabaseAdmin
        .from("promo_codes")
        .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
        .eq("code", data.promoCode.trim().toUpperCase())
        .maybeSingle();
      if (
        promoRow &&
        promoRow.active &&
        (!promoRow.expires_at || new Date(promoRow.expires_at) >= new Date()) &&
        (promoRow.max_redemptions === null ||
          promoRow.max_redemptions === undefined ||
          promoRow.times_redeemed < promoRow.max_redemptions)
      ) {
        discountPct = promoRow.discount_pct;
      }
    }

    const url = await createPaddleCheckout({
      userId: context.userId,
      email: profile?.email,
      plan: data.plan as PaddlePlan,
      redirectUrl: process.env.APP_URL || undefined,
      discountPct,
      promoCode: data.promoCode?.trim().toUpperCase() || undefined,
    });
    return { url, discountPct };
  });
