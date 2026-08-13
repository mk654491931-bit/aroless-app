/**
 * E-Commerce Simulator / Training Sandbox — deterministic client-side engine.
 * Gemini supplies the real-world market baseline (CR/CTR/CPC/CAC/fees/logistics);
 * this engine turns the user's daily decisions into outcomes against that baseline.
 */

export const SIM_PLATFORMS = [
  "Shopify",
  "Amazon FBA",
  "Amazon FBM",
  "Trendyol",
  "TikTok Shop",
  "Etsy",
  "WooCommerce",
  "eBay",
] as const;
export type SimPlatform = (typeof SIM_PLATFORMS)[number];

export type PlatformPreset = {
  id: SimPlatform;
  short: string;
  feePct: number;        // referral / commission
  fulfilmentPerUnit: number;
  organicPull: number;   // built-in marketplace traffic multiplier
  adEfficiency: number;  // how far $1 of ad spend goes
  ratingSensitivity: number;
  accent: string;
  blurb: string;
};

export const PLATFORM_PRESETS: Record<SimPlatform, PlatformPreset> = {
  "Shopify": { id: "Shopify", short: "SHP", feePct: 0.029, fulfilmentPerUnit: 3.6, organicPull: 0.25, adEfficiency: 1, ratingSensitivity: 0.8, accent: "oklch(0.72 0.17 155)", blurb: "You own the traffic. No marketplace crowd, no marketplace rules." },
  "Amazon FBA": { id: "Amazon FBA", short: "FBA", feePct: 0.15, fulfilmentPerUnit: 5.2, organicPull: 1.5, adEfficiency: 1.15, ratingSensitivity: 1.4, accent: "oklch(0.78 0.16 75)", blurb: "Huge built-in demand, brutal fees, ratings decide everything." },
  "Amazon FBM": { id: "Amazon FBM", short: "FBM", feePct: 0.15, fulfilmentPerUnit: 3.1, organicPull: 1.1, adEfficiency: 1.05, ratingSensitivity: 1.5, accent: "oklch(0.78 0.16 75)", blurb: "Same demand as FBA, you ship it — cheaper, riskier on late delivery." },
  "Trendyol": { id: "Trendyol", short: "TY", feePct: 0.185, fulfilmentPerUnit: 2.2, organicPull: 1.25, adEfficiency: 1.1, ratingSensitivity: 1.3, accent: "oklch(0.68 0.2 25)", blurb: "Price-war marketplace. Campaigns and cargo speed drive the buy box." },
  "TikTok Shop": { id: "TikTok Shop", short: "TTS", feePct: 0.08, fulfilmentPerUnit: 3.2, organicPull: 1.0, adEfficiency: 1.35, ratingSensitivity: 1.1, accent: "oklch(0.72 0.19 330)", blurb: "Cheapest impressions on earth — if the creative hooks in 3 seconds." },
  "Etsy": { id: "Etsy", short: "ETSY", feePct: 0.115, fulfilmentPerUnit: 2.8, organicPull: 0.85, adEfficiency: 0.85, ratingSensitivity: 1.2, accent: "oklch(0.74 0.15 45)", blurb: "Handmade/craft intent, higher AOV tolerance, slower volume." },
  "WooCommerce": { id: "WooCommerce", short: "WOO", feePct: 0.029, fulfilmentPerUnit: 3.4, organicPull: 0.2, adEfficiency: 0.95, ratingSensitivity: 0.75, accent: "oklch(0.68 0.18 300)", blurb: "Full control, lowest fees, zero free traffic. Everything is on you." },
  "eBay": { id: "eBay", short: "EBAY", feePct: 0.132, fulfilmentPerUnit: 3.0, organicPull: 0.95, adEfficiency: 0.9, ratingSensitivity: 1.25, accent: "oklch(0.72 0.17 250)", blurb: "Bargain hunters. Feedback score is your entire conversion rate." },
};

export const CAPITAL_OPTIONS = [500, 2000, 5000, 10000] as const;

