import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini, extractJson } from "@/lib/ai.server";
import { normalizeProduct } from "@/lib/consistency";
import { HYBRID_RELAXED_MIN_SCORE, type ConsensusResult, type CouncilSummary, type HybridScore } from "@/lib/consensus-types";
import { countryName } from "@/lib/countries";
import type { GitHubRepoTrend } from "@/lib/github-trends.server";
import type { MarketEvidence } from "@/lib/market-evidence";
import type { WinnerBreakdown } from "@/lib/winner-score";




export const PLATFORMS = [
  "Amazon",
  "eBay",
  "AliExpress",
  "Walmart",
  "Etsy",
  "Shopify",
  "WooCommerce",
  "Rakuten",
  "Zalando",
  "Mercado Libre",
  "Shopee",
  "Lazada",
  "Temu",
  "Shein",
  "Ozon",
  "JD.com",
  "Taobao",
  "Tmall",
  "Pinduoduo",
  "TikTok Shop",
  "Trendyol",
  "Hepsiburada",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const BUDGETS = [
  "$0 - $500",
  "$500 - $2,000",
  "$2,000 - $10,000",
  "$10,000+",
] as const;
export type Budget = (typeof BUDGETS)[number];

export const TARGET_COUNTRY_CODES = ["GLOBAL", "US", "DE", "UK", "FR", "CA", "AU"] as const;

const InputSchema = z.object({
  niche: z.string().min(2).max(120),
  category: z.string().min(1).max(60).optional().default("Any"),
  audience: z.string().max(120).optional().default(""),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length),
  budget: z.enum(BUDGETS),
  target_country: z.string().max(10).optional().default("GLOBAL"),
  min_score: z.number().optional().default(65),
  marketplace: z.enum(["global", "turkey"]).optional().default("global"),
  lang: z.string().max(5).optional().default("en"),
  use_github_trends: z.boolean().optional().default(true),
  // --- deep search refinements (all optional) ---
  depth: z.enum(["standard", "deep", "ultra"]).optional().default("standard"),
  include_keywords: z.string().max(200).optional().default(""),
  exclude_keywords: z.string().max(200).optional().default(""),
  price_target_min: z.number().min(0).max(100000).optional().default(0),
  price_target_max: z.number().min(0).max(100000).optional().default(0),
  sourcing: z.enum(["any", "aliexpress", "alibaba", "local", "print_on_demand"]).optional().default("any"),
  season: z.string().max(80).optional().default(""),
  competition_pref: z.enum(["any", "low"]).optional().default("any"),
  novelty: z.enum(["any", "fresh", "proven"]).optional().default("any"),
});


export type CostBreakdown = {
  supplier_cost: string;
  shipping_cost: string;
  platform_fee: string;
  ad_spend: string;
  net_profit: string;
  net_margin_pct: number;
};

export type WinningProduct = {
  name: string;
  description: string;
  why_winning: string;
  target_audience: string;
  ad_angles: string[];
  supplier_price_usd: string;
  selling_price_usd: string;
  profit_margin_pct: number;
  startup_cost_usd: string;
  platform_fit: string[];
  platform_strategy: string;
  competitor_examples: string[];
  supplier_links: string[];
  alibaba_links: string[];
  cost_breakdown: CostBreakdown;
  competition_level: "Low" | "Medium" | "High";
  trend_score: number;
  emoji: string;
  image_url?: string;
  sales_tactic?: string;
  ai_insight?: string;
  platform_difficulty?: Array<{
    platform: string;
    difficulty: "Easy" | "Medium" | "Hard";
    reason: string;
  }>;
  competitor_prices?: Array<{
    store: string;
    price: string;
    note?: string;
    url?: string;
  }>;
  // Reliability / validation scores
  health_score?: number;
  viral_probability_90d?: number;
  sellability_verdict?: "Highly Sellable" | "Moderate Risk" | "Do Not Sell";
  data_sources?: string[];
  confidence_reason?: string;
  // How many of every 1,000 people who VIEW the product actually buy it
  conversion?: {
    buyers_per_1000_views: number;
    cvr_pct: number;
    benchmark: string;
    reasoning: string;
    funnel?: {
      product_page_views: number;
      add_to_cart: number;
      checkout_started: number;
      purchases: number;
    };
  };

  // ---- Deep analysis ----
  demand?: {
    monthly_search_volume: string;
    trend_direction: "Rising" | "Stable" | "Declining";
    seasonality: string;
    peak_months: string[];
    primary_markets: string[];
  };
  unit_economics?: {
    breakeven_units: number;
    breakeven_roas: number;
    target_cpa_usd: string;
    ltv_usd: string;
    repeat_purchase_rate_pct: number;
    return_rate_pct: number;
  };
  sourcing?: {
    moq: string;
    lead_time_days: string;
    sample_cost_usd: string;
    quality_checkpoints: string[];
    shipping_method: string;
    customs_notes: string;
  };
  personas?: Array<{ name: string; age_range: string; pain: string; trigger: string; where_to_find: string }>;
  keyword_opportunities?: Array<{ keyword: string; monthly_volume: string; difficulty: "Low" | "Medium" | "High"; intent: string }>;
  differentiation?: string[];
  review_pain_points?: Array<{ complaint: string; fix: string }>;
  bundles?: Array<{ name: string; contents: string; price_usd: string; why: string }>;
  risks?: Array<{ risk: string; severity: "Low" | "Medium" | "High"; mitigation: string }>;
  launch_roadmap?: Array<{ phase: string; days: string; actions: string[]; budget_usd: string; kpi: string }>;
  scaling_playbook?: string;
  exit_criteria?: string[];
  // ---- Deeper product-finder analysis ----
  market_saturation?: {
    score: number;
    active_sellers: string;
    ad_activity: string;
    entry_window: string;
    verdict: string;
  };
  pricing_ladder?: Array<{
    tier: string;
    price_usd: string;
    positioning: string;
    expected_cvr_pct: number;
  }>;
  ad_creatives?: Array<{
    platform: string;
    format: string;
    hook: string;
    script_beats: string[];
    cta: string;
  }>;
  supplier_shortlist?: Array<{
    name: string;
    region: string;
    unit_price_usd: string;
    moq: string;
    lead_time: string;
    notes: string;
  }>;
  financial_projection?: Array<{
    month: string;
    units: number;
    revenue_usd: string;
    ad_spend_usd: string;
    net_profit_usd: string;
  }>;
  content_calendar?: Array<{ week: string; theme: string; posts: string[] }>;
  viral_proof?: Array<{
    platform: string;
    url: string;
    views: string;
    hashtag?: string;
    note?: string;
  }>;
  // 3-Agent consensus engine verdict (Agent 1 Finder vs Agent 2 Auditor)
  consensus?: ConsensusResult;
  // Hybrid 4-API country-targeted score (Groq 55% + Gemini logistics 45%)
  hybrid?: HybridScore;
  // GitHub public repo trend signal used as extra confidence input
  github_trends?: GitHubRepoTrend[];
  // 7'li AI Konsey verdict (3 teams + referees + director synthesis)
  council?: CouncilSummary;
  /** Ortak karar puanı: (hibrit skor + AI Konsey Velora skoru) / 2 */
  unified_score?: number;
  /** Canlı kaynaklardan doğrulanmış piyasa kanıtı (Trends + tedarik + ilanlar). */
  market_evidence?: MarketEvidence;
  /** 0-100: sonucun gerçek piyasa verisiyle ne kadar örtüştüğü. */
  realism_score?: number;
  /** Winner Gate + Winner Score katmanı (tek, açıklanabilir kazanan puanı). */
  winner_score?: number;
  score_breakdown?: WinnerBreakdown;
  evidence_level?: WinnerBreakdown["evidence_level"];
  /** Eleme sebebi — sadece "Elenenler" listesindeki ürünlerde dolu olur. */
  rejection_reason?: string;
};


