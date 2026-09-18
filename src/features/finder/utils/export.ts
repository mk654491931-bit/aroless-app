import { buyersPer1000 } from "@/lib/consistency";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct } from "@/lib/recommendation";
import { computeUnitEconomics, parseMoney, MIN_NET_MARGIN_PCT } from "@/lib/unit-economics";

export function toCsv(list: WinningProduct[]): string {
  const head = [
    "Product",
    "Supplier price",
    "Selling price",
    "Margin %",
    "AI score",
    "Trend",
    "Buyers per 1000",
    "CVR %",
    "Recommendation",
    "Est. monthly profit USD",
  ];
  const rows = list.map((p) => {
    const e = enrichProduct(p);
    const b = buyersPer1000(p).value;
    return [
      p.name,
      p.supplier_price_usd,
      p.selling_price_usd,
      p.profit_margin_pct,
      e.ai_score,
      e.trend_score,
      b,
      (b / 10).toFixed(1),
      e.recommendation,
      e.est_monthly_net_profit_usd,
    ];
  });
  return [head, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function csvEscape(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function parsePriceNumber(s: string | undefined): string {
  if (!s) return "";
  const m = s.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return m ? m[1] : "";
}

export function buildShopifyCsv(products: WinningProduct[]): string {
  const headers = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Product Category",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Grams",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Variant Barcode",
    "Image Src",
    "Image Position",
    "Image Alt Text",
    "Gift Card",
    "SEO Title",
    "SEO Description",
    "Status",
  ];
  const rows: string[] = [headers.join(",")];
  for (const p of products) {
    const handle = slugify(p.name || "product");
    const bodyHtml =
      `<p>${(p.description || "").replace(/</g, "&lt;")}</p>` +
      (p.why_winning ? `<p><strong>Why it wins:</strong> ${p.why_winning.replace(/</g, "&lt;")}</p>` : "") +
      (p.target_audience ? `<p><strong>For:</strong> ${p.target_audience.replace(/</g, "&lt;")}</p>` : "") +
      (p.ad_angles?.length ? `<ul>${p.ad_angles.map((a) => `<li>${a.replace(/</g, "&lt;")}</li>`).join("")}</ul>` : "");
    const tags = [
      ...(p.platform_fit ?? []),
      p.competition_level ? `competition:${p.competition_level}` : "",
      `trend:${p.trend_score ?? ""}`,
    ]
      .filter(Boolean)
      .join(", ");
    const price = parsePriceNumber(p.selling_price_usd);
    const cost = parsePriceNumber(p.supplier_price_usd);
    const row = [
      handle,
      p.name,
      bodyHtml,
      "Aroless",
      "",
      "",
      tags,
      "TRUE",
      "Title",
      "Default Title",
      `OC-${handle}`.slice(0, 40),
      "0",
      "shopify",
      "10",
      "deny",
      "manual",
      price,
      cost,
      "TRUE",
      "TRUE",
      "",
      "",
      "",
      p.name,
      "FALSE",
      p.name.slice(0, 70),
      (p.description || "").slice(0, 320),
      "active",
    ]
      .map(csvEscape)
      .join(",");
    rows.push(row);
  }
  return rows.join("\n");
}

/**
 * ACTUAL net margin for the MARGIN badge: (net profit / selling price) * 100.
 * Falls back to the derived cost stack when the AI omitted a cost breakdown.
 */
export function netMarginView(p: WinningProduct): { text: string; bad: boolean } {
  const cb = p.cost_breakdown;
  const sell = parseMoney(p.selling_price_usd);
  let net: number;
  if (cb) {
    net = parseMoney(cb.net_profit);
    if (!net)
      net =
        sell -
        (parseMoney(cb.supplier_cost) +
          parseMoney(cb.shipping_cost) +
          parseMoney(cb.platform_fee) +
          parseMoney(cb.ad_spend));
  } else {
    net = computeUnitEconomics({
      retail_price: sell,
      supplier_cost: p.supplier_price_usd,
    }).net_profit;
  }
  const pct = sell > 0 ? (net / sell) * 100 : 0;
  if (net <= 0 || pct <= 0) return { text: "0% (UNPROFITABLE)", bad: true };
  if (pct < MIN_NET_MARGIN_PCT) return { text: `${pct.toFixed(0)}% (BELOW ${MIN_NET_MARGIN_PCT}%)`, bad: true };
  return { text: `${pct.toFixed(0)}%`, bad: false };
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
