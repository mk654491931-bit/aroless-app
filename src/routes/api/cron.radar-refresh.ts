/**
 * GET /api/cron/radar-refresh — GÜNLÜK RADAR TAZELEME (Vercel cron).
 *
 * NEDEN VAR: radar yalnız kullanıcı "tazele" dediğinde güncelleniyordu. Artık
 * günde bir kez otomatik koşar ve `trend_alert` açık kullanıcılara TEK özet
 * bildirim yazar (kota koruması).
 *
 * VERCEL HOBBY GERÇEKLERİ (doğrulandı, 2026): cron var, proje başına 100 iş,
 * **en sık günde 1 kez**, saat ±59 dk sapabilir, başarısız koşu TEKRAR DENENMEZ,
 * fonksiyon tavanı 300 sn. Bu yüzden iş idempotenttir (o gün kayıt varsa atlar)
 * ve AI kotası harcamaz.
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

  const { runRadarRefresh } = await import("@/lib/radar-refresh.server");
  const started = Date.now();
  try {
    const result = await runRadarRefresh({ countries: requested.length ? requested : undefined });
    return json({ ...result, secrets: cronSecretNames(process.env), ms: Date.now() - started });
  } catch (err) {
    return json(
      {
        ok: false,
        error: "refresh_failed",
        message: err instanceof Error ? err.message.slice(0, 200) : "bilinmeyen hata",
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
