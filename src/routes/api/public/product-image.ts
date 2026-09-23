import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";
import { resolveProductImage, scraperApiConfigured } from "@/lib/product-image.server";

// Simple in-memory cache (per worker instance). Key: normalized query.
const cache = new Map<string, { url: string; at: number }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_CACHE_ENTRIES = 2000; // bound memory under abusive unique queries

function cacheSet(key: string, value: { url: string; at: number }) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest entry (Map preserves insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=86400",
};

export const Route = createFileRoute("/api/public/product-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "product-image", 240, 60);
        if (limited) return limited;
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
        if (!q) {
          return Response.json({ error: "missing q" }, { status: 400, headers: CORS });
        }
        const key = q.toLowerCase();
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) {
          return Response.json({ url: hit.url, cached: true }, { headers: CORS });
        }
        const { url: img, source } = await resolveProductImage(q);
        if (!img) {
          // No real image found — never return a fabricated/stock placeholder.
          return Response.json(
            { url: null, cached: false, source: "none", scrapapi: scraperApiConfigured() },
            { headers: CORS },
          );
        }
        cacheSet(key, { url: img, at: Date.now() });
        return Response.json(
          { url: img, cached: false, source, scrapapi: scraperApiConfigured() },
          { headers: CORS },
        );
      },
    },
  },
});
