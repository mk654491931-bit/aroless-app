// Server-only Hugging Face Inference helpers (kept out of *.functions.ts so
// server-function splitting never strips them).
// Geliştirilmiş: Response caching, provider health tracking, error categorization
import { extractJson } from "@/lib/ai.server";
import { withEstimationRules } from "./ai-guidance";

export const HF_MODELS = {
  qwen: "Qwen/Qwen2.5-7B-Instruct",
  llama: "meta-llama/Llama-3.1-8B-Instruct",
} as const;

export type HfEngine = keyof typeof HF_MODELS;

const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_CACHE_DURATION = 3_600_000; // 1 saat
const HF_REQUEST_TIMEOUT = 45_000; // 45 saniye

// Response cache
type CacheEntry = { response: string; expires: number; engine: HfEngine };
const responseCache = new Map<string, CacheEntry>();

// Provider health metrics
type ProviderMetrics = {
  successCount: number;
  failureCount: number;
  lastSuccess?: number;
  lastError?: number;
  avgResponseTime: number;
};

const providerMetrics = {
  hf: { successCount: 0, failureCount: 0, avgResponseTime: 0 } as ProviderMetrics,
  gemini: { successCount: 0, failureCount: 0, avgResponseTime: 0 } as ProviderMetrics,
  groq: { successCount: 0, failureCount: 0, avgResponseTime: 0 } as ProviderMetrics,
  premium: { successCount: 0, failureCount: 0, avgResponseTime: 0 } as ProviderMetrics,
};

/** Error kategorileri */
type ErrorCategory = "quota" | "network" | "timeout" | "invalid_response" | "unknown";

function categorizeError(status: number, body: string, error?: unknown): ErrorCategory {
  if (status === 429 || status === 402 || status === 403) return "quota";
  if (status === 0 || (error instanceof TypeError)) return "network";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (status >= 400 && status < 500) return "invalid_response";
  return "unknown";
}

function getCacheKey(prompt: string, engine: HfEngine, system?: string): string {
  const data = `${engine}:${system ?? "default"}:${prompt.slice(0, 100)}`;
  // Simple hash
  return data.split("").reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0).toString(36);
}

export function getHfMetrics() {
  return {
    cache: {
      size: responseCache.size,
      entries: Array.from(responseCache.keys()),
    },
    providers: { ...providerMetrics },
  };
}

/** Every configured HF token, de-duplicated, in rotation order (1, 2, 3 …). */
export function hfTokenPool(override?: string): string[] {
  const raw = [
    override,
    process.env["HUGGING_FACE_API_KEY1"],
    process.env["HUGGING_FACE_API_KEY_1"],
    process.env["HUGGING_FACE_API_KEY2"],
    process.env["HUGGING_FACE_API_KEY_2"],
    process.env["HUGGING_FACE_API_KEY3"],
    process.env["HUGGING_FACE_API_KEY"],
    process.env["HF_TOKEN"],
    process.env["HUGGING_FACE_TOKEN"],
  ].filter((k): k is string => Boolean(k && k.trim()));
  return Array.from(new Set(raw.map((k) => k.trim())));
}

export function hfToken(override?: string): string | null {
  return hfTokenPool(override)[0] ?? null;
}

function hfIsQuota(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 402 ||
    status === 403 ||
    status === 401 ||
    /quota|rate limit|exceeded|credits|invalid/i.test(body)
  );
}

/**
 * Raw chat completion against the HF router. Rotates keys on rate limits and,
 * when every HF token is spent (or none is configured), silently hands the
 * prompt to the other providers (Premium AI → Gemini → Groq → LovableAI) so the user never
 * sees a rate-limit error. Pass `noFallback` for pure connectivity probes.
 * 
 * Geliştirilmiş: Response cache, timeout, error categorization, metrics.
 */