/** Real-world market baseline, produced by Gemini for the chosen product+platform. */
export type MarketBaseline = {
  cvr_pct: number;
  ctr_pct: number;
  cpc_usd: number;
  cac_usd: number;
  avg_market_price_usd: number;
  refund_rate_pct: number;
  shipping_days: number;
  organic_daily_visitors: number;
  seasonality: string;
  risks: string[];
  benchmark_note: string;
};

export const FALLBACK_BASELINE: MarketBaseline = {
  cvr_pct: 1.8, ctr_pct: 1.3, cpc_usd: 0.9, cac_usd: 18, avg_market_price_usd: 29.99,
  refund_rate_pct: 5, shipping_days: 6, organic_daily_visitors: 12,
  seasonality: "No strong seasonal signal.",
  risks: ["Ad costs rise as you scale", "Late delivery hurts ratings"],
  benchmark_note: "Industry averages (Shopify 2024 ~1.4% CVR).",
};

export type ShippingMode = "economy" | "standard" | "express";
export const SHIPPING_MODES: Record<ShippingMode, { label: string; days: number; cost: number; cvrMult: number; ratingDelta: number }> = {
  economy: { label: "Economy", days: 12, cost: 1.4, cvrMult: 0.86, ratingDelta: -0.9 },
  standard: { label: "Standard", days: 6, cost: 3.2, cvrMult: 1, ratingDelta: 0 },
  express: { label: "Express", days: 2, cost: 6.4, cvrMult: 1.14, ratingDelta: 0.6 },
};

export const AUDIENCES = [
  { id: "broad", label: "Broad / Advantage+", ctrMult: 0.9, cvrMult: 0.95, cpcMult: 0.85 },
  { id: "interest", label: "Interest stack", ctrMult: 1.05, cvrMult: 1.05, cpcMult: 1 },
  { id: "lookalike", label: "1% Lookalike", ctrMult: 1.15, cvrMult: 1.25, cpcMult: 1.2 },
  { id: "retarget", label: "Retargeting", ctrMult: 1.4, cvrMult: 1.6, cpcMult: 1.45 },
] as const;
export type AudienceId = (typeof AUDIENCES)[number]["id"];

export const ANGLES = [
  { id: "problem", label: "Problem / Solution", ctrMult: 1.12, cvrMult: 1.1 },
  { id: "ugc", label: "UGC testimonial", ctrMult: 1.25, cvrMult: 1.15 },
  { id: "discount", label: "Discount / Urgency", ctrMult: 1.18, cvrMult: 1.05 },
  { id: "premium", label: "Premium brand film", ctrMult: 0.85, cvrMult: 1.2 },
  { id: "demo", label: "Product demo", ctrMult: 1.05, cvrMult: 1.12 },
] as const;
export type AngleId = (typeof ANGLES)[number]["id"];

export type SandboxProduct = {
  id: string;
  name: string;
  emoji: string;
  image_url?: string;
  cogs: number;
  price: number;
  marketPrice: number;
  stock: number;
  incoming: { qty: number; arrivesDay: number }[];
  adBudget: number;
  audience: AudienceId;
  angle: AngleId;
  shipping: ShippingMode;
  unitsSold: number;
  unitsRefunded: number;
  revenue: number;
  listed: boolean;
  stockouts: number;
};

export type DayRecord = {
  day: number; visitors: number; orders: number; revenue: number;
  adSpend: number; fees: number; refunds: number; profit: number; capital: number; cvr: number;
};

export type Review = { day: number; stars: number; author: string; text: string; product: string };
export type FeedItem = { day: number; kind: "rival" | "market" | "info" | "good" | "bad"; text: string };

export type Crisis = {
  title: string;
  body: string;
  severity: "low" | "medium" | "high";
  choices: { label: string; detail: string; capital: number; ratingDelta: number; cvrDelta: number }[];
};

