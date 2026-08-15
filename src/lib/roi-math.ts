/** Gerçek mağaza rakamlarından kâr / ROI hesapları (istemci + sunucu ortak). */

export type RoiEntry = {
  id: string;
  product_name: string;
  platform: string;
  country: string;
  currency: string;
  cost_price: number;
  sell_price: number;
  shipping_cost: number;
  other_cost: number;
  ad_spend: number;
  orders: number;
  refunds: number;
  expected_margin_pct: number | null;
  notes: string | null;
  created_at: string;
};

export type RoiStats = {
  netOrders: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
  marginPct: number;
  roasPct: number;
  cac: number;
  breakEvenRoas: number;
  profitPerOrder: number;
  refundRate: number;
  vsExpectedPct: number | null;
};

export function computeRoi(e: RoiEntry): RoiStats {
  const orders = Math.max(0, Number(e.orders) || 0);
  const refunds = Math.min(orders, Math.max(0, Number(e.refunds) || 0));
  const netOrders = Math.max(0, orders - refunds);
  const unitCost = (Number(e.cost_price) || 0) + (Number(e.shipping_cost) || 0) + (Number(e.other_cost) || 0);
  const revenue = netOrders * (Number(e.sell_price) || 0);
  const cogs = netOrders * unitCost;
  const grossProfit = revenue - cogs;
  const ads = Math.max(0, Number(e.ad_spend) || 0);
  const netProfit = grossProfit - ads;
  const marginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const roasPct = ads > 0 ? (revenue / ads) * 100 : 0;
  const cac = netOrders > 0 ? ads / netOrders : 0;
  const unitGross = (Number(e.sell_price) || 0) - unitCost;
  const breakEvenRoas = unitGross > 0 ? (Number(e.sell_price) || 0) / unitGross : 0;
  const expected = e.expected_margin_pct == null ? null : Number(e.expected_margin_pct);
  return {
    netOrders,
    revenue,
    cogs,
    grossProfit,
    netProfit,
    marginPct,
    roasPct,
    cac,
    breakEvenRoas,
    profitPerOrder: netOrders > 0 ? netProfit / netOrders : 0,
    refundRate: orders > 0 ? (refunds / orders) * 100 : 0,
    vsExpectedPct: expected == null ? null : marginPct - expected,
  };
}

export function aggregateRoi(entries: RoiEntry[]) {
  const rows = entries.map((e) => ({ entry: e, stats: computeRoi(e) }));
  const revenue = rows.reduce((s, r) => s + r.stats.revenue, 0);
  const profit = rows.reduce((s, r) => s + r.stats.netProfit, 0);
  const ads = rows.reduce((s, r) => s + (Number(r.entry.ad_spend) || 0), 0);
  const orders = rows.reduce((s, r) => s + r.stats.netOrders, 0);
  return {
    rows,
    revenue,
    profit,
    ads,
    orders,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    roasPct: ads > 0 ? (revenue / ads) * 100 : 0,
    cac: orders > 0 ? ads / orders : 0,
    winners: rows.filter((r) => r.stats.netProfit > 0).length,
    losers: rows.filter((r) => r.stats.netProfit <= 0).length,
  };
}

export function money(v: number, currency = "USD") {
  const symbol = currency === "TRY" ? "₺" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const abs = Math.abs(v);
  const formatted = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(2);
  return `${v < 0 ? "-" : ""}${symbol}${formatted}`;
}