export async function callHuggingFace(
  prompt: string,
  engine: HfEngine,
  opts: { token?: string; temperature?: number; system?: string; noFallback?: boolean } = {},
): Promise<string> {
  prompt = withEstimationRules(prompt);
  const cacheKey = getCacheKey(prompt, engine, opts.system);
  
  // Cache kontrol
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now() && cached.engine === engine) {
    console.log(`[hf-cache] Cache hit for ${engine} engine`);
    return cached.response;
  }

  const tokens = hfTokenPool(opts.token);
  if (!tokens.length) {
    if (opts.noFallback) throw new Error("HF_TOKEN_MISSING");
    console.log("[hf] No HF tokens configured — using fallback providers");
    return hfCrossProviderFallback(prompt, opts.temperature);
  }

  let lastErr: unknown = null;
  let lastStatus = 0;
  let successCount = 0;
  
  for (const token of tokens) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_REQUEST_TIMEOUT);
    const startTime = Date.now();
    
    try {
      const resp = await fetch(HF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: HF_MODELS[engine],
          temperature: opts.temperature ?? (engine === "qwen" ? 0.4 : 0.7),
          max_tokens: 4000,
          messages: [
            {
              role: "system",
              content:
                opts.system ??
                "You are an elite e-commerce product research analyst. Reply with STRICT JSON only — no prose, no markdown fences.",
            },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timer);
      const responseTime = Date.now() - startTime;
      
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200);
        lastStatus = resp.status;
        lastErr = new Error(`HF_ERROR ${resp.status}: ${body}`);
        const category = categorizeError(resp.status, body);
        
        console.warn(`[hf] ${engine} request failed [${resp.status}] (${category}): ${body.slice(0, 100)}`);
        
        if (hfIsQuota(resp.status, body)) {
          console.warn(`[hf] Token quota/rate limit exceeded — trying next token`);
          continue; // key spent — rotate
        }
        throw lastErr;
      }
      
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const result = json.choices?.[0]?.message?.content ?? "{}";
      
      if (!result || result.trim() === "{}") {
        console.warn("[hf] Empty response from HF — trying fallback");
        continue;
      }
      
      // Cache ve metrics
      responseCache.set(cacheKey, { response: result, expires: Date.now() + HF_CACHE_DURATION, engine });
      providerMetrics.hf.successCount++;
      providerMetrics.hf.lastSuccess = Date.now();
      providerMetrics.hf.avgResponseTime = 
        (providerMetrics.hf.avgResponseTime + responseTime) / 2;
      successCount++;
      
      console.log(`[hf] ${engine} engine successful (${responseTime}ms)`);
      return result;
      
    } catch (e) {
      clearTimeout(timer);
      const category = categorizeError(lastStatus, "", e);
      console.warn(`[hf] ${engine} error (${category}):`, e instanceof Error ? e.message : String(e));
      lastErr = e;
      
      if (category === "timeout") {
        providerMetrics.hf.failureCount++;
        providerMetrics.hf.lastError = Date.now();
        console.warn("[hf] Timeout — trying next token");
        continue;
      }
    }
  }

  if (opts.noFallback) {
    providerMetrics.hf.failureCount++;
    providerMetrics.hf.lastError = Date.now();
    throw lastErr instanceof Error ? lastErr : new Error("HF request failed");
  }

  // Bütün HF anahtarları tükendi → arkada diğer motorlar devralır.
  console.log("[hf] All HF tokens exhausted or failed — using fallback providers");
  providerMetrics.hf.failureCount++;
  providerMetrics.hf.lastError = Date.now();
  return hfCrossProviderFallback(prompt, opts.temperature);
}

