import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CheckoutSession } from "@/lib/paddle.server";

const InputSchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]).default("Pro"),
});
export type CreateCheckoutResponse =
  | {
      ok: true;
      transactionId: string;
      clientToken: string;
      environment: "sandbox" | "production";
      plan: "Starter" | "Pro" | "Business";
      priceId: string;
      amountCents: number;
      currency: string;
      email: string | null;
    }
  | {
      ok: false;
      error: true;
      plan: "Starter" | "Pro" | "Business";
      misconfigured: boolean;
      paddleMessage?: string | null;
      message: string;
      email: string | null;
    };

/**
 * Oturum açmış kullanıcı için sunucu tarafında bir Paddle transaction oluşturur
 * ve overlay checkout'u açmak için gereken oturum bilgisini döner.
 *
 * customData (userId + plan) transaction'a SUNUCUDA yazılır — istemci müdahale
 * edemez; Paddle bu veriyi aboneliğe ve yenileme ödemelerine kopyalar, böylece
 * webhook her ödemeyi doğru kullanıcıya bağlayabilir.
 *
 * Paddle transaction oluşturulamadığında (örneğin.Checkout Settings / varsayılan
 * payment link eksikliği veya yanlış plan price ID) 400-benzeri bir rejection
 * alınırsa, UI'nin "pencere açılıyor..." durumunda takılması yerine yerel bir
 * hata mesajı gösterebilmesi için `{ ok: false, error: true, ... }` döner.
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

    if ("error" in session && session.error) {
      const paddleMessage =
        typeof (session as { paddleMessage?: unknown }).paddleMessage === "string"
          ? (session as { paddleMessage: string }).paddleMessage
          : null;
      const sessionPlan =
        typeof (session as { plan?: unknown }).plan === "string"
          ? (session as { plan: string }).plan
          : "Pro";

      const isMisconfigured =
        typeof paddleMessage === "string" &&
        paddleMessage.toLowerCase().includes("no default payment link");

      return {
        ok: false,
        error: true,
        plan: sessionPlan as "Starter" | "Pro" | "Business",
        misconfigured: isMisconfigured,
        paddleMessage,
        message:
          typeof (session as { message?: unknown }).message === "string"
            ? (session as { message: string }).message
            : "Ödeme başlatılamadı. Paddle ayarlarınızı kontrol edin.",
        email: profile?.email ?? null,
      };
    }

    const typed = session as unknown as CheckoutSession;
    return {
      ok: true,
      transactionId: typed.transactionId,
      clientToken: typed.clientToken,
      environment: typed.environment,
      plan: typed.plan,
      priceId: typed.priceId,
      amountCents: typed.amountCents,
      currency: typed.currency,
      email: profile?.email ?? null,
    };
  });
