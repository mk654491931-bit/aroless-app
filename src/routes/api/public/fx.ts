import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";

/**
 * Live USD-based FX rates for country-aware pricing.
 * Free sources, no key required: open.er-api.com → frankfurter.app fallback.
 * Cached in-memory for 6h so cards never hammer the upstream API.
 */

export type FxPayload = {
  base: "USD";
  rates: Record<string, number>;
  updated: string;
  source: string;
};

const STATIC_FALLBACK: Record<string, number> = {
  USD: 1,
  EUR: 0.84,
  GBP: 0.72,
  TRY: 48.4,
  CAD: 1.34,
  AUD: 1.48,
  JPY: 143,
  AED: 3.67,
  SAR: 3.75,
  PLN: 3.85,
  MXN: 18.2,
  BRL: 5.1,
  INR: 84,
  KRW: 1340,
  SEK: 9.8,
  SGD: 1.28,
  CNY: 7.05,
  CHF: 0.82,
};

const TTL = 6 * 60 * 60 * 1000;
let cache: { at: number; data: FxPayload } | null = null;

async function fetchRates(): Promise<FxPayload> {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = (await r.json()) as {
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      };
      if (j.rates && j.rates["EUR"]) {
        return {
          base: "USD",
          rates: j.rates,
          updated: j.time_last_update_utc ?? new Date().toISOString(),
          source: "open.er-api.com",
        };
      }
    }
  } catch {
    /* try next */
  }

  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD", {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = (await r.json()) as { rates?: Record<string, number>; date?: string };
      if (j.rates) {
        return {
          base: "USD",
          rates: { USD: 1, ...j.rates },
          updated: j.date ?? new Date().toISOString(),
          source: "frankfurter.app",
        };
      }
    }
  } catch {
    /* fall through */
  }

  return {
    base: "USD",
    rates: STATIC_FALLBACK,
    updated: new Date().toISOString(),
    source: "fallback",
  };
}

export const Route = createFileRoute("/api/public/fx")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "fx", 40, 60);
        if (limited) return limited;
        if (cache && Date.now() - cache.at < TTL) {
          return Response.json(cache.data, {
            headers: { "Cache-Control": "public, max-age=3600" },
          });
        }
        const data = await fetchRates();
        if (data.source !== "fallback") cache = { at: Date.now(), data };
        if (data.source === "fallback" && cache) {
          // Sağlayıcılar geçici olarak erişilemezse: eski ama GERÇEK kuru göster,
          // bayat statik sabite düşme. (Fiyat sayacı hiçbir zaman yanlış kur göstermesin.)
          return Response.json(
            { ...cache.data, updated: cache.data.updated, source: "cached-stale" },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        return Response.json(data, { headers: { "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