/** HF tükendiğinde sessizce devreye giren diğer sağlayıcılar — metrics tracking ile. */
async function hfCrossProviderFallback(prompt: string, temperature = 0.5): Promise<string> {
  const { callPremiumAI, callLovableAI, callGemini, callGroq } = await import("@/lib/ai.server");
  
  // Fallback sırası: Premium Gateway → Gemini → Groq → LovableAI
  const chain = [
    { 
      name: "Premium AI Gateway", 
      run: () => callPremiumAI(prompt, temperature),
      metrics: providerMetrics.premium,
    },
    { 
      name: "Gemini", 
      run: () => callGemini(prompt, undefined, temperature, false),
      metrics: providerMetrics.gemini,
    },
    { 
      name: "Groq", 
      run: () => callGroq(prompt, temperature),
      metrics: providerMetrics.groq,
    },
    { 
      name: "Lovable AI", 
      run: () => callLovableAI(prompt, temperature),
      metrics: providerMetrics.premium, // Same as premium for fallback
    },
  ];
  
  let lastErr: unknown = null;
  
  for (const provider of chain) {
    try {
      console.log(`[hf-fallback] Trying ${provider.name}...`);
      const startTime = Date.now();
      const text = await provider.run();
      const responseTime = Date.now() - startTime;
      
      if (text && text.trim()) {
        provider.metrics.successCount++;
        provider.metrics.lastSuccess = Date.now();
        provider.metrics.avgResponseTime = 
          (provider.metrics.avgResponseTime + responseTime) / 2;
        
        console.log(`[hf-fallback] ${provider.name} başarılı (${responseTime}ms)`);
        return text;
      }
    } catch (e) {
      provider.metrics.failureCount++;
      provider.metrics.lastError = Date.now();
      console.warn(`[hf-fallback] ${provider.name} başarısız:`, 
        e instanceof Error ? e.message : String(e));
      lastErr = e;
    }
  }
  
  throw lastErr instanceof Error
    ? lastErr
    : new Error("AI motorları şu anda meşgul, birazdan tekrar deneyin.");
}

/** Lightweight connectivity probe used by the settings panel. */
export async function pingHuggingFace(token?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const out = await callHuggingFace('Reply with {"ok":true} only.', "llama", {
      token,
      temperature: 0,
      noFallback: true,
    });
    return { ok: true, message: out.slice(0, 80) };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, message: msg === "HF_TOKEN_MISSING" ? "No token configured" : msg };
  }
}

export type HfProductRaw = {
  productName?: string;
  targetAudience?: string;
  demandScore?: number | string;
  supplierPrice?: number | string;
  sellingPrice?: number | string;
  profitMargin?: number | string;
  viralAngles?: string[];
  competitionLevel?: string;
  emoji?: string;
  description?: string;
  whyWinning?: string;
  salesTactic?: string;
  // Deep-analysis blocks (same shape as the default engine)
  demand?: unknown;
  unit_economics?: unknown;
  sourcing?: unknown;
  personas?: unknown;
  keyword_opportunities?: unknown;
  differentiation?: unknown;
  review_pain_points?: unknown;
  bundles?: unknown;
  risks?: unknown;
  launch_roadmap?: unknown;
  scaling_playbook?: unknown;
  exit_criteria?: unknown;
  market_saturation?: unknown;
  pricing_ladder?: unknown;
  ad_creatives?: unknown;
  supplier_shortlist?: unknown;
  financial_projection?: unknown;
  content_calendar?: unknown;
  conversion?: unknown;
  competitor_examples?: unknown;
  competitor_prices?: unknown;
  supplier_links?: unknown;
  alibaba_links?: unknown;
  health_score?: number | string;
  viral_probability_90d?: number | string;
  sellability_verdict?: string;
  aiInsight?: string;
  confidenceReason?: string;
  data_sources?: unknown;
};

const LANG_NAMES: Record<string, string> = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  de: "German",
  fr: "French",
  ar: "Arabic",
};

