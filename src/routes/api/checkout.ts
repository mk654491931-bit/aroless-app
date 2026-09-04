import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { createPaddleCheckout, getPaddleEnv } from "@/lib/paddle.server";

const BodySchema = z.object({
  plan: z.enum(["Starter", "Pro", "Business"]).default("Pro"),
  redirectUrl: z.string().url().max(500).optional(),
  promoCode: z.string().trim().min(1).max(32).optional(),
});

/** Oturum açmış kullanıcı için Paddle ödeme bağlantısı üretir. */
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

          const paddleEnv = getPaddleEnv();
          if (!paddleEnv) {
            return json({ error: "Ödeme sistemi yapılandırılmamış." }, 500);
          }

          const body = BodySchema.parse(await request.json().catch(() => ({})));

          // Promosyon kodu doğrulama
          let discountPct = 0;
          if (body.promoCode) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: promoRow } = await supabaseAdmin
              .from("promo_codes")
              .select("discount_pct, active, expires_at, max_redemptions, times_redeemed")
              .eq("code", body.promoCode.trim().toUpperCase())
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
            userId: userData.user.id,
            email: userData.user.email,
            plan: body.plan,
            redirectUrl: body.redirectUrl ?? new URL(request.url).origin + "/settings",
            discountPct,
            promoCode: body.promoCode?.trim().toUpperCase() || undefined,
          });
          return json({ url, discountPct }, 200);
        } catch {
          return json({ error: "Ödeme bağlantısı oluşturulamadı. Lütfen tekrar deneyin." }, 500);
        }
      },
    },
  },
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
