import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed, guardPublic, jsonError, readJsonBody } from "@/lib/api-guard.server";
import {
  sanitizeCountry,
  sanitizeStringArray,
  sanitizeTrendRadarAction,
  sanitizeTrendRadarCategory,
  sanitizeTrendRadarMode,
  sanitizeHotProductsNiche,
} from "@/lib/api-request-sanitizers";

/**
 * Aroless — Multi-Platform Automated AI Trend Discovery endpoint.
 * Actions:
 *   scrape   — runs the automated scraping/RSS ingestion job (and persists rows)
 *   analyze  — Aroless Deep AI Intelligence synthesis over ingested signals
 *   brief    — deep AI product brief for a single trend
 *   webhook  — open ingestion endpoint for external scrapers / RSS bridges
 */
export const Route = createFileRoute("/api/public/trend-radar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readJsonBody<Record<string, unknown>>(request, 256 * 1024);
          if (!body) return jsonError(400, "Geçersiz veya çok büyük istek.");
          const action = sanitizeTrendRadarAction(body["action"]);
          const region = sanitizeCountry(body["region"]);
          const category = sanitizeTrendRadarCategory(body["category"]);

          if (action === "webhook") {
            // Dış kaynaklı besleme: yalnızca paylaşılan gizli anahtarla.
            const secret = process.env["TREND_WEBHOOK_SECRET"];
            const provided = request.headers.get("x-webhook-secret") ?? "";
            if (!secret || provided !== secret) return jsonError(401, "Yetkisiz istek.");
            const ipLimited = await guardPublic(request, "trend-radar-webhook", 60, 60);
            if (ipLimited) return ipLimited;
          } else {
            const guard = await guardAuthed(request, "trend-radar", 12, 60);
            if ("response" in guard) return guard.response;
          }

          const mod = await import("@/lib/trend-radar.server");

          if (action === "scrape") {
            const sources = sanitizeStringArray(body["sources"], 20, 20) as import("@/lib/trend-radar.server").TrendSource[];
            const rssFeeds = sanitizeStringArray(body["rss_feeds"], 50, 200);
            const niche = body["niche"] ? sanitizeHotProductsNiche(body["niche"]) : undefined;
            const job = await mod.runScrapeJob({ region, category, sources, rssFeeds, niche });

            // Persist to scraped_platform_trends (best-effort — UI works regardless).
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const used = Array.from(new Set(job.trends.map((t) => t.source)));
              if (used.length) {
                await supabaseAdmin
                  .from("scraped_platform_trends")
                  .delete()
                  .eq("region", region)
                  .in("source", used);
                await supabaseAdmin.from("scraped_platform_trends").insert(
                  job.trends.map((t) => ({
                    source: t.source,
                    trend_name: t.trend_name,
                    category: t.category,
                    region: t.region,
                    metrics: t.metrics,
                    raw_payload: { ...t.raw_payload, kind: t.kind },
                    scraped_at: t.scraped_at,
                  })),
                );
              }
            } catch {
              /* persistence optional */
            }

            return Response.json(job);
          }

          if (action === "analyze") {
            const trends = (
              Array.isArray(body["trends"]) ? body["trends"] : []
            ) as import("@/lib/trend-radar.server").ScrapedTrend[];
            const mode =
              sanitizeTrendRadarMode(body["mode"]) as import("@/lib/trend-radar.server").AiMode;
            if (!trends.length) {
              return new Response(JSON.stringify({ error: "no trends to analyze" }), {
                status: 400,
              });
            }
            return Response.json(await mod.runDeepAnalysis(trends, mode, region, category));
          }

          if (action === "brief") {
            const trend = sanitizeStringArray([body["trend"]], 1, 160)[0] ?? "";
            if (!trend)
              return new Response(JSON.stringify({ error: "trend required" }), { status: 400 });
            return Response.json(await mod.runProductBrief(trend, region, category));
          }

          if (action === "webhook") {
            const rows = mod.normalizeWebhook(body["payload"], region);
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              await supabaseAdmin.from("scraped_platform_trends").insert(
                rows.map((t) => ({
                  source: t.source,
                  trend_name: t.trend_name,
                  category: t.category,
                  region: t.region,
                  metrics: t.metrics,
                  raw_payload: { ...t.raw_payload, kind: "webhook" },
                  scraped_at: t.scraped_at,
                })),
              );
            } catch {
              /* optional */
            }
            return Response.json({ ingested: rows.length, trends: rows });
          }

          return new Response(JSON.stringify({ error: "unknown action" }), { status: 400 });
        } catch (e) {
          return jsonError(500, "İşlem tamamlanamadı. Lütfen tekrar deneyin.", e);
        }
      },
    },
  },
});
