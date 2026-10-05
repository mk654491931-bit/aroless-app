import { buyersPer1000 } from "@/lib/consistency";
import { hasMeasuredNetProfit, measuredMarginPct } from "@/lib/economics-evidence";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct, NOT_MEASURED } from "@/lib/recommendation";
import { parseMoney, MIN_NET_MARGIN_PCT } from "@/lib/unit-economics";

export function toCsv(list: WinningProduct[]): string {
  const head = [
    "Product",
    "Supplier price",
    "Selling price",
    "Margin %",
    // Net marj ölçülmediği için ayrı sütunlar: brüt marj (kargo öncesi) ve
    // kargoya kalan pay. Karıştırılırsa kullanıcı brütü ağırlık alır.
    "Gross margin % (pre-fee)",
    "Fee budget USD",
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
      // Ölçülmemiş alan CSV'ye de SAYI OLARAK GİRMEZ — boş hücre yazılır.
      // Net marj ölçülmediyse ÖLÇÜLEN brüt marj ayrı sütuna yazılır; ikisi
      // karıştırılmaz (brüt ≠ net).
      measuredMarginPct(p) ?? "",
      p.gross_margin_pct ?? "",
      p.fee_budget_usd ?? "",
      e.ai_score,
      e.trend_score,
      b,
      (b / 10).toFixed(1),
      e.recommendation,
      e.est_monthly_net_profit_usd ?? "",
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
      (p.why_winning
        ? `<p><strong>Why it wins:</strong> ${p.why_winning.replace(/</g, "&lt;")}</p>`
        : "") +
      (p.target_audience
        ? `<p><strong>For:</strong> ${p.target_audience.replace(/</g, "&lt;")}</p>`
        : "") +
      (p.ad_angles?.length
        ? `<ul>${p.ad_angles.map((a) => `<li>${a.replace(/</g, "&lt;")}</li>`).join("")}</ul>`
        : "");
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
 *
 * DÜRÜSTLÜK (ölçülen hata, 2026-10-05): eskiden döküm yoksa
 * `computeUnitEconomics` çağrılıp kargo/komisyon/reklam TAHMİN ediliyor ve
 * sonuç "net marj" diye gösteriliyordu. Ölçümlü keşif hattında bu, kazınmamış
 * bir sayıyı gerçek gibi sunmak demekti. Artık net marj YALNIZ ölçülmüş
 * girdilerden gelir:
 *   • dökümde `net_profit` ölçülmüşse → o,
 *   • dört maliyet kalemi de ölçülmüşse → satış − (tedarik+kargo+komisyon+reklam),
 *   • döküm yok ama gerçek-dünya modeli varsa → modelin net/adet değeri
 *     (kart bunu zaten varsayımlarıyla BİRLİKTE, "tahmini" bağlamında gösterir),
 *   • hiçbiri yoksa → "—". Uydurma tahmin YOK.
 */
export function netMarginView(p: WinningProduct): { text: string; bad: boolean } {
  // ÖLÇÜM YOKSA MARJ DA YOKTUR. Ölçülen hata: keşif hattının maliyet alanları
  // boş olduğu halde `cost_breakdown` nesnesi DOLU göründüğü için hesap
  // "net = 0" buluyor ve kart HER ÜRÜNDE "0% (UNPROFITABLE)" yazıyordu.
  if (!hasMeasuredNetProfit(p)) return { text: NOT_MEASURED, bad: false };
  const cb = p.cost_breakdown;
  const sell = parseMoney(p.selling_price_usd);
  let net: number | null = null;
  if (cb) {
    const declared = parseMoney(cb.net_profit);
    if (declared) net = declared;
    else {
      const supplier = parseMoney(cb.supplier_cost);
      const shipping = parseMoney(cb.shipping_cost);
      const fee = parseMoney(cb.platform_fee);
      const ad = parseMoney(cb.ad_spend);
      // Dört kalem de ölçülmüşse aritmetik geçerlidir; biri bile boşsa net
      // BİLİNMİYORdur (eksik kalemi tahmin etmek uydurma olurdu).
      if (supplier && shipping && fee && ad) net = sell - (supplier + shipping + fee + ad);
    }
  } else if (p.real_economics) {
    net = p.real_economics.net_per_unit;
  }
  // Satış fiyatı da net de yoksa yüzde hesaplanamaz — bu da "ölçtük ve sıfır
  // bulduk" DEĞİLDİR.
  if (net === null || !(sell > 0)) return { text: NOT_MEASURED, bad: false };
  const pct = (net / sell) * 100;
  if (net <= 0 || pct <= 0) return { text: "0% (UNPROFITABLE)", bad: true };
  if (pct < MIN_NET_MARGIN_PCT)
    return { text: `${pct.toFixed(0)}% (BELOW ${MIN_NET_MARGIN_PCT}%)`, bad: true };
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
