// NOTE: do not statically import the webhook handler's Paddle SDK here — this
// route module is also evaluated client-side while the route tree is built.
// The handler is pulled in with a dynamic import inside the request path.
import { createFileRoute } from "@tanstack/react-router";

/**
 * UYUMLULUK YOLU — Paddle panelinde elle yazılan adres.
 *
 * NEDEN VAR: ölçülen 404'ün sebebi buydu. Paddle paneline
 * `/api/webhooks/paddle` yazılmıştı, uygulama ise yalnız
 * `/api/public/webhook/paddle` sunuyordu; istek işleyiciye hiç ulaşmıyordu.
 *
 * Burada İKİNCİ bir uygulama yoktur: `/api/public/webhook/paddle` ile birebir
 * aynı `handlePaddleWebhook` çağrılır. Panelde iki adres tanımlıysa ikisi de
 * çalışır ve aynı `event_id` iki kez geldiğinde veritabanı katmanı
 * (process_paddle_event) bunu zaten tekilleştirir.
 *
 * KANONİK yol `/api/public/webhook/paddle`'dır; panelde onu kullanmak daha
 * doğru, bu yol yalnız kırık yapılandırmayı toparlar.
 */
export const Route = createFileRoute("/api/webhooks/paddle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePaddleWebhook } = await import("@/lib/paddle-webhook.server");
        return handlePaddleWebhook(request);
      },
    },
  },
});
