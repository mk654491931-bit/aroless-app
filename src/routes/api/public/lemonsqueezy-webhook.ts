import { createFileRoute } from "@tanstack/react-router";
import { verifyPaddleWebhook, getPaddleEnv } from "@/lib/paddle.server";
import { guardPublic } from "@/lib/api-guard.server";

type PaddleEvent = {
  event_id?: string;
  event_type?: string;
  data?: {
    id?: string;
    status?: string;
    customer?: { email?: string; id?: string };
    custom_data?: { user_id?: string; plan?: string };
    items?: Array<{
      price?: { id?: string; name?: string; product_id?: string };
      quantity?: number;
    }>;
    totals?: { total?: string; currency?: string };
    subscription_id?: string;
    billing_period?: { start?: string; finish?: string };
  };
};

/**
 * Paddle Billing v2 webhook handler.
 * Abonelik durumunu (PRO / Starter / Business / Free) senkronize eder.
 * shadow_transaction veya subscription.created/updated/cancelled/events about.
 */
export const Route = createFileRoute("/api/public/lemonsqueezy-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Rate limit (IP-based, herkese açık webhook)
        const rateLimited = await guardPublic(request, "lemonsqueezy-webhook", 120, 60);
        if (rateLimited) return rateLimited;

        const paddleEnv = getPaddleEnv();
        if (!paddleEnv) return new Response("Not configured", { status: 500 });

        // Boyut kontrolü
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return new Response("Payload too large", { status: 413 });

        const raw = await request.text();
        if (raw.length > 1_000_000) return new Response("Payload too large", { status: 413 });

        // Paddle v2 webhook imza doğrulama
        const signatureHeader = request.headers.get("paddle-signature") ?? "";
        if (!signatureHeader) {
          return new Response("Missing signature", { status: 401 });
        }

        const validSignature = await verifyPaddleWebhook(raw, signatureHeader);
        if (!validSignature) {
          console.error("[paddle-webhook] invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: PaddleEvent;
        try {
          payload = JSON.parse(raw) as PaddleEvent;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const eventType = payload.event_type ?? "";
        const data = payload.data ?? {};

        // Webhook verilerinden user_id ve plan bilgisini çıkar
        const userId = data.custom_data?.user_id;
        const plan = data.custom_data?.plan;

        // UUID format kontrolü
        if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
          return new Response("Bad user id", { status: 400 });
        }

        // Event tipine göre tier belirleme
        let tier: string | null = null;
        let shouldCredit = false;

        switch (eventType) {
          case "transaction.completed":
          case "subscription.created":
            tier = plan ?? "Pro";
            shouldCredit = true;
            break;
          case "subscription.updated":
            // subscription updated → duruma göre tier
            tier = plan ?? "Pro";
            shouldCredit = true;
            break;
          case "subscription.canceled":
          case "subscription.expired":
            tier = "Free";
            break;
          case "subscription.past_due":
          case "subscription.paused":
            tier = "Free";
            break;
          default:
            // Bilinmeyen event türlerini sessizce kabul et
            return new Response("ok", { status: 200 });
        }

        if (!userId) {
          return new Response("ok", { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Profili güncelle
        if (tier) {
          const { error } = await supabaseAdmin
            .from("profiles")
            .update({
              subscription_tier: tier,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
          if (error) {
            console.error("[paddle-webhook] profile update failed", error);
            return new Response("Webhook işlenemedi", { status: 500 });
          }
        }

        // Kredi uygula
        if (shouldCredit && tier && tier !== "Free") {
          const tierCredits =
            tier === "Business" ? 50 : tier === "Pro" ? 15 : tier === "Starter" ? 8 : 0;

          try {
            await supabaseAdmin.rpc("apply_subscription_credits", {
              _user_id: userId,
              _tier: tier,
              _credits: tierCredits,
              _customer_id: data.customer?.id ?? "",
              _subscription_id: data.subscription_id ?? data.id ?? "",
            });
          } catch (e) {
            console.error("[paddle-webhook] credit application failed", e);
          }

          // Transaction kaydı
          const totalCents = Math.round((parseFloat(data.totals?.total ?? "0") || 0) * 100);
          try {
            await supabaseAdmin.from("transactions").insert({
              user_id: userId,
              email: data.customer?.email ?? null,
              tier,
              amount_cents:
                totalCents ||
                (tier === "Business"
                  ? 19900
                  : tier === "Pro"
                    ? 5900
                    : tier === "Starter"
                      ? 3900
                      : 0),
              currency: data.totals?.currency ?? "USD",
              payment_method: "card",
              provider: "paddle",
              provider_event: eventType,
              external_id: data.subscription_id ?? data.id ?? null,
            });
          } catch (e) {
            console.error("[paddle-webhook] transaction record failed", e);
          }

          // Promosyon kodu dönüşümünü işaretle
          await supabaseAdmin
            .from("promo_redemptions")
            .update({
              purchased_tier: tier,
              purchased_at: new Date().toISOString(),
              amount_cents:
                totalCents || (tier === "Business" ? 19900 : tier === "Pro" ? 5900 : 3900),
            })
            .eq("user_id", userId);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
