import { hasMeasuredEconomics, measuredMarginPct } from "./economics-evidence";
import type { WinningProduct } from "./gemini.functions";
import { realEconomics } from "./real-economics";

export type Recommendation = "Launch" | "Watch" | "Avoid";

/**
 * `number | null` = "ÖLÇÜLME(D)İ" alanlar.
 *
 * NEDEN: ölçümlü keşif hattı yalnız fiyat/puan/satıcı ölçer; tedarik maliyeti,
 * komisyon ve aylık hacim kazınmaz. Bu alanlara sayı yazmak ürünü satılabilir
 * gösterirdi (ölçülen örnek: fiyatı $24.99 olan bir ürün için "21 adet/ay,
 * $525 ciro, −$97 net" üretiliyordu). Artık `null` döner ve arayüz "—" gösterir.
 */
export type EnrichedScores = {
  /** Gerçekçi aylık net kâr aralığı (düşük / yüksek senaryo). */
  monthly_net_low_usd: number | null;
  monthly_net_high_usd: number | null;
  net_per_unit_usd: number | null;
  ai_score: number;
  opportunity_score: number;
  trend_score: number;
  confidence_score: number;
  recommendation: Recommendation;
  est_monthly_sales: number | null;
  est_monthly_revenue_usd: number | null;
  est_monthly_net_profit_usd: number | null;
};

/** Marj ölçülmediyse kullanılan NÖTR değer — 0 değil, 30/50 de tahmin değil. */
const UNKNOWN_MARGIN_SCORE = 50;

/** Rapor/CSV/tablo metinlerinde ölçülmemiş sayı yerine geçen işaret. */
export const NOT_MEASURED = "—";

// Deterministic enrichment derived from Gemini output
export function enrichProduct(p: WinningProduct): EnrichedScores {
  const trend = clamp(p.trend_score ?? 70, 0, 100);
  const compPenalty =
    p.competition_level === "High" ? 25 : p.competition_level === "Medium" ? 10 : 0;
  // Marj yalnız ÖLÇÜLMÜŞSE kullanılır. `0` (keşif hattının "doluymuş" kalıbı)
  // ölçüm değildir; ölçülmediyse nötr değere düşülür.
  const measuredMargin = measuredMarginPct(p);
  const marginPct = clamp(measuredMargin ?? UNKNOWN_MARGIN_SCORE, 0, 100);
  const opportunity = clamp(Math.round(trend * 0.6 + marginPct * 0.5 - compPenalty), 0, 100);
  const ai = clamp(Math.round((trend + opportunity + marginPct) / 3), 0, 100);
  const confidence = clamp(100 - compPenalty - Math.max(0, 60 - trend) / 2, 40, 99);

  let recommendation: Recommendation = "Watch";
  if (opportunity >= 75 && p.competition_level !== "High") recommendation = "Launch";
  else if (opportunity < 45 || (p.competition_level === "High" && marginPct < 30))
    recommendation = "Avoid";
  // Marj bilinmiyorsa "Avoid" DENMEZ: en belirleyici girdiden yoksun bir
  // ürün hakkında "kaçın" kararı vermek uydurmadır. Ölçülen hata: ölçümlü
  // hattın her ürünü uydurma %0 marj yüzünden kırmızı "Avoid" rozeti alıyordu.
  if (measuredMargin === null && recommendation === "Avoid") recommendation = "Watch";

  // Gerçek dünya modeli: reklam bütçesiyle sınırlı hacim, gerçek komisyon/CAC/iade.
  //
  // KAPI: maliyet girdisi hiç yoksa model ÇALIŞTIRILMAZ. `realEconomics`
  // eksik girdileri varsayılanla doldurur (tedarik = perakende %30'ı, bütçe
  // $600…), yani o koşulda "ölçüm" tamamen model kurgusudur. Ölçülmemişse
  // `null` döner — kart "—" gösterir.
  const economicsMeasured = hasMeasuredEconomics(p);
  const re = economicsMeasured
    ? (p.real_economics ??
      realEconomics({
        selling_price_usd: p.selling_price_usd,
        supplier_price_usd: p.supplier_price_usd,
        shipping_cost: p.cost_breakdown?.shipping_cost,
        competition_level: p.competition_level,
        platform: p.platform_fit?.[0],
        trend_score: trend,
        cvr_pct: p.conversion?.cvr_pct,
        startup_cost_usd: p.startup_cost_usd,
        category: p.name,
      }))
    : null;

  return {
    monthly_net_low_usd: re ? re.monthly.low_usd : null,
    monthly_net_high_usd: re ? re.monthly.high_usd : null,
    net_per_unit_usd: re ? re.net_per_unit : null,
    ai_score: ai,
    opportunity_score: opportunity,
    trend_score: trend,
    confidence_score: Math.round(confidence),
    recommendation,
    est_monthly_sales: re ? re.monthly.units : null,
    est_monthly_revenue_usd: re ? re.monthly.revenue_usd : null,
    est_monthly_net_profit_usd: re ? re.monthly.net_profit_usd : null,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function recommendationStyle(r: Recommendation) {
  if (r === "Launch")
    return { emoji: "🟢", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" };
  if (r === "Avoid") return { emoji: "🔴", cls: "border-rose-500/40 bg-rose-500/15 text-rose-300" };
  return { emoji: "🟡", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300" };
}

export type SellabilityVerdict = "Highly Sellable" | "Moderate Risk" | "Do Not Sell";

export function reliabilityStyle(v: SellabilityVerdict | undefined) {
  if (v === "Highly Sellable")
    return { cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300", icon: "✅" };
  if (v === "Do Not Sell")
    return { cls: "border-rose-500/40 bg-rose-500/15 text-rose-300", icon: "⛔" };
  return { cls: "border-amber-500/40 bg-amber-500/15 text-amber-300", icon: "⚠️" };
}

/** Ölçülmemiş tutar için `formatCurrency` sarmalayıcısı — "—" döner. */
export function formatMeasuredCurrency(n: number | null | undefined, currency = "USD"): string {
  return typeof n === "number" && Number.isFinite(n) ? formatCurrency(n, currency) : NOT_MEASURED;
}

export function formatCurrency(n: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n.toLocaleString()}`;
  }
}
