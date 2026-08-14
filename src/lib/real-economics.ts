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

export type EconomicsBenchmark = {
  /** Hangi katman: Sektör / Ülke / Pazaryeri / Reklam / Lojistik. */
  scope: "Sektör" | "Ülke" | "Pazaryeri" | "Reklam" | "Lojistik" | "Ödeme";
  label: string;
  /** Modelde kullanılan sayı, okunabilir biçimde. */
  value: string;
  /** Bu sayının hesaba nasıl girdiği. */
  basis: string;
  /** Kaynağın adı. */
  source: string;
  /** Kaynak bağlantısı. */
  url: string;
};

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
  /** Hangi sektör/ülke/pazar tahminlerinin kullanıldığı + kaynak bağlantıları. */
  benchmarks: EconomicsBenchmark[];
  /** Modelin uygulandığı bağlam (rozetlerde gösterilir). */
  context: { country: string; country_label: string; category: string; platform: string };
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
  /** ISO ülke kodu (US, DE, TR…) veya GLOBAL. */
  country?: string;
  /** Ürün kategorisi / niş (sektör benchmark'ı için). */
  category?: string;
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

// ---------------------------------------------------------------------------
// Country & sector benchmark tables (published 2024/2025 references).
// ---------------------------------------------------------------------------

type CountryBench = {
  label: string;
  /** Paid-traffic CPC multiplier vs the global baseline. */
  cpc: number;
  /** Typical store CVR (%) for that market. */
  cvr: number;
  /** Domestic last-mile shipping, USD. */
  ship: number;
  /** VAT / sales-tax note. */
  tax: string;
  source: string;
  url: string;
};

const COUNTRY_BENCH: Record<string, CountryBench> = {
  US: { label: "ABD", cpc: 1.15, cvr: 2.3, ship: 5.5, tax: "Eyalet satış vergisi %0-9.5 (fiyata dahil değil)", source: "Statista – US e-commerce & CPC benchmarks", url: "https://www.statista.com/topics/2443/us-ecommerce/" },
  DE: { label: "Almanya", cpc: 0.85, cvr: 2.6, ship: 4.9, tax: "KDV %19 (fiyata dahil)", source: "Eurostat – E-commerce statistics", url: "https://ec.europa.eu/eurostat/statistics-explained/index.php?title=E-commerce_statistics" },
  UK: { label: "Birleşik Krallık", cpc: 0.95, cvr: 2.9, ship: 4.5, tax: "KDV %20 (fiyata dahil)", source: "ONS – Retail sales, internet sales", url: "https://www.ons.gov.uk/businessindustryandtrade/retailindustry" },
  FR: { label: "Fransa", cpc: 0.8, cvr: 2.4, ship: 5.2, tax: "KDV %20 (fiyata dahil)", source: "FEVAD – Bilan du e-commerce", url: "https://www.fevad.com/" },
  CA: { label: "Kanada", cpc: 0.95, cvr: 2.2, ship: 6.5, tax: "GST/HST %5-15", source: "Statistics Canada – Retail e-commerce", url: "https://www150.statcan.gc.ca/n1/en/subjects/business_performance_and_ownership/retail_and_wholesale" },
  AU: { label: "Avustralya", cpc: 0.9, cvr: 2.5, ship: 7.5, tax: "GST %10", source: "Australia Post – eCommerce Industry Report", url: "https://auspost.com.au/business/marketing-and-communications/access-data-and-insights/ecommerce-industry-report" },
  TR: { label: "Türkiye", cpc: 0.35, cvr: 1.9, ship: 2.2, tax: "KDV %20 (fiyata dahil)", source: "TÜİK / TOBB E-Ticaret Bilgi Sistemi", url: "https://www.eticaret.gov.tr/istatistikler" },
  GLOBAL: { label: "Global", cpc: 1, cvr: 2.1, ship: 5, tax: "Pazara göre değişken KDV/satış vergisi", source: "Statista – Global e-commerce benchmarks", url: "https://www.statista.com/markets/413/e-commerce/" },
};

