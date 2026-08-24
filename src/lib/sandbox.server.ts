// Server-only prompt builders for the E-Commerce Simulator.
import type { MarketBaseline, Crisis, Review } from "./sandbox-engine";

export function baselinePrompt(input: {
  product: string;
  platform: string;
  capital: number;
  price: number;
  cogs: number;
  country?: string;
}) {
  return `You are a senior e-commerce market analyst. Use LIVE web knowledge and real 2024/2025 benchmarks.

Product: "${input.product}"
Selling platform: ${input.platform}
Seller starting capital: $${input.capital}
Planned selling price: $${input.price} · COGS: $${input.cogs}
Market: ${input.country ?? "United States"}

Return REAL, sourced benchmark numbers for selling THIS product on THIS platform right now. No invented optimism — use published category averages (Shopify/Amazon/TikTok Shop/Etsy reports, ad benchmark studies).

Return ONLY JSON:
{
  "cvr_pct": number (realistic conversion rate % for this category+platform+price),
  "ctr_pct": number (ad click-through rate %),
  "cpc_usd": number (average cost per click for this niche on the main ad channel),
  "cac_usd": number (realistic customer acquisition cost),
  "avg_market_price_usd": number (what competitors actually charge today),
  "refund_rate_pct": number (category return/refund rate),
  "shipping_days": number (typical supplier-to-customer days),
  "organic_daily_visitors": number (daily free traffic a brand-new listing/store realistically gets),
  "seasonality": string (1 sentence on current seasonal demand),
  "risks": string[3] (concrete, platform-specific risks),
  "benchmark_note": string (1 sentence naming the real benchmarks you used)
}`;
}

export function crisisPrompt(input: {
  product: string;
  platform: string;
  day: number;
  capital: number;
  rating: number;
  price: number;
  adBudget: number;
  recent: string;
}) {
  return `You run a realistic e-commerce simulator. Generate ONE realistic day-${input.day} event for a seller on ${input.platform}.

Product: "${input.product}" · price $${input.price} · daily ad spend $${input.adBudget}
Capital: $${input.capital.toFixed(0)} · Store rating: ${input.rating.toFixed(0)}/100
Recent activity: ${input.recent}

The event must be platform-specific and true to how ${input.platform} actually works (customs/cargo delay, negative review, policy/suspension warning, supplier price hike, ad account review, buy-box loss, chargeback, influencer mention...). Give 2-3 strategic choices with genuinely different trade-offs. Impacts must fit the seller's capital scale.

Return ONLY JSON:
{
  "title": string (short headline),
  "body": string (2-3 sentences, concrete and specific),
  "severity": "low"|"medium"|"high",
  "choices": [ { "label": string (short action), "detail": string (1 sentence consequence), "capital": number (USD delta, negative = cost), "ratingDelta": number (-20..+10), "cvrDelta": number (percent change to conversion, -40..+30) } ]
}`;
}

export function reviewsPrompt(input: {
  product: string;
  platform: string;
  price: number;
  marketPrice: number;
  shippingDays: number;
  rating: number;
  orders: number;
}) {
  return `Write ${input.orders >= 12 ? 3 : 2} authentic customer reviews for "${input.product}" sold on ${input.platform}.
Price paid: $${input.price} (market average $${input.marketPrice}) · delivery took ${input.shippingDays} days · current store rating ${input.rating.toFixed(0)}/100 · ${input.orders} orders yesterday.
Reviews must react to the ACTUAL price positioning and delivery speed above (overpriced + slow = angry; fair price + fast = happy). Sound like real marketplace buyers: short, typo-free but casual, specific.

Return ONLY JSON: { "reviews": [ { "stars": number 1-5, "author": string (first name + initial), "text": string (1-2 sentences) } ] }`;
}

export function coachPrompt(input: {
  product: string;
  platform: string;
  day: number;
  summary: string;
  state: string;
}) {
  return `You are an elite e-commerce mentor coaching a seller inside a training simulator on ${input.platform}.

Day ${input.day} results: ${input.summary}
Store state: ${input.state}
Product: "${input.product}"

Explain WHY the numbers moved and exactly HOW to fix them tomorrow. Be blunt, specific and numeric (name prices, budgets, thresholds). No generic advice.

Return ONLY JSON:
{
  "verdict": string (one punchy sentence),
  "why": string (2-3 sentences explaining the cause of yesterday's numbers),
  "actions": string[3] (concrete actions with numbers for tomorrow),
  "watch_out": string (1 sentence on the biggest risk right now)
}`;
}

export type CoachAdvice = { verdict: string; why: string; actions: string[]; watch_out: string };
export type { MarketBaseline, Crisis, Review };

export function num(v: unknown, fb: number, min: number, max: number) {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : fb;
}
export function str(v: unknown, fb: string) {
  return typeof v === "string" && v.trim() ? v.trim() : fb;
}
export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