/** Compact, model-friendly summary of a product used as debate context. */
export function productDebateContext(p: WinningProduct): string {
  return [
    `Product: ${p.name}`,
    `Description: ${p.description}`,
    `Why it could win: ${p.why_winning}`,
    `Target audience: ${p.target_audience}`,
    `Supplier cost: ${p.supplier_price_usd} | Selling price: ${p.selling_price_usd} | Margin: ${p.profit_margin_pct}%`,
    `Startup cost: ${p.startup_cost_usd} | Competition: ${p.competition_level} | Trend score: ${p.trend_score}`,
    `Channels: ${(p.platform_fit ?? []).join(", ")}`,
    p.viral_proof?.length
      ? `Viral proof: ${p.viral_proof.map((v) => `${v.platform} ${v.views} ${v.url}`).join(" | ")}`
      : "Viral proof: none provided",
  ].join("\n");
}

export const generateProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: remaining, error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // Fetch GitHub public repo trends as an additional confidence signal.
    let githubBlock = "";
    let githubTrends: GitHubRepoTrend[] = [];
    if (data.use_github_trends) {
      try {
        const { fetchGitHubTrendsForNiche, summarizeGitHubTrends, formatGitHubTrendsBlock } = await import("@/lib/github-trends.server");
        githubTrends = await fetchGitHubTrendsForNiche(data.niche);
        if (githubTrends.length) {
          const { summary } = await summarizeGitHubTrends(data.niche, githubTrends, data.lang).catch(() => ({ summary: "" }));
          githubBlock = formatGitHubTrendsBlock(summary, githubTrends);
        }
      } catch {
        githubBlock = "";
        githubTrends = [];
      }
    }

    // Live, real-world market evidence (Google Trends + live marketplace
    // listings) injected as ground truth so the model's numbers stay realistic.
    const { buildLiveEvidenceBlock } = await import("@/lib/market-verify.server");
    const liveBlock = await buildLiveEvidenceBlock(
      data.niche,
      (data.target_country || "GLOBAL").toUpperCase(),
    ).catch(() => "");



    // ---- Deep-search refinement constraints (only what the user actually set) ----
    const listify = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
    const deepLines: string[] = [];
    const inc = listify(data.include_keywords);
    const exc = listify(data.exclude_keywords);
    if (inc.length) deepLines.push(`- MUST-HAVE ATTRIBUTES: every product must genuinely match ALL of: ${inc.join(", ")}. Drop candidates that do not.`);
    if (exc.length) deepLines.push(`- HARD EXCLUSIONS: never return products matching any of: ${exc.join(", ")}.`);
    if (data.price_target_min > 0 || data.price_target_max > 0) {
      const lo = data.price_target_min > 0 ? `$${data.price_target_min}` : "no minimum";
      const hi = data.price_target_max > 0 ? `$${data.price_target_max}` : "no maximum";
      deepLines.push(`- TARGET RETAIL PRICE BAND: ${lo} to ${hi}. The realistic selling price must sit inside this band.`);
    }
    if (data.sourcing !== "any") {
      const map: Record<string, string> = {
        aliexpress: "AliExpress / CJ Dropshipping single-unit dropshipping (no bulk MOQ).",
        alibaba: "Alibaba / 1688 bulk sourcing — respect real MOQs and give per-unit landed cost at MOQ.",
        local: "Local / domestic suppliers or 3PL stock with 1-4 day delivery in the target country.",
        print_on_demand: "Print-on-demand / custom-printed products (Printful, Printify style) only.",
      };
      deepLines.push(`- SOURCING MODEL (mandatory): ${map[data.sourcing]}`);
    }
    if (data.season.trim()) deepLines.push(`- SEASON / TIMING: optimise for "${data.season.trim()}" — demand must be rising or peaking in that window, and say why in why_winning.`);
    if (data.competition_pref === "low") deepLines.push(`- COMPETITION FILTER: only products where competition_level is genuinely "Low" (few established sellers, low ad saturation). Do not label a saturated product as Low.`);
    if (data.novelty === "fresh") deepLines.push(`- MATURITY: only products whose demand started rising within the last 30-60 days (early window, not yet saturated).`);
    if (data.novelty === "proven") deepLines.push(`- MATURITY: only products with a proven, sustained sales track record (consistent demand for 6+ months, verifiable review counts).`);
    if (data.depth !== "standard") deepLines.push(`- RESEARCH DEPTH: ${data.depth === "ultra" ? "exhaustive" : "deep"} — run multiple distinct searches per claim, cross-check at least 2 independent sources per key number, and be explicit in confidence_reason about which source backs which figure.`);
    const deepBrief = deepLines.length ? `\nDEEP SEARCH CONSTRAINTS (mandatory, applied before ranking):\n${deepLines.join("\n")}\n` : "";


    const buildPrompt = (angle: string, extra = "") => `You are an elite e-commerce product research analyst with LIVE Google Search access.
CRITICAL: Use the Google Search tool before answering. Base every number, price, competitor, link and trend claim on real, current search results you actually retrieved. Never invent, estimate blindly, or simulate data. If a figure cannot be verified, give the closest verified real-world figure and say so in "confidence_reason".
ANGLE FOR THIS BATCH: ${angle}
VIRAL-ONLY RULE (MANDATORY): Every product you return MUST currently have a REAL, verifiable viral form on TikTok, Instagram Reels, YouTube Shorts, or a similar short-form platform — a specific video, hashtag, or creator post with real view counts you actually found via search. If a candidate product does NOT have a currently-viral form you can prove with a URL and view count, DROP IT ENTIRELY. It is better to return 1 product with rock-solid viral proof than 2 without.
Return UP TO 2 products that match the angle (may be 0, 1, or 2 depending on how many you can prove are viral right now). Each returned product must be your highest-conviction pick with maximum depth and rigor.
Every product MUST be a specific, nameable SKU currently sold online (e.g. "Portable Mini Ice Maker XR-500", "Sol de Janeiro Brazilian Bum Bum Cream 240ml"), not a category like "kitchen gadgets".
Ground pricing in real AliExpress / 1688 supplier costs and realistic retail selling prices for the SELECTED sales platforms. Tailor commission math, fee structure, and marketing strategy to each platform (Amazon FBA fees, TikTok Shop 5-8% + ads, Etsy listing + 6.5%, Shopify processing, Trendyol commission 12-22%, Hepsiburada commission 9-20% + local cargo, WooCommerce self-hosted, eBay 10-13%).
For every product also justify the score: cite the concrete demand signal (search/sales trend), the top 2 competitors and their price band, the main risk (saturation, IP, shipping, regulation) and one differentiation angle. Never invent placeholder numbers — if a figure is uncertain, give a conservative range.
RANK & FILTER results to fit the user's starting capital.

Brief:
- Niche: ${data.niche}
- Category: ${data.category}
- Target audience hint: ${data.audience || "(none)"}
- Selected sales platforms: ${data.platforms.join(", ")}
- Starting capital / budget: ${data.budget}
- MARKETPLACE FOCUS: ${
      data.marketplace === "turkey"
        ? "Turkey — source and price for Trendyol and Hepsiburada. Give prices in TRY (Turkish Lira), apply real Trendyol/Hepsiburada commission rates (10-22%) and local cargo costs in cost_breakdown, and score demand against Turkish local search/sales data."
        : "Global — source from AliExpress/Alibaba and benchmark retail against Amazon. Prices in USD."
    }
${deepBrief}${extra ? extra + "\n" : ""}- OUTPUT LANGUAGE: write every human-readable string in ${data.lang === "tr" ? "Turkish" : data.lang === "es" ? "Spanish" : data.lang === "de" ? "German" : data.lang === "fr" ? "French" : data.lang === "ar" ? "Arabic" : "English"} (keep URLs, numbers and product brand names as-is).


Return STRICT JSON only (a single JSON object, no prose, no markdown fences), matching:
{ "products": [ {
  "name": string (SPECIFIC real product name),
  "description": string (1-2 sentences),
  "why_winning": string (why it's trending right now — mention data/signals if possible),
  "target_audience": string,
  "ad_angles": string[3-4],
  "supplier_price_usd": string (e.g. "$4.20 (AliExpress)"),
  "selling_price_usd": string (e.g. "$29.99"),
  "profit_margin_pct": number (0-100, after platform fees),
  "startup_cost_usd": string (recommended initial inventory investment fitting the budget),
  "platform_fit": string[] (subset of the selected platforms best suited),
  "platform_strategy": string (1-2 sentences tailored to the top platform, incl. fees/commission),
  "competitor_examples": string[2-3] (real store or listing names, e.g. "Amazon: TOZO T10", "Shopify: Peace Out Acne"),
  "supplier_links": string[1-2] (AliExpress SEARCH URLs, e.g. "https://www.aliexpress.com/w/wholesale-mini-ice-maker.html"),
  "alibaba_links": string[1-2] (Alibaba.com SEARCH URLs, e.g. "https://www.alibaba.com/trade/search?SearchText=mini+ice+maker"),
  "cost_breakdown": {
    "supplier_cost": string (e.g. "$4.20"),
    "shipping_cost": string (e.g. "$2.50"),
    "platform_fee": string (fee for the top selected platform, e.g. "$3.00 (15%)"),
    "ad_spend": string (estimated CAC, e.g. "$6.00"),
    "net_profit": string (per-unit after all costs, e.g. "$14.29"),
    "net_margin_pct": number (0-100)
  },
  "competition_level": "Low"|"Medium"|"High",
  "trend_score": number (0-100),
  "emoji": string,
  "image_url": string (a REAL, publicly accessible direct product photo URL you found via search — an AliExpress/Amazon/Alibaba/manufacturer image ending in .jpg/.jpeg/.png/.webp. If you cannot verify a real direct image URL, return an empty string "" — never a stock, random or placeholder image service URL.),
  "sales_tactic": string (4-6 sentences: a DETAILED, product-specific sales & go-to-market tactic. Must include: (1) the exact hook/angle to use, (2) which content format & platform to lead with, (3) pricing/bundle/upsell play, (4) the #1 objection and how to crush it, (5) a concrete first-week action plan. Be tactical and specific to THIS product, not generic advice.),
  "ai_insight": string (2-3 sentences: AI's honest expert commentary on this specific product — its edge, biggest risk, and one tactical tip),
  "platform_difficulty": [ { "platform": string (one of the SELECTED platforms), "difficulty": "Easy"|"Medium"|"Hard", "reason": string (1 sentence: why it's easy/hard to sell there — competition, fees, audience fit) } ] (one entry PER selected platform),
  "competitor_prices": [ { "store": string (real store/marketplace name e.g. "Amazon", "Walmart", "AliExpress", "Target", a named Shopify brand), "price": string (e.g. "$34.99"), "note": string (optional, e.g. "Prime", "free shipping"), "url": string (search URL on that store for this product) } ] (3-5 entries comparing prices across DIFFERENT stores),
  "health_score": number (0-100, overall product viability considering trend, margin, competition, and supplier availability),
  "viral_probability_90d": number (0-100, likelihood this product generates viral short-form content in the next 90 days),
  "sellability_verdict": "Highly Sellable"|"Moderate Risk"|"Do Not Sell",
  "data_sources": string[] (2-4 specific signals you used, e.g. "TikTok trending hashtags", "Google Search demand", "Alibaba wholesale pricing", "Amazon BSR"),
  "confidence_reason": string (1 sentence explaining why the scores are confident or uncertain),
  "conversion": {
    "buyers_per_1000_views": number (0-120: out of every 1,000 real people who VIEW this product page/ad, how many actually purchase, based on real benchmark conversion rates for this category, price point and platform),
    "cvr_pct": number (= buyers_per_1000_views / 10, one decimal),
    "benchmark": string (the real-world benchmark source/figure you grounded this on, e.g. "Shopify 2024 avg CVR 1.4%, beauty vertical 2.7%"),
    "reasoning": string (1-2 sentences: why this product converts above/below the category benchmark),
    "funnel": { "product_page_views": number (<=1000), "add_to_cart": number, "checkout_started": number, "purchases": number (= buyers_per_1000_views) }
  },

  "demand": {
    "monthly_search_volume": string (e.g. "~48,000 US/mo (Google) + 120M TikTok views"),
    "trend_direction": "Rising"|"Stable"|"Declining",
    "seasonality": string (1 sentence on seasonal demand pattern),
    "peak_months": string[2-4] (e.g. "November", "December"),
    "primary_markets": string[2-4] (countries with strongest demand)
  },
  "unit_economics": {
    "breakeven_units": number (units to recover the recommended startup investment),
    "breakeven_roas": number (e.g. 1.8, one decimal),
    "target_cpa_usd": string (max allowable cost per acquisition, e.g. "$11.00"),
    "ltv_usd": string (estimated 12-month customer LTV),
    "repeat_purchase_rate_pct": number (0-100),
    "return_rate_pct": number (0-100, realistic for this product type)
  },
  "sourcing": {
    "moq": string (typical minimum order quantity from 1688/Alibaba),
    "lead_time_days": string (e.g. "12-20 days air, 35-45 days sea"),
    "sample_cost_usd": string,
    "quality_checkpoints": string[3-4] (specific things to inspect/test for THIS product before ordering bulk),
    "shipping_method": string (best method incl. weight/volumetric consideration),
    "customs_notes": string (certifications/compliance: CE, FDA, battery/UN38.3, electrical, cosmetics — be specific to this product)
  },
  "personas": [ { "name": string (persona label), "age_range": string, "pain": string, "trigger": string (what makes them buy now), "where_to_find": string (specific subreddits, hashtags, interest targeting) } ] (2-3 personas),
  "keyword_opportunities": [ { "keyword": string, "monthly_volume": string, "difficulty": "Low"|"Medium"|"High", "intent": string (informational/commercial/transactional + note) } ] (4-6 keywords, mix of long-tail),
  "differentiation": string[3-4] (concrete ways to differentiate this product from existing sellers: packaging, bundle, warranty, content, variant, positioning),
  "review_pain_points": [ { "complaint": string (real recurring complaint buyers make about this product type), "fix": string (how a new seller solves it) } ] (2-4 entries),
  "bundles": [ { "name": string, "contents": string, "price_usd": string, "why": string } ] (2-3 bundle/upsell offers to raise AOV),
  "risks": [ { "risk": string (specific: saturation, patent/IP, fragility, battery shipping, seasonality, ad policy restrictions), "severity": "Low"|"Medium"|"High", "mitigation": string } ] (3-4 entries),
  "launch_roadmap": [ { "phase": string (e.g. "Validate"), "days": string (e.g. "Day 1-5"), "actions": string[3-4] (concrete tasks), "budget_usd": string, "kpi": string (measurable success target) } ] (3-4 phases covering the first 30 days, budgets summing within the user's capital),
  "scaling_playbook": string (3-5 sentences: how to scale from first sales to $10k+/mo for THIS product — creative iteration, channel expansion, supplier renegotiation, retention),
  "exit_criteria": string[2-3] (measurable signals that mean you should kill this product),
  "market_saturation": {
    "score": number (0-100, 0 = untouched blue ocean, 100 = fully saturated),
    "active_sellers": string (rough count/description of sellers already on the selected platforms),
    "ad_activity": string (what Meta/TikTok ad library activity looks like for this product right now),
    "entry_window": string (how long the opportunity window likely stays open, e.g. "3-5 months"),
    "verdict": string (1 sentence: is it still worth entering and on what condition)
  },
  "pricing_ladder": [ { "tier": string (e.g. "Entry", "Core", "Premium bundle"), "price_usd": string, "positioning": string (1 sentence), "expected_cvr_pct": number (0-100, one decimal) } ] (3 tiers to price-test),
  "ad_creatives": [ { "platform": string (one of the selected/most relevant ad platforms), "format": string (e.g. "UGC 15s vertical", "static carousel"), "hook": string (the exact first-3-second line), "script_beats": string[3-5] (shot-by-shot beats or copy blocks), "cta": string } ] (3 ready-to-shoot creative briefs, each a different angle),
  "supplier_shortlist": [ { "name": string (realistic supplier/factory type or named marketplace seller), "region": string, "unit_price_usd": string, "moq": string, "lead_time": string, "notes": string (quality/negotiation note) } ] (2-3 sourcing options at different price/quality points),
  "financial_projection": [ { "month": string (e.g. "Month 1"), "units": number, "revenue_usd": string, "ad_spend_usd": string, "net_profit_usd": string } ] (3 months, realistic ramp fitting the user's capital),
  "content_calendar": [ { "week": string (e.g. "Week 1"), "theme": string, "posts": string[3-4] (specific post/video ideas) } ] (4 weeks of organic content)
  ,
  "viral_proof": [ { "platform": string (e.g. "TikTok", "Instagram Reels", "YouTube Shorts"), "url": string (REAL URL to the viral video / hashtag page / creator post you actually found), "views": string (real view or like count, e.g. "12.4M views"), "hashtag": string (optional related trending hashtag), "note": string (1 short line: what makes this clip go viral) } ] (1-3 entries — REQUIRED, at least 1 real URL. If you cannot find real viral proof, DO NOT return this product at all.)
} ] }`;

    const refund = async () => {
      try {
        await context.supabase
          .from("profiles")
          .update({ credits: (remaining as number) + 1 })
          .eq("id", context.userId);
      } catch {}
    };

    // Run parallel Gemini calls with DIFFERENT angles to (a) multiply the
    // output token headroom (each call returns 2 products with full schema)
    // and (b) surface a much more diverse, higher-quality set.
    // Deep search adds extra angles → more products, same credit cost.
    const ANGLES = [
      "VIRAL / TRENDING RIGHT NOW — high-velocity social buzz, TikTok/Reels traction, currently spiking in demand.",
      "UNDERRATED HIGH-MARGIN — proven-selling products with strong margins and lower competition/saturation than the obvious viral picks.",
      "PROBLEM-SOLVER / EVERGREEN — products that fix a painful, frequently-searched problem in this niche with steady year-round demand and easy ad angles.",
      "BUNDLE & UPSELL POTENTIAL — anchor products with natural accessories/refills that lift AOV, low return rate and easy repeat purchase.",
      "EARLY WINDOW — demand started rising in the last 30-60 days, very few established sellers, ad libraries still thin. Prove the rise with a real signal.",
      "PREMIUM / HIGH-AOV — $60-250 retail products with a defensible quality story, low return rate and buyers who are not price-shoppers.",
      "CONSUMABLE / REPEAT PURCHASE — refill, subscription or run-out products with natural repurchase cycles and high LTV.",
      "DIFFERENTIATION PLAY — a product where existing listings have loud, repeated review complaints you can fix; state the complaint and the fix.",
    ];
    const angleCount = data.depth === "ultra" ? 8 : data.depth === "deep" ? 7 : 6;
    const anglePrompts = ANGLES.slice(0, angleCount).map((a) => buildPrompt(a, githubBlock + liveBlock));
    // Each angle goes out on a DIFFERENT rotated key (apiKey omitted → the
    // round-robin scheduler in ai.server picks the next cool key), with a small
    // stagger so both calls never hit the same per-minute bucket at once.
    const results = await Promise.allSettled(
      anglePrompts.map(async (pr, i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, 700 * i));
        return callGemini(pr, undefined);
      }),
    );
    const collected: WinningProduct[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        const parsedBatch = extractJson<{ products?: WinningProduct[] }>(r.value, { products: [] });
        if (parsedBatch.products?.length) collected.push(...parsedBatch.products);
      }
    }
    // Keep only products with real viral proof (URL + views).
    const hasViralProof = (p: WinningProduct) =>
      Array.isArray(p?.viral_proof) &&
      p.viral_proof.some((v) => v && /^https?:\/\//i.test(v.url ?? "") && String(v.views ?? "").trim().length > 0);

    // Fuzzy de-duplication: aynı ürünün farklı isimleri tek adaya iner.
    const { dedupeCandidates, winnerGate } = await import("@/lib/winner-gate.server");
    const unique: WinningProduct[] = dedupeCandidates(collected as WinningProduct[]);
    // Prefer products with real viral proof, but never return an empty set
    // just because the model omitted proof URLs.
    const proven = unique.filter(hasViralProof);
    let products: WinningProduct[] = proven.length >= 3 ? proven : unique;
    // Aday havuzu geniş tutulur; asıl eleme Winner Gate + skorlamada yapılır.
    const cap = Math.max(10, angleCount * 2);
    if (products.length > cap) products = products.slice(0, cap);



    // If nothing came back, retry the first angle without grounding (strict JSON)
    if (products.length === 0) {
      const retry = await callGemini(anglePrompts[0], apiKey, 0.7, false).catch(() => "");
      const parsed = extractJson<{ products?: WinningProduct[] }>(retry, { products: [] });
      if (parsed.products?.length) products = parsed.products;
    }
    if (products.length === 0) {
      // Lovable AI gateway direct fallback
      const retry2 = await callGemini(anglePrompts[0], undefined, 0.7, false).catch(() => "");
      const parsed = extractJson<{ products?: WinningProduct[] }>(retry2, { products: [] });
      if (parsed.products?.length) products = parsed.products;
    }
    if (products.length === 0) {
      // Emergency slim-schema fallback: the full prompt likely truncated past maxOutputTokens.
      // Ask for the minimal viable shape so downstream normalizeProduct can fill defaults.
      const slimPrompt = `You are an e-commerce product researcher. Return STRICT JSON only.
Find 4 REAL, specific, currently trending products for:
- Niche: ${data.niche}
- Category: ${data.category}
- Audience: ${data.audience || "(none)"}
- Platforms: ${data.platforms.join(", ")}
- Budget: ${data.budget}

JSON shape:
{ "products": [ {
  "name": string, "description": string, "why_winning": string,
  "target_audience": string, "ad_angles": string[3],
  "supplier_price_usd": string, "selling_price_usd": string,
  "profit_margin_pct": number, "startup_cost_usd": string,
  "platform_fit": string[], "competition_level": "Low"|"Medium"|"High",
  "trend_score": number, "emoji": string,
  "sales_tactic": string, "ai_insight": string,
  "health_score": number, "viral_probability_90d": number,
  "sellability_verdict": "Highly Sellable"|"Moderate Risk"|"Do Not Sell"
} ] }`;
      const slim = await callGemini(slimPrompt, undefined, 0.8, false).catch(() => "");
      const parsed = extractJson<{ products?: WinningProduct[] }>(slim, { products: [] });
      if (parsed.products?.length) products = parsed.products;
    }
    if (products.length === 0) {
      await refund();
      throw new Error("The AI could not return verified products for this niche. Try a more specific niche — your credit was refunded.");
    }
    const normalized = products.map(normalizeProduct);

    // ---- Winner Gate: ucuz, deterministik ön eleme (kara liste + eşikler) ----
    const gate = winnerGate(normalized, {
      minNetMargin: data.competition_pref === "low" ? 20 : 16,
      priceMin: data.price_target_min || 0,
      priceMax: data.price_target_max || 0,
      keepAtLeast: 3,
    });
    const rejectedCandidates = gate.rejected.map((r) => ({
      name: r.product.name,
      emoji: r.product.emoji,
      selling_price_usd: r.product.selling_price_usd,
      supplier_price_usd: r.product.supplier_price_usd,
      competition_level: r.product.competition_level,
      rejection_reason: r.rejection_reason,
    }));
    // Pahalı derin analiz sadece kapıyı geçen en iyi adaylara uygulanır.
    const deepLimit = data.depth === "ultra" ? 8 : data.depth === "deep" ? 7 : 6;
    const gated = gate.survivors.slice(0, deepLimit);



    // ---- Hybrid scoring: AI1 Groq (55%) + AI2 Gemini logistics (45%) ----
    const country = (data.target_country || "GLOBAL").toUpperCase();
    const minScore = Math.max(0, Math.min(100, Math.round(data.min_score ?? 65)));

    const { runConsensus } = await import("@/lib/agents.server");
    const { scoreProductForCountry, runCountryCrossMatch } = await import("@/lib/hybrid-scoring.server");

    // Judge at most 2 products at a time: each product fans out into several
    // agent calls, so an unbounded Promise.all is what trips rate limits.
    const { mapWithConcurrency } = await import("@/lib/ai.server");
    const judged = await mapWithConcurrency(normalized, 2, async (p) => {
      const ctx = productDebateContext(p);
      const [hybrid, consensus] = await Promise.all([
        scoreProductForCountry(ctx, country).catch(() => undefined),
        runConsensus({
          context: ctx,
          profit_margin_pct: p.profit_margin_pct,
          competition_level: p.competition_level,
        }).catch(() => undefined),
      ]);
      return { ...p, hybrid, consensus };
    });


    // Rank by the weighted hybrid score — no strict AND gate, so the engine
    // never deadlocks into an empty result set.
    const ranked = [...judged].sort(
      (a, b) => (b.hybrid?.calculated_score ?? 0) - (a.hybrid?.calculated_score ?? 0),
    );

    let finalProducts = ranked.filter((p) => (p.hybrid?.calculated_score ?? 0) >= minScore);
    let fallback: { type: "relaxed"; message: string } | null = null;

    if (finalProducts.length === 0) {
      // Fallback A — relax the threshold and show the best available.
      finalProducts = ranked.filter((p) => (p.hybrid?.calculated_score ?? 0) >= HYBRID_RELAXED_MIN_SCORE).slice(0, 3);
      if (finalProducts.length === 0) finalProducts = ranked.slice(0, Math.min(3, ranked.length));
      fallback = {
        type: "relaxed",
        message: `Bugün ${countryName(country)} pazarında ${minScore}+ puanlı mükemmel bir eşleşme bulunamadı. Potansiyeli en yüksek alternatifler listeleniyor.`,
      };
    }

    // Fallback B — country cross-match for below-threshold survivors.
    finalProducts = await Promise.all(
      finalProducts.map(async (p) => {
        if (!p.hybrid || p.hybrid.calculated_score >= minScore) return p;
        const alt = await runCountryCrossMatch(productDebateContext(p), country).catch(() => ({}));
        return { ...p, hybrid: { ...p.hybrid, ...alt } };
      }),
    );

    if (finalProducts.length === 0) {
      await refund();
      throw new Error("The AI could not return verified products for this niche. Try a more specific niche — your credit was refunded.");
    }

    // ---- 7'li AI Konsey: ürün bulucu ile ORTAK KARAR (24h cached, no extra credit) ----
    const { runCouncil } = await import("@/lib/council.server");
    const councilTargets = finalProducts.slice(0, 5);
    const withCouncil = await mapWithConcurrency(councilTargets, 1, async (p) => {
      try {
        const report = await runCouncil(p.name, country, data.category);
        const council: CouncilSummary = {
          velora_score: report.velora_score,
          verdict: report.verdict,
          director_engine: report.director_engine,
          executive_report: report.executive_report,
          teams: report.teams.map((t) => ({
            team: t.team,
            title: t.title,
            score: t.score,
            engine: t.engine,
            summary: t.summary,
          })),
          action_plan: report.action_plan,
          risks: report.risks,
          cache_hit: report.cache_hit,
        };
        return { ...p, council };
      } catch {
        return p;
      }
    });
    finalProducts = [...withCouncil, ...finalProducts.slice(5)];

    // Ortak karar: hibrit motor puanı ile AI Konsey puanının ortalaması.
    finalProducts = finalProducts.map((p) => {
      const hybridScore = p.hybrid?.calculated_score ?? p.consensus?.average_score ?? 0;
      const velora = p.council?.velora_score;
      const unified = typeof velora === "number" && velora > 0
        ? Math.round((hybridScore + velora) / 2)
        : Math.round(hybridScore);
      return { ...p, unified_score: unified };
    });
    // En iyi özellikteki ürünler ortak puana göre en üstte.
    finalProducts.sort((a, b) => (b.unified_score ?? 0) - (a.unified_score ?? 0));
    // Kârlılık kapısı: net marjı düşük ürünler elenir, en kârlı olan en üstte.
    {
      const { rankProfitable } = await import("@/lib/profitability");
      const profitable = rankProfitable(finalProducts);
      if (profitable.length) finalProducts = profitable;
    }

    // ---- Canlı piyasa doğrulaması: her ürün gerçek kaynaklarla çapraz kontrol
    // edilir; gerçeklik puanı ortak karara ağırlıklı olarak işlenir. ----
    {
      const { verifyProduct } = await import("@/lib/market-verify.server");
      const verified = await mapWithConcurrency(finalProducts, 2, async (p) => {
        try {
          const { market_evidence, realism_score } = await verifyProduct(p, country);
          const base = p.unified_score ?? 0;
          return {
            ...p,
            market_evidence,
            realism_score,
            unified_score: Math.round(base * 0.8 + realism_score * 0.2),
          };
        } catch {
          return p;
        }
      });
      // Gerçek piyasa verisiyle örtüşen ürünler önce gelir.
      finalProducts = verified.sort(
        (a, b) =>
          (b.unified_score ?? 0) - (a.unified_score ?? 0) ||
          (b.realism_score ?? 0) - (a.realism_score ?? 0),
      );
    }





    return {
      products: finalProducts.map((p) => ({ ...p, github_trends: githubTrends })),

      creditsRemaining: remaining as number,
      target_country: country,
      min_score: minScore,
      fallback,
    };


  });

