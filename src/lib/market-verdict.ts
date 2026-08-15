// ============================================================================
// Ülke + platform karar gerekçesi (istemci güvenli, saf veri/tip).
// Winner Gate her aday için bunu üretir; arayüz "neden seçildi / neden elendi"
// panelinde komisyon, teslimat ve sertifika bariyeri gerekçelerini gösterir.
// ============================================================================
import type { Platform } from "@/lib/gemini.functions";
import { countryByCode } from "@/lib/countries";
import { PLATFORM_MARKETS, commissionRange, countryFit, fitLabel, shipDays, type CountryFit } from "@/lib/platform-market";

export type ChannelVerdict = {
  platform: string;
  fit: CountryFit;
  fit_label: string;
  commission: [number, number];
  ship_days: [number, number];
  note: string;
};

export type VerdictCheck = {
  /** Kontrol adı, ör. "Net marj eşiği". */
  label: string;
  passed: boolean;
  /** Ölçülen değer, ör. "%21". */
  value?: string;
  /** Eşik/kural, ör. "≥ %18". */
  threshold?: string;
  detail?: string;
};

export type MarketVerdict = {
  decision: "kept" | "rejected" | "rescued";
  country_code: string;
  country_name: string;
  currency: string;
  vat_label: string;
  vat_pct: number;
  channels: ChannelVerdict[];
  /** Seçilen kanallardan bu ülkede çalışmayanlar. */
  blocked_channels: string[];
  barrier?: { rule: string; why: string };
  checks: VerdictCheck[];
  summary: string;
};

export function channelVerdicts(platforms: string[], code: string): ChannelVerdict[] {
  return platforms
    .filter((p) => p in PLATFORM_MARKETS)
    .map((p) => {
      const plat = p as Platform;
      const fit = countryFit(plat, code);
      return {
        platform: p,
        fit,
        fit_label: fitLabel(fit),
        commission: commissionRange(plat, code),
        ship_days: shipDays(plat, code),
        note: PLATFORM_MARKETS[plat]?.note ?? "",
      };
    });
}

export function buildVerdict(input: {
  decision: MarketVerdict["decision"];
  country: string;
  platforms: string[];
  checks: VerdictCheck[];
  barrier?: { rule: string; why: string };
  reason?: string;
}): MarketVerdict {
  const code = (input.country || "GLOBAL").toUpperCase();
  const country = countryByCode(code);
  const channels = channelVerdicts(input.platforms, code);
  const blocked = channels.filter((c) => c.fit === "unavailable").map((c) => c.platform);
  const best = channels.find((c) => c.fit === "native") ?? channels.find((c) => c.fit === "cross-border");

  let summary: string;
  if (input.decision === "rejected") {
    summary = input.reason ?? "Kalite eşiklerini geçemedi.";
  } else if (input.decision === "rescued") {
    summary = `${country.name} için en iyi adaylar arasında kaldı (eşik altı: ${input.reason ?? "kısmi uyum"}).`;
  } else if (best) {
    summary = `${country.name} pazarında ${best.platform} ${best.fit === "native" ? "yerel kanal" : "sınır ötesi kanal"}: %${best.commission[0]}-%${best.commission[1]} komisyon ve ${best.ship_days[0]}-${best.ship_days[1]} gün teslimat ile ${country.vat_label} %${country.vat_pct} sonrası marj korunuyor.`;
  } else {
    summary = `${country.name} pazarında seçili kanallar sınırlı; kendi mağaza (Shopify/WooCommerce) rotası önerilir.`;
  }

  return {
    decision: input.decision,
    country_code: country.code,
    country_name: country.name,
    currency: country.currency,
    vat_label: country.vat_label,
    vat_pct: country.vat_pct,
    channels,
    blocked_channels: blocked,
    barrier: input.barrier,
    checks: input.checks,
    summary,
  };
}
