import { createFileRoute } from "@tanstack/react-router";
import {
  MAX_PAYLOAD_BYTES,
  processPaddleWebhook,
  type SupabaseLike,
} from "@/lib/paddle-webhook-core";
import { guardPublic } from "@/lib/api-guard.server";

/**
 * Paddle Billing v2 webhook handler (canonical URL).
 *
 * Paddle dashboard'da bu URL'yi webhook endpoint olarak kaydedin:
 *   POST https://<your-domain>/api/public/paddle-webhook
 *
 * Tüm mantık (imza doğrulama, olay yönetimi, Supabase senkronizasyonu,
 * idempotency, loglama) platform-bağımsız çekirdekte yaşar:
 *   @/lib/paddle-webhook-core
 *
 * Vercel fonksiyonu (api/webhook.ts) da aynı çekirdeği kullanır.
 */

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
        try {
          // 1. Rate limit (IP tabanlı; imza doğrulamadan önce ucuz koruma)
          const rateLimited = await guardPublic(request, "paddle-webhook", 120, 60);
          if (rateLimited) return rateLimited;

          // 2. Payload boyut kontrolü
          const contentLength = Number(request.headers.get("content-length") ?? 0);
          if (contentLength > MAX_PAYLOAD_BYTES) return json({ error: "Payload too large" }, 413);

          const raw = await request.text();
          if (raw.length > MAX_PAYLOAD_BYTES) return json({ error: "Payload too large" }, 413);

          // 3. Çekirdeğe devret (çekirdek platform-bağımsızdır; yalnızca
          //    SupabaseLike yüzeyini kullanır, tipli client cast edilir)
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await processPaddleWebhook({
            raw,
            signatureHeader: request.headers.get("paddle-signature") ?? "",
            supabase: supabaseAdmin as unknown as SupabaseLike,
          });
          return json(result.body, result.status);
        } catch (e) {
          console.error("[paddle-webhook] handler error", e);
          return json({ error: "Webhook processing failed" }, 500);
        }
      },
    },
  },
});
