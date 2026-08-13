import type { WinningProduct } from "./gemini.functions";
import { parseMoneyNum, buyersPer1000 } from "./consistency";

export type Difficulty = "easy" | "normal" | "hard";

export type DifficultyConfig = {
  id: Difficulty;
  label: string;
  blurb: string;
  startCash: number;
  cpc: number;              // cost per click on ads
  platformFeePct: number;   // marketplace / payment fees
  dailyFixedCost: number;   // subscription, apps, domain
  refundBase: number;       // baseline refund rate
  leadTimeDays: number;     // supplier delivery
  shippingPerUnit: number;  // fulfilment cost per order
  organicMult: number;      // free traffic multiplier
  eventChance: number;      // chance of a random market event per day
  targetProfit: number;     // profit needed to "win" the 30-day run
};

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: "easy", label: "Starter", blurb: "Cheap clicks, patient customers. Learn the loop.",
    startCash: 2500, cpc: 0.35, platformFeePct: 0.03, dailyFixedCost: 1,
    refundBase: 0.02, leadTimeDays: 2, shippingPerUnit: 2.5, organicMult: 1.35,
    eventChance: 0.14, targetProfit: 1200,
  },
  normal: {
    id: "normal", label: "Realistic", blurb: "Real CPCs, real fees, real refunds. Most stores live here.",
    startCash: 1200, cpc: 0.85, platformFeePct: 0.052, dailyFixedCost: 1.9,
    refundBase: 0.05, leadTimeDays: 4, shippingPerUnit: 4, organicMult: 1,
    eventChance: 0.22, targetProfit: 1800,
  },
  hard: {
    id: "hard", label: "Saturated", blurb: "Expensive traffic, harsh refunds, slow suppliers. Brutal.",
    startCash: 700, cpc: 1.45, platformFeePct: 0.079, dailyFixedCost: 3.1,
    refundBase: 0.09, leadTimeDays: 7, shippingPerUnit: 5.5, organicMult: 0.7,
    eventChance: 0.32, targetProfit: 2500,
  },
};

export type StoreProduct = {
  id: string;
  name: string;
  emoji: string;
  image_url?: string;
  unitCost: number;         // supplier cost per unit
  price: number;            // your selling price
  recommendedPrice: number; // AI suggested price
  baseCvrPct: number;       // conversion at recommended price
  competition: "Low" | "Medium" | "High";
  trend: number;
  stock: number;
  incoming: { qty: number; arrivesDay: number; unitCost: number }[];
  adBudget: number;         // daily ad spend
  unitsSold: number;
  unitsRefunded: number;
  revenue: number;
  rating: number;           // 1-5
  reviews: number;
  stockouts: number;
  listed: boolean;
  /* --- deep mechanics (optional for older saves) --- */
  channel?: AdChannel;          // where the ad budget is spent
  fatigue?: number;             // 0..1 creative fatigue
  lastBudget?: number;          // budget of previous day (scaling penalty)
  returnPool?: number;          // happy customers that may buy again
  repeatOrders?: number;        // lifetime repeat orders
};

export type AdChannel = "meta" | "tiktok" | "google";

export const CHANNELS: Record<AdChannel, { label: string; blurb: string; cpcMult: number; cvrMult: number; fatigueRate: number }> = {
  meta:   { label: "Meta",   blurb: "Dengeli: orta TBM, orta dönüşüm, orta yorulma.",        cpcMult: 1,    cvrMult: 1,    fatigueRate: 0.06 },
  tiktok: { label: "TikTok", blurb: "Ucuz tıklama ama hızlı yorulan kitle, düşük niyet.",    cpcMult: 0.72, cvrMult: 0.86, fatigueRate: 0.11 },
  google: { label: "Google", blurb: "Pahalı tıklama, yüksek alım niyeti, çok yavaş yorulur.", cpcMult: 1.38, cvrMult: 1.34, fatigueRate: 0.025 },
};

/** Pzt→Paz talep katsayısı: hafta sonu alışveriş yoğunlaşır. */
export const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;
const WEEKDAY_DEMAND = [0.9, 0.94, 1.0, 1.06, 1.16, 1.2, 1.02];
export const weekdayOf = (day: number) => (day - 1) % 7;
export const weekdayDemand = (day: number) => WEEKDAY_DEMAND[weekdayOf(day)];

export const CREATIVE_COST = 45;

export type DayRecord = {
  day: number;
  visitors: number;
  orders: number;
  revenue: number;
  adSpend: number;
  cogs: number;
  fees: number;
  refunds: number;
  profit: number;
  cash: number;
};

export type LogEntry = { day: number; kind: "info" | "good" | "bad"; text: string };