export const BADGES = [
  { id: "first-sale", label: "First Blood", desc: "Your first order came in." },
  { id: "orders-100", label: "First 100 Orders", desc: "100 net orders in a single run." },
  { id: "crisis", label: "Crisis Manager", desc: "Survived 3 crisis events." },
  { id: "roas", label: "ROAS Beast", desc: "A day with 3.0x+ ROAS." },
  { id: "zero-hero", label: "Zero-to-Hero", desc: "Doubled your starting capital." },
  { id: "five-star", label: "Five Star Seller", desc: "Store rating 95+ after day 10." },
  { id: "profitable-week", label: "Profitable Week", desc: "7 straight profitable days." },
] as const;
export type BadgeId = (typeof BADGES)[number]["id"];

export const SIM_LENGTH = 30;

export type SandboxState = {
  version: 2;
  storeName: string;
  platform: SimPlatform;
  startingCapital: number;
  capital: number;
  day: number;
  rating: number;
  products: SandboxProduct[];
  history: DayRecord[];
  reviews: Review[];
  feed: FeedItem[];
  badges: BadgeId[];
  crisesResolved: number;
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
  status: "running" | "bankrupt" | "finished";
  baseline: MarketBaseline;
  rivalPrice: number;
  coach: string;
  submitted?: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function newSandbox(opts: {
  storeName: string; platform: SimPlatform; capital: number;
  baseline: MarketBaseline; product?: Omit<SandboxProduct, "id"> | null;
}): SandboxState {
  const products: SandboxProduct[] = opts.product ? [{ ...opts.product, id: crypto.randomUUID() }] : [];
  return {
    version: 2,
    storeName: opts.storeName.trim() || "My Practice Store",
    platform: opts.platform,
    startingCapital: opts.capital,
    capital: opts.capital,
    day: 1,
    rating: 100,
    products,
    history: [],
    reviews: [],
    feed: [
      { day: 1, kind: "info", text: `Store opened on ${opts.platform} with $${opts.capital.toLocaleString()} working capital.` },
      { day: 1, kind: "market", text: opts.baseline.benchmark_note },
    ],
    badges: [],
    crisesResolved: 0,
    totalRevenue: 0,
    totalProfit: 0,
    totalOrders: 0,
    status: "running",
    baseline: opts.baseline,
    rivalPrice: round2(opts.baseline.avg_market_price_usd),
    coach: "",
  };
}

export function blankProduct(name: string, cogs: number, price: number, marketPrice: number, emoji = "📦", image_url?: string): Omit<SandboxProduct, "id"> {
  return {
    name, emoji, image_url,
    cogs: round2(cogs), price: round2(price), marketPrice: round2(marketPrice),
    stock: 0, incoming: [], adBudget: 0,
    audience: "interest", angle: "ugc", shipping: "standard",
    unitsSold: 0, unitsRefunded: 0, revenue: 0, listed: true, stockouts: 0,
  };
}

export function unitEconomics(p: SandboxProduct, preset: PlatformPreset) {
  const fee = p.price * preset.feePct;
  const ship = SHIPPING_MODES[p.shipping].cost;
  const net = p.price - p.cogs - fee - ship - preset.fulfilmentPerUnit * 0.25;
  return { fee: round2(fee), ship, net: round2(net), marginPct: round2((net / Math.max(0.01, p.price)) * 100) };
}

export function restockSandbox(state: SandboxState, productId: string, qty: number): { state: SandboxState; error?: string } {
  const p = state.products.find((x) => x.id === productId);
  if (!p || qty <= 0) return { state };
  const discount = qty >= 200 ? 0.82 : qty >= 100 ? 0.88 : qty >= 50 ? 0.94 : 1;
  const unit = round2(p.cogs * discount);
  const total = round2(unit * qty);
  if (total > state.capital) return { state, error: "Not enough capital for that purchase order." };
  const lead = Math.max(1, Math.round(state.baseline.shipping_days * 0.6) + (qty >= 100 ? 2 : 0));
  return {
    state: {
      ...state,
      capital: round2(state.capital - total),
      products: state.products.map((x) =>
        x.id === productId ? { ...x, incoming: [...x.incoming, { qty, arrivesDay: state.day + lead }] } : x,
      ),
      feed: [...state.feed, { day: state.day, kind: "info", text: `Purchase order: ${qty}× ${p.name} for $${total.toFixed(2)} (arrives day ${state.day + lead}).` }],
    },
  };
}

export type AdvanceResult = { state: SandboxState; record: DayRecord; newBadges: BadgeId[]; feed: FeedItem[] };

export function advanceDay(prev: SandboxState): AdvanceResult {
  const preset = PLATFORM_PRESETS[prev.platform];
  const b = prev.baseline;
  const s: SandboxState = {
    ...prev,
    products: prev.products.map((p) => ({ ...p, incoming: [...p.incoming] })),
    history: [...prev.history],
    feed: [...prev.feed],
    badges: [...prev.badges],
  };
  const day = s.day;
  const feed: FeedItem[] = [];

  // inventory arrivals
  for (const p of s.products) {
    const arrived = p.incoming.filter((i) => i.arrivesDay <= day);
    if (arrived.length) {
      const qty = arrived.reduce((a, i) => a + i.qty, 0);
      p.stock += qty;
      p.incoming = p.incoming.filter((i) => i.arrivesDay > day);
      feed.push({ day, kind: "good", text: `${qty} units of ${p.name} cleared customs and are in stock.` });
    }
  }

  // AI rival repricing
  const cheapest = Math.min(...s.products.filter((p) => p.listed).map((p) => p.price), Infinity);
  if (Number.isFinite(cheapest)) {
    const drift = cheapest < s.rivalPrice ? rnd(-0.06, -0.01) : rnd(-0.02, 0.04);
    const next = Math.max(b.avg_market_price_usd * 0.62, round2(s.rivalPrice * (1 + drift)));
    if (Math.abs(next - s.rivalPrice) >= 0.4) {
      feed.push({
        day, kind: "rival",
        text: next < s.rivalPrice
          ? `Rival seller cut price to $${next.toFixed(2)} (was $${s.rivalPrice.toFixed(2)}) to defend the buy box.`
          : `Rival seller raised price to $${next.toFixed(2)} — demand is holding.`,
      });
      s.rivalPrice = next;
    }
  }

  let visitors = 0, orders = 0, revenue = 0, adSpend = 0, fees = 0, refundLoss = 0;
  const ratingMult = Math.max(0.35, Math.min(1.2, 0.35 + (s.rating / 100) * 0.85 * preset.ratingSensitivity / 1.1));

  for (const p of s.products) {
    if (!p.listed) continue;
    const aud = AUDIENCES.find((a) => a.id === p.audience)!;
    const ang = ANGLES.find((a) => a.id === p.angle)!;
    const ship = SHIPPING_MODES[p.shipping];

    const cpc = Math.max(0.08, (b.cpc_usd * aud.cpcMult * rnd(0.85, 1.2)) / preset.adEfficiency / Math.max(0.6, ang.ctrMult));
    const spend = Math.max(0, Math.min(p.adBudget, s.capital + revenue - adSpend));
    const paid = spend > 0 ? spend / cpc : 0;
    const organic = preset.organicPull * (b.organic_daily_visitors + Math.sqrt(p.unitsSold) * 2.4) * ratingMult * rnd(0.75, 1.3);
    const traffic = paid + organic;

    const priceRatio = p.price / Math.max(0.01, s.rivalPrice);
    const priceMult = Math.max(0.15, Math.min(1.9, 1.85 - 0.9 * priceRatio));
    const cvr = (b.cvr_pct / 100) * priceMult * aud.cvrMult * ang.cvrMult * ship.cvrMult * ratingMult * rnd(0.75, 1.3);

    let wanted = Math.floor(traffic * cvr);
    if (Math.random() < (traffic * cvr) % 1) wanted += 1;
    if (wanted > p.stock) {
      if (p.stock === 0 && wanted > 0) {
        p.stockouts += 1;
        s.rating = Math.max(0, s.rating - 1.5);
        feed.push({ day, kind: "bad", text: `${p.name} is out of stock — ${wanted} ready buyers bounced.` });
      }
      wanted = p.stock;
    }

    const refundRate = (b.refund_rate_pct / 100) * (ship.days > 8 ? 1.5 : 1) * (priceRatio > 1.3 ? 1.3 : 1) * (s.rating < 70 ? 1.4 : 1);
    const refunded = Math.round(wanted * refundRate);
    const net = wanted - refunded;

    p.stock -= wanted - refunded;
    p.unitsSold += net;
    p.unitsRefunded += refunded;
    p.revenue += net * p.price;

    visitors += traffic;
    orders += net;
    revenue += net * p.price;
    adSpend += spend;
    fees += net * p.price * preset.feePct + net * (ship.cost + preset.fulfilmentPerUnit * 0.25);
    refundLoss += refunded * (p.price * 0.3 + ship.cost);

    // rating drift from shipping promise + price fairness
    s.rating = Math.max(0, Math.min(100, s.rating + (net > 0 ? ship.ratingDelta * 0.35 : 0) - (priceRatio > 1.45 ? 0.4 : 0) + (net > 0 && ship.days <= 3 ? 0.15 : 0)));
  }

  const fixed = s.platform === "Shopify" || s.platform === "WooCommerce" ? 1.9 : 0.6;
  const profit = revenue - adSpend - fees - refundLoss - fixed;
  s.capital = round2(s.capital + profit);
  s.totalRevenue += revenue;
  s.totalProfit += profit;
  s.totalOrders += orders;

  const record: DayRecord = {
    day,
    visitors: Math.round(visitors),
    orders,
    revenue: round2(revenue),
    adSpend: round2(adSpend),
    fees: round2(fees + fixed),
    refunds: round2(refundLoss),
    profit: round2(profit),
    capital: s.capital,
    cvr: visitors > 0 ? round2((orders / visitors) * 100) : 0,
  };
  s.history.push(record);
  s.day = day + 1;

  // badges
  const newBadges: BadgeId[] = [];
  const award = (id: BadgeId) => { if (!s.badges.includes(id)) { s.badges.push(id); newBadges.push(id); } };
  if (s.totalOrders > 0) award("first-sale");
  if (s.totalOrders >= 100) award("orders-100");
  if (s.crisesResolved >= 3) award("crisis");
  if (record.adSpend > 5 && record.revenue / record.adSpend >= 3) award("roas");
  if (s.capital >= s.startingCapital * 2) award("zero-hero");
  if (s.rating >= 95 && day >= 10) award("five-star");
  if (s.history.slice(-7).length === 7 && s.history.slice(-7).every((h) => h.profit > 0)) award("profitable-week");

  if (s.capital < 0) {
    s.status = "bankrupt";
    feed.push({ day, kind: "bad", text: "Capital went negative. The store is insolvent — run over." });
  } else if (s.day > SIM_LENGTH) {
    s.status = "finished";
    feed.push({ day, kind: s.totalProfit > 0 ? "good" : "bad", text: `${SIM_LENGTH}-day run complete: $${s.totalProfit.toFixed(0)} net profit.` });
  }

  s.feed = [...s.feed, ...feed].slice(-200);
  return { state: s, record, newBadges, feed };
}

export function applyCrisisChoice(state: SandboxState, crisis: Crisis, index: number): SandboxState {
  const c = crisis.choices[index];
  if (!c) return state;
  const baseline = { ...state.baseline, cvr_pct: Math.max(0.1, state.baseline.cvr_pct * (1 + c.cvrDelta / 100)) };
  return {
    ...state,
    capital: round2(state.capital + c.capital),
    rating: Math.max(0, Math.min(100, state.rating + c.ratingDelta)),
    baseline,
    crisesResolved: state.crisesResolved + 1,
    feed: [...state.feed, {
      day: state.day,
      kind: (c.capital < 0 || c.ratingDelta < 0 ? "bad" : "good") as FeedItem["kind"],
      text: `${crisis.title} → ${c.label} (${c.capital >= 0 ? "+" : ""}$${c.capital.toFixed(0)}, rating ${c.ratingDelta >= 0 ? "+" : ""}${c.ratingDelta})`,
    }].slice(-200),
  };
}

export function roiPct(s: SandboxState) {
  return round2((s.totalProfit / Math.max(1, s.startingCapital)) * 100);
}
