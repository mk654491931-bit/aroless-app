import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";
import { countryByCode } from "@/lib/countries";

/**
 * GET /api/public/country?code=GB|US|DE|...
 * Server-side proxy for RestCountries + Frankfurter.
 * - Browser never calls restcountries.com or api.frankfurter.app directly (CORS kaynaklı hatalar çözülür).
 * - In-memory cache (per worker) + rate limiting via guardPublic.
 * - Mevcut CountryMeta / rate tipleri korunur; frontend `meta` + `rate` alanlarını tüketir.
 */

type CountryPayload = {
  code: string;
  flagSvg: string | null;
  flagEmoji: string;
  currency: string;
  currencySymbol: string;
  region: string;
  subregion: string;
  population: number | null;
  rate: number; // USD → currency rate, 0 = unavailable
};

const ISO_ALPHA2: Record<string, string> = { GLOBAL: "US", UK: "GB" };

function alpha2(code: string): string {
  const c = (code || "GLOBAL").toUpperCase();
  return ISO_ALPHA2[c] ?? c;
}

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  TRY: "₺",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  AED: "د.إ",
  SAR: "﷼",
  PLN: "zł",
  MXN: "MX$",
  BRL: "R$",
  INR: "₹",
  KRW: "₩",
  SEK: "kr",
  SGD: "S$",
};

function currencySymbol(code: string): string {
  return SYMBOLS[code?.toUpperCase()] ?? code ?? "";
}

const TTL = 6 * 60 * 60 * 1000; // 6h
const RATE_TTL = 60 * 60 * 1000; // 1h

const countryCache = new Map<string, { at: number; data: Omit<CountryPayload, "rate"> }>();
const rateCache = new Map<string, { at: number; value: number }>();

async function fetchCountryMetaServer(code: string): Promise<Omit<CountryPayload, "rate">> {
  const c = (code || "GLOBAL").toUpperCase();
  const hit = countryCache.get(c);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const local = countryByCode(c);
  const fallback: Omit<CountryPayload, "rate"> = {
    code: c,
    flagSvg: null,
    flagEmoji: local.flag,
    currency: local.currency,
    currencySymbol: currencySymbol(local.currency),
    region: "",
    subregion: "",
    population: null,
  };

  try {
    const res = await fetch(
      `https://restcountries.com/v3.1/alpha/${alpha2(c)}?fields=flags,currencies,region,subregion,population`,
      { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`restcountries ${res.status}`);
    const raw = (await res.json()) as unknown;
    const row = (Array.isArray(raw) ? raw[0] : raw) as {
      flags?: { svg?: string };
      currencies?: Record<string, { symbol?: string }>;
      region?: string;
      subregion?: string;
      population?: number;
    };
    const curCode = Object.keys(row.currencies ?? {})[0] ?? local.currency;
    const meta: Omit<CountryPayload, "rate"> = {
      code: c,
      flagSvg: row.flags?.svg ?? null,
      flagEmoji: local.flag,
      currency: c === "GLOBAL" ? "USD" : curCode,
      currencySymbol:
        (row.currencies?.[curCode]?.symbol as string | undefined) || currencySymbol(curCode),
      region: row.region ?? "",
      subregion: row.subregion ?? "",
      population: typeof row.population === "number" ? row.population : null,
    };
    countryCache.set(c, { at: Date.now(), data: meta });
    return meta;
  } catch {
    countryCache.set(c, { at: Date.now(), data: fallback });
    return fallback;
  }
}

async function fetchRateServer(currency: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  const hit = rateCache.get(cur);
  if (hit && Date.now() - hit.at < RATE_TTL) return hit.value;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${cur}`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error("frankfurter");
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = Number(json.rates?.[cur]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("no rate");
    rateCache.set(cur, { at: Date.now(), value: rate });
    return rate;
  } catch {
    // cache 0 briefly so callers can fall back to USD without hammering upstream
    rateCache.set(cur, { at: Date.now(), value: 0 });
    // keep the 0 cached for 5 minutes only, then retry on next call
    setTimeout(
      () => {
        const v = rateCache.get(cur);
        if (v?.value === 0) rateCache.delete(cur);
      },
      5 * 60 * 1000,
    );
    return 0;
  }
}

export const Route = createFileRoute("/api/public/country")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "country", 120, 60);
        if (limited) return limited;
        const url = new URL(request.url);
        const code = (url.searchParams.get("code") || url.searchParams.get("country") || "GLOBAL")
          .trim()
          .toUpperCase()
          .slice(0, 16);
        // Validate: only A-Z, up to 8 chars or GLOBAL
        if (!/^[A-Z]{2,8}$/.test(code)) {
          return Response.json({ error: "invalid code" }, { status: 400 });
        }
        const meta = await fetchCountryMetaServer(code);
        const rate = await fetchRateServer(meta.currency);
        const payload: CountryPayload = { ...meta, rate };
        return Response.json(payload, {
          headers: {
            "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=600",
            "Content-Type": "application/json",
          },
        });
      },
    },
  },
});
