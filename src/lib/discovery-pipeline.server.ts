/**
 * Ağır ürün keşif hattı (Gemini + canlı kanıt + konsey + skorlama).
 *
 * Bu modül SADECE sunucuda çalışır ve hem senkron `generateProducts` server
 * function'ı hem de QStash arka plan işçisi (`/api/worker`) tarafından
 * kullanılır. Tek kaynak = tek davranış: iki yol arasında sonuç farkı olamaz.
 *
 * NOT: `DiscoveryInputSchema`, `@/lib/gemini.functions` içindeki `InputSchema`
 * ile birebir aynı tutulmalıdır (biri istemci paketine giden modülde, diğeri
 * sunucu rotalarında kullanılır).
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { callGemini, callLovableAI, extractJson, withDeadline } from "@/lib/ai.server";
import { normalizeProduct } from "@/lib/consistency";
import type { CouncilReport } from "@/lib/council.server";
import { HYBRID_RELAXED_MIN_SCORE, type CouncilSummary } from "@/lib/consensus-types";
import { countryName } from "@/lib/countries";
import { marketBriefBlock, countryAngles } from "@/lib/platform-market";
import type { GitHubRepoTrend } from "@/lib/github-trends.server";
import type { Platform, Budget, WinningProduct } from "@/lib/gemini.functions";

export const DISCOVERY_PLATFORMS = [
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

export const DISCOVERY_BUDGETS = [
  "$0 - $500",
  "$500 - $2,000",
  "$2,000 - $10,000",
  "$10,000+",
] as const;

export const DiscoveryInputSchema = z.object({
  niche: z.string().min(2).max(120),
  category: z.string().min(1).max(60).optional().default("Any"),
  audience: z.string().max(120).optional().default(""),
  platforms: z.array(z.enum(DISCOVERY_PLATFORMS)).min(1).max(DISCOVERY_PLATFORMS.length),
  budget: z.enum(DISCOVERY_BUDGETS),
  target_country: z.string().max(10).optional().default("GLOBAL"),
  min_score: z.number().optional().default(65),
  marketplace: z.enum(["global", "turkey"]).optional().default("global"),
  lang: z.string().max(5).optional().default("en"),
  use_github_trends: z.boolean().optional().default(true),
  depth: z.enum(["standard", "deep", "ultra"]).optional().default("standard"),
  include_keywords: z.string().max(200).optional().default(""),
  exclude_keywords: z.string().max(200).optional().default(""),
  price_target_min: z.number().min(0).max(100000).optional().default(0),
  price_target_max: z.number().min(0).max(100000).optional().default(0),
  sourcing: z
    .enum(["any", "aliexpress", "alibaba", "local", "print_on_demand"])
    .optional()
    .default("any"),
  season: z.string().max(80).optional().default(""),
  competition_pref: z.enum(["any", "low"]).optional().default("any"),
  novelty: z.enum(["any", "fresh", "proven"]).optional().default("any"),
});

/** Hattın beklediği, doğrulanmış arama girdisi. */
export type DiscoveryInput = {
  niche: string;
  category: string;
  audience: string;
  platforms: Platform[];
  budget: Budget;
  target_country: string;
  min_score: number;
  marketplace: "global" | "turkey";
  lang: string;
  use_github_trends: boolean;
  depth: "standard" | "deep" | "ultra";
  include_keywords: string;
  exclude_keywords: string;
  price_target_min: number;
  price_target_max: number;
  sourcing: "any" | "aliexpress" | "alibaba" | "local" | "print_on_demand";
  season: string;
  competition_pref: "any" | "low";
  novelty: "any" | "fresh" | "proven";
};

export type DiscoveryContext = {
  /** Kullanıcı JWT'si ile oluşturulmuş istemci (kredi RPC'leri auth.uid() görür). */
  supabase: SupabaseClient<Database>;
  userId: string;
  /** true ise kredi bu çağrı içinde atomik olarak düşülür. */
  deductCredit?: boolean;
  /** Kredi yukarıda düşüldüyse kalan bakiye. */
  creditsRemaining?: number;
  /**
   * Hattın tamamlanması için ayrılan süre (ms). Vercel Hobby planında
   * fonksiyon limiti 60 sn olduğu için işçi ~44 sn'lik bir bütçe gönderir ve
   * hat pahalı/opsiyonel adımları atlayarak limitin içinde kalır.
   */
  budgetMs?: number;
};

