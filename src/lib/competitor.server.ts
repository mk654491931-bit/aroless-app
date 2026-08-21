// Server-only prompt builders + types for the Competitor Analysis engine.
import { countryName } from "./countries";

export type CompetitorSeller = {
  seller: string;
  platform: string;
  /** Store domain (from the lightweight scraper), when known. */
  domain?: string;
  /** Open PageRank domain authority 0-10, when available. */
  domain_rank?: number | null;
  url?: string;
  price_usd: number;
  price_trend: string;
  est_monthly_sales: number;
  est_stock: number;
  rating: number;
  traffic_sources: string[];
  margin_note: string;
};

export type CompetitorWeakness = { complaint: string; frequency: string; opportunity: string };

export type CounterStrategy = {
  headline: string;
  positioning: string;
  price_advice: string;
  playbook: string[];
  ad_angle: string;
};

export type CompetitorReport = {
  query: string;
  country: string;
  sellers: CompetitorSeller[];
  avg_price_usd: number;
  weaknesses: CompetitorWeakness[];
  sentiment_summary: string;
  strategy: CounterStrategy | null;
  /** Google Trends 30-day momentum for the query in this market. */
  trend_momentum_pct?: number;
  trend_monthly?: number[];
  trend_source?: string;
};

export function sellersPrompt(query: string, country: string, liveContext = "") {
  return `You are a competitive-intelligence analyst for e-commerce. Use live web knowledge.
Target market: ${countryName(country)}.
${liveContext ? `Live scraped signals (trust these over memory):\n${liveContext}\n` : ""}
Input (keyword, Amazon ASIN, Shopify store URL, Etsy shop or eBay listing): "${query}"

Identify the TOP 5 currently active sellers/listings for this product in that market. Use realistic,
current market data (marketplace prices, review counts, BSR-style signals, ad-library presence).

Return ONLY JSON:
{ "avg_price_usd": number,
  "sellers": [ { "seller": string, "platform": string, "price_usd": number,
    "price_trend": string (short Turkish, e.g. "son 30 günde %8 düştü"),
    "est_monthly_sales": number, "est_stock": number, "rating": number 0-5,
    "traffic_sources": string[] (e.g. ["Meta Ads","Google Shopping","TikTok Organic"]),
    "margin_note": string (1 short Turkish sentence on their likely margin) } ] }`;
}

export function sentimentPrompt(query: string, country: string, liveContext = "") {
  return `You are a review-sentiment analyst. Product/store: "${query}". Market: ${countryName(country)}.
${liveContext ? `Live search-interest & seller signals:\n${liveContext}\n` : ""}
Analyse the NEGATIVE reviews competitors receive for this product and extract the recurring product
weaknesses and customer complaints — these are our opportunity gaps.

Return ONLY JSON:
{ "sentiment_summary": string (1-2 Turkish sentences),
  "weaknesses": [ { "complaint": string (Turkish), "frequency": string (e.g. "yorumların ~%30'u"),
                    "opportunity": string (Turkish, how we exploit it) } ] }`;
}

export function strategyPrompt(query: string, country: string, context: string) {
  return `You are AI 2 — the COUNTER-STRATEGY GENERATOR (logistics, VAT and pricing specialist).
Product/store: "${query}" · Market: ${countryName(country)}
Competitor intelligence:
${context}

Write a concrete playbook in Turkish for OUTPERFORMING these sellers. Be numeric and specific
(prices, shipping promises, VAT/customs impact, bundle ideas). No generic advice.

Return ONLY JSON:
{ "headline": string (one punchy Turkish sentence),
  "positioning": string (2 sentences),
  "price_advice": string (concrete price with number),
  "playbook": string[4] (concrete actions),
  "ad_angle": string (1 Turkish ad hook) }`;
}

export function countryStrategyPrompt(niche: string, country: string) {
  return `You are an e-commerce market strategist. Niche/product: "${niche || "genel e-ticaret"}".
Target market: ${countryName(country)}.
Give ONE actionable, specific strategy for succeeding with this niche in this exact country
(pricing, logistics, compliance, marketing channel). Turkish, max 3 sentences.

Return ONLY JSON: { "strategy": string }`;
}

export function copilotPrompt(message: string, context: string, history: string) {
  return `You are the Aroless Co-Pilot — a live e-commerce mentor embedded in a SaaS dashboard
and training sandbox. Answer in Turkish, short and concrete (max 120 words), with numbers where useful.
If the user is making a mistake in the sandbox, warn them directly.

App context: ${context || "dashboard"}
Recent conversation:
${history || "(yok)"}

User: ${message}

Return ONLY JSON: { "reply": string }`;
}