export function buildHfPrompt(input: {
  niche: string;
  category: string;
  audience: string;
  platforms: string[];
  budget: string;
  target_country: string;
  engine: HfEngine;
  marketplace?: "global" | "turkey";
  lang?: string;
}): string {
  const depth =
    input.engine === "qwen"
      ? "Think deeply: reason about market demand curves, seasonality, saturation and margin durability before answering."
      : "Move fast: prioritise sharp, sellable picks with punchy marketing angles.";
  const marketRule =
    input.marketplace === "turkey"
      ? `MARKETPLACE FOCUS: Turkey. Source and price for Trendyol and Hepsiburada. Give supplierPrice/sellingPrice in TRY (Turkish Lira) and factor Trendyol/Hepsiburada commissions (typically 10-22%) plus local shipping into profitMargin. demandScore must reflect Turkish local demand.`
      : `MARKETPLACE FOCUS: Global. Source from AliExpress/Alibaba and benchmark retail against Amazon. Prices in USD.`;
  const langName = LANG_NAMES[input.lang ?? "en"] ?? "English";
  return `${depth}
${marketRule}
LANGUAGE: Write every human-readable string in ${langName} (keep URLs, numbers and brand names as-is).
Find 4 specific, currently sellable e-commerce products (real, nameable SKUs — never broad categories).

QUALITY RULES (MANDATORY):
- Every product MUST be a specific, nameable SKU (e.g. "Portable Mini Ice Maker XR-500") — never broad categories.
- Ground pricing in real AliExpress / 1688 supplier costs. Tailor commission math to each platform (Amazon FBA 15%, TikTok Shop 5-8%, Etsy 6.5%, Shopify ~3%, Trendyol 12-22%, Hepsiburada 9-20%, eBay 10-13%).
- Net margin after ALL costs (supplier + shipping + platform fee + ad spend + returns) MUST be at least 25%.
- Rank the most profitable product first.
- For every product, cite a concrete demand signal (search/sales trend), top 2 competitors, the main risk, and one differentiation angle.
- Do NOT return generic dropshipping items (random phone cases, USB cables, etc.). Return products with real brand identity and proven market demand.
- Every product must have a specific viral proof — a real TikTok/Reels URL with view count.
- Products must solve a real problem or fulfill a genuine desire, not just look cool in a video.

Brief:
- Niche: ${input.niche}
- Category: ${input.category}
- Audience hint: ${input.audience || "(none)"}
- Sales platforms: ${input.platforms.join(", ") || "Shopify"}
- Starting capital: ${input.budget}
- Target market: ${input.target_country}

Fill EVERY field below — the app renders a full research dossier per product.
Return STRICT JSON only, exactly this shape:
{"products":[{
 "productName": string,
 "targetAudience": string,
 "demandScore": number (0-100),
 "supplierPrice": number,
 "sellingPrice": number,
 "profitMargin": number (NET percent after all costs, 0-100),
 "viralAngles": [string, string, string],
 "competitionLevel": "Low" | "Medium" | "High",
 "emoji": string (single emoji),
 "description": string (one sentence),
 "whyWinning": string (why it sells right now, with a concrete demand signal),
 "salesTactic": string (4-6 sentences: exact hook/angle, content format & platform, pricing/bundle/upsell play, #1 objection + how to crush it, concrete first-week plan),
 "health_score": number (0-100, overall viability: trend + margin + competition + supplier),
 "viral_probability_90d": number (0-100, likelihood of viral short-form content in 90 days),
 "sellability_verdict": "Highly Sellable" | "Moderate Risk" | "Do Not Sell",
 "competitor_examples": [string, string, string] (3 real store/listing names),
 "competitor_prices": [{"store": string, "price": string, "note": string, "url": string}] (3-5 entries across DIFFERENT stores),
 "supplier_links": [string (AliExpress SEARCH URL)],
 "alibaba_links": [string (Alibaba SEARCH URL)],
 "conversion": {"buyers_per_1000_views": number (0-120), "cvr_pct": number (one decimal), "benchmark": string (real-world source), "reasoning": string},
 "demand": {"monthly_search_volume": string, "trend_direction": "Rising"|"Stable"|"Declining", "seasonality": string, "peak_months": [string] (2-4), "primary_markets": [string] (2-4)},
 "unit_economics": {"breakeven_units": number, "breakeven_roas": number, "target_cpa_usd": string, "ltv_usd": string, "repeat_purchase_rate_pct": number, "return_rate_pct": number},
 "sourcing": {"moq": string, "lead_time_days": string, "sample_cost_usd": string, "quality_checkpoints": [string] (3-4 product-specific checks), "shipping_method": string, "customs_notes": string (CE/FDA/battery specifics)},
 "personas": [{"name": string, "age_range": string, "pain": string, "trigger": string (what makes them buy now), "where_to_find": string (specific subreddits/hashtags)}] (2-3),
 "keyword_opportunities": [{"keyword": string, "monthly_volume": string, "difficulty": "Low"|"Medium"|"High", "intent": string}] (4-6, mix long-tail),
 "differentiation": [string] (3-4: packaging, bundle, warranty, content, variant, positioning),
 "review_pain_points": [{"complaint": string, "fix": string}] (2-4 real recurring complaints),
 "bundles": [{"name": string, "contents": string, "price_usd": string, "why": string}] (2-3 to lift AOV),
 "risks": [{"risk": string, "severity": "Low"|"Medium"|"High", "mitigation": string}] (3-4),
 "launch_roadmap": [{"phase": string, "days": string, "actions": [string] (3-4 tasks), "budget_usd": string, "kpi": string}] (3 phases, 30 days, budgets fit capital),
 "scaling_playbook": string (3-5 sentences: how to scale to $10k+/mo),
 "exit_criteria": [string] (2-3 measurable kill signals),
 "market_saturation": {"score": number (0-100), "active_sellers": string, "ad_activity": string, "entry_window": string, "verdict": string},
 "pricing_ladder": [{"tier": string, "price_usd": string, "positioning": string, "expected_cvr_pct": number}] (3 tiers),
 "ad_creatives": [{"platform": string, "format": string, "hook": string (exact first-3-seconds line), "script_beats": [string] (3-5 beats), "cta": string}] (3 ready-to-shoot briefs),
 "supplier_shortlist": [{"name": string, "region": string, "unit_price_usd": string, "moq": string, "lead_time": string, "notes": string}] (2-3 options at different price/quality),
 "financial_projection": [{"month": string, "units": number, "revenue_usd": string, "ad_spend_usd": string, "net_profit_usd": string}] (3 months, realistic ramp),
 "content_calendar": [{"week": string, "theme": string, "posts": [string] (3-4 ideas)}] (4 weeks organic content)
}]}`;
}

