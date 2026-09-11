import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed } from "@/lib/api-guard.server";
import { getJobOwned, isUuid, readJobTransient } from "@/lib/discovery-jobs.server";
import { toJobView } from "@/lib/discovery-jobs.shared";

/**
 * GET /api/product-discovery/status?jobId=<uuid>
 *
 * Poll target for the async discovery UI. Every guarantee it needs:
 *
 *   • **Auth** — `guardAuthed` verifies the Supabase access token.
 *   • **Rate limit** — polling is cheap but not free; a stuck client cannot
 *     hammer the durable store.
 *   • **Ownership / IDOR** — the row is always filtered by `user_id`, and a
 *     foreign or unknown job id answers `404` (never `403`), so a job id cannot
 *     be probed for existence.
 *   • **No secrets** — the response is the wire view only; Redis credentials,
 *     the service-role key and other users' data are never reachable.
 *
 * Redis is read for the fast-moving progress fields and merged with the durable
 * row: status/result can only ever come from Postgres, so a lost Redis key can
 * never make a running job look finished.
 */
export const maxDuration = 15;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/product-discovery/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // 180 polls/min ≈ one poll every 2s from three tabs.
        const guard = await guardAuthed(request, "product-discovery-status", 180, 60);
        if ("response" in guard) return guard.response;

        const jobId = (new URL(request.url).searchParams.get("jobId") ?? "").trim();
        if (!isUuid(jobId)) return json(400, { error: "Geçersiz iş kimliği." });

        const row = await getJobOwned(jobId, guard.userId);
        // Foreign id and missing id are indistinguishable on purpose (IDOR).
        if (!row) return json(404, { error: "İş bulunamadı." });

        const transient = await readJobTransient(jobId);
        return json(200, { job: toJobView(row, transient) });
      },
    },
  },
});
