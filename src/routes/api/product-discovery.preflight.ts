/**
 * GET /api/product-discovery/preflight — Hat çalışmaya hazır mı?
 *
 * NEDEN BU UÇ VAR (ölçülen olgu): ürün arama ekranı yeni hattı dener,
 * başlatılamazsa klasik hatta düşüyordu — ve sebebi KULLANICIYA HİÇ
 * ULAŞMIYORDU. Ekranda "5 ürün" görünürken gerçekte hat hiç çalışmamış
 * olabiliyordu. Bu uç, hat için gereken ÜÇ bağımsız koşulu (QStash jetonu,
 * imza anahtarı, Supabase servis rolü + migration) tek istekte denetler ve
 * her eksik için NE YAPILACAK yazar.
 *
 * GÜVENLİK:
 *   • Oturum zorunlu (`requireUser`) — kurum yapısını herkese açmıyoruz.
 *   • HİÇBİR sır döndürülmez: yalnız anahtarın VAR/YOK durumu, kontrol
 *     etiketleri ve Supabase'in HATA METNİ (anahtar değeri içermez).
 *
 * `Cache-Control: no-store`: bu cevap ortam durumunu yansıtır; önbelleğe
 * alınırsa kullanıcı anahtarı ekledikten sonra "yine eksik" görür.
 */
import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/api-guard.server";
import { runDiscoveryPreflight } from "@/lib/product-discovery-preflight.server";

export const Route = createFileRoute("/api/product-discovery/preflight")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireUser(request);
        if ("response" in guard) return guard.response;

        // Bu uç asla HATA FIRLATMAZ: teşhis aracının kendisi çökerse
        // kullanıcı "kontrol çalışmıyor" diye kalır ve asıl arıza gizlenir.
        // Bu yüzden yakalanır ve 200 ile "kontrol edilemedi" cevabı döner.
        try {
          const report = await runDiscoveryPreflight();
          return new Response(JSON.stringify(report), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              ok: false,
              checks: [],
              summary: "Kontrol edilemedi",
              error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
