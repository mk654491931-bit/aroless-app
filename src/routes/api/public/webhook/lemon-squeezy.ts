import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

type LemonPayload = {
  meta?: { event_name?: string; custom_data?: { user_id?: string; plan?: string } };
  data?: { id?: string; attributes?: Record<string, unknown> };
};

/** Abonelik durumunu (PRO / FREE) senkronize eden imzalı webhook. */
export const Route = createFileRoute("/api/public/webhook/lemon-squeezy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { lemonWebhookSecret } = await import("@/lib/lemonsqueezy.server");
        const secret = lemonWebhookSecret();
        if (!secret) return new Response("Not configured", { status: 500 });

        const raw = await request.text();
        const signature = request.headers.get("x-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sig = Buffer.from(signature, "hex");
        const exp = Buffer.from(expected, "hex");
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: LemonPayload;
        try {
          payload = JSON.parse(raw) as LemonPayload;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const event = payload.meta?.event_name ?? "";
        const userId = payload.meta?.custom_data?.user_id;
        const plan = payload.meta?.custom_data?.plan ?? "Pro";
        const attrs = payload.data?.attributes ?? {};
        const status = String(attrs["status"] ?? "");
        if (!userId) return new Response("ok", { status: 200 });

        let tier: string | null = null;
        switch (event) {
          case "subscription_created":
            tier = plan;
            break;
          case "subscription_updated":
            // active / on_trial → plan aktif; diğer her durum ücretsize düşer.
            tier = status === "active" || status === "on_trial" ? plan : "Free";
            break;
          case "subscription_cancelled":
          case "subscription_expired":
            tier = "Free";
            break;
          default:
            return new Response("ok", { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({
            subscription_tier: tier,
            lemon_subscription_id: payload.data?.id ? String(payload.data.id) : null,
            lemon_customer_id: attrs["customer_id"] ? String(attrs["customer_id"]) : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        if (error) return new Response(error.message, { status: 500 });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
