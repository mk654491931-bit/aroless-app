import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/lemonsqueezy-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return new Response("Payload too large", { status: 413 });

        const signature = request.headers.get("x-signature") ?? "";
        const raw = await request.text();
        if (raw.length > 1_000_000) return new Response("Payload too large", { status: 413 });
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sigBuf = Buffer.from(signature, "hex");
        const expBuf = Buffer.from(expected, "hex");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        if (!isRecord(payload)) return new Response("Bad payload", { status: 400 });
        const meta = isRecord(payload.meta) ? payload.meta : {};
        const custom = isRecord(meta.custom_data) ? meta.custom_data : {};
        const data = isRecord(payload.data) ? payload.data : {};
        const attrs = isRecord(data.attributes) ? data.attributes : {};
        const eventName = typeof meta.event_name === "string" ? meta.event_name : "";
        const userId = typeof custom.user_id === "string" ? custom.user_id : undefined;
        const plan = typeof custom.plan === "string" ? custom.plan : undefined;
        if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
          return new Response("Bad user id", { status: 400 });
        }
        const customerId = attrs.customer_id ? String(attrs.customer_id) : null;
        const subscriptionId = data.id ? String(data.id) : null;

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
        if (error) {
          console.error("[lemon-webhook] credit application failed", error);
          return new Response("Webhook işlenemedi", { status: 500 });
        }

        // Record transaction
        const totalCents =
          Number(attrs.total ?? attrs.total_usd ?? 0) ||
          (tier === "Business" ? 19900 : tier === "Pro" ? 5900 : 3900);
        const currency = String(attrs.currency ?? "USD");
        const paymentMethod = String(attrs.card_brand ?? attrs.payment_method ?? "card");
        const userEmail = String(attrs.user_email ?? attrs.email ?? "");
        const { error: transactionError } = await supabaseAdmin.from("transactions").insert({
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
        if (transactionError) {
          console.error("[lemon-webhook] transaction record failed", transactionError);
        }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
