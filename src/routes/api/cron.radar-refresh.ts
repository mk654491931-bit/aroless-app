/**
 * GET /api/cron/radar-refresh — GÜNLÜK BAKIM İŞİ (Vercel cron).
 *
 * İKİ İŞ, TEK ZAMANLAMA:
 *   1. Meta Conversions API outbox'ı işlenir (başarısız `Purchase` gönderimleri
 *      üstel geri çekilmeyle yeniden denenir) ve saklama sınırı temizlenir.
 *   2. Radar günde bir kez tazelenir ve `trend_alert` açık kullanıcılara TEK
 *      özet bildirim yazar (kota koruması).
 *
 * SIRA ÖNEMLİ: outbox işi ÖNCE ve kendi try/catch'inde koşar. Radar tarafı
 * hata verse bile CAPI kuyruğu işlenmiş olur. `?job=meta-capi` yalnız kuyruğu
 * işler (radar kotası harcamadan elle tekrar deneme için).
 *
 * NEDEN AYRI CRON YOK: Vercel Hobby cron'u günde 1 kez koşar; ikinci bir iş
 * ek frekans kazandırmaz, yalnız yapılandırma yüzeyini büyütürdü. Ayrıca her
 * `transaction.completed` webhook'u kendi kaydını hemen dener; buradaki koşu
 * kaçırılanlar için güvenlik ağıdır.
 *
 * VERCEL HOBBY GERÇEKLERİ (doğrulandı, 2026): cron var, proje başına 100 iş,
 * **en sık günde 1 kez**, saat ±59 dk sapabilir, başarısız koşu TEKRAR DENENMEZ,
 * fonksiyon tavanı 300 sn. Bu yüzden iki iş de idempotenttir ve AI kotası
 * harcamaz.
 *
 * GÜVENLİK: `CRON_SECRET` (ya da `JOB_WORKER_SECRET`) tanımlı DEĞİLSE uç 503
 * döner ve NEDENİNİ adıyla yazar; sır varken yalnız `Authorization: Bearer`
 * veya `x-cron-secret` eşleşirse çalışır.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function run(request: Request): Promise<Response> {
  const { cronAuthorized, cronConfigured, cronSecretNames } = await import("@/lib/cron-auth");

  if (!cronConfigured()) {
    return json(
      {
        ok: false,
        error: "cron_not_configured",
        message:
          "Zamanlanmış iş için CRON_SECRET (veya JOB_WORKER_SECRET) tanımlı olmalı. Vercel cron bu sırrı `Authorization: Bearer` başlığıyla gönderir.",
      },
      503,
    );
  }
  if (!cronAuthorized(request.headers)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const url = new URL(request.url);
  const requested = (url.searchParams.get("countries") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const onlyMetaCapi = url.searchParams.get("job") === "meta-capi";
  const started = Date.now();

  // --- 1) Meta CAPI outbox (radar hatasından BAĞIMSIZ) -------------------
  let metaCapi: Record<string, unknown> | null = null;
  try {
    const { createSupabaseMetaCapiOutbox } = await import("@/lib/meta-capi-outbox.server");
    const outbox = createSupabaseMetaCapiOutbox();
    // Her olay en fazla 10 sn sürebilir. Vercel'in 300 sn fonksiyon tavanı
    // içinde radar işine de yer kalsın diye: en fazla 25 kayıt VE en fazla
    // 60 sn. Meta sağlıklıyken 25 kayıt saniyeler içinde biter; yavaş/hatalı
    // yanıtlarda süre bütçesi radar işini korur.
    const drained = await outbox.drain(25, { deadlineMs: 60_000 });
    const cleaned = await outbox.cleanup();
    metaCapi = { ...drained, cleaned };
  } catch (err) {
    // Outbox tablosu/migration henüz yoksa radar işi YİNE koşmalıdır.
    console.warn(
      "[cron] Meta CAPI outbox işlenemedi:",
      err instanceof Error ? err.message : String(err),
    );
    metaCapi = { error: "outbox_failed" };
  }

  if (onlyMetaCapi) {
    return json({
      ok: true,
      metaCapi,
      secrets: cronSecretNames(process.env),
      ms: Date.now() - started,
    });
  }

  const { runRadarRefresh } = await import("@/lib/radar-refresh.server");
  try {
    const result = await runRadarRefresh({ countries: requested.length ? requested : undefined });
    return json({
      ...result,
      metaCapi,
      secrets: cronSecretNames(process.env),
      ms: Date.now() - started,
    });
  } catch (err) {
    return json(
      {
        ok: false,
        error: "refresh_failed",
        message: err instanceof Error ? err.message.slice(0, 200) : "bilinmeyen hata",
        metaCapi,
        ms: Date.now() - started,
      },
      500,
    );
  }
}

export const Route = createFileRoute("/api/cron/radar-refresh")({
  server: {
    handlers: {
      // Vercel cron GET atar; elle tetikleme için POST da aynı kapıdan geçer.
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
