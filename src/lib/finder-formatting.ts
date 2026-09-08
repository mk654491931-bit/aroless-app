import { computeUnitEconomics, MIN_NET_MARGIN_PCT, parseMoney } from "@/lib/unit-economics";

export type MarginProduct = {
  selling_price_usd: string;
  supplier_price_usd: string;
  cost_breakdown?: {
    net_profit?: string | null;
    supplier_cost?: string | null;
    shipping_cost?: string | null;
    platform_fee?: string | null;
    ad_spend?: string | null;
  } | null;
};

export function netMarginView(product: MarginProduct): { text: string; bad: boolean } {
  const breakdown = product.cost_breakdown;
  const sell = parseMoney(product.selling_price_usd);
  let net: number;
  if (breakdown) {
    net = parseMoney(breakdown.net_profit ?? undefined);
    if (!net) {
      net =
        sell -
        (parseMoney(breakdown.supplier_cost ?? undefined) +
          parseMoney(breakdown.shipping_cost ?? undefined) +
          parseMoney(breakdown.platform_fee ?? undefined) +
          parseMoney(breakdown.ad_spend ?? undefined));
    }
  } else {
    net = computeUnitEconomics({
      retail_price: sell,
      supplier_cost: product.supplier_price_usd,
    }).net_profit;
  }
  const pct = sell > 0 ? (net / sell) * 100 : 0;
  if (net <= 0 || pct <= 0) return { text: "0% (UNPROFITABLE)", bad: true };
  if (pct < MIN_NET_MARGIN_PCT)
    return { text: `${pct.toFixed(0)}% (BELOW ${MIN_NET_MARGIN_PCT}%)`, bad: true };
  return { text: `${pct.toFixed(0)}%`, bad: false };
}

type ShopifyCsvProduct = {
  name: string;
  description?: string | null;
  why_winning?: string | null;
  target_audience?: string | null;
  ad_angles?: string[] | null;
  platform_fit?: string[] | null;
  competition_level?: string | null;
  trend_score?: number | null;
  selling_price_usd?: string;
  supplier_price_usd?: string;
};

function parsePriceNumber(value: string | undefined): string {
  if (!value) return "";
  const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? match[1] : "";
}

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function buildShopifyCsv(products: ShopifyCsvProduct[]): string {
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
  for (const product of products) {
    const handle = slugify(product.name || "product");
    const bodyHtml =
      `<p>${(product.description || "").replace(/</g, "&lt;")}</p>` +
      (product.why_winning
        ? `<p><strong>Why it wins:</strong> ${product.why_winning.replace(/</g, "&lt;")}</p>`
        : "") +
      (product.target_audience
        ? `<p><strong>For:</strong> ${product.target_audience.replace(/</g, "&lt;")}</p>`
        : "") +
      (product.ad_angles?.length
        ? `<ul>${product.ad_angles.map((angle) => `<li>${angle.replace(/</g, "&lt;")}</li>`).join("")}</ul>`
        : "");
    const tags = [
      ...(product.platform_fit ?? []),
      product.competition_level ? `competition:${product.competition_level}` : "",
      `trend:${product.trend_score ?? ""}`,
    ]
      .filter(Boolean)
      .join(", ");
    const price = parsePriceNumber(product.selling_price_usd);
    const cost = parsePriceNumber(product.supplier_price_usd);
    rows.push(
      [
        handle,
        product.name,
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
        product.name,
        "FALSE",
        product.name.slice(0, 70),
        (product.description || "").slice(0, 320),
        "active",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return rows.join("\n");
}

export function resolveProductImage(product: { image_url?: string | null }): string | null {
  const url = product.image_url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (
    /source\.unsplash\.com|loremflickr|picsum\.photos|placehold|via\.placeholder|dummyimage/i.test(
      url,
    )
  )
    return null;
  return url;
}