export type SimState = {
  version: 1;
  storeName: string;
  difficulty: Difficulty;
  day: number;
  cash: number;
  products: StoreProduct[];
  history: DayRecord[];
  log: LogEntry[];
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
  spentOnInventory: number;
  status: "running" | "bankrupt" | "finished";
  pendingDecision?: { id: string; day: number };
  decisionsTaken?: number;
  activeEvent?: { text: string; daysLeft: number; cpcMult: number; cvrMult: number };
};

export const RUN_LENGTH = 30;

export function newRun(storeName: string, difficulty: Difficulty): SimState {
  const cfg = DIFFICULTIES[difficulty];
  return {
    version: 1,
    storeName: storeName.trim() || "My Test Store",
    difficulty,
    day: 1,
    cash: cfg.startCash,
    products: [],
    history: [],
    log: [{ day: 1, kind: "info", text: `Store opened with $${cfg.startCash.toFixed(0)} in working capital.` }],
    totalRevenue: 0,
    totalProfit: 0,
    totalOrders: 0,
    spentOnInventory: 0,
    status: "running",
  };
}

export function productFromWinner(p: WinningProduct): StoreProduct {
  const cost = Math.max(0.5, parseMoneyNum(p.supplier_price_usd));
  const rec = Math.max(cost * 1.6, parseMoneyNum(p.selling_price_usd) || cost * 2.6);
  const cvr = buyersPer1000(p).value / 10;
  return {
    id: `${p.name}-${Math.random().toString(36).slice(2, 8)}`,
    name: p.name,
    emoji: p.emoji || "📦",
    image_url: p.image_url,
    unitCost: Math.round(cost * 100) / 100,
    price: Math.round(rec * 100) / 100,
    recommendedPrice: Math.round(rec * 100) / 100,
    baseCvrPct: Math.max(0.3, Math.min(9, cvr)),
    competition: p.competition_level ?? "Medium",
    trend: p.trend_score ?? 60,
    stock: 0,
    incoming: [],
    adBudget: 0,
    unitsSold: 0,
    unitsRefunded: 0,
    revenue: 0,
    rating: 4.6,
    reviews: 0,
    stockouts: 0,
    listed: true,
    channel: "meta",
    fatigue: 0,
    lastBudget: 0,
    returnPool: 0,
    repeatOrders: 0,
  };
}

const rnd = (min: number, max: number) => min + Math.random() * (max - min);

const EVENTS: { text: string; cpcMult: number; cvrMult: number; days: number; kind: "good" | "bad" }[] = [
  { text: "A creator's video went semi-viral — traffic is cheaper and converts better.", cpcMult: 0.7, cvrMult: 1.45, days: 3, kind: "good" },
  { text: "Ad auction heated up: competitors raised bids, CPCs are up.", cpcMult: 1.55, cvrMult: 1, days: 4, kind: "bad" },
  { text: "Payment processor review slowed checkout — conversion dipped.", cpcMult: 1, cvrMult: 0.7, days: 2, kind: "bad" },
  { text: "Seasonal demand spike in your niche.", cpcMult: 1.1, cvrMult: 1.35, days: 4, kind: "good" },
  { text: "A copycat store undercut your prices.", cpcMult: 1.15, cvrMult: 0.75, days: 5, kind: "bad" },
  { text: "You got featured in a niche newsletter — free traffic bump.", cpcMult: 0.85, cvrMult: 1.25, days: 2, kind: "good" },
  { text: "Shipping delays hit your supplier region.", cpcMult: 1, cvrMult: 0.85, days: 3, kind: "bad" },
];

export type DayResult = { state: SimState; record: DayRecord; events: LogEntry[] };

