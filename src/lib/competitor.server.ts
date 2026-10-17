// Server-only prompt builders + types for the Competitor Analysis engine.
import { countryName } from "./countries";
import { outputLanguageDirective } from "./ai-language";

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

/**
 * Çıktı dili TEK kaynaktan eklenir (bkz. `ai-language.ts`).
 *
 * NEDEN: bu istemler alanların içine gömülü "short Turkish" / "Turkish"
 * yazıyordu; arayüzü İngilizce ya da Arapça kullanan bir satıcı rakip
 * raporunu yine Türkçe okuyordu. Dil artık istemin sonunda TEK satırda
 * belirtilir ve o dil değişince bütün alanlar (özet, fırsat, playbook) ona
 * uyar.
 */
export function sellersPrompt(query: string, country: string, liveContext = "", lang?: string) {
  return `You are a competitive-intelligence analyst for e-commerce. Use live web knowledge.
Target market: ${countryName(country)}.
${liveContext ? `Live scraped signals (trust these over memory):\n${liveContext}\n` : ""}
Input (keyword, Amazon ASIN, Shopify store URL, Etsy shop or eBay listing): "${query}"

Identify the TOP 5 currently active sellers/listings for this product in that market. Use realistic,
current market data (marketplace prices, review counts, BSR-style signals, ad-library presence).

Return ONLY JSON:
{ "avg_price_usd": number,
  "sellers": [ { "seller": string, "platform": string, "price_usd": number,
    "price_trend": string (short, e.g. "down 8% in the last 30 days"),
    "est_monthly_sales": number, "est_stock": number, "rating": number 0-5,
    "traffic_sources": string[] (e.g. ["Meta Ads","Google Shopping","TikTok Organic"]),
    "margin_note": string (1 short sentence on their likely margin) } ] }

${outputLanguageDirective(lang, "price_trend, traffic_sources, margin_note")}`;
}

export function sentimentPrompt(query: string, country: string, liveContext = "", lang?: string) {
  return `You are a review-sentiment analyst. Product/store: "${query}". Market: ${countryName(country)}.
${liveContext ? `Live search-interest & seller signals:\n${liveContext}\n` : ""}
Analyse the NEGATIVE reviews competitors receive for this product and extract the recurring product
weaknesses and customer complaints — these are our opportunity gaps.

Return ONLY JSON:
{  "sentiment_summary": string (1-2 sentences),
  "weaknesses": [ { "complaint": string, "frequency": string (e.g. "~30% of reviews"),
                    "opportunity": string (how we exploit it) } ] }

${outputLanguageDirective(lang, "sentiment_summary, complaint, frequency, opportunity")}`;
}

export function strategyPrompt(query: string, country: string, context: string, lang?: string) {
  return `You are AI 2 — the COUNTER-STRATEGY GENERATOR (logistics, VAT and pricing specialist).
Product/store: "${query}" · Market: ${countryName(country)}
Competitor intelligence:
${context}

Write a concrete playbook for OUTPERFORMING these sellers. Be numeric and specific
(prices, shipping promises, VAT/customs impact, bundle ideas). No generic advice.

Return ONLY JSON:
{ "headline": string (one punchy sentence),
  "positioning": string (2 sentences),
  "price_advice": string (concrete price with number),
  "playbook": string[4] (concrete actions),
  "ad_angle": string (1 ad hook) }

${outputLanguageDirective(lang, "headline, positioning, price_advice, playbook, ad_angle")}`;
}

export function countryStrategyPrompt(niche: string, country: string, lang?: string) {
  return `You are an e-commerce market strategist. Niche/product: "${niche || "genel e-ticaret"}".
Target market: ${countryName(country)}.
Give ONE actionable, specific strategy for succeeding with this niche in this exact country
(pricing, logistics, compliance, marketing channel). Max 3 sentences.

Return ONLY JSON: { "strategy": string }

${outputLanguageDirective(lang, "strategy")}`;
}

export function copilotPrompt(message: string, context: string, history: string, lang?: string) {
  return `You are the Aroless Co-Pilot — a live e-commerce mentor embedded in a SaaS dashboard
and training sandbox. Answer short and concrete (max 120 words), with numbers where useful.
If the user is making a mistake in the sandbox, warn them directly.

App context: ${context || "dashboard"}
Recent conversation:
${history || "(yok)"}

User: ${message}

Return ONLY JSON: { "reply": string }

${outputLanguageDirective(lang, "reply")}`;
}
