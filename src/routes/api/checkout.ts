import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { sanitizeLine } from "@/lib/request-hygiene";

const BodySchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]).default("Pro"),
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Oturum açmış kullanıcı için Paddle overlay checkout oturumu üretir.
 * Yanıt: { transactionId, clientToken, environment, ... } — istemci bu veriyle
 * Paddle.js overlay'ini açar. Client token yalnızca Paddle tarafında sınırlı
 * yetkiye sahiptir (public by design), API anahtarı asla buraya dönmez.
 */
export const Route = createFileRoute("/api/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
          if (!token) return json({ error: "Unauthorized" }, 401);

          const supabase = createClient<Database>(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_PUBLISHABLE_KEY"]!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const { data: userData, error } = await supabase.auth.getUser(token);
          if (error || !userData.user) return json({ error: "Unauthorized" }, 401);

          const rawBody = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
          const sanitizedPlan = sanitizeLine(rawBody["plan"], 20);
          const parsed = BodySchema.safeParse({
            ...rawBody,
            ...(sanitizedPlan ? { plan: sanitizedPlan } : {}),
          });
          if (!parsed.success) {
            return json({ error: "Geçersiz istek: plan Starter/Pro/Business olmalı." }, 400);
          }

          const { createPaddleCheckoutSession } = await import("@/lib/paddle.server");
          const session = await createPaddleCheckoutSession({
            userId: userData.user.id,
            email: userData.user.email,
            plan: parsed.data.plan,
          });

          return json(
            {
              transactionId: session.transactionId,
              clientToken: session.clientToken,
              environment: session.environment,
              plan: session.plan,
              priceId: session.priceId,
              amountCents: session.amountCents,
              currency: session.currency,
              email: userData.user.email,
            },
            200,
          );
        } catch (e) {
          console.error("[Checkout] Failed to create Paddle session:", e);
          return json({ error: "Checkout oturumu oluşturulamadı." }, 500);
        }
      },
    },
  },
});
