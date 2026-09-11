import { createFileRoute } from "@tanstack/react-router";
import { processDiscoveryDelivery } from "@/lib/discovery-worker.server";

/**
 * POST /api/product-discovery/worker
 *
 * The QStash target. It is never called by the browser: only a delivery signed
 * with `QSTASH_CURRENT_SIGNING_KEY` is accepted, and the raw body is verified
 * before a single byte of work happens.
 *
 * Because the pipeline runs here (not on the client's HTTP connection), the
 * 100s Cloudflare wall can no longer produce a 524. Proof that it cannot:
 * `start` answers in milliseconds, and this endpoint answers only QStash.
 *
 * `maxDuration` gives the background run a large slice; the job's own deadline
 * (WORKER_BUDGET_MS) still commits partial results and exits before the host
 * limit, so a slow run degrades to a partial success instead of being killed.
 */
export const maxDuration = 300;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/product-discovery/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // `text()` (not `json()`) because the signature covers the exact bytes.
        const rawBody = await request.text().catch(() => "");
        const result = await processDiscoveryDelivery({
          signature: request.headers.get("upstash-signature"),
          rawBody,
          url: request.url,
        });
        return json(result.status, result.body);
      },
    },
  },
});