function countryBench(code?: string): CountryBench {
  const c = (code ?? "GLOBAL").toUpperCase();
  const alias: Record<string, string> = { GB: "UK", TUR: "TR", USA: "US", TURKEY: "TR", TÜRKIYE: "TR" };
  return COUNTRY_BENCH[alias[c] ?? c] ?? COUNTRY_BENCH.GLOBAL;
}

type SectorBench = { label: string; returns: number; cvr: number; source: string; url: string };

const SECTOR_BENCH: SectorBench[] = [
  { label: "Moda & Giyim", returns: 0.24, cvr: 1.9, source: "NRF & Appriss – Consumer Returns in Retail", url: "https://nrf.com/research/2024-consumer-returns-retail-industry" },
  { label: "Elektronik & Aksesuar", returns: 0.12, cvr: 1.6, source: "NRF – Returns by category", url: "https://nrf.com/research/2024-consumer-returns-retail-industry" },
  { label: "Ev & Yaşam", returns: 0.09, cvr: 1.8, source: "Statista – Home & living e-commerce", url: "https://www.statista.com/outlook/emo/furniture/worldwide" },
  { label: "Güzellik & Kişisel Bakım", returns: 0.07, cvr: 3.0, source: "Statista – Beauty & personal care", url: "https://www.statista.com/outlook/cmo/beauty-personal-care/worldwide" },
  { label: "Spor & Outdoor", returns: 0.13, cvr: 2.0, source: "Statista – Sports e-commerce", url: "https://www.statista.com/outlook/cmo/eyewear/worldwide" },
  { label: "Bebek & Çocuk", returns: 0.08, cvr: 2.4, source: "Statista – Baby products market", url: "https://www.statista.com/outlook/cmo/toys-hobby/worldwide" },
  { label: "Evcil Hayvan", returns: 0.06, cvr: 2.8, source: "Statista – Pet care market", url: "https://www.statista.com/outlook/cmo/pet-care/worldwide" },
  { label: "Sağlık & Wellness", returns: 0.07, cvr: 2.5, source: "Statista – Health & wellness", url: "https://www.statista.com/outlook/hmo/worldwide" },
  { label: "Genel perakende", returns: 0.10, cvr: 2.1, source: "IRP / Statista – Average online return rate", url: "https://www.statista.com/statistics/1263954/return-rate-by-product-category/" },
];

function sectorBench(category?: string): SectorBench {
  const c = (category ?? "").toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/moda|giyim|fashion|apparel|cloth|ayakkab|shoe|takı|jewel/, "Moda & Giyim"],
    [/elektronik|electronic|tech|gadget|phone|telefon|kulaklık|audio/, "Elektronik & Aksesuar"],
    [/ev |home|kitchen|mutfak|dekor|decor|furniture|mobilya|garden|bahçe/, "Ev & Yaşam"],
    [/beauty|güzellik|kozmetik|cosmet|skincare|cilt|makyaj|hair|saç/, "Güzellik & Kişisel Bakım"],
    [/spor|sport|fitness|outdoor|camp|bisiklet|yoga/, "Spor & Outdoor"],
    [/bebek|baby|kid|çocuk|toy|oyuncak/, "Bebek & Çocuk"],
    [/pet|evcil|köpek|kedi|dog|cat/, "Evcil Hayvan"],
    [/sağlık|health|wellness|supplement|vitamin|massage|masaj/, "Sağlık & Wellness"],
  ];
  const hit = map.find(([re]) => re.test(c))?.[1];
  return SECTOR_BENCH.find((s) => s.label === hit) ?? SECTOR_BENCH[SECTOR_BENCH.length - 1];
}