// ---------- Product Validator: "Will it sell?" ----------

const ValidateInput = z.object({
  query: z.string().min(2).max(300),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional().default([]),
});

export type ValidationReport = {
  query: string;
  product_name: string;
  market_note: string;
  consensus: ConsensusResult;
};

export const validateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ report: ValidationReport; creditsRemaining: number }> => {
    const { data: remaining, error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }

    const { runMarketAgent, runConsensus } = await import("@/lib/agents.server");
    const scan = await runMarketAgent({ query: data.query, platforms: data.platforms });
    const candidate = scan.candidates[0];
    const productName = candidate?.name || data.query;
    const ctx = [
      `User input (link / name / niche): ${data.query}`,
      `Resolved product: ${productName}`,
      candidate ? `Why now: ${candidate.why_now}` : "",
      candidate ? `Retail price band: ${candidate.price_band_usd} | Supplier cost: ${candidate.supplier_cost_usd}` : "",
      candidate ? `Demand signal: ${candidate.demand_signal} | Best channel: ${candidate.channel}` : "",
      scan.market_note ? `Market note: ${scan.market_note}` : "",
      data.platforms.length ? `Seller channels: ${data.platforms.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const consensus = await runConsensus({ context: ctx });
    return {
      report: { query: data.query, product_name: productName, market_note: scan.market_note, consensus },
      creditsRemaining: remaining as number,
    };
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("email, credits, subscription_tier")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) {
      // Token/clock-skew issues ("JWT issued at future", expired JWT) must not
      // blank the app — surface a recoverable signal the client can retry on.
      const msg = String(error.message);
      if (/jwt/i.test(msg)) return { email: null, credits: 0, subscription_tier: "Free", stale_token: true };
      throw new Error(msg);
    }
    return data ?? { email: null, credits: 0, subscription_tier: "Free" };
  });

// ---------- SEO & Marketing generator ----------

const SEO_PLATFORMS = ["TikTok", "Facebook", "Google Ads", "Instagram"] as const;
export type AdPlatform = (typeof SEO_PLATFORMS)[number];

const SeoInput = z.object({
  product: z.string().min(2).max(160),
  audience: z.string().max(160).optional().default(""),
  platform: z.enum(PLATFORMS),
});

export type SeoKit = {
  titles: string[];              // 5 SEO product titles
  meta_descriptions: string[];   // 3 meta descriptions <=160 chars
  keywords: string[];            // 15 keywords/tags
  ad_copy: { platform: AdPlatform; hook: string; primary: string; cta: string }[];
};

export const generateSeoKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SeoInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }
    const apiKey = process.env.GEMINI_API_KEY;

    const prompt = `You are a senior DTC / e-commerce copywriter and SEO specialist. Generate a complete marketing kit for the product below, optimized for the target sales platform.

Product: ${data.product}
Sales platform: ${data.platform}
Target audience: ${data.audience || "(infer)"}

Return STRICT JSON only:
{
  "titles": string[5] (high-converting SEO product titles, front-load primary keyword, <70 chars, tailored to ${data.platform} search),
  "meta_descriptions": string[3] (<=160 chars each, benefit + CTA),
  "keywords": string[15] (mix of short-tail + long-tail SEO keywords + platform tags),
  "ad_copy": [
    { "platform": "TikTok", "hook": string (scroll-stopping 1-liner), "primary": string (2-3 short punchy lines), "cta": string },
    { "platform": "Facebook", "hook": string, "primary": string (2-4 sentences, benefit-led), "cta": string },
    { "platform": "Google Ads", "hook": string (headline <=30 chars), "primary": string (description <=90 chars), "cta": string },
    { "platform": "Instagram", "hook": string, "primary": string (caption w/ 1-2 emojis), "cta": string }
  ]
}`;
    const text = await callGemini(prompt, apiKey);
    let parsed: SeoKit = { titles: [], meta_descriptions: [], keywords: [], ad_copy: [] };
    parsed = extractJson<SeoKit>(text, parsed);
    return parsed;
  });

// ---------- Creative Studio (TikTok / Reels scripts) ----------

const SCRIPT_FORMATS = ["TikTok", "Instagram Reels"] as const;
export type ScriptFormat = (typeof SCRIPT_FORMATS)[number];

const ScriptInput = z.object({
  product: z.string().min(2).max(160),
  platform: z.enum(PLATFORMS),
  audience: z.string().max(160).optional().default(""),
});

export type CreativeScript = {
  format: ScriptFormat;
  title: string;
  hook: string;
  storyline: string;
  visuals: string[];
  voiceover: string;
  cta: string;
  hashtags: string[];
  duration_seconds: number;
};

export const generateCreativeScripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScriptInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }
    const apiKey = process.env.GEMINI_API_KEY;

    const prompt = `You are a viral short-form video strategist who has scripted 9-figure DTC TikTok and Instagram Reels campaigns.
Write 2 fully-produced short-form video scripts (one TikTok, one Instagram Reels) for the product below. Each script MUST be immediately shootable by a solo creator with a phone.

Product: ${data.product}
Target sales platform: ${data.platform}
Audience: ${data.audience || "(infer)"}

Return STRICT JSON only:
{
  "scripts": [
    {
      "format": "TikTok",
      "title": string (working title),
      "hook": string (first 2 seconds — must stop the scroll),
      "storyline": string (beat-by-beat 20-40s script, numbered beats separated by \\n),
      "visuals": string[3-5] (shot list / b-roll suggestions),
      "voiceover": string (full VO script the creator reads),
      "cta": string (final call to action),
      "hashtags": string[6-10],
      "duration_seconds": number
    },
    {
      "format": "Instagram Reels",
      "title": string,
      "hook": string,
      "storyline": string,
      "visuals": string[3-5],
      "voiceover": string,
      "cta": string,
      "hashtags": string[6-10],
      "duration_seconds": number
    }
  ]
}`;
    const text = await callGemini(prompt, apiKey);
    let parsed: { scripts?: CreativeScript[] } = {};
    parsed = extractJson<{ scripts?: CreativeScript[] }>(text, { scripts: [] });
    return { scripts: parsed.scripts ?? [] };
  });

// ---------- Favorites / Product Library ----------

export type FavoriteRow = {
  id: string;
  name: string;
  collection_name: string;
  notes: string | null;
  tags: string[];
  product: WinningProduct;
  created_at: string;
};

export const listFavorites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("favorites")
      .select("id, name, collection_name, notes, tags, product, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    })) as FavoriteRow[];
  });

const SaveInput = z.object({
  name: z.string().min(1).max(200),
  collection_name: z.string().max(100).optional().default("Default"),
  product: z.any(),
});

export const saveFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("favorites")
      .insert({
        user_id: context.userId,
        name: data.name,
        collection_name: data.collection_name,
        product: data.product,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  collection_name: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export const updateFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const update: {
      name?: string;
      collection_name?: string;
      notes?: string;
      tags?: string[];
    } = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.collection_name !== undefined) update.collection_name = data.collection_name;
    if (data.notes !== undefined) update.notes = data.notes;
    if (data.tags !== undefined) update.tags = data.tags;
    if (Object.keys(update).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("favorites")
      .update(update as never)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("favorites").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CompareInput = z.object({
  favoriteIds: z.array(z.string().uuid()).min(2).max(4),
});

export const compareFavorites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompareInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("favorites")
      .select("id, name, product")
      .in("id", data.favoriteIds)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!rows || rows.length < 2) throw new Error("At least 2 saved products are required");
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      product: r.product as WinningProduct,
    }));
  });

// ---------- A/B test + 100-persona buyer simulation ----------

const SimInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(600).optional().default(""),
  selling_price_usd: z.string().max(60).optional().default(""),
  target_audience: z.string().max(300).optional().default(""),
  platform: z.string().max(60).optional().default(""),
});

export type SimSegment = {
  label: string;
  count: number;          // people out of 100
  buyers: number;         // of that segment
  profile: string;        // who they are
  reason: string;         // why they buy / don't
};

export type AbVariant = {
  id: "A" | "B";
  angle: string;
  headline: string;
  price_usd: string;
  creative: string;
  predicted_cvr_pct: number;
  predicted_ctr_pct: number;
  predicted_aov_usd: string;
  buyers_of_100: number;
};

export type BuyerSimulation = {
  buyers: number;
  non_buyers: number;
  confidence_pct: number;
  summary: string;
  segments: SimSegment[];
  top_buy_reasons: string[];
  top_objections: Array<{ objection: string; share_pct: number; fix: string }>;
  ab_test: {
    variants: AbVariant[];
    winner: "A" | "B";
    lift_pct: number;
    significance_note: string;
    recommended_test_plan: string;
  };
};

export const simulateBuyers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SimInput.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;

    const prompt = `You are a consumer-research simulator and CRO scientist.
Simulate a panel of EXACTLY 100 distinct human shoppers with varied personalities, ages, incomes, risk tolerance, shopping habits and skepticism levels, and decide how many would actually BUY the product below at the stated price, and how many would NOT.
Also design a rigorous A/B test (two different offer/creative variants) and predict which wins.

Product: ${data.name}
Description: ${data.description || "(infer)"}
Selling price: ${data.selling_price_usd || "(infer a realistic retail price)"}
Target audience: ${data.target_audience || "(infer)"}
Sales platform: ${data.platform || "(infer)"}

Rules:
- segments[].count MUST sum to exactly 100.
- Sum of segments[].buyers MUST equal top-level "buyers"; buyers + non_buyers = 100.
- Be realistic: most impulse ecommerce products convert 1-15 of 100 cold shoppers, warm/high-intent panels higher. Do not inflate.
- Each of the 8-10 segments is a different personality archetype (e.g. "Skeptical bargain hunter", "Impulsive TikTok scroller", "Research-heavy dad", "Gift buyer", "Brand-loyal premium buyer").
- ab_test.variants[].buyers_of_100 are the buyer counts if the same 100 panel saw that variant.

Return STRICT JSON only:
{
  "buyers": number, "non_buyers": number, "confidence_pct": number,
  "summary": string (2-3 sentences on why the split looks like this),
  "segments": [ { "label": string, "count": number, "buyers": number, "profile": string, "reason": string } ],
  "top_buy_reasons": string[3-5],
  "top_objections": [ { "objection": string, "share_pct": number, "fix": string } ] (3-5),
  "ab_test": {
    "variants": [
      { "id": "A", "angle": string, "headline": string, "price_usd": string, "creative": string (the ad/PDP creative concept), "predicted_cvr_pct": number, "predicted_ctr_pct": number, "predicted_aov_usd": string, "buyers_of_100": number },
      { "id": "B", "angle": string (meaningfully different from A), "headline": string, "price_usd": string, "creative": string, "predicted_cvr_pct": number, "predicted_ctr_pct": number, "predicted_aov_usd": string, "buyers_of_100": number }
    ],
    "winner": "A"|"B",
    "lift_pct": number (relative CVR lift of winner vs loser),
    "significance_note": string (sample size / duration needed to reach significance),
    "recommended_test_plan": string (2-3 sentences: budget split, duration, primary metric, kill rule)
  }
}`;

    const text = await callGemini(prompt, apiKey, 0.8);
    let parsed: BuyerSimulation | null = null;
    parsed = extractJson<BuyerSimulation | null>(text, null);
    if (!parsed || !Array.isArray(parsed.segments)) throw new Error("Simulation failed, try again");

    // normalize to exactly 100 people
    const segs = parsed.segments.map((s) => ({
      ...s,
      count: Math.max(0, Math.round(Number(s.count) || 0)),
      buyers: Math.max(0, Math.round(Number(s.buyers) || 0)),
    }));
    let total = segs.reduce((a, s) => a + s.count, 0);
    if (total !== 100 && total > 0 && segs.length) {
      segs[segs.length - 1].count += 100 - total;
      if (segs[segs.length - 1].count < 0) segs[segs.length - 1].count = 0;
      total = segs.reduce((a, s) => a + s.count, 0);
    }
    segs.forEach((s) => { if (s.buyers > s.count) s.buyers = s.count; });
    const buyers = Math.min(100, segs.reduce((a, s) => a + s.buyers, 0));
    parsed.segments = segs;
    parsed.buyers = buyers;
    parsed.non_buyers = 100 - buyers;
    return parsed;
  });
