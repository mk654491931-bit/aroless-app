// Client-safe RestCountries + Frankfurter helpers (both free, no key, CORS-open).
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
  USD: "$", EUR: "€", GBP: "£", TRY: "₺", JPY: "¥", CAD: "C$", AUD: "A$",
  AED: "د.إ", SAR: "﷼", PLN: "zł", MXN: "MX$", BRL: "R$", INR: "₹",
  KRW: "₩", SEK: "kr", SGD: "S$",
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code?.toUpperCase()] ?? code ?? "";
}

/** ISO-3166 alpha-2 used by RestCountries for one of our target-country codes. */
export function alpha2(code: string): string {
  const c = (code || "GLOBAL").toUpperCase();
  return ISO_ALPHA2[c] ?? c;
}

export async function fetchCountryMeta(code: string): Promise<CountryMeta> {
  const c = (code || "GLOBAL").toUpperCase();
  const cached = metaCache.get(c);
  if (cached) return cached;

  const local = countryByCode(c);
  const fallback: CountryMeta = {
    code: c, flagSvg: null, flagEmoji: local.flag, currency: local.currency,
    currencySymbol: currencySymbol(local.currency), region: "", subregion: "", population: null,
  };

  try {
    const res = await fetch(
      `https://restcountries.com/v3.1/alpha/${alpha2(c)}?fields=flags,currencies,region,subregion,population`,
    );
    if (!res.ok) throw new Error("restcountries");
    const raw = (await res.json()) as unknown;
    const row = (Array.isArray(raw) ? raw[0] : raw) as {
      flags?: { svg?: string };
      currencies?: Record<string, { symbol?: string }>;
      region?: string; subregion?: string; population?: number;
    };
    const curCode = Object.keys(row.currencies ?? {})[0] ?? local.currency;
    const meta: CountryMeta = {
      code: c,
      flagSvg: row.flags?.svg ?? null,
      flagEmoji: local.flag,
      currency: c === "GLOBAL" ? "USD" : curCode,
      currencySymbol: row.currencies?.[curCode]?.symbol || currencySymbol(curCode),
      region: row.region ?? "",
      subregion: row.subregion ?? "",
      population: typeof row.population === "number" ? row.population : null,
    };
    metaCache.set(c, meta);
    return meta;
  } catch {
    metaCache.set(c, fallback);
    return fallback;
  }
}

/** USD → target currency rate via Frankfurter (free, unlimited, no key). */
export async function fetchUsdRate(currency: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  const cached = rateCache.get(cur);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${cur}`);
    if (!res.ok) throw new Error("frankfurter");
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = Number(json.rates?.[cur]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("no rate");
    rateCache.set(cur, rate);
    return rate;
  } catch {
    return 0; // 0 = unavailable, callers fall back to USD
  }
}

export function useCountryMeta(code: string): CountryMeta {
  const local = countryByCode(code);
  const [meta, setMeta] = useState<CountryMeta>(() =>
    metaCache.get((code || "GLOBAL").toUpperCase()) ?? {
      code: local.code, flagSvg: null, flagEmoji: local.flag, currency: local.currency,
      currencySymbol: currencySymbol(local.currency), region: "", subregion: "", population: null,
    },
  );
  useEffect(() => {
    let alive = true;
    fetchCountryMeta(code).then((m) => { if (alive) setMeta(m); });
    return () => { alive = false; };
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
    fetchUsdRate(currency).then((r) => { if (alive) setRate(r); });
    return () => { alive = false; };
  }, [currency]);
  return rate;
}