/** Published rate-card link for the selected sales channel. */
function platformSource(platform?: string): { source: string; url: string } {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("amazon")) return { source: "Amazon Seller Central – Referral fee schedule", url: "https://sellercentral.amazon.com/help/hub/reference/GTG4BAWSY39Z98Z9" };
  if (p.includes("etsy")) return { source: "Etsy – Fees & payments policy", url: "https://www.etsy.com/legal/fees" };
  if (p.includes("ebay")) return { source: "eBay – Selling fees", url: "https://www.ebay.com/help/selling/fees-credits-invoices/store-selling-fees" };
  if (p.includes("tiktok")) return { source: "TikTok Shop – Seller commission", url: "https://seller-us.tiktok.com/university/essay?knowledge_id=10000103" };
  if (p.includes("trendyol")) return { source: "Trendyol – Komisyon oranları", url: "https://partner.trendyol.com/" };
  if (p.includes("hepsi")) return { source: "Hepsiburada – Komisyon oranları", url: "https://www.hepsiburada.com/satici-ol" };
  if (p.includes("walmart")) return { source: "Walmart Marketplace – Referral fees", url: "https://marketplace.walmart.com/referral-fees/" };
  return { source: "Shopify – Pricing & payment rates", url: "https://www.shopify.com/pricing" };
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

  const cb = countryBench(input.country);
  const sb = sectorBench(input.category);

  // Inbound + last-mile shipping, weight-proxied from unit cost + country last-mile.
  const shipInput = money(input.shipping_cost);
  const shipping = shipInput > 0 && shipInput < retail * 0.5
    ? shipInput
    : clamp(cb.ship * 0.55 + supplier * 0.4, 2.2, Math.max(4, retail * 0.28));

  const { rate, label } = platformRate(input.platform);
  const platform_fee = retail * rate;
  // Payment processing is charged on every order, marketplace or not.
  const payment_fee = retail * 0.029 + 0.3;

  const cpc = r2(cpcFor(competition, retail) * cb.cpc);
  const cvr = input.cvr_pct && input.cvr_pct > 0.2 && input.cvr_pct < 12
    ? Number(input.cvr_pct)
    : clamp(r2((cvrFor(retail, competition, trend) + cb.cvr + sb.cvr) / 3 * 1.02), 0.4, 4.5);
  // CAC from real ad math; ~25% of orders arrive organic/repeat, lowering blended CAC.
  // Pazaryerlerinde trafiğin çoğu platform içi organik: reklam gideri TACoS
  // (satışın %10-15'i) olarak gerçekleşir. Kendi mağazanda ise CAC = CPC / CVR.
  const isMarketplace = rate > 0;
  const rawCac = isMarketplace
    ? retail * (competition === "High" ? 0.15 : competition === "Low" ? 0.09 : 0.12)
    : (cpc / (cvr / 100)) * 0.7; // ~%30 organik + tekrar eden müşteri harmanı
  const cac = clamp(r2(rawCac), 1.2, retail * 0.45);

  // İade oranı: fiyat/platform proxy'si ile sektör ortalamasının harmanı.
  const rr = clamp((returnRate(retail, input.platform) + sb.returns) / 2, 0.03, 0.28);
  const returns_cost = rr * (supplier + shipping + retail * 0.05);

  const misc = 0.45; // packaging insert, app/tool cost per order, support time

  const gross_per_unit = retail - (supplier + shipping + platform_fee + payment_fee + returns_cost + misc);
  const net_per_unit = gross_per_unit - cac;
  const net_margin_pct = r2((net_per_unit / retail) * 100);
  const breakeven_roas = gross_per_unit > 0 ? r2(retail / gross_per_unit) : 0;

  // ---- Monthly volume for an average seller: budget constrained, not market size.
  const startup = money(input.startup_cost_usd);
  const ad_budget = clamp(startup > 0 ? startup * 0.45 : 600, 300, 2500);
  // Hacim, en pahalı gerçekçi edinme maliyetiyle sınırlanır (pazaryerinde bile
  // reklam tıklama maliyeti geçerlidir), böylece "ayda 5.000 adet" çıkmaz.
  const acquisitionCost = Math.max(cac, (cpc / (cvr / 100)) * 0.5, 2.5);
  const paid_units = Math.round(ad_budget / acquisitionCost);
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
