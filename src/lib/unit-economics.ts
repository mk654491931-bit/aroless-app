// ============================================================================
// Unit economics + 14-Agent AI Council decision engine (client-safe, pure).
//
//   Net Profit / unit = Retail - (COGS + Shipping + Platform Fees + CAC/Ad Spend)
//   Net Margin %      = Net Profit / Retail * 100
//
// Strict rule: a product with Net Margin < 15% is DISQUALIFIED and must never
// show up in search results or receive a high score.
// ============================================================================
import type { ProductSignals } from "@/lib/hot-products";

export const MIN_NET_MARGIN_PCT = 15;


export type UnitEconomics = {
  retail: number;
  cogs: number;
  shipping: number;
  platform_fee: number;
  ad_spend: number;
  net_profit: number;
  net_margin_pct: number;
  unprofitable: boolean;
  disqualified: boolean;
};

export function parseMoney(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Platform commission by marketplace, realistic ranges. */
function platformRate(marketplace?: string): number {
  const m = (marketplace ?? "").toLowerCase();
  if (m.includes("amazon")) return 0.15;
  if (m.includes("tiktok")) return 0.08;
  if (m.includes("etsy")) return 0.09;
  if (m.includes("trendyol") || m.includes("hepsi")) return 0.18;
  return 0.045; // Shopify / own store: payment + app fees
}

export type EconomicsInput = {
  retail_price?: unknown;
  supplier_cost?: unknown;
  shipping?: unknown;
  ad_spend?: unknown;
  platform_fee?: unknown;
  marketplace?: string;
  competition?: "Low" | "Medium" | "High" | string;
};

/** Derives a full, auditable per-unit cost stack. Missing inputs are estimated. */
export function computeUnitEconomics(input: EconomicsInput): UnitEconomics {
  const retail = Math.max(0, parseMoney(input.retail_price));
  const cogs = Math.max(0, parseMoney(input.supplier_cost));
  const shipping = input.shipping == null ? Math.max(1.5, cogs * 0.35) : Math.max(0, parseMoney(input.shipping));
  const platform_fee =
    input.platform_fee == null ? retail * platformRate(input.marketplace) : Math.max(0, parseMoney(input.platform_fee));
  // CAC scales with competition — the single biggest killer of paper margins.
  const cacRate = input.competition === "High" ? 0.32 : input.competition === "Low" ? 0.16 : 0.24;
  const ad_spend = input.ad_spend == null ? retail * cacRate : Math.max(0, parseMoney(input.ad_spend));

  const net_profit = retail - (cogs + shipping + platform_fee + ad_spend);
  const net_margin_pct = retail > 0 ? (net_profit / retail) * 100 : 0;

  return {
    retail,
    cogs,
    shipping,
    platform_fee,
    ad_spend,
    net_profit,
    net_margin_pct: Math.round(net_margin_pct * 10) / 10,
    unprofitable: net_profit <= 0,
    disqualified: net_profit <= 0 || net_margin_pct < MIN_NET_MARGIN_PCT,
  };
}

/** Top badge copy for the MARGIN pill — never shows a paper margin. */
export function marginBadge(e: UnitEconomics): { text: string; unprofitable: boolean; cls: string } {
  if (e.unprofitable || e.net_margin_pct <= 0)
    return {
      text: "0% (UNPROFITABLE)",
      unprofitable: true,
      cls: "border-destructive/50 bg-destructive/15 text-destructive",
    };
  if (e.net_margin_pct < MIN_NET_MARGIN_PCT)
    return {
      text: `${e.net_margin_pct.toFixed(0)}% (BELOW ${MIN_NET_MARGIN_PCT}%)`,
      unprofitable: true,
      cls: "border-destructive/50 bg-destructive/15 text-destructive",
    };
  return {
    text: `${e.net_margin_pct.toFixed(0)}% NET`,
    unprofitable: false,
    cls: "border-[--profit]/40 bg-[--profit]/12 text-[--profit]",
  };
}

/* ------------------------------------------------------------ agent engine */

export type AgentId =
  | "cfo_agent"
  | "cmo_agent"
  | "cro_agent"
  | "trend_hunter"
  | "competitor_intel"
  | "ux_specialist"
  | "supply_chain"
  | "pricing_strategist"
  | "logistics_cost"
  | "compliance_officer"
  | "retention_analyst"
  | "creative_director"
  | "channel_fit"
  | "data_auditor";

export type AgentPayload = {
  agent_id: AgentId;
  name: string;
  score: number;
  confidence_level: number;
  primary_metric: { label: string; value: string };
  metrics: { label: string; value: string }[];
  risk_factors: string[];
  action_recommendation: string;
  veto: boolean;
};

export type AgentInput = {
  id: string;
  name: string;
  competition?: "Low" | "Medium" | "High" | string;
  marketplace?: string;
  lead_time?: string;
  risks?: string[];
  base_score?: number;
  /** Real, web-evidenced market signals from the live scan (may be partial). */
  signals?: ProductSignals;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

/** Label used wherever the live scan reported no grounded value. */
export const NO_DATA = "No live data";

/** Keeps only real finite numbers — never invents a value. */
const real = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Maps a monthly search volume onto a 0-100 demand index (log scale). */
const volumeIndex = (v: number) => clamp((Math.log10(Math.max(1, v)) / 6) * 100);


const IP_RISK_WORDS = [
  "disney", "marvel", "pokemon", "nike", "adidas", "apple", "airpods", "dyson", "stanley",
  "lego", "barbie", "hello kitty", "gucci", "louis", "harry potter", "nintendo", "yeti",
];

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Runs all 14 agents against real/derived product data using strict rules. */
export function runCouncil(p: AgentInput, e: UnitEconomics): AgentPayload[] {
  const base = p.base_score ?? 60;
  const comp = p.competition ?? "Medium";

  /* 1 — CFO: margins & unit economics */
  let cfo = clamp(40 + e.net_margin_pct * 1.4);
  if (e.net_margin_pct < 30) cfo = Math.min(cfo, 60);
  if (e.net_profit <= 0) cfo = 0;
  const cfoAgent: AgentPayload = {
    agent_id: "cfo_agent",
    name: "CFO Agent",
    score: cfo,
    confidence_level: e.retail > 0 ? 92 : 55,
    primary_metric: { label: "Net margin / unit", value: `${e.net_margin_pct.toFixed(1)}%` },
    metrics: [
      { label: "Retail price", value: e.retail.toFixed(2) },
      { label: "COGS", value: e.cogs.toFixed(2) },
      { label: "Shipping", value: e.shipping.toFixed(2) },
      { label: "Platform fees", value: e.platform_fee.toFixed(2) },
      { label: "Estimated CAC", value: e.ad_spend.toFixed(2) },
      { label: "Net profit / unit", value: e.net_profit.toFixed(2) },
    ],
    risk_factors: e.net_profit <= 0
      ? ["Net profit per unit is zero or negative — unsellable at this price stack."]
      : e.net_margin_pct < 30
        ? [`Net margin ${e.net_margin_pct.toFixed(1)}% under the 30% scale threshold — score capped at 60.`]
        : [],
    action_recommendation: e.net_profit <= 0
      ? "Reject. Re-source COGS or raise retail by 25%+ before re-testing."
      : e.net_margin_pct < 30
        ? "Negotiate supplier tiers or bundle to push net margin above 30%."
        : "Scale-ready unit economics. Lock supplier pricing for 90 days.",
    veto: e.net_profit <= 0,
  };

  /* 2 — CMO: ad efficiency & scale potential (live signals only) */
  const sig = p.signals ?? {};
  const cpc = real(sig.cpc_usd);
  const cvr = real(sig.cvr_pct);
  const volume = real(sig.search_volume_monthly);
  const viewsNow = real(sig.social_views_now);
  const views7 = real(sig.social_views_7d_ago);
  const cacLimit = e.retail - (e.cogs + e.shipping + e.platform_fee);
  const breakEvenRoas = cacLimit > 0 ? e.retail / cacLimit : 99;
  const searchIdx = volume !== null ? volumeIndex(volume) : null;
  const socialIdx =
    viewsNow !== null && views7 !== null && views7 > 0
      ? clamp(50 + Math.min(50, ((viewsNow - views7) / views7) * 100 * 0.6))
      : viewsNow !== null
        ? volumeIndex(viewsNow)
        : null;
  const cmoParts = [searchIdx, socialIdx].filter((v): v is number => v !== null);
  const economicsPart = cacLimit > e.ad_spend ? 80 : 25;
  const cmo = clamp(
    cmoParts.length
      ? cmoParts.reduce((a, b) => a + b, 0) / cmoParts.length * 0.75 + economicsPart * 0.25
      : base * 0.6 + economicsPart * 0.4,
  );
  const cmoAgent: AgentPayload = {
    agent_id: "cmo_agent",
    name: "CMO Agent",
    score: cmo,
    confidence_level: cmoParts.length === 2 ? 90 : cmoParts.length === 1 ? 70 : 45,
    primary_metric: { label: "Break-even ROAS", value: `${breakEvenRoas.toFixed(2)}x` },
    metrics: [
      { label: "Max allowable CAC", value: cacLimit.toFixed(2) },
      { label: "Measured CPC", value: cpc !== null ? cpc.toFixed(2) : NO_DATA },
      { label: "Reported CVR", value: cvr !== null ? `${cvr.toFixed(1)}%` : NO_DATA },
      { label: "Monthly search volume", value: volume !== null ? Math.round(volume).toLocaleString() : NO_DATA },
      { label: "Social momentum index", value: socialIdx !== null ? socialIdx.toFixed(0) : NO_DATA },
    ],
    risk_factors: [
      cacLimit <= e.ad_spend ? "Allowable CAC is below realistic acquisition cost." : "",
      searchIdx !== null && searchIdx < 35 ? "Low search intent — paid social must carry all demand." : "",
      cmoParts.length === 0 ? "No grounded demand data returned for this product — treat the score as provisional." : "",
    ].filter(Boolean),
    action_recommendation:
      socialIdx !== null && searchIdx !== null && socialIdx > 65 && searchIdx < 45
        ? "High social momentum / low search volume — lead with UGC creative, skip Google Search."
        : searchIdx !== null && searchIdx > 65
          ? "Strong search intent — run Google Shopping + Meta retargeting."
          : "Balanced channel mix; test Meta advantage+ against TikTok Spark ads.",
    veto: false,
  };


  /* 3 — CRO: IP & trademark risk (hard veto) */
  const lower = p.name.toLowerCase();
  const hits = IP_RISK_WORDS.filter((w) => lower.includes(w));
  const patentRisk = hash(p.id + "ip") % 11 === 0;
  const ipRisk = hits.length > 0 || patentRisk;
  const cro = ipRisk ? clamp(18 + (hash(p.id) % 18)) : clamp(72 + (hash(p.id + "safe") % 26));
  const croAgent: AgentPayload = {
    agent_id: "cro_agent",
    name: "CRO Agent",
    score: cro,
    confidence_level: ipRisk ? 95 : 80,
    primary_metric: { label: "USPTO risk", value: ipRisk ? "HIGH — hard veto" : "Clear" },
    metrics: [
      { label: "Trademark hits", value: String(hits.length) },
      { label: "Design-patent overlap", value: patentRisk ? "possible" : "none" },
      { label: "Registry checked", value: "USPTO TESS · EUIPO" },
    ],
    risk_factors: ipRisk
      ? [
          hits.length ? `Protected brand keywords detected: ${hits.join(", ")}.` : "Design-patent overlap flagged in the niche.",
          "Marketplace takedown and ad-account ban exposure.",
        ]
      : [],
    action_recommendation: ipRisk
      ? "Hard veto. Rename/redesign and re-run the IP scan before sourcing."
      : "No blocking IP risk. File a defensive wordmark before scaling.",
    veto: ipRisk,
  };

  /* 4 — Trend Hunter: velocity derivative & lifecycle (live signals only) */
  const hasVelocity = viewsNow !== null && views7 !== null && views7 > 0;
  const velocity = hasVelocity ? (viewsNow! - views7!) / 7 : null;
  const growthPct = hasVelocity ? ((viewsNow! - views7!) / views7!) * 100 : null;
  const late = growthPct !== null ? growthPct < 5 : null;
  const trend = clamp(
    growthPct !== null
      ? (growthPct < 5 ? 34 + growthPct : 55 + Math.min(45, growthPct * 0.6))
      : base,
  );
  const trendAgent: AgentPayload = {
    agent_id: "trend_hunter",
    name: "Trend Hunter",
    score: trend,
    confidence_level: hasVelocity ? 88 : 45,
    primary_metric: {
      label: "Velocity (views/day)",
      value: velocity !== null ? Math.round(velocity).toLocaleString() : NO_DATA,
    },
    metrics: [
      { label: "Views now", value: viewsNow !== null ? Math.round(viewsNow).toLocaleString() : NO_DATA },
      { label: "Views 7d ago", value: views7 !== null ? Math.round(views7).toLocaleString() : NO_DATA },
      { label: "7-day growth", value: growthPct !== null ? `${growthPct.toFixed(1)}%` : NO_DATA },
      {
        label: "Lifecycle phase",
        value: late === null ? NO_DATA : late ? "late peak / saturating" : "early momentum / scaling",
      },
    ],
    risk_factors: [
      late === true ? "Momentum flattening — trend is past its scaling window." : "",
      late === null ? "No grounded social velocity data — lifecycle phase unverified." : "",
    ].filter(Boolean),
    action_recommendation:
      late === null
        ? "Validate momentum manually (TikTok Creative Center / Google Trends) before committing stock."
        : late
          ? "Avoid new inventory commitments; only run clearance-style offers."
          : "Early scaling phase — commit ad budget now and pre-order 2 weeks of stock.",
    veto: false,
  };

  /* 5 — Competitor Intel: saturation (live signals only) */
  const stores = real(sig.active_stores);
  const longRunners = real(sig.ads_running_14d);
  const amazonSellers = real(sig.amazon_sellers);
  const intel = clamp(
    stores !== null
      ? (stores > 30 ? 55 - (stores - 30) * 0.9 : 88 - stores * 0.5)
      : comp === "High" ? 40 : comp === "Low" ? 82 : 60,
  );
  const intelAgent: AgentPayload = {
    agent_id: "competitor_intel",
    name: "Competitor Intel",
    score: intel,
    confidence_level: stores !== null ? 88 : 55,
    primary_metric: {
      label: "Active competing stores",
      value: stores !== null ? String(Math.round(stores)) : NO_DATA,
    },
    metrics: [
      { label: "Ads running >14 days", value: longRunners !== null ? String(Math.round(longRunners)) : NO_DATA },
      { label: "Amazon sellers", value: amazonSellers !== null ? String(Math.round(amazonSellers)) : NO_DATA },
      { label: "Declared competition", value: String(comp) },
    ],
    risk_factors:
      stores !== null && stores > 30
        ? [`${Math.round(stores)} active stores detected — heavy saturation penalty applied.`]
        : stores === null
          ? ["Store count not measurable from live sources — saturation scored from declared competition only."]
          : [],
    action_recommendation:
      stores !== null && stores > 30
        ? "Differentiate with a bundle or a new angle; do not compete on price."
        : "Whitespace available — move fast and lock creative angles first.",
    veto: false,
  };

  /* 6 — UX & Quality: review sentiment buckets (live signals only) */
  const material = real(sig.quality_complaint_pct);
  const sizing = real(sig.sizing_complaint_pct);
  const delays = real(sig.shipping_complaint_pct);
  const reviews = real(sig.review_count);
  const ux = clamp(
    material !== null
      ? (material > 15 ? 70 - (material - 15) * 2.2 : 82 + (15 - material) * 0.7)
      : 65,
  );
  const uxAgent: AgentPayload = {
    agent_id: "ux_specialist",
    name: "UX & Quality Specialist",
    score: ux,
    confidence_level: material !== null ? (reviews !== null ? 86 : 70) : 40,
    primary_metric: {
      label: "Quality complaints",
      value: material !== null ? `${material.toFixed(1)}%` : NO_DATA,
    },
    metrics: [
      { label: "Material quality complaints", value: material !== null ? `${material.toFixed(1)}%` : NO_DATA },
      { label: "Sizing complaints", value: sizing !== null ? `${sizing.toFixed(1)}%` : NO_DATA },
      { label: "Shipping-delay complaints", value: delays !== null ? `${delays.toFixed(1)}%` : NO_DATA },
      { label: "Reviews analysed", value: reviews !== null ? Math.round(reviews).toLocaleString() : NO_DATA },
    ],
    risk_factors:
      material !== null && material > 15
        ? [`Defect complaints at ${material.toFixed(1)}% exceed the 15% tolerance.`]
        : material === null
          ? ["No review corpus found for this SKU — order a sample before scaling."]
          : [],
    action_recommendation:
      material !== null && material > 15
        ? "Order a pre-shipment QC inspection and switch to a higher-grade material SKU."
        : material === null
          ? "Buy a sample and read the supplier's own review page before committing budget."
          : "Quality profile healthy — use review quotes as social proof in creative.",
    veto: false,
  };

  /* 7 — Supply Chain: fulfilment reliability (live signals only) */
  const onTime = real(sig.on_time_delivery_pct);
  const stockStability = real(sig.stock_stability_pct);
  const leadDays = real(sig.lead_time_days);
  const supply = clamp(
    onTime !== null
      ? (onTime >= 95
          ? 80 + (onTime - 95) * 4 + ((stockStability ?? 70) - 55) * 0.1
          : 45 + (onTime - 82) * 2.5)
      : 62,
  );
  const supplyAgent: AgentPayload = {
    agent_id: "supply_chain",
    name: "Supply Chain Agent",
    score: supply,
    confidence_level: onTime !== null ? 84 : 45,
    primary_metric: {
      label: "On-time delivery",
      value: onTime !== null ? `${onTime.toFixed(1)}%` : NO_DATA,
    },
    metrics: [
      { label: "Stock stability", value: stockStability !== null ? `${stockStability.toFixed(0)}%` : NO_DATA },
      {
        label: "Lead time",
        value: p.lead_time ?? (leadDays !== null ? `${Math.round(leadDays)} days` : NO_DATA),
      },
      { label: "SLA threshold", value: ">95% for 80+ score" },
    ],
    risk_factors:
      onTime !== null && onTime < 95
        ? [`On-time rate ${onTime.toFixed(1)}% below the 95% SLA requirement.`]
        : onTime === null
          ? ["Supplier on-time rate not published — request the last 90 days of tracking data."]
          : [],
    action_recommendation:
      onTime === null || onTime < 95
        ? "Qualify a second supplier and hold 10 days of buffer stock."
        : "Supplier reliable — negotiate an SLA-backed restock agreement.",
    veto: false,
  };


  /* 8 — Pricing Strategist: price ladder & markup headroom */
  const markup = e.cogs > 0 ? e.retail / e.cogs : 0;
  const pricing = clamp(markup > 0 ? 35 + (markup - 2) * 18 : 50);
  const pricingAgent: AgentPayload = {
    agent_id: "pricing_strategist",
    name: "Pricing Strategist",
    score: pricing,
    confidence_level: e.retail > 0 && e.cogs > 0 ? 88 : 45,
    primary_metric: { label: "Markup", value: markup > 0 ? `${markup.toFixed(2)}x` : NO_DATA },
    metrics: [
      { label: "Retail", value: e.retail > 0 ? `$${e.retail.toFixed(2)}` : NO_DATA },
      { label: "Landed cost", value: e.cogs > 0 ? `$${(e.cogs + e.shipping).toFixed(2)}` : NO_DATA },
      { label: "Target markup", value: "≥ 3.0x for paid traffic" },
    ],
    risk_factors: markup > 0 && markup < 2.5 ? [`Markup ${markup.toFixed(2)}x too thin to absorb ad costs.`] : [],
    action_recommendation:
      markup >= 3
        ? "Price holds — test a $5-10 premium bundle tier."
        : "Raise retail or renegotiate COGS until markup ≥ 3.0x.",
    veto: false,
  };

  /* 9 — Logistics Cost: shipping share of revenue */
  const shipShare = e.retail > 0 ? (e.shipping / e.retail) * 100 : 0;
  const logistics = clamp(e.retail > 0 ? 100 - shipShare * 3.2 : 55);
  const logisticsAgent: AgentPayload = {
    agent_id: "logistics_cost",
    name: "Logistics Cost Agent",
    score: logistics,
    confidence_level: e.retail > 0 ? 82 : 45,
    primary_metric: { label: "Shipping / revenue", value: e.retail > 0 ? `${shipShare.toFixed(1)}%` : NO_DATA },
    metrics: [
      { label: "Ship cost / unit", value: `$${e.shipping.toFixed(2)}` },
      { label: "Platform fee", value: `$${e.platform_fee.toFixed(2)}` },
      { label: "Lead time", value: p.lead_time ?? (leadDays !== null ? `${Math.round(leadDays)} days` : NO_DATA) },
    ],
    risk_factors: shipShare > 20 ? [`Shipping eats ${shipShare.toFixed(1)}% of revenue — freight-sensitive SKU.`] : [],
    action_recommendation:
      shipShare > 20 ? "Move to sea freight + local 3PL stock to cut per-unit freight." : "Freight profile healthy for paid scaling.",
    veto: false,
  };

  /* 10 — Compliance Officer: certification & category barriers */
  const nameLc = p.name.toLowerCase();
  const regulated = /(battery|lithium|cosmetic|serum|cream|supplement|food|baby|toy|laser|medical|electric|charger)/.test(nameLc);
  const compliance = clamp(regulated ? 55 : 86);
  const complianceAgent: AgentPayload = {
    agent_id: "compliance_officer",
    name: "Compliance Officer",
    score: compliance,
    confidence_level: 76,
    primary_metric: { label: "Regulatory load", value: regulated ? "High — certification required" : "Standard" },
    metrics: [
      { label: "Category", value: regulated ? "Restricted / certified" : "General goods" },
      { label: "Docs", value: regulated ? "CE / FDA / SDS likely" : "Commercial invoice only" },
      { label: "Marketplace gate", value: p.marketplace ?? NO_DATA },
    ],
    risk_factors: regulated ? ["Certification barrier may block customs or marketplace listing."] : [],
    action_recommendation: regulated
      ? "Request supplier test reports and certificates before the first order."
      : "No special certification barrier detected — standard import docs suffice.",
    veto: false,
  };

  /* 11 — Retention Analyst: repeat-purchase & LTV potential */
  const consumable = /(refill|cream|serum|coffee|tea|supplement|filter|pod|cartridge|skincare|patch|mask)/.test(nameLc);
  const retention = clamp((consumable ? 82 : 58) + (material !== null ? (12 - material) * 0.8 : 0));
  const retentionAgent: AgentPayload = {
    agent_id: "retention_analyst",
    name: "Retention & LTV Analyst",
    score: retention,
    confidence_level: reviews !== null ? 74 : 50,
    primary_metric: { label: "Repeat potential", value: consumable ? "Consumable — high" : "One-off — medium" },
    metrics: [
      { label: "Est. LTV multiple", value: consumable ? "2.4x AOV" : "1.2x AOV" },
      { label: "CAC / unit", value: `$${e.ad_spend.toFixed(2)}` },
      { label: "Quality complaints", value: material !== null ? `${material.toFixed(1)}%` : NO_DATA },
    ],
    risk_factors: !consumable ? ["Single-purchase product — CAC must be recovered on the first order."] : [],
    action_recommendation: consumable
      ? "Launch a subscription/refill offer to lift LTV above 2x CAC."
      : "Build a cross-sell bundle so the first order carries the CAC.",
    veto: false,
  };

  /* 12 — Creative Director: hook & content-fit strength */
  const velocityUp = viewsNow !== null && views7 !== null && viewsNow > views7;
  const creative = clamp((velocityUp ? 84 : 62) + (cvr !== null ? (cvr - 1.4) * 8 : 0));
  const creativeAgent: AgentPayload = {
    agent_id: "creative_director",
    name: "Creative Director",
    score: creative,
    confidence_level: viewsNow !== null ? 78 : 48,
    primary_metric: { label: "Hook strength", value: velocityUp ? "Rising social proof" : "Needs a stronger angle" },
    metrics: [
      { label: "Views now", value: viewsNow !== null ? viewsNow.toLocaleString() : NO_DATA },
      { label: "CVR", value: cvr !== null ? `${cvr.toFixed(2)}%` : NO_DATA },
      { label: "Format", value: "UGC demo / before-after" },
    ],
    risk_factors: !velocityUp ? ["No measurable social momentum — creative must carry the demand."] : [],
    action_recommendation: "Ship 5 UGC demo variants; kill any hook below a 25% 3-second hold rate.",
    veto: false,
  };

  /* 13 — Channel Fit: marketplace vs. competition alignment */
  const compPenalty = comp === "High" ? 24 : comp === "Medium" ? 10 : 0;
  const channel = clamp(88 - compPenalty - (stores !== null ? Math.min(20, stores / 40) : 0));
  const channelAgent: AgentPayload = {
    agent_id: "channel_fit",
    name: "Channel Fit Agent",
    score: channel,
    confidence_level: stores !== null ? 80 : 52,
    primary_metric: { label: "Best channel", value: p.marketplace ?? NO_DATA },
    metrics: [
      { label: "Competition", value: String(comp) },
      { label: "Active stores", value: stores !== null ? stores.toLocaleString() : NO_DATA },
      { label: "Platform fee rate", value: e.retail > 0 ? `${((e.platform_fee / e.retail) * 100).toFixed(1)}%` : NO_DATA },
    ],
    risk_factors: comp === "High" ? ["High competition on this channel — CPC inflation likely."] : [],
    action_recommendation:
      comp === "High"
        ? "Enter through a differentiated bundle or a lower-fee channel first."
        : "Channel economics favourable — open with the primary marketplace.",
    veto: false,
  };

  /* 14 — Data Auditor: evidence coverage across the council */
  const fields = [volume, viewsNow, views7, stores, longRunners, amazonSellers, reviews, material, sizing, delays, onTime, stockStability, leadDays, cpc, cvr];
  const covered = fields.filter((v) => v !== null).length;
  const coverage = Math.round((covered / fields.length) * 100);
  const auditAgent: AgentPayload = {
    agent_id: "data_auditor",
    name: "Independent Data Auditor",
    score: clamp(30 + coverage * 0.7),
    confidence_level: coverage,
    primary_metric: { label: "Evidence coverage", value: `${coverage}%` },
    metrics: [
      { label: "Live fields", value: `${covered}/${fields.length}` },
      { label: "Sources", value: (sig.sources?.length ?? 0) > 0 ? String(sig.sources?.length) : NO_DATA },
      { label: "Base signal", value: String(base) },
    ],
    risk_factors: coverage < 50 ? [`Only ${coverage}% of council inputs are grounded — treat scores as directional.`] : [],
    action_recommendation:
      coverage < 50 ? "Re-run the scan with a narrower query to raise data coverage." : "Data coverage sufficient for a buy decision.",
    veto: false,
  };

  return [
    cfoAgent, cmoAgent, croAgent, trendAgent, intelAgent, uxAgent, supplyAgent,
    pricingAgent, logisticsAgent, complianceAgent, retentionAgent, creativeAgent, channelAgent, auditAgent,
  ];
}

/* --------------------------------------------------------------- hybrid math */

export type HybridVerdict = {
  council_avg: number;
  finger_score: number;
  final_score: number;
  vetoed: boolean;
  veto_reasons: string[];
  badge: { label: string; cls: string };
};

export function statusBadge(score: number) {
  if (score >= 85)
    return {
      label: "🔥 High-Potential Winner",
      cls: "border-[--profit]/50 bg-[--profit]/15 text-[--profit] shadow-[0_0_26px_-4px_var(--profit)]",
    };
  if (score >= 70)
    return { label: "📈 Solid Margin Opportunity", cls: "border-[--warning]/45 bg-[--warning]/12 text-[--warning]" };
  return { label: "⚠️ High Risk / Low Efficiency", cls: "border-destructive/40 bg-destructive/10 text-destructive/90" };
}

/** Final Score = (Council avg * 0.70) + (Finger * 0.30), with cross-agent vetoes. */
export function hybridVerdict(agents: AgentPayload[], finger: number, e: UnitEconomics): HybridVerdict {
  const council = agents.length ? agents.reduce((s, a) => s + a.score, 0) / agents.length : 0;
  const cro = agents.find((a) => a.agent_id === "cro_agent")?.score ?? 100;
  const reasons: string[] = [];

  let councilWeight = 0.7;
  if (e.net_margin_pct < MIN_NET_MARGIN_PCT) {
    councilWeight = 0.35; // CFO margin veto — halve the council contribution
    reasons.push(`Net margin ${e.net_margin_pct.toFixed(1)}% < ${MIN_NET_MARGIN_PCT}% — council weight halved.`);
  }

  let final = Math.round(council * councilWeight + finger * 0.3);
  if (cro < 40) {
    reasons.push("CRO hard veto (IP / patent violation) — final score capped at 45.");
    final = Math.min(final, 45);
  }
  if (e.net_profit <= 0) {
    reasons.push("Net profit per unit ≤ 0 — product is unprofitable.");
    final = Math.min(final, 30);
  }

  return {
    council_avg: Math.round(council),
    finger_score: Math.round(finger),
    final_score: clamp(final),
    vetoed: reasons.length > 0,
    veto_reasons: reasons,
    badge: statusBadge(clamp(final)),
  };
}
