import { createFileRoute } from "@tanstack/react-router";

type PaddleWebhookPayload = {
  eventId?: string;
  eventType?: string;
  data?: {
    id?: string;
    status?: string;
    customData?: { userId?: string; plan?: string };
    customerId?: string;
  };
};

/**
 * Paddle Billing v2 webhook handler
 * Subscription events'ı dinle ve profile'ı güncelle
 */
export const Route = createFileRoute("/api/public/webhook/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Webhook secret'ı yükle
        const { paddleEnv, verifyPaddleWebhookSignature, getPaddleSubscriptionTier } =
          await import("@/lib/paddle.server");

        const env = paddleEnv();
        if (!env) {
          console.error("[Paddle Webhook] Paddle not configured");
          return new Response("Paddle not configured", { status: 500 });
        }

        // 2. Payload boyutu kontrolü (Dos protection)
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) {
          return new Response("Payload too large", { status: 413 });
        }

        // 3. Raw body'yi oku
        const raw = await request.text();
        if (raw.length > 1_000_000) {
          return new Response("Payload too large", { status: 413 });
        }

        // 4. Signature doğrulaması (Paddle-Signature header)
        const paddleSignature = request.headers.get("paddle-signature") ?? "";
        if (!verifyPaddleWebhookSignature(raw, paddleSignature, env.webhookSecret)) {
          console.warn("[Paddle Webhook] Invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        // 5. JSON parse
        let payload: PaddleWebhookPayload;
        try {
          payload = JSON.parse(raw) as PaddleWebhookPayload;
        } catch (e) {
          console.error("[Paddle Webhook] JSON parse error:", e);
          return new Response("Bad JSON", { status: 400 });
        }

        // 6. Event tipi ve data'yı çıkart
        const eventType = payload.eventType ?? "";
        const subscriptionId = payload.data?.id;
        const status = payload.data?.status ?? "";
        const userId = payload.data?.customData?.userId;
        const customerId = payload.data?.customerId;
        const plan = payload.data?.customData?.plan ?? "Pro";

        // 7. User ID validasyonu (UUID format)
        if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
          console.warn("[Paddle Webhook] Invalid user ID format:", userId);
          return new Response("Bad user id format", { status: 400 });
        }

        // User ID yoksa webhook'u başarılı kabul et (duplicate prevention)
        if (!userId) {
          return new Response("ok", { status: 200 });
        }

        // 8. Subscription tier'ı belirle
        const tier = getPaddleSubscriptionTier(eventType, status);

        // Bilinmeyen event → başarılı kabul et
        if (tier === null) {
          return new Response("ok", { status: 200 });
        }

        // 9. Database update
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const updateData: Record<string, unknown> = {
          subscription_tier: tier,
          paddle_subscription_id: subscriptionId ?? null,
          paddle_customer_id: customerId ?? null,
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabaseAdmin
          .from("profiles")
          .update(updateData)
          .eq("id", userId);

        if (error) {
          console.error("[Paddle Webhook] Profile update failed:", error);
          return new Response("Update failed", { status: 500 });
        }

        console.log(
          `[Paddle Webhook] ✓ ${eventType} for user ${userId}: tier=${tier}`,
        );

        return new Response("ok", { status: 200 });
      },
    },
  },
});
