import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPaddleCheckout, getPaddleEnv } from "@/lib/paddle.server";
import type { PaddlePlan } from "@/lib/paddle.server";

const InputSchema = z.object({ plan: z.enum(["Starter", "Pro", "Business"]) });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const paddleEnv = getPaddleEnv();
    if (!paddleEnv) {
      throw new Error(
        "Ödeme sistemi yapılandırılmamış. Lütfen yöneticiyle iletişime geçin.",
      );
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const url = await createPaddleCheckout({
      userId: context.userId,
      email: profile?.email,
      plan: data.plan as PaddlePlan,
      redirectUrl: process.env.APP_URL || undefined,
    });
    return { url };
  });
