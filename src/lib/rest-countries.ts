// Client-safe RestCountries + FX helpers — proxied via server to avoid browser CORS.
// Upstream calls (restcountries.com / frankfurter) happen only in `src/routes/api/public/country.ts`
// and `src/routes/api/public/fx.ts`. Frontend fetches only our own /api/... endpoints.
import { useEffect, useState } from "react";
import { countryByCode } from "./countries";

export type CountryMeta = {
  code: string;
  flagSvg: string | null;
  flagEmoji: string;
  currency: string;
  currencySymbol: string;
  region: string;
  subregion: string;
  population: number | null;
};

const ISO_ALPHA2: Record<string, string> = { GLOBAL: "US", UK: "GB" };
const metaCache = new Map<string, CountryMeta>();
const rateCache = new Map<string, number>();

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

export function currencySymbol(code: string): string {
  return SYMBOLS[code?.toUpperCase()] ?? code ?? "";
}

/** ISO-3166 alpha-2 used by RestCountries for one of our target-country codes. */
export function alpha2(code: string): string {
  const c = (code || "GLOBAL").toUpperCase();
  return ISO_ALPHA2[c] ?? c;
}

type CountryProxyPayload = {
  code: string;
  flagSvg: string | null;
  flagEmoji: string;
  currency: string;
  currencySymbol: string;
  region: string;
  subregion: string;
  population: number | null;
  rate: number;
};

export async function fetchCountryMeta(code: string): Promise<CountryMeta> {
  const c = (code || "GLOBAL").toUpperCase();
  const cached = metaCache.get(c);
  if (cached) return cached;

  const local = countryByCode(c);
  const fallback: CountryMeta = {
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
    const res = await fetch(`/api/public/country?code=${encodeURIComponent(c)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`country proxy ${res.status}`);
    const payload = (await res.json()) as Partial<CountryProxyPayload>;
    // Accept only well-formed payloads; the proxy always returns the fields above.
    if (!payload || typeof payload.code !== "string") throw new Error("bad payload");
    const meta: CountryMeta = {
      code: payload.code ?? c,
      flagSvg: payload.flagSvg ?? null,
      flagEmoji: payload.flagEmoji ?? local.flag,
      currency: payload.currency ?? local.currency,
      currencySymbol: payload.currencySymbol ?? currencySymbol(payload.currency ?? local.currency),
      region: payload.region ?? "",
      subregion: payload.subregion ?? "",
      population: typeof payload.population === "number" ? payload.population : null,
    };
    metaCache.set(c, meta);
    // Warm FX cache opportunistically so useUsdRate can resolve without a second request.
    if (
      typeof payload.rate === "number" &&
      Number.isFinite(payload.rate) &&
      payload.rate > 0 &&
      payload.currency
    ) {
      const cur = String(payload.currency).toUpperCase();
      if (!rateCache.has(cur)) rateCache.set(cur, payload.rate);
    }
    return meta;
  } catch {
    metaCache.set(c, fallback);
    return fallback;
  }
}

/** USD → target currency rate via our own /api/public/fx (server calls Frankfurter). */
export async function fetchUsdRate(currency: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  const cached = rateCache.get(cur);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch("/api/public/fx", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("fx proxy");
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = Number(json.rates?.[cur]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("no rate");
    rateCache.set(cur, rate);
    return rate;
  } catch {
    // Also try country proxy as a fallback when FX is temporarily unavailable — most
    // currencies map 1:1 to a country (e.g. GBP → UK / GB). Try a best-effort code lookup.
    try {
      const guessCode = cur === "GBP" ? "UK" : cur === "EUR" ? "DE" : cur;
      // Don't recurse forever: only try if guess looks like a country code.
      if (/^[A-Z]{2}$/.test(guessCode)) {
        const r = await fetch(`/api/public/country?code=${encodeURIComponent(guessCode)}`, {
          headers: { accept: "application/json" },
        });
        if (r.ok) {
          const p = (await r.json()) as CountryProxyPayload;
          if (p.currency?.toUpperCase() === cur && Number.isFinite(p.rate) && p.rate > 0) {
            rateCache.set(cur, p.rate);
            return p.rate;
          }
        }
      }
    } catch {
      /* ignore */
    }
    return 0; // 0 = unavailable, callers fall back to USD
  }
}

export function useCountryMeta(code: string): CountryMeta {
  const local = countryByCode(code);
  const [meta, setMeta] = useState<CountryMeta>(
    () =>
      metaCache.get((code || "GLOBAL").toUpperCase()) ?? {
        code: local.code,
        flagSvg: null,
        flagEmoji: local.flag,
        currency: local.currency,
        currencySymbol: currencySymbol(local.currency),
        region: "",
        subregion: "",
        population: null,
      },
  );
  useEffect(() => {
    let alive = true;
    fetchCountryMeta(code).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return meta;
}

/** Live USD→local rate for a target-country code. Returns 0 while loading/unavailable. */
export function useUsdRate(currency: string): number {
  const [rate, setRate] = useState<number>(() =>
    (currency || "USD").toUpperCase() === "USD" ? 1 : (rateCache.get(currency.toUpperCase()) ?? 0),
  );
  useEffect(() => {
    let alive = true;
    fetchUsdRate(currency).then((r) => {
      if (alive) setRate(r);
    });
    return () => {
      alive = false;
    };
  }, [currency]);
  return rate;
}
