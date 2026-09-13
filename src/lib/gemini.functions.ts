import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini, extractJson } from "@/lib/ai.server";
import type { RealEconomics } from "@/lib/real-economics";
import {
  type ConsensusResult,
  type CouncilSummary,
  type HybridScore,
} from "@/lib/consensus-types";
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

export const BUDGETS = ["$0 - $500", "$500 - $2,000", "$2,000 - $10,000", "$10,000+"] as const;
export type Budget = (typeof BUDGETS)[number];

export const TARGET_COUNTRY_CODES = ["GLOBAL", "US", "DE", "UK", "FR", "CA", "AU"] as const;

// NOT: Bu şema `@/lib/discovery-pipeline.server` içindeki `DiscoveryInputSchema`
// ile birebir aynı tutulmalıdır (biri istemci paketine giden bu modülde,
// diğeri /api/search ve /api/worker sunucu rotalarında kullanılır).
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
  sourcing: z
    .enum(["any", "aliexpress", "alibaba", "local", "print_on_demand"])
    .optional()
    .default("any"),
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
  /** Ülke + platform karar gerekçesi (Winner Gate üretir). */
  market_verdict?: import("@/lib/market-verdict").MarketVerdict;
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
  personas?: Array<{
    name: string;
    age_range: string;
    pain: string;
    trigger: string;
    where_to_find: string;
  }>;
  keyword_opportunities?: Array<{
    keyword: string;
    monthly_volume: string;
    difficulty: "Low" | "Medium" | "High";
    intent: string;
  }>;
  differentiation?: string[];
  review_pain_points?: Array<{ complaint: string; fix: string }>;
  bundles?: Array<{ name: string; contents: string; price_usd: string; why: string }>;
  risks?: Array<{ risk: string; severity: "Low" | "Medium" | "High"; mitigation: string }>;
  launch_roadmap?: Array<{
    phase: string;
    days: string;
    actions: string[];
    budget_usd: string;
    kpi: string;
  }>;
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
  // 14'lü AI Konsey verdict (3 teams + referees + director synthesis)
  council?: CouncilSummary;
  /** Ortak karar puanı: (hibrit skor + AI Konsey Aroless skoru) / 2 */
  unified_score?: number;
  /** Canlı kaynaklardan doğrulanmış piyasa kanıtı (Trends + tedarik + ilanlar). */
  market_evidence?: MarketEvidence;
  /** 0-100: sonucun gerçek piyasa verisiyle ne kadar örtüştüğü. */
  realism_score?: number;
  /** Winner Gate + Winner Score katmanı (tek, açıklanabilir kazanan puanı). */
  winner_score?: number;
  score_breakdown?: WinnerBreakdown;
  evidence_level?: WinnerBreakdown["evidence_level"];
  /** Gerçek dünya verisine dayalı birim + aylık ekonomi (deterministik, AI değil). */
  real_economics?: RealEconomics;
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

/**
 * Ürün bulucu — ASENKRON (Publish → Poll).
 *
 * Ağır Gemini + scraping hattı artık bu istek içinde çalışmaz: iş QStash ile
 * `/api/worker`'a yayınlanır, `searches` tablosundaki kayıt `completed` olana
 * kadar hafif yoklama yapılır. Böylece 90 saniyelik sunucu zaman aşımı yerine
 * arka plan işçisinin uzun süre limiti (maxDuration) geçerli olur.
 *
 * QStash yapılandırılmamışsa veya iş kuyruğa alınamazsa hat aynı istek içinde
 * (eski davranış) çalıştırılır — hiçbir durumda arama tamamen bozulmaz.
 */
export const generateProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { runProductDiscovery } = await import("@/lib/discovery-pipeline.server");
    const jobs = await import("@/lib/discovery-jobs.server");

    const inline = () =>
      runProductDiscovery(data, {
        supabase: context.supabase,
        userId: context.userId,
        deductCredit: true,
      });

    if (!jobs.qstashConfigured()) return await inline();

    let accessToken = "";
    let origin = "";
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const request = getRequest();
      accessToken = (request?.headers?.get("authorization") ?? "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      origin = request ? jobs.appOrigin(request) : "";
    } catch {
      accessToken = "";
      origin = "";
    }
    // İşçi, kredi düşümü ve RLS için kullanıcının JWT'sine ihtiyaç duyar.
    if (!accessToken || !origin) return await inline();

    const started = await jobs.startDiscoveryJob({
      input: data,
      userId: context.userId,
      accessToken,
      origin,
    });
    if (!started.ok) {
      console.warn(`[discovery] background job unavailable (${started.error}) — running inline`);
      return await inline();
    }

    const finished = await jobs.waitForJob(started.jobId, {
      timeoutMs: 240_000,
      intervalMs: 2_000,
    });
    if (finished.status === "completed" && finished.result) {
      return finished.result as Awaited<ReturnType<typeof inline>>;
    }
    if (finished.status === "failed") {
      throw new Error(finished.error || "Arama tamamlanamadı.");
    }
    throw new Error(
      `Analiz hâlâ arka planda çalışıyor. Birkaç dakika içinde tekrar deneyin (jobId: ${started.jobId}).`,
    );
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
  .handler(
    async ({ data, context }): Promise<{ report: ValidationReport; creditsRemaining: number }> => {
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
        candidate
          ? `Retail price band: ${candidate.price_band_usd} | Supplier cost: ${candidate.supplier_cost_usd}`
          : "",
        candidate
          ? `Demand signal: ${candidate.demand_signal} | Best channel: ${candidate.channel}`
          : "",
        scan.market_note ? `Market note: ${scan.market_note}` : "",
        data.platforms.length ? `Seller channels: ${data.platforms.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const consensus = await runConsensus({ context: ctx });
      return {
        report: {
          query: data.query,
          product_name: productName,
          market_note: scan.market_note,
          consensus,
        },
        creditsRemaining: remaining as number,
      };
    },
  );

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
      if (/jwt/i.test(msg))
        return { email: null, credits: 0, subscription_tier: "Free", stale_token: true };
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
  titles: string[]; // 5 SEO product titles
  meta_descriptions: string[]; // 3 meta descriptions <=160 chars
  keywords: string[]; // 15 keywords/tags
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
    if (error) {
      // Clock-skew / stale token ("JWT issued at future") must not blank the app.
      if (/jwt/i.test(String(error.message))) return [] as FavoriteRow[];
      throw new Error(error.message);
    }
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
    const { error } = await context.supabase.from("favorites").insert({
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
    const { error } = await context.supabase
      .from("favorites")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
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
  count: number; // people out of 100
  buyers: number; // of that segment
  profile: string; // who they are
  reason: string; // why they buy / don't
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
    segs.forEach((s) => {
      if (s.buyers > s.count) s.buyers = s.count;
    });
    const buyers = Math.min(
      100,
      segs.reduce((a, s) => a + s.buyers, 0),
    );
    parsed.segments = segs;
    parsed.buyers = buyers;
    parsed.non_buyers = 100 - buyers;
    return parsed;
  });
