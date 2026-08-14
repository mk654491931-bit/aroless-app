// ============================================================================
// Real-world unit & monthly economics for the Product Finder.
//
// AI models routinely hallucinate margins ("%70 net") and volumes ("5.000
// adet/ay"). This module replaces those numbers with a grounded, auditable
// model built from published 2024/2025 e-commerce benchmarks:
//
//   • Dropship/private-label sourcing sits at 20-40% of retail (keystone+).
//   • Platform + payment fees are taken from real published rate cards.
//   • CAC is derived from CPC / conversion rate, not a flat "% of price".
//   • Category return rates and fixed monthly overhead are subtracted.
//   • Monthly volume for an AVERAGE seller is ad-budget constrained,
//     not "market size".
//
// Everything here is a pure function — client-safe and testable.
// ============================================================================

export type RealEconomics = {
  retail: number;
  supplier: number;
  shipping: number;
  platform_fee: number;
  payment_fee: number;
  cac: number;
  returns_cost: number;
  misc: number;
  net_per_unit: number;
  net_margin_pct: number;
  /** Contribution margin before advertising (useful to judge ad headroom). */
  gross_per_unit: number;
  gross_margin_pct: number;
  cpc_usd: number;
  cvr_pct: number;
  breakeven_roas: number;
  monthly: {
    ad_budget_usd: number;
    paid_units: number;
    organic_units: number;
    units: number;
    revenue_usd: number;
    overhead_usd: number;
    net_profit_usd: number;
    low_usd: number;
    high_usd: number;
  };
  assumptions: string[];
};

export type RealEconomicsInput = {
  selling_price_usd?: unknown;
  supplier_price_usd?: unknown;
  shipping_cost?: unknown;
  competition_level?: string;
  platform?: string;
  trend_score?: number;
  cvr_pct?: number;
  startup_cost_usd?: unknown;
};

export function money(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Real published marketplace commission rates (referral/transaction only). */
function platformRate(platform?: string): { rate: number; label: string } {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("amazon")) return { rate: 0.15, label: "Amazon referral %15" };
  if (p.includes("etsy")) return { rate: 0.115, label: "Etsy %6.5 + işlem/liste ≈ %11.5" };
  if (p.includes("ebay")) return { rate: 0.132, label: "eBay final value ≈ %13.2" };
  if (p.includes("tiktok")) return { rate: 0.08, label: "TikTok Shop ≈ %8" };
  if (p.includes("trendyol") || p.includes("hepsi") || p.includes("n11")) return { rate: 0.19, label: "TR pazaryeri komisyon ≈ %19" };
  if (p.includes("walmart")) return { rate: 0.13, label: "Walmart referral ≈ %13" };
  return { rate: 0, label: "Kendi mağazan (komisyon yok)" };
}

/** Category return rate proxy — online retail averages 16-20%, but low-ticket impulse goods return less. */
function returnRate(retail: number, platform?: string): number {
  const p = (platform ?? "").toLowerCase();
  let r = retail > 120 ? 0.09 : retail > 60 ? 0.06 : 0.04;
  if (p.includes("amazon")) r += 0.02;
  if (p.includes("tiktok")) r += 0.03; // impulse buying = higher remorse returns
  return r;
}

/** Realistic paid-traffic CPC by competition and price tier (Meta/TikTok 2025 averages). */
function cpcFor(competition: string, retail: number): number {
  const base = competition === "High" ? 1.35 : competition === "Low" ? 0.55 : 0.9;
  const tier = retail > 150 ? 1.5 : retail > 70 ? 1.2 : 1;
  return r2(base * tier);
}

/** Store-level conversion rate: ecommerce average 1.5-3%, adjusted for price/competition/trend. */
function cvrFor(retail: number, competition: string, trend: number): number {
  let cvr = 2.1;
  if (retail > 150) cvr -= 1.0;
  else if (retail > 70) cvr -= 0.5;
  else if (retail < 25) cvr += 0.4;
  cvr += ((clamp(trend, 0, 100) - 60) / 40) * 0.5;
  if (competition === "High") cvr -= 0.35;
  if (competition === "Low") cvr += 0.25;
  return clamp(r2(cvr), 0.4, 4.5);
}

/**
 * Grounded unit + monthly economics for an AVERAGE small seller.
 * Never returns fantasy numbers: sourcing, fees, CAC and volume are all bounded.
 */
