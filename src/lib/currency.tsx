import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { countryByCode } from "@/lib/countries";

export type FxPayload = {
  base: "USD";
  rates: Record<string, number>;
  updated: string;
  source: string;
};

/** Kur verisi yüklenene kadar yalnızca USD gösterilir — statik/mock kur kullanılmaz. */
const USD_ONLY: FxPayload = { base: "USD", rates: { USD: 1 }, updated: "", source: "pending" };

const LOCAL_CACHE_KEY = "velora:fx-cache";

/** Son başarılı kur setini tarayıcıya yazar (sağlayıcı kesintisinde son gerçek kur). */
function persistLocal(payload: FxPayload) {
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ at: Date.now(), payload }));
  } catch {
    /* depolama yoksa yoksay */
  }
}

function readLocalCache(): FxPayload | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; payload?: FxPayload };
    if (!parsed?.payload?.rates || typeof parsed.at !== "number") return null;
    // Son bilinen GERÇEK kur; tarih önemli değil — statik/bayat sabit göstermekten iyidir.
    return parsed.payload;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Sağlayıcı zinciri: kendi sunucu API'si → canlı halka açık API → tarayıcı önbelleği. */
async function loadFxRates(): Promise<FxPayload> {
  // 1) Kendi sunucumuz (6s TTL cache + guardPublic). SSR/static ortamda bulunamayabilir.
  try {
    const r = await fetchWithTimeout("/api/public/fx", 5000);
    if (r.ok) {
      const j = (await r.json()) as FxPayload;
      if (j?.rates?.["TRY"] || j?.rates?.["EUR"]) {
        persistLocal(j);
        return j;
      }
    }
  } catch {
    /* sıradaki sağlayıcı */
  }

  // 2) Doğrudan open.er-api.com (CORS açık, anahtar gerekmez) — statik barındırmada
  //    /api/public/fx çalışmaz, bu adım kurun canlı kalmasını sağlar.
  try {
    const r = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD", 8000);
    if (r.ok) {
      const j = (await r.json()) as {
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      };
      if (j.rates && j.rates["EUR"]) {
        const payload: FxPayload = {
          base: "USD",
          rates: j.rates,
          updated: j.time_last_update_utc ?? new Date().toISOString(),
          source: "open.er-api.com",
        };
        persistLocal(payload);
        return payload;
      }
    }
  } catch {
    /* sıradaki */
  }

  // 3) Son bilinen gerçek kur (asla bayat statik sabite düşme).
  const cached = readLocalCache();
  if (cached) return { ...cached, source: "cached" };

  // 4) Hiçbir kaynak yok: yalnızca USD gösterilir, yanlış kur gösterilmez.
  return USD_ONLY;
}

/** Live USD→X rates. Sunucu + halka açık API + tarayıcı önbelleği zinciriyle çalışır. */
export function useFxRates() {
  return useQuery({
    queryKey: ["fx-rates"],
    queryFn: async (): Promise<FxPayload> => loadFxRates(),
    staleTime: 60 * 60 * 1000,
    retry: 1,
    placeholderData: USD_ONLY,
  });
}

/** Pulls the first number out of "$12.99", "12,99 USD", "~$8–10" etc. */
export function parseUsd(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const m = String(v)
    .replace(/,/g, "")
    .match(/-?\d+(\.\d+)?/);
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
        style: "currency",
        currency: cur,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount);
    } catch {
      return `${cur} ${amount.toFixed(digits)}`;
    }
  };

  /** USD amount → local currency (with the USD original in parentheses). */
  const money = (
    usd: number | string | undefined,
    opts?: { compact?: boolean; showUsd?: boolean },
  ) => {
    const value = parseUsd(usd);
    if (currency === "USD" || rate === 1) return fmt(value, "USD", opts);
    const local = fmt(value * rate, currency, opts);
    return opts?.showUsd === false ? local : `${local} · ${fmt(value, "USD", opts)}`;
  };

  return {
    currency,
    rate,
    locale,
    money,
    fmt,
    isLive: (data?.source ?? "fallback") !== "fallback",
    updated: data?.updated ?? "",
  };
}
