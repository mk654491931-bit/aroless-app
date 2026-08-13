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
  /* --- growth systems --- */
  upgrades?: UpgradeId[];
  loan?: { balance: number; takenDay: number; paidInterest: number };
  subscribers?: number;
  lastCampaignDay?: number;
  /** rakip fiyat endeksi: 1 = piyasa referansı */
  marketIndex?: number;
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
    upgrades: [],
    subscribers: 0,
    marketIndex: 1,
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

  // 2b. Rakip fiyat endeksi: piyasa referans fiyatı gün gün kayar
  const prevIndex = s.marketIndex ?? 1;
  const drift = prevIndex > 1.05 ? -0.012 : prevIndex < 0.9 ? 0.014 : 0;
  s.marketIndex = Math.max(0.78, Math.min(1.22, prevIndex + drift + rnd(-0.035, 0.03)));
  if (s.marketIndex < 0.9 && prevIndex >= 0.9) {
    events.push({ day, kind: "bad", text: `Rakipler fiyat kırdı (endeks ${s.marketIndex.toFixed(2)}) — fiyatını gözden geçir.` });
  } else if (s.marketIndex > 1.1 && prevIndex <= 1.1) {
    events.push({ day, kind: "good", text: `Piyasa fiyatları yükseldi (endeks ${s.marketIndex.toFixed(2)}) — zam yapma fırsatı.` });
  }
  const marketIndex = s.marketIndex;

  // yükseltmelerin etkileri
  const upCheckout = hasUpgrade(s, "checkout") ? 1.14 : 1;
  const upShipping = hasUpgrade(s, "logistics") ? 0.72 : 1;
  const upRetention = hasUpgrade(s, "retention") ? 1.6 : 1;
  const upStudio = hasUpgrade(s, "studio") ? 0.55 : 1;
  const upBundle = hasUpgrade(s, "bundle") ? 1.18 : 1;
  const shipCost = cfg.shippingPerUnit * upShipping;


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

    // price elasticity: rakip piyasa fiyatına göre pahalı/ucuz olmak dönüşümü belirler
    const ratio = p.price / Math.max(0.01, p.recommendedPrice * marketIndex);
    const priceMult = Math.max(0.1, Math.min(2, 1.75 - 0.78 * ratio));
    const ratingMult = Math.max(0.4, Math.min(1.25, 0.4 + (p.rating - 2.5) / 2.6));
    const fatigueMult = 1 - fatigue * 0.5;
    const cvr = (p.baseCvrPct / 100) * priceMult * ratingMult * ch.cvrMult * fatigueMult * evCvr * upCheckout * rnd(0.75, 1.3);

    let wanted = Math.floor(traffic * cvr + (Math.random() < (traffic * cvr) % 1 ? 1 : 0));
    if (wanted > p.stock) {
      if (p.stock === 0 && wanted > 0) {
        p.stockouts += 1;
        p.rating = Math.max(1, p.rating - 0.12);
        events.push({ day, kind: "bad", text: `${p.name} sold out — ${wanted} buyers left empty-handed.` });
      }
      wanted = p.stock;
    }

    const refundRate = cfg.refundBase * (p.rating < 4 ? 1.6 : 1) * (ratio > 1.35 ? 1.4 : 1);
    const refundUnits = Math.round(wanted * refundRate);
    const netUnits = wanted - refundUnits;
    const aov = p.price * upBundle; // paket/üst satış ortalama sepeti büyütür

    p.stock -= wanted;
    p.stock += refundUnits; // returned to stock
    p.unitsSold += netUnits;
    p.unitsRefunded += refundUnits;
    p.revenue += netUnits * aov;

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
        ? fatigue + ch.fatigueRate * upStudio * (0.6 + Math.min(1.4, spend / 60)) * (scalingPenalty > 1 ? 1.5 : 1)
        : fatigue - 0.09,
    ));
    if (p.fatigue > 0.7 && fatigue <= 0.7) {
      events.push({ day, kind: "bad", text: `${p.name} kreatifi yoruldu — TBM artıyor, dönüşüm düşüyor. Yeni kreatif çek.` });
    }
    p.lastBudget = p.adBudget;

    // loyalty: happy buyers join the return pool, unhappy ones leave it
    const loyalty = Math.max(0, (p.rating - 3.4) / 1.6);
    p.returnPool = Math.max(0, (pool - returning * 0.35) + netUnits * 0.5 * loyalty * upRetention);
    p.repeatOrders = (p.repeatOrders ?? 0) + Math.round(Math.min(netUnits, returning * cvr));

    // e-posta listesi: her siparişin bir kısmı aboneye dönüşür
    s.subscribers = (s.subscribers ?? 0) + netUnits * 0.55 * (hasUpgrade(s, "retention") ? 1.5 : 1);

    visitors += traffic;
    orders += netUnits;
    revenue += netUnits * aov;
    adSpend += spend;
    fees += netUnits * aov * cfg.platformFeePct + netUnits * shipCost;
    refundAmt += refundUnits * p.price * 0.35; // shipping + processing lost on refunds
    cogs += 0; // COGS is paid when inventory is purchased
  }


  // kredi faizi her gün işler
  let interest = 0;
  if (s.loan && s.loan.balance > 0) {
    interest = Math.round(s.loan.balance * LOAN_DAILY_RATE * 100) / 100;
    s.loan = { ...s.loan, paidInterest: Math.round((s.loan.paidInterest + interest) * 100) / 100 };
    if (day % 7 === 0) {
      events.push({ day, kind: "bad", text: `Kredi faizi işliyor: bugüne kadar $${s.loan.paidInterest.toFixed(2)} faiz ödendi.` });
    }
  }
  // liste doğal olarak erir
  s.subscribers = Math.max(0, (s.subscribers ?? 0) * 0.992);

  const fixed = cfg.dailyFixedCost + interest;
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
  const supplierMult = hasUpgrade(state, "supplier") ? 0.94 : 1;
  const leadTime = Math.max(1, cfg.leadTimeDays - (hasUpgrade(state, "supplier") ? 2 : 0));
  const unitCost = Math.round(p.unitCost * bulkDiscount * supplierMult * 100) / 100;
  const total = unitCost * qty;
  if (total > state.cash) return { state, error: "Not enough cash for that purchase order." };
  const next: SimState = {
    ...state,
    cash: Math.round((state.cash - total) * 100) / 100,
    spentOnInventory: state.spentOnInventory + total,
    totalProfit: state.totalProfit, // inventory is an asset swap until sold
    products: state.products.map((x) =>
      x.id === productId
        ? { ...x, incoming: [...x.incoming, { qty, arrivesDay: state.day + leadTime, unitCost }] }
        : x,
    ),
    log: [
      ...state.log,
      {
        day: state.day,
        kind: "info" as const,
        text: `Ordered ${qty}× ${p.name} for $${total.toFixed(2)} (arrives day ${state.day + leadTime}).`,
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

/* ---------------- Strategic decision cards ---------------- */

export type DecisionEffect = {
  cash?: number;                 // + income / - spend
  ratingDelta?: number;          // applied to every product
  fatigueDelta?: number;         // applied to every product
  priceMult?: number;            // discount / raise across the store
  stockPerProduct?: number;      // free units added
  event?: { text: string; days: number; cpcMult: number; cvrMult: number };
  log: string;
};

export type Decision = {
  id: string;
  title: string;
  body: string;
  options: { label: string; detail: string; effect: DecisionEffect }[];
};

export const DECISIONS: Decision[] = [
  {
    id: "influencer",
    title: "Mikro-influencer teklifi",
    body: "45B takipçili bir içerik üreticisi ürününü tanıtmak için $120 istiyor. Barter da teklif ediyor.",
    options: [
      { label: "$120 öde", detail: "3 gün ucuz ve iyi dönüşen trafik", effect: { cash: -120, event: { text: "Influencer videosu yayında — trafik ucuzladı ve dönüşüm arttı.", days: 3, cpcMult: 0.72, cvrMult: 1.4 }, log: "Influencer iş birliği için $120 ödendi." } },
      { label: "Ürün gönder", detail: "Ücretsiz ama etki daha zayıf", effect: { stockPerProduct: -2, event: { text: "Barter içerik yayınlandı — ılımlı bir trafik artışı var.", days: 2, cpcMult: 0.9, cvrMult: 1.15 }, log: "Influencer'a numune ürün gönderildi." } },
      { label: "Reddet", detail: "Nakit korunur", effect: { log: "Influencer teklifi reddedildi." } },
    ],
  },
  {
    id: "supplier",
    title: "Tedarikçi zam yapıyor",
    body: "Ana tedarikçin birim maliyeti %8 artırıyor. Alternatif tedarikçi daha ucuz ama kalite riski var.",
    options: [
      { label: "Zammı kabul et", detail: "Kalite sabit", effect: { cash: -40, log: "Tedarikçi zammı kabul edildi." } },
      { label: "Ucuz tedarikçiye geç", detail: "Nakit kalır, puan düşebilir", effect: { cash: 60, ratingDelta: -0.25, log: "Daha ucuz tedarikçiye geçildi, kalite riski alındı." } },
      { label: "Stok yığ", detail: "Şimdiden ücretsiz 8 birim", effect: { cash: -150, stockPerProduct: 8, log: "Zam öncesi toplu stok alındı." } },
    ],
  },
  {
    id: "review",
    title: "1 yıldızlı kritik yorum",
    body: "Kargo gecikmesi yüzünden öfkeli bir müşteri kötü yorum bıraktı ve görülme oranı yüksek.",
    options: [
      { label: "İade + özür kiti", detail: "Puanı toparlar", effect: { cash: -55, ratingDelta: 0.3, log: "Müşteriye iade ve özür kiti gönderildi." } },
      { label: "Yalnızca yanıt yaz", detail: "Ücretsiz, küçük etki", effect: { ratingDelta: 0.08, log: "Yoruma kamuya açık yanıt verildi." } },
      { label: "Görmezden gel", detail: "Dönüşüm 2 gün düşer", effect: { event: { text: "Kötü yorum öne çıktı — dönüşüm baskı altında.", days: 2, cpcMult: 1, cvrMult: 0.82 }, ratingDelta: -0.1, log: "Kötü yorum yanıtsız bırakıldı." } },
    ],
  },
  {
    id: "flash",
    title: "Flaş indirim fırsatı",
    body: "Pazaryeri hafta sonu kampanyasına seni davet ediyor. Katılmak için fiyatları %12 düşürmen gerekiyor.",
    options: [
      { label: "Kampanyaya gir", detail: "Fiyatlar -%12, 3 gün talep patlaması", effect: { priceMult: 0.88, event: { text: "Kampanya sayfasındasın — talep arttı.", days: 3, cpcMult: 0.95, cvrMult: 1.45 }, log: "Flaş indirim kampanyasına girildi." } },
      { label: "Katılma", detail: "Marj korunur", effect: { log: "Kampanya daveti reddedildi." } },
    ],
  },
  {
    id: "creative",
    title: "Kreatif ajansı teklifi",
    body: "Bir UGC ajansı $90'a 5 yeni video paketi sunuyor.",
    options: [
      { label: "Paketi al", detail: "Tüm kreatif yorgunluğu sıfırlanır", effect: { cash: -90, fatigueDelta: -1, log: "UGC kreatif paketi satın alındı, reklamlar tazelendi." } },
      { label: "Kendin çek", detail: "Ücretsiz, kısmi tazeleme", effect: { fatigueDelta: -0.35, log: "Kendi kreatiflerin çekildi." } },
    ],
  },
  {
    id: "shipping",
    title: "Hızlı kargo anlaşması",
    body: "Kargo firması, ek ücretle 2 gün daha hızlı teslimat sunuyor. Müşteri memnuniyeti artabilir.",
    options: [
      { label: "Anlaş", detail: "Puan artar, nakit azalır", effect: { cash: -75, ratingDelta: 0.22, log: "Hızlı kargo anlaşması yapıldı." } },
      { label: "Mevcutta kal", detail: "Değişiklik yok", effect: { log: "Kargo anlaşması değiştirilmedi." } },
    ],
  },
];

export function applyDecision(state: SimState, optionIndex: number): SimState {
  const pending = state.pendingDecision;
  if (!pending) return state;
  const card = DECISIONS.find((d) => d.id === pending.id);
  const opt = card?.options[optionIndex];
  if (!card || !opt) return { ...state, pendingDecision: undefined };
  const e = opt.effect;

  const products = state.products.map((p) => ({
    ...p,
    rating: e.ratingDelta ? Math.max(1, Math.min(5, p.rating + e.ratingDelta)) : p.rating,
    fatigue: e.fatigueDelta ? Math.max(0, Math.min(0.95, (p.fatigue ?? 0) + e.fatigueDelta)) : p.fatigue,
    price: e.priceMult ? Math.round(p.price * e.priceMult * 100) / 100 : p.price,
    stock: e.stockPerProduct ? Math.max(0, p.stock + e.stockPerProduct) : p.stock,
  }));

  return {
    ...state,
    products,
    cash: Math.round((state.cash + (e.cash ?? 0)) * 100) / 100,
    activeEvent: e.event ? { text: e.event.text, daysLeft: e.event.days, cpcMult: e.event.cpcMult, cvrMult: e.event.cvrMult } : state.activeEvent,
    decisionsTaken: (state.decisionsTaken ?? 0) + 1,
    pendingDecision: undefined,
    log: [...state.log, { day: state.day, kind: "info" as const, text: `${card.title}: ${e.log}` }].slice(-120),
  };
}

/** Shoot a fresh creative for one product: costs cash, resets fatigue. */
export function refreshCreative(state: SimState, productId: string): { state: SimState; error?: string } {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return { state };
  if (hasUpgrade(state, "studio")) {
    return {
      state: {
        ...state,
        products: state.products.map((x) => (x.id === productId ? { ...x, fatigue: 0 } : x)),
        log: [...state.log, { day: state.day, kind: "good" as const, text: `${p.name} için stüdyoda ücretsiz yeni kreatif çekildi.` }].slice(-120),
      },
    };
  }
  if (state.cash < CREATIVE_COST) return { state, error: "Kreatif çekimi için yeterli nakit yok." };
  return {
    state: {
      ...state,
      cash: Math.round((state.cash - CREATIVE_COST) * 100) / 100,
      products: state.products.map((x) => (x.id === productId ? { ...x, fatigue: 0 } : x)),
      log: [...state.log, { day: state.day, kind: "good" as const, text: `${p.name} için yeni kreatif yayına alındı (-$${CREATIVE_COST}).` }].slice(-120),
    },
  };
}

/* ---------------- Growth systems: upgrades, financing, CRM ---------------- */

export type UpgradeId =
  | "checkout" | "logistics" | "supplier" | "retention" | "studio" | "bundle";

export type Upgrade = {
  id: UpgradeId;
  title: string;
  blurb: string;
  cost: number;
  icon: string;
};

export const UPGRADES: Upgrade[] = [
  { id: "checkout",  title: "Tek tık ödeme",        blurb: "Sepet terkini azaltır: dönüşüm +%14.",              cost: 220, icon: "⚡" },
  { id: "logistics", title: "3PL depo anlaşması",   blurb: "Sipariş başı kargo maliyeti -%28.",                 cost: 260, icon: "🚚" },
  { id: "supplier",  title: "Öncelikli tedarikçi",  blurb: "Teslim süresi -2 gün, birim maliyet -%6.",          cost: 300, icon: "🏭" },
  { id: "retention", title: "Sadakat programı",     blurb: "Geri dönen müşteri havuzu +%60 daha hızlı büyür.",  cost: 240, icon: "💎" },
  { id: "studio",    title: "İçerik stüdyosu",      blurb: "Kreatif yorulması -%45, kreatif çekimi ücretsiz.",  cost: 320, icon: "🎬" },
  { id: "bundle",    title: "Paket & üst satış",    blurb: "Sipariş başı ortalama sepet +%18.",                 cost: 280, icon: "🎁" },
];

export const hasUpgrade = (s: SimState, id: UpgradeId) => (s.upgrades ?? []).includes(id);

export function buyUpgrade(state: SimState, id: UpgradeId): { state: SimState; error?: string } {
  const up = UPGRADES.find((u) => u.id === id);
  if (!up) return { state };
  if (hasUpgrade(state, id)) return { state, error: "Bu yükseltme zaten aktif." };
  if (state.cash < up.cost) return { state, error: "Yükseltme için yeterli nakit yok." };
  return {
    state: {
      ...state,
      cash: Math.round((state.cash - up.cost) * 100) / 100,
      upgrades: [...(state.upgrades ?? []), id],
      log: [...state.log, { day: state.day, kind: "good" as const, text: `Yükseltme alındı: ${up.title} (-$${up.cost}).` }].slice(-120),
    },
  };
}

export const LOAN_MAX = 1500;
export const LOAN_DAILY_RATE = 0.014;

export function takeLoan(state: SimState, amount: number): { state: SimState; error?: string } {
  const owed = state.loan?.balance ?? 0;
  const room = LOAN_MAX - owed;
  const amt = Math.floor(Math.max(0, Math.min(room, amount)));
  if (amt <= 0) return { state, error: "Kredi limitin dolu." };
  return {
    state: {
      ...state,
      cash: Math.round((state.cash + amt) * 100) / 100,
      loan: { balance: Math.round((owed + amt) * 100) / 100, takenDay: state.day, paidInterest: state.loan?.paidInterest ?? 0 },
      log: [...state.log, { day: state.day, kind: "info" as const, text: `$${amt} işletme kredisi çekildi (günlük %${(LOAN_DAILY_RATE * 100).toFixed(1)} faiz).` }].slice(-120),
    },
  };
}

export function repayLoan(state: SimState, amount: number): { state: SimState; error?: string } {
  const owed = state.loan?.balance ?? 0;
  if (owed <= 0) return { state, error: "Ödenecek kredi yok." };
  const amt = Math.round(Math.max(0, Math.min(owed, Math.min(amount, state.cash))) * 100) / 100;
  if (amt <= 0) return { state, error: "Ödeme için yeterli nakit yok." };
  return {
    state: {
      ...state,
      cash: Math.round((state.cash - amt) * 100) / 100,
      loan: { balance: Math.round((owed - amt) * 100) / 100, takenDay: state.loan?.takenDay ?? state.day, paidInterest: state.loan?.paidInterest ?? 0 },
      log: [...state.log, { day: state.day, kind: "good" as const, text: `Krediden $${amt.toFixed(0)} geri ödendi.` }].slice(-120),
    },
  };
}

export const CAMPAIGN_COOLDOWN = 4;

/** E-posta listene kampanya gönder: anında sipariş yaratır, listeyi bir miktar yorar. */
export function sendCampaign(state: SimState): { state: SimState; error?: string } {
  const subs = Math.floor(state.subscribers ?? 0);
  if (subs < 25) return { state, error: "Liste henüz çok küçük (en az 25 abone gerekir)." };
  const last = state.lastCampaignDay ?? -99;
  if (state.day - last < CAMPAIGN_COOLDOWN) {
    return { state, error: `Listeyi yakma: ${CAMPAIGN_COOLDOWN - (state.day - last)} gün daha beklemelisin.` };
  }
  const listed = state.products.filter((p) => p.listed && p.stock > 0);
  if (!listed.length) return { state, error: "Stokta satılabilir ürün yok." };

  const cfg = DIFFICULTIES[state.difficulty];
  let orders = 0, revenue = 0, fees = 0;
  const products = state.products.map((p) => ({ ...p }));
  let budget = Math.round(subs * (0.045 + Math.random() * 0.03));
  for (const p of products) {
    if (budget <= 0) break;
    if (!p.listed || p.stock <= 0) continue;
    const take = Math.min(p.stock, Math.ceil(budget / listed.length) || 1);
    if (take <= 0) continue;
    p.stock -= take;
    p.unitsSold += take;
    p.revenue += take * p.price;
    p.repeatOrders = (p.repeatOrders ?? 0) + take;
    orders += take;
    revenue += take * p.price;
    fees += take * p.price * cfg.platformFeePct + take * cfg.shippingPerUnit;
    budget -= take;
  }
  const profit = revenue - fees;
  return {
    state: {
      ...state,
      products,
      cash: Math.round((state.cash + profit) * 100) / 100,
      totalRevenue: state.totalRevenue + revenue,
      totalProfit: state.totalProfit + profit,
      totalOrders: state.totalOrders + orders,
      subscribers: Math.max(0, subs * 0.94),
      lastCampaignDay: state.day,
      log: [...state.log, {
        day: state.day, kind: orders > 0 ? "good" as const : "info" as const,
        text: `E-posta kampanyası gönderildi: ${orders} sipariş, ${money2(revenue)} ciro (reklam maliyeti $0).`,
      }].slice(-120),
    },
  };
}

const money2 = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
