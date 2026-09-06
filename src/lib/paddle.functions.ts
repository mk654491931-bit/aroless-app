import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]).default("Pro"),
});

/**
 * Oturum açmış kullanıcı için sunucu tarafında bir Paddle transaction oluşturur
 * ve overlay checkout'u açmak için gereken oturum bilgisini döner.
 *
 * customData (userId + plan) transaction'a SUNUCUDA yazılır — istemci müdahale
 * edemez; Paddle bu veriyi aboneliğe ve yenileme ödemelerine kopyalar, böylece
 * webhook her ödemeyi doğru kullanıcıya bağlayabilir.
 */
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createPaddleCheckoutSession } = await import("@/lib/paddle.server");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const session = await createPaddleCheckoutSession({
      userId: context.userId,
      email: profile?.email ?? null,
      plan: data.plan,
    });

    return {
      transactionId: session.transactionId,
      clientToken: session.clientToken,
      environment: session.environment,
      plan: session.plan,
      priceId: session.priceId,
      amountCents: session.amountCents,
      currency: session.currency,
      email: profile?.email ?? null,
    };
  });
