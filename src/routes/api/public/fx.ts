import { createFileRoute } from "@tanstack/react-router";

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
  USD: 1, EUR: 0.92, GBP: 0.79, TRY: 34.2, CAD: 1.36, AUD: 1.52, JPY: 152,
  AED: 3.67, SAR: 3.75, PLN: 4.0, MXN: 18.5, BRL: 5.5, INR: 83.5, KRW: 1350,
  SEK: 10.6, SGD: 1.34, CNY: 7.2, CHF: 0.88,
};

const TTL = 6 * 60 * 60 * 1000;
let cache: { at: number; data: FxPayload } | null = null;

async function fetchRates(): Promise<FxPayload> {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { rates?: Record<string, number>; time_last_update_utc?: string };
      if (j.rates && j.rates["EUR"]) {
        return { base: "USD", rates: j.rates, updated: j.time_last_update_utc ?? new Date().toISOString(), source: "open.er-api.com" };
      }
    }
  } catch { /* try next */ }

  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD", { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { rates?: Record<string, number>; date?: string };
      if (j.rates) {
        return { base: "USD", rates: { USD: 1, ...j.rates }, updated: j.date ?? new Date().toISOString(), source: "frankfurter.app" };
      }
    }
  } catch { /* fall through */ }

  return { base: "USD", rates: STATIC_FALLBACK, updated: new Date().toISOString(), source: "fallback" };
}

export const Route = createFileRoute("/api/public/fx")({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.at < TTL) {
          return Response.json(cache.data, { headers: { "Cache-Control": "public, max-age=3600" } });
        }
        const data = await fetchRates();
        if (data.source !== "fallback") cache = { at: Date.now(), data };
        return Response.json(data, { headers: { "Cache-Control": "public, max-age=3600" } });
      },
    },
  },
});
