import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/lemonsqueezy-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const signature = request.headers.get("x-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sigBuf = Buffer.from(signature, "hex");
        const expBuf = Buffer.from(expected, "hex");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const eventName: string = payload?.meta?.event_name ?? "";
        const custom = payload?.meta?.custom_data ?? {};
        const userId: string | undefined = custom.user_id;
        const plan: string | undefined = custom.plan;
        const attrs = payload?.data?.attributes ?? {};
        const customerId = attrs.customer_id ? String(attrs.customer_id) : null;
        const subscriptionId = payload?.data?.id ? String(payload.data.id) : null;

        // Only credit on successful subscription creation or renewal payment
        const shouldCredit =
          eventName === "subscription_created" ||
          eventName === "subscription_payment_success" ||
          eventName === "order_created";

        if (!shouldCredit || !userId || !plan) {
          return new Response("ok", { status: 200 });
        }

        const tier = plan === "Business" ? "Business" : plan === "Pro" ? "Pro" : "Starter";
        const credits = tier === "Business" ? 50 : tier === "Pro" ? 15 : 8;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("apply_subscription_credits", {
          _user_id: userId,
          _tier: tier,
          _credits: credits,
          _customer_id: customerId ?? "",
          _subscription_id: subscriptionId ?? "",
        });
        if (error) return new Response(error.message, { status: 500 });

        // Record transaction
        const totalCents = Number(attrs.total ?? attrs.total_usd ?? 0) || (tier === "Business" ? 19900 : tier === "Pro" ? 5900 : 3900);
        const currency = String(attrs.currency ?? "USD");
        const paymentMethod = String(attrs.card_brand ?? attrs.payment_method ?? "card");
        const userEmail = String(attrs.user_email ?? attrs.email ?? "");
        await supabaseAdmin.from("transactions").insert({
          user_id: userId,
          email: userEmail || null,
          tier,
          amount_cents: totalCents,
          currency,
          payment_method: paymentMethod,
          provider: "lemonsqueezy",
          provider_event: eventName,
          external_id: subscriptionId,
        });

        // Promosyon kodu dönüşümünü işaretle (admin panel istatistikleri için).
        await supabaseAdmin
          .from("promo_redemptions")
          .update({
            purchased_tier: tier,
            purchased_at: new Date().toISOString(),
            amount_cents: totalCents,
          })
          .eq("user_id", userId);


        return new Response("ok", { status: 200 });
      },
    },
  },
});
