// NOTE: do not statically import the webhook handler's Paddle SDK here — this
// route module is also evaluated client-side while the route tree is built.
// The handler is pulled in with a dynamic import inside the request path.
import { createFileRoute } from "@tanstack/react-router";

/**
 * KANONİK Paddle webhook yolu — belgelenen adres budur:
 *   https://<origin>/api/public/webhook/paddle
 *
 * İş mantığı `@/lib/paddle-webhook.server` içindedir; aynı işleyici
 * `/api/webhooks/paddle` uyumluluk yolundan da çağrılır.
 */
export const Route = createFileRoute("/api/public/webhook/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePaddleWebhook } = await import("@/lib/paddle-webhook.server");
        return handlePaddleWebhook(request);
      },
    },
  },
});
