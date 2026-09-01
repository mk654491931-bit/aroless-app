import { createFileRoute } from "@tanstack/react-router";
import { verifyPaddleWebhook, getPaddleEnv } from "@/lib/paddle.server";

/**
 * Alternatif Paddle webhook endpoint (URL uyumluluğu için).
 * Ana webhook handler ile aynı mantığı çalıştırır.
 */
export const Route = createFileRoute("/api/public/webhook/lemon-squeezy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const paddleEnv = getPaddleEnv();
        if (!paddleEnv) return new Response("Not configured", { status: 500 });

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return new Response("Payload too large", { status: 413 });

        const raw = await request.text();
        if (raw.length > 1_000_000) return new Response("Payload too large", { status: 413 });

        // Webhook imza doğrulama
        const signatureHeader = request.headers.get("paddle-signature") ?? "";
        if (!signatureHeader) {
          return new Response("Missing signature", { status: 401 });
        }

        const validSignature = await verifyPaddleWebhook(raw, signatureHeader);
        if (!validSignature) {
          console.error("[paddle-webhook-alt] invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const eventType = String(payload.event_type ?? "");
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const customData = (data.custom_data ?? {}) as Record<string, unknown>;

        const userId = typeof customData.user_id === "string" ? customData.user_id : undefined;
        const plan = typeof customData.plan === "string" ? customData.plan : undefined;

        if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
          return new Response("Bad user id", { status: 400 });
        }
        if (!userId) return new Response("ok", { status: 200 });

        // Tier belirleme
        let tier: string | null = null;
        switch (eventType) {
          case "subscription.created":
          case "transaction.completed":
            tier = plan ?? "Pro";
            break;
          case "subscription.updated":
            tier = plan ?? "Pro";
            break;
          case "subscription.canceled":
          case "subscription.expired":
          case "subscription.paused":
          case "subscription.past_due":
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
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        if (error) {
          console.error("[paddle-webhook-alt] profile update failed", error);
          return new Response("Webhook işlenemedi", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
