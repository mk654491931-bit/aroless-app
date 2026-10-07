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
      /**
       * GET — ucun CANLI olduğunu doğrulamak için.
       *
       * NEDEN VAR: "Paddle abonelik başladı diyor ama uygulamada başlamıyor"
       * belirtisinin en sık sebebi, panelde yazılı adresin 404 dönmesi ya da
       * imza sırrının eksik olmasıdır; ikisi de sessizdir. Tarayıcıdan bu adres
       * açıldığında `configured: true` görünüyorsa adres doğru ve imza sırrı
       * tanımlı demektir. SIR YAYINLANMAZ — yalnız boolean ve adresin kendisi.
       */
      GET: async () => {
        const { paddleSetupStatus } = await import("@/lib/paddle.server");
        const status = paddleSetupStatus();
        return Response.json(
          {
            ok: true,
            endpoint: "/api/public/webhook/paddle",
            alias: "/api/webhooks/paddle",
            // `configured: false` ise `missingEnv` HANGİ değişkenin eksik olduğunu
            // adıyla söyler; webhook bu durumda 500 döner ve Paddle yeniden dener.
            configured: status.ready,
            environment: status.environment,
            missingEnv: status.missingEnv,
            // Hiç fiyat/ürün kimliği olmayan planlar satılamaz + webhook onları
            // çözemez. Boş olması beklenir.
            missingPlanAssets: status.missingPlanAssets,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const { handlePaddleWebhook } = await import("@/lib/paddle-webhook.server");
        return handlePaddleWebhook(request);
      },
    },
  },
});
