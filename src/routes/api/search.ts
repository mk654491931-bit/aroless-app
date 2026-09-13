import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isQstashConfigured, publishDiscoveryJob } from "@/lib/qstash.server";
import { redisGetJson } from "@/lib/redis.server";

export const maxDuration = 30;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function publicOrigin(request: Request): string {
  const configured = (process.env["APP_URL"] ?? process.env["VITE_APP_URL"] ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const niche = typeof body.niche === "string" ? body.niche.trim() : "";
          const userId = typeof body.userId === "string" ? body.userId : null;

          // 1. Create entry in Supabase searches table with status: "processing"
          const { data: searchRow, error: dbError } = await supabaseAdmin
            .from("searches")
            .insert([
              {
                status: "processing",
                niche: niche || "general",
                payload: body,
                user_id: userId,
              },
            ])
            .select("id")
            .single();

          if (dbError || !searchRow) {
            console.error("[api/search] DB insert failed:", dbError);
            return json(500, {
              success: false,
              error: "Arama kaydı oluşturulamadı.",
            });
          }

          const jobId = searchRow.id;
          const origin = publicOrigin(request);
          const workerUrl = `${origin}/api/worker`;

          // 2. Publish JSON to QStash to trigger /api/worker
          if (isQstashConfigured()) {
            const pubResult = await publishDiscoveryJob({
              jobId,
              workerUrl,
            });

            if (!pubResult.ok) {
              console.error("[api/search] QStash publish failed:", pubResult.message);
            }
          } else {
            // Direct fetch fallback if QStash is not configured in environment
            console.warn("[api/search] QStash unconfigured, triggering worker asynchronously");
            void fetch(workerUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId, payload: body }),
            }).catch((err) => console.error("[api/search] fallback worker fetch failed:", err));
          }

          // 3. Return immediately (<500ms) with { success: true, jobId }
          return json(200, {
            success: true,
            jobId,
            status: "processing",
          });
        } catch (err) {
          console.error("[api/search] handler error:", err);
          return json(500, {
            success: false,
            error: err instanceof Error ? err.message : "Arama tetiklenemedi.",
          });
        }
      },

      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const jobId = url.searchParams.get("jobId")?.trim();

          if (!jobId) {
            return json(400, { success: false, error: "jobId parametresi gerekli." });
          }

          // Check Redis cache first for fast access
          const cached = await redisGetJson<Record<string, unknown>>(`search:${jobId}`);
          if (cached) {
            return json(200, {
              success: true,
              jobId,
              ...cached,
            });
          }

          // Fallback to Supabase searches table
          const { data: searchRow, error: dbError } = await supabaseAdmin
            .from("searches")
            .select("*")
            .eq("id", jobId)
            .maybeSingle();

          if (dbError || !searchRow) {
            return json(404, { success: false, error: "Arama kaydı bulunamadı." });
          }

          return json(200, {
            success: true,
            jobId: searchRow.id,
            status: searchRow.status,
            result: searchRow.result,
            error: searchRow.error,
          });
        } catch (err) {
          console.error("[api/search] status error:", err);
          return json(500, {
            success: false,
            error: err instanceof Error ? err.message : "Arama durumu alınamadı.",
          });
        }
      },
    },
  },
});
