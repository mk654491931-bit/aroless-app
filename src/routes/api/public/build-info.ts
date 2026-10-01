/**
 * GET /api/public/build-info — CANLIDA HANGİ KOD VAR?
 *
 * NEDEN BU UÇ VAR (ölçülen olgu, 2026-10-01):
 *   Düzeltme push edildi (`a083696` / `28fa6eb`), tarayıcı HÂLÂ aynı hatayı
 *   verdi:
 *     "Yeni hat kurulamadı: Hiç kaynak doğrulanabilir ürün döndürmedi."
 *     "Sık görülen nedenler: Supabase servis rolü anahtarı eksik…"
 *   O iki cümle güncel kodda ÜRETİLEMEZ — biri (`Sık görülen nedenler…`)
 *   tamamen silindi, diğeri yeniden yazıldı. Yani ekran ESKİ bundle'ı
 *   çalıştırıyordu veya düzeltme hiç yayına çıkmamıştı.
 *
 *   Build logu istenmeden "canlıda hangi commit var?" sorusunu cevaplamak
 *   için bu uç var. Kullanıcı tarayıcıdan tek adres açıp gerçeği görür.
 *
 * GÜVENLİK: HİÇBİR sır döndürülmez. Yalnız commit SHA'sı ve boolean
 * bayraklar (anahtar var mı). Anahtar DEĞERLERİ, URL'ler veya kullanıcı
 * verisi yok. Bu yüzden `requireUser` YOKTUR — herkese açıktır ve öyle
 * kalmalıdır; aksi halde "hat canlıda mı?" sorusu oturum gerektirir ve
 * teşhis yine kilitlenir.
 *
 * `Cache-Control: no-store`: bu cevap KONUMUN kendisini anlatıyor; önbellek
 * alınırsa eski commit'i "canlı" gösterir ve tam olarak bu uçtan duymak
 * istediğimiz şeyi gizler.
 */
import { createFileRoute } from "@tanstack/react-router";

import { guardPublic, jsonError } from "@/lib/api-guard.server";

/**
 * Fiyat kapısı düzeltmesinin bu derlemede OLUŞTURULMUŞ olduğunun işareti.
 *
 * DÜRÜSTLÜK: bu bayrak "düzeltme çalışıyor" DEMEZ, yalnız "düzeltmenin
 * KODU yayında" der. Kaynakların canlıda veri döndürmesi ve konsey
 * zincirinin bitmesi AYRI konulardır; onları bu uç iddia etmez.
 */
const PRICE_GATE_FIXED = true;

export const Route = createFileRoute("/api/public/build-info")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Hız sınırlayıcı: herkese açık uç, diğer public uçlarla aynı ölçü.
        // Sır döndürmediği için risk düşük, yine de sınırsız çağrıya açık
        // bırakılmaz.
        const limited = await guardPublic(request, "build-info", 60, 60);
        if (limited) return limited;

        const commit =
          process.env["VERCEL_GIT_COMMIT_SHA"] ??
          process.env["COMMIT_SHA"] ??
          process.env["GIT_COMMIT"] ??
          null;

        const hasQstash = !!process.env["QSTASH_TOKEN"];
        const hasWorkerSecret = !!process.env["JOB_WORKER_SECRET"];

        return new Response(
          JSON.stringify(
            {
              ok: true,
              commit,
              // SHA yoksa UYDURMUYORUZ; "bilinmiyor" demek dürüst olan.
              commitKnown: commit !== null,
              priceGateFixed: PRICE_GATE_FIXED,
              nodeEnv: process.env["NODE_ENV"] ?? null,
              // Hattın dağıtım planı — sır DEĞİL, yalnız var/yok.
              // `inline` ise ağır hat istek içinde çalışır ve Hobby'de
              // 300 sn duvarına çarpar; bu, en sık yapılandırma hatasıdır.
              dispatch:
                hasQstash && hasWorkerSecret
                  ? "qstash"
                  : "inline (QSTASH_TOKEN veya JOB_WORKER_SECRET eksik)",
              envPresent: {
                qstashToken: hasQstash,
                jobWorkerSecret: hasWorkerSecret,
                supabaseServiceRole: !!process.env["SUPABASE_SERVICE_ROLE_KEY"],
              },
            },
            null,
            2,
          ),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      },
      // Tanımsız metotlara dürüst yanıt (405), sessiz 404 değil.
      POST: async () =>
        jsonError(405, "build-info yalnız GET kabul eder."),
    },
  },
});
