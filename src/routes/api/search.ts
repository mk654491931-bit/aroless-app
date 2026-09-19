/**
 * POST /api/search — istemci tetikleme rotası.
 *
 * Ağır işi BEKLEMEZ: `searches` tablosunda `status: "processing"` bir kayıt
 * açar, işi QStash ile `/api/worker`'a yayınlar ve anında `{ success, jobId }`
 * döner. Böylece 90 saniyelik sunucu zaman aşımı hiç tetiklenmez.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "")
          .replace(/^Bearer\s+/i, "")
          .trim();
        if (!token || token.split(".").length !== 3) {
          return json({ success: false, error: "Unauthorized" }, 401);
        }

        const raw = (await request.json().catch(() => null)) as
          | { data?: unknown }
          | null
          | undefined;
        if (!raw || typeof raw !== "object") {
          return json({ success: false, error: "Invalid JSON body" }, 400);
        }

        const { DiscoveryInputSchema } = await import("@/lib/discovery-pipeline.server");
        const parsed = DiscoveryInputSchema.safeParse(raw.data ?? raw);
        if (!parsed.success) {
          return json({ success: false, error: "Invalid search input" }, 400);
        }

        const jobs = await import("@/lib/discovery-jobs.server");

        let userId: string;
        try {
          userId = await jobs.resolveUserId(token);
        } catch {
          return json({ success: false, error: "Unauthorized" }, 401);
        }

        const started = await jobs.startDiscoveryJob({
          input: parsed.data,
          userId,
          accessToken: token,
          origin: jobs.appOrigin(request),
        });

        if (!started.ok) {
          console.error(`[api/search] job could not be queued: ${started.error}`);
          return json({ success: false, error: started.error }, 503);
        }

        return json({
          success: true,
          jobId: started.jobId,
          status: "processing",
          // İstemci sabit süre varsaymasın: bekleme bütçesi platformdan gelir.
          ...jobs.jobPollingPlan(),
        });
      },
    },
  },
});