export type DiscoveryResult = {
  products: WinningProduct[];
  rejected: Array<{
    name: string;
    emoji: string;
    selling_price_usd: string;
    supplier_price_usd: string;
    competition_level: WinningProduct["competition_level"];
    rejection_reason: string;
    market_verdict: WinningProduct["market_verdict"];
  }>;
  creditsRemaining: number;
  target_country: string;
  min_score: number;
  fallback: { type: "relaxed"; message: string } | null;
  fallback_engine: string;
  /**
   * AI Konsey karneyi bu koşuda hiç çalıştırmadı (hat 280 sn'ye sıkıştı ve
   * ürün başına ayrılan rezerv kadar süre kalmadı). UI bunu dürüstçe söyler.
   */
  skipped_council?: boolean;
};

/** Compact, model-friendly summary of a product used as debate context. */
function productDebateContext(p: WinningProduct): string {
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

export async function runProductDiscovery(
  data: DiscoveryInput,
  ctx: DiscoveryContext,
): Promise<DiscoveryResult> {
  let remaining: number = ctx.creditsRemaining ?? 0;

  if (ctx.deductCredit) {
    const { data: deducted, error: deductErr } = await ctx.supabase.rpc(
      "deduct_product_finder_credit",
    );
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }
    remaining = (deducted as number) ?? 0;
  }

  // ---- Süre bütçesi (Vercel Hobby: 60 sn fonksiyon limiti) ----
  // İşçi `budgetMs` gönderir. Bütçe kısa ise ("hızlı profil") opsiyonel ama
  // pahalı adımlar atlanır; sonuç şekli hiç değişmez, yalnızca derinlik azalır.
  const startedAt = Date.now();
  const budgetMs = Math.max(20_000, ctx.budgetMs ?? 240_000);
  const fast = budgetMs <= 75_000;
  // Aşama planı — tek kaynak. Her adımın penceresini ve sonraki adımların
  // rezervini buradan alıyoruz; böylece erken bir adım (ör. zeminli açı turu)
  // bütçenin tamamını yiyip canlı doğrulamayı/konsey karneyi dışarıda bırakamaz.
  const { discoveryStagePlan, batchReserveMs, councilEnrichLimit } =
    await import("@/lib/discovery-jobs.server");
  const plan = discoveryStagePlan(budgetMs, { fast });
  const deadline = startedAt + budgetMs;
  /** Hat bu andan önce bitmeli: sonuç yazımı + yanıt için dönüş payı bırakılır. */
  const planDeadline = deadline - plan.returnFloorMs;
  const timeLeft = () => deadline - Date.now();
  const planTimeLeft = () => planDeadline - Date.now();
  /** Bu adıma başlamak sonraki adımların rezervini yiyor mu? */
  const fits = (needMs: number, reservedMs: number) => planTimeLeft() > needMs + reservedMs;

  const apiKey = process.env.GEMINI_API_KEY;

  // ---- Hazırlık kanıtları: GitHub trendi + canlı piyasa verisi ----
  // İkisi de aynı prompt'a giren BAĞIMSIZ kanıtlardır; eskiden sırayla
  // koşuyorlardı ve 280 sn'lik bütçeden ~40 sn'yi karşılıksız yiyorlardı.
  // Artık aynı anda başlıyorlar ve her biri `plan.prepMs` penceresine bağlı:
  // yavaş bir kaynak pencereyi aşamaz, kanıt gelmezse hat devam eder.
  let githubBlock = "";
  let githubTrends: GitHubRepoTrend[] = [];
  let liveBlock = "";
  if (!fast) {
    const prepCountry = (data.target_country || "GLOBAL").toUpperCase();
    const prepGh: Promise<unknown> = data.use_github_trends
      ? withDeadline(
          (async () => {
            const { fetchGitHubTrendsForNiche, summarizeGitHubTrends, formatGitHubTrendsBlock } =
              await import("@/lib/github-trends.server");
            const trends = await fetchGitHubTrendsForNiche(data.niche);
            if (!trends.length) return { trends, block: "" };
            const { summary } = await summarizeGitHubTrends(data.niche, trends, data.lang).catch(
              () => ({ summary: "" }),
            );
            return { trends, block: formatGitHubTrendsBlock(summary, trends) };
          })(),
          plan.prepMs,
          "prep:github",
        )
      : Promise.resolve(null);
    const prepLive: Promise<unknown> = withDeadline(
      (async () => {
        const { buildLiveEvidenceBlock } = await import("@/lib/market-verify.server");
        return buildLiveEvidenceBlock(data.niche, prepCountry);
      })(),
      plan.prepMs,
      "prep:live",
    );
    const [gh, live] = await Promise.allSettled([prepGh, prepLive]);
    if (gh.status === "fulfilled" && gh.value) {
      const v = gh.value as { trends: GitHubRepoTrend[]; block: string };
      githubTrends = v.trends;
      githubBlock = v.block;
    }
    if (live.status === "fulfilled") liveBlock = (live.value as string | null) ?? "";
  }

  // ---- Deep-search refinement constraints (only what the user actually set) ----
  const listify = (s: string) =>
    s
      .split(/[,;\n]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 10);
  const deepLines: string[] = [];
  const inc = listify(data.include_keywords);
  const exc = listify(data.exclude_keywords);
  if (inc.length)
    deepLines.push(
      `- MUST-HAVE ATTRIBUTES: every product must genuinely match ALL of: ${inc.join(", ")}. Drop candidates that do not.`,
    );
  if (exc.length)
    deepLines.push(`- HARD EXCLUSIONS: never return products matching any of: ${exc.join(", ")}.`);
  if (data.price_target_min > 0 || data.price_target_max > 0) {
    const lo = data.price_target_min > 0 ? `$${data.price_target_min}` : "no minimum";
    const hi = data.price_target_max > 0 ? `$${data.price_target_max}` : "no maximum";
    deepLines.push(
      `- TARGET RETAIL PRICE BAND: ${lo} to ${hi}. The realistic selling price must sit inside this band.`,
    );
  }
  if (data.sourcing !== "any") {
    const map: Record<string, string> = {
      aliexpress: "AliExpress / CJ Dropshipping single-unit dropshipping (no bulk MOQ).",
      alibaba:
        "Alibaba / 1688 bulk sourcing — respect real MOQs and give per-unit landed cost at MOQ.",
      local: "Local / domestic suppliers or 3PL stock with 1-4 day delivery in the target country.",
      print_on_demand:
        "Print-on-demand / custom-printed products (Printful, Printify style) only.",
    };
    deepLines.push(`- SOURCING MODEL (mandatory): ${map[data.sourcing]}`);
  }
  if (data.season.trim())
    deepLines.push(
      `- SEASON / TIMING: optimise for "${data.season.trim()}" — demand must be rising or peaking in that window, and say why in why_winning.`,
    );
  if (data.competition_pref === "low")
    deepLines.push(
      `- COMPETITION FILTER: only products where competition_level is genuinely "Low" (few established sellers, low ad saturation). Do not label a saturated product as Low.`,
    );
  if (data.novelty === "fresh")
    deepLines.push(
      `- MATURITY: only products whose demand started rising within the last 30-60 days (early window, not yet saturated).`,
    );
  if (data.novelty === "proven")
    deepLines.push(
      `- MATURITY: only products with a proven, sustained sales track record (consistent demand for 6+ months, verifiable review counts).`,
    );
  if (data.depth !== "standard")
    deepLines.push(
      `- RESEARCH DEPTH: ${data.depth === "ultra" ? "exhaustive" : "deep"} — run multiple distinct searches per claim, cross-check at least 2 independent sources per key number, and be explicit in confidence_reason about which source backs which figure.`,
    );
  const deepBrief = deepLines.length
    ? `\nDEEP SEARCH CONSTRAINTS (mandatory, applied before ranking):\n${deepLines.join("\n")}\n`
    : "";

  // ---- Country + platform reality (commissions, shipping, tax, barriers) ----
  const targetCode = (
    data.target_country || (data.marketplace === "turkey" ? "TR" : "GLOBAL")
  ).toUpperCase();
  const marketBrief = marketBriefBlock(data.platforms, targetCode);
  const localAngles = countryAngles(targetCode, data.platforms);

  const buildPrompt = (
    angle: string,
    extra = "",
  ) => `You are an elite e-commerce product research analyst with LIVE Google Search access.
CRITICAL: Use the Google Search tool before answering. Base every number, price, competitor, link and trend claim on real, current search results you actually retrieved. Never invent, estimate blindly, or simulate data. If a figure cannot be verified, give the closest verified real-world figure and say so in "confidence_reason".
QUALITY BAR (ENFORCED): Every product you return must pass ALL of these tests:
1. It must be a SPECIFIC, real, currently-sold product — not a category or generic description.
2. It must have at least ONE verified viral proof (TikTok/Reels/Shorts URL with real view count found via search).
3. Its net profit margin AFTER all costs (supplier + shipping + platform fee + ad spend + returns) must be ≥ 25%.
4. It must NOT be in a hyper-saturated category where 500+ identical sellers exist.
5. The selling price must be realistic for the target country's shoppers (not US prices copy-pasted for other markets).
If a product fails ANY of these tests, DROP IT and return fewer products rather than lower-quality ones.
ANGLE FOR THIS BATCH: ${angle}
VIRAL-ONLY RULE (MANDATORY): Every product you return MUST currently have a REAL, verifiable viral form on TikTok, Instagram Reels, YouTube Shorts, or a similar short-form platform — a specific video, hashtag, or creator post with real view counts you actually found via search. If a candidate product does NOT have a currently-viral form you can prove with a URL and view count, DROP IT ENTIRELY. It is better to return 1 product with rock-solid viral proof than 2 without.
ANTI-DROP-SHIPPING RULE: Do NOT return generic dropshipping products that are available on AliExpress with zero branding (e.g., random phone accessories, generic kitchen tools). Return products that have at least some brand identity, unique value proposition, or proven market demand beyond impulse buys. Products must solve a real problem or fulfill a genuine desire — not just look cool in a 15-second video.
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
      : "Global sourcing from AliExpress/Alibaba, but every demand and price claim must be validated for the target country below."
  }
${marketBrief}
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
      await ctx.supabase
        .from("profiles")
        .update({ credits: remaining + 1 })
        .eq("id", ctx.userId);
    } catch {
      /* kredi iadesi başarısız olsa da akış bozulmaz */
    }
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
  // Açı sayısı plandan gelir: zeminli aramalar PARALEL koştuğu için duvar saati
  // maliyeti neredeyse aynıdır, aday havuzu ise büyür (kalite ↑). Hızlı profilde
  // kota yakmamak için 3'te kalır.
  const angleCount = plan.angleCount;
  // İlk iki açı hedef ülkeye özel (yerel trend + yerel platform çok satanları).
  const activeAngles = [...localAngles, ...ANGLES].slice(0, angleCount);
  const anglePrompts = activeAngles.map((a) => buildPrompt(a, githubBlock + liveBlock));
  // Each angle goes out on a DIFFERENT rotated key (apiKey omitted → the
  // round-robin scheduler in ai.server picks the next cool key), with a small
  // stagger so both calls never hit the same per-minute bucket at once.
  // Zeminli tur artık SÜRE SINIRLI: yavaş bir motor ya da kota rotasyonu tek
  // başına hattın bütçesini yiyip sonraki aşamaları dışarıda bırakamaz. Süresi
  // dolan açı düşer, elimizdeki sonuçlarla devam edilir (504 yerine sonuç).
  const generationDeadlineAt = Date.now() + plan.generationMs;
  const results = await Promise.allSettled(
    anglePrompts.map(async (pr, i) => {
      if (i > 0) await new Promise((r) => setTimeout(r, 700 * i));
      return withDeadline(
        callGemini(pr, undefined, 0.9, true, undefined, generationDeadlineAt),
        generationDeadlineAt - Date.now(),
        `generation:angle${i}`,
      );
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
    p.viral_proof.some(
      (v) => v && /^https?:\/\//i.test(v.url ?? "") && String(v.views ?? "").trim().length > 0,
    );

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

  // If nothing came back, retry the first angle without grounding (strict JSON).
  // Yedek denemeler de pencereye bağlıdır: hepsi başarısız olsa bile bu blok
  // hattın kalan süresini yiyemez.
  const retryDeadlineAt = Date.now() + plan.generationMs;
  if (products.length === 0) {
    const retry = await callGemini(
      anglePrompts[0],
      apiKey,
      0.7,
      false,
      undefined,
      retryDeadlineAt,
    ).catch(() => "");
    const parsed = extractJson<{ products?: WinningProduct[] }>(retry, { products: [] });
    if (parsed.products?.length) products = parsed.products;
  }
  if (products.length === 0) {
    // Lovable AI gateway direct fallback
    const retry2 = await callGemini(
      anglePrompts[0],
      undefined,
      0.7,
      false,
      undefined,
      retryDeadlineAt,
    ).catch(() => "");
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
    const slim = await callGemini(
      slimPrompt,
      undefined,
      0.8,
      false,
      undefined,
      retryDeadlineAt,
    ).catch(() => "");
    const parsed = extractJson<{ products?: WinningProduct[] }>(slim, { products: [] });
    if (parsed.products?.length) products = parsed.products;
  }
  // ---- Cross-engine fallback: Gemini tükendiyse HF motorlarıyla dene ----
  let fallbackEngine = "gemini";
  if (products.length === 0) {
    try {
      const { buildHfPrompt, callHuggingFace, mapHfProducts, mergeHfProducts, hfTokenPool } =
        await import("@/lib/hf.server");
      const hfTokens = hfTokenPool();
      if (hfTokens.length > 0) {
        const hfBase = {
          niche: data.niche,
          category: data.category,
          audience: data.audience,
          platforms: data.platforms as string[],
          budget: data.budget,
          target_country: data.target_country,
          marketplace: data.marketplace,
          lang: data.lang,
        };
        const hfEnginePromises = [
          (async () => {
            const text = await callHuggingFace(buildHfPrompt({ ...hfBase, engine: "llama" }), "llama");
            return mapHfProducts(text, data.platforms as string[], "llama");
          })(),
          (async () => {
            const text = await callHuggingFace(buildHfPrompt({ ...hfBase, engine: "qwen" }), "qwen");
            return mapHfProducts(text, data.platforms as string[], "qwen");
          })(),
        ];
        const hfResults = await Promise.allSettled(hfEnginePromises);
        const hfLists = hfResults
          .filter(
            (r): r is PromiseFulfilledResult<ReturnType<typeof mapHfProducts>> =>
              r.status === "fulfilled",
          )
          .map((r) => r.value);
        if (hfLists.length > 0) {
          const merged = mergeHfProducts(hfLists) as unknown as WinningProduct[];
          if (merged.length > 0) {
            products = merged;
            fallbackEngine = "hf_hybrid";
          }
        }
      }
    } catch {
      // HF fallback başarısız olsa da Gemini hatasıyla devam et
    }
  }
  // ---- Son çare: 22 anahtarlık mesh — Gemini→Groq→Cerebras→SambaNova→
  // HF→OpenRouter→PROVIDER_* zincirindeki ÇALIŞAN motorla minimal şemada bir
  // kez daha dene; böylece "ürün bulunamadı" yalnızca gerçekten her motor
  // tükendiğinde görünür. ----
  if (products.length === 0) {
    try {
      const meshPrompt = `You are an e-commerce product researcher. Return STRICT JSON only.
Find 3 REAL, specific, currently trending products for:
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
      const meshText = await callLovableAI(meshPrompt, 0.7);
      const parsed = extractJson<{ products?: WinningProduct[] }>(meshText, { products: [] });
      if (parsed.products?.length) {
        products = parsed.products;
        fallbackEngine = "mesh";
      }
    } catch {
      // tüm motorlar tükendi → aşağıda kredi iade + net hata
    }
  }
  if (products.length === 0) {
    await refund();
    throw new Error(
      "The AI could not return verified products for this niche. Try a more specific niche — your credit was refunded.",
    );
  }
  const normalized = products.map((prod) =>
    normalizeProduct(prod, {
      country: data.target_country,
      category: data.category && data.category !== "Any" ? data.category : data.niche,
    }),
  );

  // ---- Winner Gate: ucuz, deterministik ön eleme (kara liste + eşikler) ----
  const gate = winnerGate(normalized, {
    minNetMargin: data.competition_pref === "low" ? 20 : 16,
    priceMin: data.price_target_min || 0,
    priceMax: data.price_target_max || 0,
    keepAtLeast: 3,
    country: targetCode,
    platforms: data.platforms,
  });
  const rejectedCandidates = gate.rejected.map((r) => ({
    name: r.product.name,
    emoji: r.product.emoji,
    selling_price_usd: r.product.selling_price_usd,
    supplier_price_usd: r.product.supplier_price_usd,
    competition_level: r.product.competition_level,
    rejection_reason: r.rejection_reason,
    market_verdict: r.verdict,
  }));
  // Pahalı derin analiz sadece kapıyı geçen en iyi adaylara uygulanır.
  const deepLimit = fast ? 3 : data.depth === "ultra" ? 8 : data.depth === "deep" ? 7 : 6;
  const gated = gate.survivors.slice(0, deepLimit);

  // ---- Hybrid scoring: AI1 Groq (55%) + AI2 Gemini logistics (45%) ----
  const country = (data.target_country || "GLOBAL").toUpperCase();
  const minScore = Math.max(0, Math.min(100, Math.round(data.min_score ?? 65)));

  const { runConsensus } = await import("@/lib/agents.server");
  const { scoreProductForCountry, runCountryCrossMatch } = await import(
    "@/lib/hybrid-scoring.server"
  );

  // Judge at most 2 products at a time: each product fans out into several
  // agent calls, so an unbounded Promise.all is what trips rate limits.
  const { mapWithConcurrency } = await import("@/lib/ai.server");
  let judged: WinningProduct[] = gated;
  // Hakem turu: kaç ürün kaldıysa o kadar süre + sonraki aşamaların rezervi.
  // (Sığmıyorsa hiç başlamaz — yarıda kesilen turdan iyi olan: tek tutarlı sonuç.)
  const judgeNeedMs = batchReserveMs(plan.judgePerProductMs, gated.length, plan.judgeConcurrency);
  if (fits(judgeNeedMs, plan.verifyReserveMs + plan.councilReserveMs)) {
    judged = await mapWithConcurrency(gated, plan.judgeConcurrency, async (p) => {
      const context = productDebateContext(p);
      // Ürün başına pencere: plan somut bir söz olsun diye her hakem turu
      // `judgePerProductMs`e bağlanır. Süre dolarsa puanlar boş kalır ama
      // sonraki aşamalar (doğrulama + konsey) planlandığı gibi çalışır.
      const [hybrid, consensus] = await withDeadline(
        Promise.all([
          scoreProductForCountry(context, country).catch(() => undefined),
          runConsensus({
            context,
            profit_margin_pct: p.profit_margin_pct,
            competition_level: p.competition_level,
          }).catch(() => undefined),
        ]),
        plan.judgePerProductMs,
        "judge",
      ).catch(() => [undefined, undefined] as [undefined, undefined]);
      return { ...p, hybrid, consensus };
    });
  }

  // Rank by the weighted hybrid score with quality bonuses:
  // +5 for products with verified viral proof (URL + views)
  // +3 for products with profit margin > 40%
  // +2 for products with 3+ platform fit options
  const ranked = [...judged].sort((a, b) => {
    const scoreA = a.hybrid?.calculated_score ?? 0;
    const scoreB = b.hybrid?.calculated_score ?? 0;
    // Quality bonuses
    const bonusA =
      ((a.viral_proof ?? []).length > 0 ? 5 : 0) +
      ((a.cost_breakdown?.net_margin_pct ?? a.profit_margin_pct ?? 0) > 40 ? 3 : 0) +
      ((a.platform_fit ?? []).length >= 3 ? 2 : 0);
    const bonusB =
      ((b.viral_proof ?? []).length > 0 ? 5 : 0) +
      ((b.cost_breakdown?.net_margin_pct ?? b.profit_margin_pct ?? 0) > 40 ? 3 : 0) +
      ((b.platform_fit ?? []).length >= 3 ? 2 : 0);
    return scoreB + bonusB - (scoreA + bonusA);
  });

  let finalProducts: WinningProduct[] = ranked.filter(
    (p) => (p.hybrid?.calculated_score ?? 0) >= minScore,
  );
  let fallback: { type: "relaxed"; message: string } | null = null;
  /** Konsey karneye yer kalmadıysa `true` — sonuç bunu dürüstçe taşır. */
  let skippedCouncil = false;

  if (finalProducts.length === 0) {
    // Fallback A — relax the threshold and show the best available.
    finalProducts = ranked
      .filter((p) => (p.hybrid?.calculated_score ?? 0) >= HYBRID_RELAXED_MIN_SCORE)
      .slice(0, 3);
    if (finalProducts.length === 0) finalProducts = ranked.slice(0, Math.min(3, ranked.length));
    fallback = {
      type: "relaxed",
      message: `Bugün ${countryName(country)} pazarında ${minScore}+ puanlı mükemmel bir eşleşme bulunamadı. Potansiyeli en yüksek alternatifler listeleniyor.`,
    };
  }

  // Fallback B — country cross-match for below-threshold survivors.
  if (fits(12_000, plan.verifyReserveMs)) {
    finalProducts = await withDeadline(
      Promise.all(
        finalProducts.map(async (p) => {
          if (!p.hybrid || p.hybrid.calculated_score >= minScore) return p;
          const alt = await runCountryCrossMatch(productDebateContext(p), country).catch(
            () => ({}),
          );
          return { ...p, hybrid: { ...p.hybrid, ...alt } };
        }),
      ),
      plan.verifyReserveMs,
      "cross-match",
    ).catch(() => finalProducts);
  }

  if (finalProducts.length === 0) {
    await refund();
    throw new Error(
      "The AI could not return verified products for this niche. Try a more specific niche — your credit was refunded.",
    );
  }

  // ---- 14'lü AI Konsey: ürün bulucu ile ORTAK KARAR (24h cached, no extra credit) ----
  // En pahalı adım. Hat 280 sn ile sınırlı olduğu için karne KISA PROFİLDE
  // (`depth: "enrich"`) çağrılır: 6 uzman ekip + müdür paralel koşar, hakem turu
  // ve bağımsız denetçi atlanır — ve bu durum ürün kartında dürüstçe yazılır.
  // Ürün başına maliyet sabittir (~62 sn rezerv), bu yüzden kaç ürünün karne
  // alacağını KALAN SÜRE belirler: tek bir ürün hattın bütçesini yiyemez.
  if (!fast) {
    const { COUNCIL_ENRICH_BUDGET_MS, COUNCIL_ENRICH_MIN_MS } =
      await import("@/lib/council-budget.server");
    const { runCouncil } = await import("@/lib/council.server");
    // Konsey kalan süreyle koşar; erken aşamalar `plan.councilReserveMs` ile onun
    // payını korur, yani bu satır artık boş kalmıyor.
    const councilCount = councilEnrichLimit(timeLeft());
    const councilTargets = finalProducts.slice(0, councilCount);
    if (councilTargets.length === 0) skippedCouncil = true;
    const withCouncil = await mapWithConcurrency(councilTargets, 1, async (p) => {
      try {
        const report = await runCouncil(
          p.name,
          country,
          data.category,
          "tr",
          Math.max(COUNCIL_ENRICH_MIN_MS, Math.min(timeLeft() - 3_000, COUNCIL_ENRICH_BUDGET_MS)),
          "enrich",
        );
        const council: CouncilSummary = {
          velora_score: report.velora_score,
          verdict: report.verdict,
          director_engine: report.director_engine,
          executive_report: report.executive_report,
          teams: report.teams.map((t: CouncilReport["teams"][number]) => ({
            team: t.team,
            title: t.title,
            score: t.score,
            engine: t.engine,
            summary: t.summary,
            review_score: t.review_score,
            reviewer_engine: t.reviewer_engine,
            review_note: t.review_note,
            confidence: t.confidence,
            weight: t.weight,
          })),
          action_plan: report.action_plan,
          risks: report.risks,
          cache_hit: report.cache_hit,
          auditor_engine: report.auditor_engine,
          auditor_score: report.auditor_score,
          auditor_note: report.auditor_note,
          confidence: report.confidence,
          disagreement: report.disagreement,
          data_coverage: report.data_coverage,
          kill_criteria: report.kill_criteria,
          depth: report.depth,
          skipped_stages: report.skipped_stages,
        };
        // Karne gövdesi boşsa (tüm motorlar susmuş) ürünü karne ile etiketlemeyiz.
        if (!council.executive_report && council.velora_score <= 0) return p;
        return { ...p, council };
      } catch {
        return p;
      }
    });
    finalProducts = [...withCouncil, ...finalProducts.slice(councilTargets.length)];
  } else {
    skippedCouncil = true;
  }

  // Ortak karar: hibrit motor puanı ile AI Konsey puanının ortalaması.
  finalProducts = finalProducts.map((p) => {
    const hybridScore = p.hybrid?.calculated_score ?? p.consensus?.average_score ?? 0;
    const velora = p.council?.velora_score;
    const unified =
      typeof velora === "number" && velora > 0
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
  // Canlı doğrulama: ürün sayısına göre ölçülen süre + konsey rezervi korunur.
  const verifyNeedMs = batchReserveMs(
    plan.verifyPerProductMs,
    finalProducts.length,
    plan.verifyConcurrency,
  );
  if (fits(verifyNeedMs, plan.councilReserveMs)) {
    const { verifyProduct } = await import("@/lib/market-verify.server");
    const verified = await mapWithConcurrency(finalProducts, plan.verifyConcurrency, async (p) => {
      const outcome = await withDeadline(
        verifyProduct(p, country),
        plan.verifyPerProductMs,
        "verify",
      ).catch(() => null);
      if (!outcome) return p;
      const { market_evidence, realism_score } = outcome;
      const base = p.unified_score ?? 0;
      return {
        ...p,
        market_evidence,
        realism_score,
        unified_score: Math.round(base * 0.8 + realism_score * 0.2),
      };
    });
    // Gerçek piyasa verisiyle örtüşen ürünler önce gelir.
    finalProducts = verified.sort(
      (a, b) =>
        (b.unified_score ?? 0) - (a.unified_score ?? 0) ||
        (b.realism_score ?? 0) - (a.realism_score ?? 0),
    );
  }

  // ---- Winner Score: tüm sinyalleri tek, açıklanabilir puana indirger ----
  {
    const { computeWinnerScore } = await import("@/lib/winner-score");
    finalProducts = finalProducts
      .map((p) => {
        const breakdown = computeWinnerScore(p);
        return {
          ...p,
          winner_score: breakdown.winner_score,
          score_breakdown: breakdown,
          evidence_level: breakdown.evidence_level,
        };
      })
      .sort(
        (a, b) =>
          (b.winner_score ?? 0) - (a.winner_score ?? 0) ||
          (b.unified_score ?? 0) - (a.unified_score ?? 0),
      );
  }

  return {
    products: finalProducts.map((p) => ({ ...p, github_trends: githubTrends })),
    rejected: rejectedCandidates,
    creditsRemaining: remaining,
    target_country: country,
    min_score: minScore,
    fallback,
    fallback_engine: fallbackEngine,
    skipped_council: skippedCouncil,
  };
}
