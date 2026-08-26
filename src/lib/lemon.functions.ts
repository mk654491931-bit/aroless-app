import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLemonCheckout } from "@/lib/lemonsqueezy.server";

const InputSchema = z.object({ plan: z.enum(["Starter", "Pro", "Business"]) });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const url = await createLemonCheckout({
      userId: context.userId,
      email: profile?.email,
      plan: data.plan,
      redirectUrl: process.env.APP_URL || undefined,
    });
    return { url };
  });
