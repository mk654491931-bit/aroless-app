import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyQstashSignature } from "@/lib/qstash.server";
import { redisSetJson } from "@/lib/redis.server";
import { runFinderGeneration, FinderInputSchema } from "@/lib/gemini.functions";
import { processDiscoveryDelivery } from "@/lib/discovery-worker.server";
import type { Json } from "@/integrations/supabase/types";

export const maxDuration = 300;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text().catch(() => "");
        const signature = request.headers.get("upstash-signature");

        // Verify signature if QStash is configured
        const verified = await verifyQstashSignature(signature, rawBody, request.url);
        if (!verified.ok && verified.reason === "invalid_signature") {
          return json(401, { error: "Invalid signature" });
        }

        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          // empty body handled below
        }

        const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
        if (!jobId) {
          return json(400, { error: "Missing or invalid jobId." });
        }

        // Check if this job is in Supabase `searches` table
        const { data: searchRow } = await supabaseAdmin
          .from("searches")
          .select("*")
          .eq("id", jobId)
          .maybeSingle();

        if (searchRow) {
          try {
            const rawPayload = (searchRow.payload as Record<string, unknown>) || body.payload || {};
            const niche = (searchRow.niche as string) || String(rawPayload.niche || "general");

            const parsedInput = FinderInputSchema.safeParse({
              ...rawPayload,
              niche,
            });

            const finderData = parsedInput.success
              ? parsedInput.data
              : FinderInputSchema.parse({ niche });

            // Execute heavy Gemini AI strategy generation and web scraping
            const result = await runFinderGeneration(finderData, {
              refund: async () => {},
            });

            // 1. Write completed result to Supabase `searches` table
            await supabaseAdmin
              .from("searches")
              .update({
                status: "completed",
                result: result as unknown as Json,
                updated_at: new Date().toISOString(),
              })
              .eq("id", jobId);

            // 2. Cache result in Upstash Redis for fast access
            await redisSetJson(`search:${jobId}`, {
              status: "completed",
              result,
            });

            return json(200, {
              success: true,
              jobId,
              status: "completed",
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "İşlem başarısız oldu.";
            console.error("[api/worker] search worker error:", err);

            // Update status: "failed" in Supabase searches table
            await supabaseAdmin
              .from("searches")
              .update({
                status: "failed",
                error: errorMessage,
                updated_at: new Date().toISOString(),
              })
              .eq("id", jobId);

            // Cache failure state in Upstash Redis
            await redisSetJson(`search:${jobId}`, {
              status: "failed",
              error: errorMessage,
            });

            return json(500, {
              success: false,
              jobId,
              error: errorMessage,
            });
          }
        }

        // Fallback to discovery job delivery processor if not in searches table
        const discoveryResult = await processDiscoveryDelivery({
          signature,
          rawBody,
          url: request.url,
        });

        return json(discoveryResult.status, discoveryResult.body);
      },
    },
  },
});
