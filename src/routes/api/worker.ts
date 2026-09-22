/**
 * POST /api/worker — QStash arka plan işçisi.
 *
 * Ağır Gemini analizi + canlı piyasa doğrulamasını burada çalıştırır, bitişte
 * `searches` kaydına `completed` + `result` (hata durumunda `failed` + `error`)
 * yazar ve sonucu Upstash Redis'te önbelleğe alır.
 *
 * ÜCRETSIZ KURULUM: `DISCOVERY_WORKER_URL` tanımlı değilse iş yine bu uca
 * yayınlanır — yani uygulamanın KENDİ origin'i işçidir ve ayrı (ücretli) bir
 * sunucu gerekmez. Fonksiyon süresi `nitro.config.ts` içindeki
 * `vercel.functions.maxDuration` ile ayarlanır (Vercel Hobby'de varsayılan ve
 * üst sınır 300 sn).
 */
import { createFileRoute } from "@tanstack/react-router";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const jobs = await import("@/lib/discovery-jobs.server");

        if (!jobs.verifyWorkerRequest(request)) {
          return json({ success: false, error: "Forbidden" }, 403);
        }

        const payload = (await request.json().catch(() => null)) as {
          jobId?: string;
          userId?: string;
          accessToken?: string;
          input?: unknown;
          enqueuedAtMs?: number;
        } | null;

        if (!payload?.jobId || !payload.userId || !payload.accessToken || !payload.input) {
          return json({ success: false, error: "Invalid job payload" }, 400);
        }

        const { DiscoveryInputSchema } = await import("@/lib/discovery-pipeline.server");
        const parsed = DiscoveryInputSchema.safeParse(payload.input);
        if (!parsed.success) {
          await jobs.markJobFailed(payload.jobId, "Invalid search input").catch(() => {});
          return json({ success: false, error: "Invalid search input" });
        }

        const outcome = await jobs.runJob({
          jobId: payload.jobId,
          userId: payload.userId,
          accessToken: payload.accessToken,
          input: parsed.data,
          // Kuyruk gecikmesini (QStash teslimi + soğuk başlangıç) sözden
          // düşebilmek için taşınır; olmazsa sabit tavana düşer.
          enqueuedAtMs:
            typeof payload.enqueuedAtMs === "number" ? payload.enqueuedAtMs : undefined,
        });

        // Hata durumunda bile 200 dönülür: kayıt "failed" olarak işlendi, QStash'in
        // aynı ağır işi tekrar tekrar denemesi istenmez.
        return json(outcome.ok ? { success: true } : { success: false, error: outcome.error });
      },
    },
  },
});
