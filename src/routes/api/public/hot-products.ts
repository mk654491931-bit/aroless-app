import { createFileRoute } from "@tanstack/react-router";
import { guardPublic, readJsonBody, requireUser } from "@/lib/api-guard.server";
import { buildMarketScan, hourKey, type MarketScanPayload } from "@/lib/hot-scan.server";
import { persistStreamedProduct } from "@/lib/product-store.server";
import { createSseResponse, encodeSseEvent } from "@/lib/sse.server";
import type { ProductStreamEvent } from "@/lib/product-stream.shared";

/**
 * Live "most sellable right now" feed — Product Discovery.
 *
 * 100% real-world data: Google-Search-grounded Gemini scan refreshed once per
 * hour (server memory cache keyed by UTC hour + niche, plus CDN cache headers).
 * There is no demo catalog and no synthetic fallback.
 *
 * Two transports, one scan (`@/lib/hot-scan.server`):
 *  • `GET` (JSON)  — the cached, hour-bucketed feed.
 *  • `GET`/`POST` with `Accept: text/event-stream` — streaming discovery. The
 *    scan is long enough to blow past the gateway window as a single JSON body
 *    (the HTTP 524s), so the stream flushes immediately, heartbeats every 5s,
 *    pushes each product to Postgres the moment it is produced and emits it
 *    right away, contains per-product failures as `event: error` frames and
 *    aborts the scan + DB writes when the client disconnects.
 */
export const maxDuration = 1800;

type Payload = MarketScanPayload;

const cache = new Map<string, Payload>();
const inflight = new Map<string, Promise<Payload>>();

async function getPayload(niche: string): Promise<Payload> {
  const cacheKey = `${hourKey()}::${niche.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit?.items.length) return hit;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const p = buildMarketScan(niche)
    .then((payload) => {
      if (payload.items.length) cache.set(cacheKey, payload);
      if (cache.size > 40) cache.delete(cache.keys().next().value as string);
      return payload;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });
  inflight.set(cacheKey, p);
  return p;
}

type StreamBody = { niche?: string; target_country?: string };

function optionalString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function wantsStream(request: Request): boolean {
  return (
    (request.headers.get("accept") ?? "").includes("text/event-stream") ||
    new URL(request.url).searchParams.get("stream") === "1"
  );
}

/**
 * Streams the discovery scan.
 *
 * Signed-in callers get per-user limits and their products persisted.
 * Anonymous callers are still served (the feed is public) but nothing is
 * written to the database on their behalf.
 */
async function streamDiscovery(request: Request, body: StreamBody): Promise<Response> {
  const auth = await requireUser(request);
  let userId: string | null = null;
  if ("response" in auth) {
    const limited = await guardPublic(request, "product-stream", 20, 60);
    if (limited) return limited;
  } else {
    userId = auth.userId;
  }

  const niche = optionalString(body.niche, 60);
  const targetCountry = optionalString(body.target_country, 10).toUpperCase() || "GLOBAL";
  const traceId = `discover_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const started = Date.now();

  return createSseResponse(
    async (emit, signal) => {
      const send = (event: ProductStreamEvent): void => emit(encodeSseEvent(event.type, event));

      send({ type: "connected", traceId, at: Date.now() });
      send({ type: "agent", agent: "Market Scanner", status: "running", tier: 1 });
      send({ type: "stage", stage: "scan", label: "Canlı pazar taraması başladı" });

      let persisted = 0;
      let failed = 0;

      const scan = await buildMarketScan(niche, {
        signal,
        onItem: async (product, index) => {
          const outcome = await persistStreamedProduct(product, { userId, targetCountry });

          if (outcome.saved) persisted += 1;
          if (outcome.error) {
            failed += 1;
            send({
              type: "error",
              scope: "product",
              message: outcome.error,
              productName: product.name,
            });
          }

          send({
            type: "product",
            index,
            product,
            saved: outcome.saved,
            ...(outcome.rowId ? { rowId: outcome.rowId } : {}),
            ...(outcome.error ? { saveError: outcome.error } : {}),
          });
        },
      });

      send({
        type: "agent",
        agent: "Market Scanner",
        status: "complete",
        tier: 1,
        ms: Date.now() - started,
      });
      send({ type: "stage", stage: "rank", label: "Ürünler derecelendirildi" });
      send({
        type: "complete",
        data: {
          traceId,
          items: scan.items,
          count: scan.items.length,
          persisted,
          failed,
          elapsedMs: Date.now() - started,
          nextRefreshAt: scan.next_refresh_at,
        },
      });
    },
    { signal: request.signal, heartbeatMs: 5_000 },
  );
}

export const Route = createFileRoute("/api/public/hot-products")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        if (wantsStream(request)) {
          return streamDiscovery(request, { niche: url.searchParams.get("niche") ?? "" });
        }

        const limited = await guardPublic(request, "hot-products", 40, 60);
        if (limited) return limited;
        const niche = (url.searchParams.get("niche") ?? "").slice(0, 60).trim();
        try {
          const payload = await getPayload(niche);
          return new Response(JSON.stringify(payload), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=600, s-maxage=3600",
            },
          });
        } catch (e) {
          console.error("Hot products scan failed", e);
          return new Response(
            JSON.stringify({ items: [], error: "Market scan temporarily unavailable" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },

      POST: async ({ request }) => {
        const body = (await readJsonBody<StreamBody>(request)) ?? {};
        return streamDiscovery(request, body);
      },
    },
  },
});
