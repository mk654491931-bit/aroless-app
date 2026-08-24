import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { countryByCode } from "@/lib/countries";

export type FxPayload = { base: "USD"; rates: Record<string, number>; updated: string; source: string };

/** Kur verisi yüklenene kadar yalnızca USD gösterilir — statik/mock kur kullanılmaz. */
const USD_ONLY: FxPayload = { base: "USD", rates: { USD: 1 }, updated: "", source: "pending" };

/** Live USD→X rates, cached for the session (server caches 6h). */
export function useFxRates() {
  return useQuery({
    queryKey: ["fx-rates"],
    queryFn: async (): Promise<FxPayload> => {
      const r = await fetch("/api/public/fx");
      if (!r.ok) throw new Error("fx failed");
      return (await r.json()) as FxPayload;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
    placeholderData: USD_ONLY,
  });
}

/** Pulls the first number out of "$12.99", "12,99 USD", "~$8–10" etc. */
export function parseUsd(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

const COUNTRY_KEY = "velora:target-country";

/** Last country the user picked — lets FX-aware UI outside the provider (pricing modal, sidebar) stay in sync. */
export function storedCountry(): string {
  if (typeof window === "undefined") return "GLOBAL";
  return window.localStorage.getItem(COUNTRY_KEY) || "GLOBAL";
}

const CurrencyCtx = createContext<{ country: string } | null>(null);

export function CurrencyProvider({ country, children }: { country: string; children: ReactNode }) {
  const value = useMemo(() => ({ country }), [country]);
  if (typeof window !== "undefined") window.localStorage.setItem(COUNTRY_KEY, country);
  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW"]);

/**
 * Country-aware money helper. Everything the AI returns is USD-based; this
 * converts it to the selected target country's currency using live FX and
 * keeps the USD reference visible for sourcing decisions.
 */
export function useMoney() {
  const ctx = useContext(CurrencyCtx);
  const country = ctx?.country ?? storedCountry();
  const { i18n } = useTranslation();
  const { data } = useFxRates();
  const rates = data?.rates ?? USD_ONLY.rates;
  const currency = countryByCode(country).currency || "USD";
  const rate = rates[currency] ?? 1;
  const locale = i18n.language || "en";

  const fmt = (amount: number, cur = currency, opts?: { compact?: boolean }) => {
    const digits = ZERO_DECIMAL.has(cur) ? 0 : opts?.compact ? 0 : Math.abs(amount) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency", currency: cur,
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(amount);
    } catch {
      return `${cur} ${amount.toFixed(digits)}`;
    }
  };

  /** USD amount → local currency (with the USD original in parentheses). */
  const money = (usd: number | string | undefined, opts?: { compact?: boolean; showUsd?: boolean }) => {
    const value = parseUsd(usd);
    if (currency === "USD" || rate === 1) return fmt(value, "USD", opts);
    const local = fmt(value * rate, currency, opts);
    return opts?.showUsd === false ? local : `${local} · ${fmt(value, "USD", opts)}`;
  };

  return { currency, rate, locale, money, fmt, isLive: (data?.source ?? "fallback") !== "fallback", updated: data?.updated ?? "" };
}
