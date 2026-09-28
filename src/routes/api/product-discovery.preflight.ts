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
 * ⚠ TARAYICIDA AÇILMAZ (ölçüldü): `requireUser` `Authorization: Bearer` başlığı
 * zorunlu tutuyor; adres çubuğu bu başlığı gönderemez. Bu uç, JWT ile çağıran
 * istemciler (curl, sunucu) içindir. Tarayıcıdaki tek yol
 * `getDiscoveryPreflight` sunucu fonksiyonudur; arama ekranı hat kurulamayınca
 * onu kendiliğinden çağırır. Başlıksız istekte aşağıdaki ipucu döner ki
 * kullanıcı aynı 401'i tekrar tekrar görmesin.
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
        // Başlık yoksa anlamlı bir 401 döndür: kullanıcı "giriş yap" deyip
        // aynı sayfayı tekrar açmasın, neden açılamadığını görsün.
        if (!request.headers.get("authorization")) {
          return new Response(
            JSON.stringify({
              error: "Bu uç tarayıcı adresinden açılamaz.",
              hint: "Oturum jetonu başlığı ister. Uygulama içindeki teşhis aynı bilgiyi gösterir.",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
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
