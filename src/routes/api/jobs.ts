/**
 * POST /api/jobs — uzak worker ucu (Render).
 *
 * Hibrit kurulum: tetikleyici Vercel'de (kısa ömürlü fonksiyon) kalır, ağır iş
 * Render'daki **kalıcı** serviste koşar. Tetikleyici bu uca QStash ile yayın
 * yapar; uç işi süreç içi arka plan kuyruğuna atıp ANINDA `202` döner. Böylece
 * hiçbir istek platformun kesme süresine dayanmaz ve 504 oluşmaz.
 *
 * Güvenlik: `JOB_WORKER_SECRET` (QStash forward header'ı ile taşınır) zorunlu.
 * Kredi tetikleyicide düşülür; iş burada başarısız olursa iade edilir.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Tetikleyicinin kullandığı anahtarla BİREBİR aynı olmalı (dedupe). */
function councilKeyOf(query: string, country: string, category: string, lang: string): string {
  return `council:${[query, country, category, lang]
    .map((part) => part.trim().toLowerCase())
    .join("|")}`;
}

export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const jobs = await import("@/lib/discovery-jobs.server");
        if (!jobs.verifyWorkerRequest(request)) {
          return json({ success: false, error: "Forbidden" }, 403);
        }

        const payload = (await request.json().catch(() => null)) as {
          kind?: string;
          userId?: string;
          query?: string;
          country?: string;
          category?: string;
          lang?: string;
        } | null;
        if (!payload?.kind) return json({ success: false, error: "Invalid job payload" }, 400);

        if (payload.kind !== "council") {
          return json({ success: false, error: `UNSUPPORTED_JOB_KIND:${payload.kind}` }, 400);
        }

        const query = String(payload.query ?? "")
          .trim()
          .slice(0, 140);
        const userId = String(payload.userId ?? "").trim();
        if (query.length < 2 || !userId) {
          return json({ success: false, error: "Invalid council job" }, 400);
        }

        const country = String(payload.country ?? "GLOBAL")
          .toUpperCase()
          .slice(0, 8);
        const category = String(payload.category ?? "General").slice(0, 60);
        const lang = String(payload.lang ?? "tr").slice(0, 5);
        const key = councilKeyOf(query, country, category, lang);

        const runner = await import("@/lib/job-runner.server");
        const started = runner.runInBackground(
          "council-analysis",
          async () => {
            const { runCouncil } = await import("@/lib/council.server");
            const { withCreditRefund } = await import("@/lib/credit-guard.server");
            return withCreditRefund(userId, () => runCouncil(query, country, category, lang));
          },
          { key },
        );

        if (!started.started) {
          // Aynı sorgu zaten çalışıyor: sonuç önbelleğe yazılacak, istemci yoklar.
          if (started.reason === "duplicate") return json({ success: true, deduped: true }, 202);
          // Bu süreçte arka plan yoksa (ör. uç yanlışlıkla Vercel'de çalıştı):
          // QStash'in tekrar denemesi için 503.
          return json(
            { success: false, error: `JOB_RUNNER_UNAVAILABLE:${started.reason ?? "unknown"}` },
            503,
          );
        }

        return json({ success: true, queued: true, key }, 202);
      },
    },
  },
});