const money = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : "$0.00";
};
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/** Keeps a model-provided array only when it really is a non-empty array. */
const arr = <T>(v: unknown, max = 8): T[] | undefined =>
  Array.isArray(v) && v.length ? (v.slice(0, max) as T[]) : undefined;
/** Keeps a model-provided object only when it really is an object. */
const obj = <T>(v: unknown): T | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as T) : undefined;

/** Maps the forced HF JSON schema onto the app's full product dossier shape. */
export function mapHfProducts(text: string, platforms: string[], engine: HfEngine) {
  const parsed = extractJson<{ products?: HfProductRaw[] }>(text, {});
  const list = Array.isArray(parsed.products) ? parsed.products : [];
  return list.slice(0, 8).map((r) => {
    const supplier = num(r.supplierPrice);
    const selling = num(r.sellingPrice, supplier * 3);
    const margin = num(r.profitMargin, selling > 0 ? ((selling - supplier) / selling) * 100 : 0);
    const angles = (Array.isArray(r.viralAngles) ? r.viralAngles : []).map(String).slice(0, 4);
    const comp = ["Low", "Medium", "High"].includes(String(r.competitionLevel))
      ? (String(r.competitionLevel) as "Low" | "Medium" | "High")
      : "Medium";
    const fee = selling * 0.1;
    const ship = supplier * 0.25;
    const ads = selling * 0.15;
    const net = selling - supplier - fee - ship - ads;
    const verdict = String(r.sellability_verdict ?? "");
    return {
      name: String(r.productName ?? "Unnamed product"),
      description: String(r.description ?? ""),
      why_winning: String(
        r.whyWinning ?? angles[0] ?? "High demand signal detected by the Hugging Face engine.",
      ),
      target_audience: String(r.targetAudience ?? "General shoppers"),
      ad_angles: angles.length
        ? angles
        : ["Problem/solution hook", "Before-after demo", "Social proof"],
      supplier_price_usd: money(supplier),
      selling_price_usd: money(selling),
      profit_margin_pct: Math.round(margin),
      startup_cost_usd: money(supplier * 25),
      platform_fit: platforms.length ? platforms : ["Shopify"],
      platform_strategy:
        engine === "qwen" ? "Deep-research backed rollout" : "Fast-launch creative testing",
      competitor_examples: (arr<string>(r.competitor_examples, 3) ?? []).map(String),
      supplier_links: (arr<string>(r.supplier_links, 2) ?? []).map(String),
      alibaba_links: (arr<string>(r.alibaba_links, 2) ?? []).map(String),
      competitor_prices: arr<{ store?: string; price?: string; note?: string; url?: string }>(r.competitor_prices, 5)?.map((cp) => ({
        store: String(cp?.store ?? ""),
        price: String(cp?.price ?? ""),
        note: cp?.note ? String(cp.note) : undefined,
        url: cp?.url ? String(cp.url) : undefined,
      })),
      cost_breakdown: {
        supplier_cost: money(supplier),
        shipping_cost: money(ship),
        platform_fee: money(fee),
        ad_spend: money(ads),
        net_profit: money(net),
        net_margin_pct: selling > 0 ? Math.round((net / selling) * 100) : 0,
      },
      competition_level: comp,
      trend_score: Math.max(0, Math.min(100, Math.round(num(r.demandScore, 70)))),
      emoji: String(r.emoji ?? "🛍️").slice(0, 4),
      sales_tactic: r.salesTactic ? String(r.salesTactic) : undefined,
      ai_insight: r.aiInsight ? String(r.aiInsight) : `Generated by ${HF_MODELS[engine]} via Hugging Face. Cross-validated across ${engine === "qwen" ? "Qwen 2.5" : "Llama 3.1"} models.`,
      data_sources: Array.from(new Set([`Hugging Face · ${HF_MODELS[engine]}`, ...(arr<string>(r.data_sources, 4) ?? [])])),
      health_score: Math.max(0, Math.min(100, Math.round(num(r.health_score, 70)))),
      viral_probability_90d: Math.max(
        0,
        Math.min(100, Math.round(num(r.viral_probability_90d, 55))),
      ),
      sellability_verdict: (["Highly Sellable", "Moderate Risk", "Do Not Sell"].includes(verdict)
        ? verdict
        : "Moderate Risk") as "Highly Sellable" | "Moderate Risk" | "Do Not Sell",
      confidence_reason: r.confidenceReason ? String(r.confidenceReason) : `Assessed by ${HF_MODELS[engine]} — treat scores as directional until live-verified.`,
      // ---- full deep-analysis dossier, same blocks as the default engine ----
      conversion: obj(r.conversion),
      demand: obj(r.demand),
      unit_economics: obj(r.unit_economics),
      sourcing: obj(r.sourcing),
      personas: arr(r.personas, 4),
      keyword_opportunities: arr(r.keyword_opportunities, 6),
      differentiation: (arr<string>(r.differentiation, 5) ?? []).map(String),
      review_pain_points: arr(r.review_pain_points, 5),
      bundles: arr(r.bundles, 4),
      risks: arr(r.risks, 5),
      launch_roadmap: arr(r.launch_roadmap, 5),
      scaling_playbook: r.scaling_playbook ? String(r.scaling_playbook) : undefined,
      exit_criteria: (arr<string>(r.exit_criteria, 5) ?? []).map(String),
      market_saturation: obj(r.market_saturation),
      pricing_ladder: arr(r.pricing_ladder, 4),
      ad_creatives: arr(r.ad_creatives, 4),
      supplier_shortlist: arr(r.supplier_shortlist, 4),
      financial_projection: arr(r.financial_projection, 4),
      content_calendar: arr(r.content_calendar, 6),
    };
  });
}

/** Synthesizes parallel engine outputs: dedupes by product name, averages scores, unions angles. */
export function mergeHfProducts(lists: ReturnType<typeof mapHfProducts>[]) {
  const byKey = new Map<string, ReturnType<typeof mapHfProducts>[number] & { _n: number }>();
  for (const list of lists) {
    for (const p of list) {
      const key = p.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...p, _n: 1 });
        continue;
      }
      prev.trend_score = Math.round((prev.trend_score * prev._n + p.trend_score) / (prev._n + 1));
      prev.profit_margin_pct = Math.round(
        (prev.profit_margin_pct * prev._n + p.profit_margin_pct) / (prev._n + 1),
      );
      prev.ad_angles = Array.from(new Set([...prev.ad_angles, ...p.ad_angles])).slice(0, 5);
      prev.data_sources = Array.from(new Set([...prev.data_sources, ...p.data_sources]));
      prev.ai_insight = `Cross-validated by ${prev.data_sources.length} Hugging Face engines.`;
      prev._n += 1;
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b._n - a._n || b.trend_score - a.trend_score)
    .slice(0, 9)
    .map(({ _n, ...p }) => p);
}
