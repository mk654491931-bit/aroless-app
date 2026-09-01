import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyPaddleWebhook, getPaddleEnv } from "@/lib/paddle.server";
import { guardPublic } from "@/lib/api-guard.server";

/**
 * Paddle Billing v2 webhook handler (canonical URL).
 * Abonelik durumunu (Pro / Starter / Business / Free) senkronize eder.
 *
 * Paddle dashboard'unda bu URL'yi webhook endpoint olarak kaydedin:
 *   /api/public/paddle-webhook
 *
 * Geriye dönük uyumluluk için eski /lemonsqueezy-webhook endpoint'i
 * korunmaya devam etmektedir.
 */

const MAX_PAYLOAD_BYTES = 1_000_000;

const PaddleEventSchema = z.object({
  event_id: z.string().optional(),
  event_type: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      customer: z
        .object({
          email: z.string().optional(),
          id: z.string().optional(),
        })
        .optional(),
      custom_data: z
        .object({
          user_id: z.string().optional(),
          plan: z.string().optional(),
        })
        .optional(),
      items: z
        .array(
          z.object({
            price: z
              .object({
                id: z.string().optional(),
                name: z.string().optional(),
                product_id: z.string().optional(),
              })
              .optional(),
            quantity: z.number().optional(),
          }),
        )
        .optional(),
      totals: z
        .object({
          total: z.string().optional(),
          currency: z.string().optional(),
        })
        .optional(),
      subscription_id: z.string().optional(),
      billing_period: z
        .object({
          start: z.string().optional(),
          finish: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

type PaddleEvent = z.infer<typeof PaddleEventSchema>;

/** UUID formatı kontrolü — injection engellemek için. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/public/paddle-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Rate limit (IP-based, herkese açık webhook)
        const rateLimited = await guardPublic(request, "paddle-webhook", 120, 60);
        if (rateLimited) return rateLimited;

        // 2. Paddle yapılandırması kontrolü
        const paddleEnv = getPaddleEnv();
        if (!paddleEnv) return json({ error: "Not configured" }, 500);

        // 3. Payload boyut kontrolü
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_PAYLOAD_BYTES)
          return json({ error: "Payload too large" }, 413);

        const raw = await request.text();
        if (raw.length > MAX_PAYLOAD_BYTES)
          return json({ error: "Payload too large" }, 413);

        // 4. Webhook imza doğrulama (Paddle v2 HMAC-SHA256)
        const signatureHeader = request.headers.get("paddle-signature") ?? "";
        if (!signatureHeader) {
          return json({ error: "Missing signature" }, 401);
        }

        const validSignature = await verifyPaddleWebhook(raw, signatureHeader);
        if (!validSignature) {
          console.error("[paddle-webhook] invalid signature");
          return json({ error: "Invalid signature" }, 401);
        }

        // 5. JSON parse + Zod doğrulama
        let payload: PaddleEvent;
        try {
          const parsed: unknown = JSON.parse(raw);
          payload = PaddleEventSchema.parse(parsed);
        } catch {
          return json({ error: "Bad JSON or invalid schema" }, 400);
        }

        const eventType = payload.event_type ?? "";
        const data = payload.data ?? {};
        const customData = data.custom_data ?? {};

        // 6. UUID format kontrolü — injection engellemek için
        const userId = customData.user_id;
        if (userId && !UUID_REGEX.test(userId)) {
          return json({ error: "Bad user id" }, 400);
        }

        const plan = customData.plan;

        // 7. Event tipine göre tier belirleme
        let tier: string | null = null;
        let shouldCredit = false;

        switch (eventType) {
          case "transaction.completed":
          case "subscription.created":
            tier = (plan as string) ?? "Pro";
            shouldCredit = true;
            break;
          case "subscription.updated":
            tier = (plan as string) ?? "Pro";
            shouldCredit = true;
            break;
          case "subscription.canceled":
          case "subscription.expired":
          case "subscription.past_due":
          case "subscription.paused":
            tier = "Free";
            break;
          default:
            // Bilinmeyen event türlerini sessizce kabul et
            return json({ ok: true }, 200);
        }

        if (!userId) {
          return json({ ok: true }, 200);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 8. Profili güncelle
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
            return json({ error: "Webhook işlenemedi" }, 500);
          }
        }

        // 9. Kredi uygula
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
          const totalCents = Math.round(
            (parseFloat(data.totals?.total ?? "0") || 0) * 100,
          );
          try {
            await supabaseAdmin.from("transactions").insert({
              user_id: userId,
              email: data.customer?.email ?? null,
              tier,
              amount_cents:
                totalCents ||
                (tier === "Business" ? 19900 : tier === "Pro" ? 5900 : tier === "Starter" ? 3900 : 0),
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
                totalCents ||
                (tier === "Business" ? 19900 : tier === "Pro" ? 5900 : 3900),
            })
            .eq("user_id", userId);
        }

        return json({ ok: true }, 200);
      },
    },
  },
});