/** Simulate one trading day. Pure-ish: returns a new state. */
export function simulateDay(prev: SimState): DayResult {
  const cfg = DIFFICULTIES[prev.difficulty];
  const s: SimState = {
    ...prev,
    products: prev.products.map((p) => ({ ...p, incoming: [...p.incoming] })),
    history: [...prev.history],
    log: [...prev.log],
  };
  const events: LogEntry[] = [];
  const day = s.day;

  // 1. Receive inventory
  for (const p of s.products) {
    const arrived = p.incoming.filter((i) => i.arrivesDay <= day);
    if (arrived.length) {
      const qty = arrived.reduce((a, i) => a + i.qty, 0);
      p.stock += qty;
      p.incoming = p.incoming.filter((i) => i.arrivesDay > day);
      events.push({ day, kind: "good", text: `${qty} units of ${p.name} arrived in stock.` });
    }
  }

  // 2. Market event lifecycle
  if (s.activeEvent) {
    s.activeEvent = { ...s.activeEvent, daysLeft: s.activeEvent.daysLeft - 1 };
    if (s.activeEvent.daysLeft <= 0) s.activeEvent = undefined;
  }
  if (!s.activeEvent && Math.random() < cfg.eventChance) {
    const e = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    s.activeEvent = { text: e.text, daysLeft: e.days, cpcMult: e.cpcMult, cvrMult: e.cvrMult };
    events.push({ day, kind: e.kind, text: e.text });
  }
  const evCpc = s.activeEvent?.cpcMult ?? 1;
  const evCvr = s.activeEvent?.cvrMult ?? 1;

  let visitors = 0, orders = 0, revenue = 0, adSpend = 0, cogs = 0, fees = 0, refundAmt = 0;

  const dow = weekdayDemand(day);

  for (const p of s.products) {
    if (!p.listed) continue;

    const ch = CHANNELS[p.channel ?? "meta"];
    const fatigue = Math.max(0, Math.min(0.95, p.fatigue ?? 0));
    const compMult = p.competition === "High" ? 1.35 : p.competition === "Low" ? 0.8 : 1;

    // scaling too fast burns money: a >60% budget jump spikes CPC and fatigue
    const prevBudget = p.lastBudget ?? p.adBudget;
    const jump = prevBudget > 0 ? p.adBudget / prevBudget : 1;
    const scalingPenalty = jump > 1.6 ? 1 + Math.min(0.35, (jump - 1.6) * 0.25) : 1;

    const cpc = cfg.cpc * compMult * ch.cpcMult * evCpc * (1 + fatigue * 0.65) * scalingPenalty * rnd(0.85, 1.18);
    const spend = Math.min(p.adBudget, Math.max(0, s.cash + revenue - adSpend));
    const paidVisits = spend > 0 ? spend / cpc : 0;
    // organic traffic grows with sales history, reviews and trend
    const organic =
      cfg.organicMult * (Math.sqrt(p.unitsSold) * 2.2 + p.reviews * 1.1 + (p.trend / 100) * 6) * rnd(0.7, 1.3);
    // loyal buyers come back on their own — no ad cost
    const pool = p.returnPool ?? 0;
    const returning = pool * 0.06 * rnd(0.6, 1.4);
    const traffic = (paidVisits + organic + returning) * dow;

    // price elasticity: cheaper than recommended converts better, pricier worse
    const ratio = p.price / Math.max(0.01, p.recommendedPrice);
    const priceMult = Math.max(0.1, Math.min(2, 1.75 - 0.78 * ratio));
    const ratingMult = Math.max(0.4, Math.min(1.25, 0.4 + (p.rating - 2.5) / 2.6));
    const fatigueMult = 1 - fatigue * 0.5;
    const cvr = (p.baseCvrPct / 100) * priceMult * ratingMult * ch.cvrMult * fatigueMult * evCvr * rnd(0.75, 1.3);

    let wanted = Math.floor(traffic * cvr + (Math.random() < (traffic * cvr) % 1 ? 1 : 0));
    if (wanted > p.stock) {
      if (p.stock === 0 && wanted > 0) {
        p.stockouts += 1;
        p.rating = Math.max(1, p.rating - 0.12);
        events.push({ day, kind: "bad", text: `${p.name} sold out — ${wanted} buyers left empty-handed.` });
      }
      wanted = p.stock;
    }

    const gross = wanted * p.price;
    const refundRate = cfg.refundBase * (p.rating < 4 ? 1.6 : 1) * (ratio > 1.35 ? 1.4 : 1);
    const refundUnits = Math.round(wanted * refundRate);
    const netUnits = wanted - refundUnits;

    p.stock -= wanted;
    p.stock += refundUnits; // returned to stock
    p.unitsSold += netUnits;
    p.unitsRefunded += refundUnits;
    p.revenue += netUnits * p.price;

    // reviews accumulate on ~18% of net orders
    const newReviews = Math.round(netUnits * 0.18);
    if (newReviews > 0) {
      const valueScore = 4.9 - (ratio - 1) * 1.6 - (p.competition === "High" ? 0.15 : 0);
      const target = Math.max(2, Math.min(5, valueScore + rnd(-0.3, 0.3)));
      p.rating = (p.rating * p.reviews + target * newReviews) / (p.reviews + newReviews);
      p.reviews += newReviews;
    }

    // creative fatigue: burns while spending, cools down when paused
    p.fatigue = Math.max(0, Math.min(0.95,
      spend > 0
        ? fatigue + ch.fatigueRate * (0.6 + Math.min(1.4, spend / 60)) * (scalingPenalty > 1 ? 1.5 : 1)
        : fatigue - 0.09,
    ));
    if (p.fatigue > 0.7 && fatigue <= 0.7) {
      events.push({ day, kind: "bad", text: `${p.name} kreatifi yoruldu — TBM artıyor, dönüşüm düşüyor. Yeni kreatif çek.` });
    }
    p.lastBudget = p.adBudget;

    // loyalty: happy buyers join the return pool, unhappy ones leave it
    const loyalty = Math.max(0, (p.rating - 3.4) / 1.6);
    p.returnPool = Math.max(0, (pool - returning * 0.35) + netUnits * 0.5 * loyalty);
    p.repeatOrders = (p.repeatOrders ?? 0) + Math.round(Math.min(netUnits, returning * cvr));

    visitors += traffic;
    orders += netUnits;
    revenue += netUnits * p.price;
    adSpend += spend;
    fees += netUnits * p.price * cfg.platformFeePct + netUnits * cfg.shippingPerUnit;
    refundAmt += refundUnits * p.price * 0.35; // shipping + processing lost on refunds
    cogs += 0; // COGS is paid when inventory is purchased
  }

  const fixed = cfg.dailyFixedCost;
  const profit = revenue - adSpend - fees - refundAmt - fixed;
  s.cash = Math.round((s.cash + profit) * 100) / 100;
  s.totalRevenue += revenue;
  s.totalProfit += profit;
  s.totalOrders += orders;

  const record: DayRecord = {
    day,
    visitors: Math.round(visitors),
    orders,
    revenue: Math.round(revenue * 100) / 100,
    adSpend: Math.round(adSpend * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    fees: Math.round((fees + fixed) * 100) / 100,
    refunds: Math.round(refundAmt * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    cash: s.cash,
  };
  s.history.push(record);
  s.day = day + 1;

  if (s.cash < 0) {
    s.status = "bankrupt";
    events.push({ day, kind: "bad", text: "You ran out of cash. The store is insolvent." });
  } else if (s.day > RUN_LENGTH) {
    s.status = "finished";
    events.push({
      day,
      kind: s.totalProfit >= cfg.targetProfit ? "good" : "bad",
      text: s.totalProfit >= cfg.targetProfit
        ? `30-day run complete — target beaten with $${s.totalProfit.toFixed(0)} net profit.`
        : `30-day run complete — $${s.totalProfit.toFixed(0)} net profit vs $${cfg.targetProfit} target.`,
    });
  }

  // strategic decision card (player choice) — one at a time
  if (s.status === "running" && !s.pendingDecision && s.products.length > 0 && day > 2 && Math.random() < 0.16) {
    const card = DECISIONS[Math.floor(Math.random() * DECISIONS.length)];
    s.pendingDecision = { id: card.id, day };
  }

  s.log = [...s.log, ...events].slice(-120);
  return { state: s, record, events };
}

export function restock(state: SimState, productId: string, qty: number): { state: SimState; error?: string } {
  const cfg = DIFFICULTIES[state.difficulty];
  const p = state.products.find((x) => x.id === productId);
  if (!p || qty <= 0) return { state };
  const bulkDiscount = qty >= 100 ? 0.85 : qty >= 50 ? 0.92 : 1;
  const unitCost = Math.round(p.unitCost * bulkDiscount * 100) / 100;
  const total = unitCost * qty;
  if (total > state.cash) return { state, error: "Not enough cash for that purchase order." };
  const next: SimState = {
    ...state,
    cash: Math.round((state.cash - total) * 100) / 100,
    spentOnInventory: state.spentOnInventory + total,
    totalProfit: state.totalProfit, // inventory is an asset swap until sold
    products: state.products.map((x) =>
      x.id === productId
        ? { ...x, incoming: [...x.incoming, { qty, arrivesDay: state.day + cfg.leadTimeDays, unitCost }] }
        : x,
    ),
    log: [
      ...state.log,
      {
        day: state.day,
        kind: "info" as const,
        text: `Ordered ${qty}× ${p.name} for $${total.toFixed(2)} (arrives day ${state.day + cfg.leadTimeDays}).`,
      },
    ],
  };
  return { state: next };
}

export function netMarginPct(p: StoreProduct, cfg: DifficultyConfig) {
  const net = p.price - p.unitCost - p.price * cfg.platformFeePct - cfg.shippingPerUnit;
  return (net / Math.max(0.01, p.price)) * 100;
}

export function unitProfit(p: StoreProduct, cfg: DifficultyConfig) {
  return p.price - p.unitCost - p.price * cfg.platformFeePct - cfg.shippingPerUnit;
}