export function realEconomics(input: RealEconomicsInput): RealEconomics {
  const competition = input.competition_level === "High" || input.competition_level === "Low"
    ? input.competition_level : "Medium";
  const trend = clamp(Number(input.trend_score ?? 60) || 60, 0, 100);

  const retail = clamp(money(input.selling_price_usd) || 29.9, 3, 5000);

  // Sourcing sanity: real dropship/private-label COGS is 20-40% of retail.
  let supplier = money(input.supplier_price_usd);
  const sourcingOutOfBand = !(supplier > 0 && supplier >= retail * 0.12 && supplier <= retail * 0.55);
  if (sourcingOutOfBand) supplier = retail * 0.3;
  supplier = clamp(supplier, retail * 0.12, retail * 0.55);

  // Inbound + last-mile shipping, weight-proxied from unit cost.
  const shipInput = money(input.shipping_cost);
  const shipping = shipInput > 0 && shipInput < retail * 0.5
    ? shipInput
    : clamp(2.2 + supplier * 0.4, 2.2, Math.max(4, retail * 0.28));

  const { rate, label } = platformRate(input.platform);
  const platform_fee = retail * rate;
  // Payment processing is charged on every order, marketplace or not.
  const payment_fee = retail * 0.029 + 0.3;

  const cpc = cpcFor(competition, retail);
  const cvr = input.cvr_pct && input.cvr_pct > 0.2 && input.cvr_pct < 12
    ? Number(input.cvr_pct) : cvrFor(retail, competition, trend);
  // CAC from real ad math; ~25% of orders arrive organic/repeat, lowering blended CAC.
  // Pazaryerlerinde trafiğin çoğu platform içi organik: reklam gideri TACoS
  // (satışın %10-15'i) olarak gerçekleşir. Kendi mağazanda ise CAC = CPC / CVR.
  const isMarketplace = rate > 0;
  const rawCac = isMarketplace
    ? retail * (competition === "High" ? 0.15 : competition === "Low" ? 0.09 : 0.12)
    : (cpc / (cvr / 100)) * 0.7; // ~%30 organik + tekrar eden müşteri harmanı
  const cac = clamp(r2(rawCac), 1.2, retail * 0.45);

  const rr = returnRate(retail, input.platform);
  const returns_cost = rr * (supplier + shipping + retail * 0.05);
  const misc = 0.45; // packaging insert, app/tool cost per order, support time

  const gross_per_unit = retail - (supplier + shipping + platform_fee + payment_fee + returns_cost + misc);
  const net_per_unit = gross_per_unit - cac;
  const net_margin_pct = r2((net_per_unit / retail) * 100);
  const breakeven_roas = gross_per_unit > 0 ? r2(retail / gross_per_unit) : 0;

  // ---- Monthly volume for an average seller: budget constrained, not market size.
  const startup = money(input.startup_cost_usd);
  const ad_budget = clamp(startup > 0 ? startup * 0.45 : 600, 300, 2500);
  const paid_units = Math.round(ad_budget / Math.max(1.5, cac));
  const organic_units = Math.round(clamp((trend - 45) / 5, 0, 14) * (competition === "Low" ? 1.4 : competition === "High" ? 0.6 : 1));
  const units = Math.max(5, paid_units + organic_units);
  const overhead = 120; // Shopify + apps + domain + basic tooling
  const monthlyNet = Math.round(units * net_per_unit + organic_units * cac - overhead);

  return {
    retail: r2(retail),
    supplier: r2(supplier),
    shipping: r2(shipping),
    platform_fee: r2(platform_fee),
    payment_fee: r2(payment_fee),
    cac: r2(cac),
    returns_cost: r2(returns_cost),
    misc,
    net_per_unit: r2(net_per_unit),
    net_margin_pct,
    gross_per_unit: r2(gross_per_unit),
    gross_margin_pct: r2((gross_per_unit / retail) * 100),
    cpc_usd: cpc,
    cvr_pct: cvr,
    breakeven_roas,
    monthly: {
      ad_budget_usd: Math.round(ad_budget),
      paid_units,
      organic_units,
      units,
      revenue_usd: Math.round(units * retail),
      overhead_usd: overhead,
      net_profit_usd: monthlyNet,
      low_usd: Math.round(monthlyNet * (monthlyNet > 0 ? 0.5 : 1.5)),
      high_usd: Math.round(monthlyNet * (monthlyNet > 0 ? 1.7 : 0.4)),
    },
    assumptions: [
      sourcingOutOfBand
        ? `Tedarik fiyatı gerçekçi banda çekildi (perakendenin ~%30'u): $${r2(supplier)}`
        : `Tedarik fiyatı kaynak verisinden: $${r2(supplier)}`,
      `${label} + ödeme komisyonu %2.9 + $0.30`,
      isMarketplace
        ? `Reklam gideri satışın %${Math.round((cac / retail) * 100)}'i (pazaryeri TACoS) → $${r2(cac)}/sipariş`
        : `CPC $${cpc} · dönüşüm %${cvr} → müşteri edinme maliyeti $${r2(cac)} (%30 organik/tekrar harmanlı)`,
      `İade/hasar oranı %${Math.round(rr * 100)} maliyete yansıtıldı`,
      `Aylık $${Math.round(ad_budget)} reklam bütçesi ve $${overhead} sabit gider varsayıldı`,
    ],
  };
}

/** Formats a USD amount the same way the cards do. */
export function usd(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}
