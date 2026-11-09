/**
 * ÜRÜN MALİYET DÖKÜMÜ — ölçülen değer varsa onu, yoksa KAYNAĞI BELİRTİLMİŞ
 * hesaplanmış değeri döndürür.
 *
 * NEDEN VAR (2026-11-09, kullanıcı ekran görüntüsü): derin analizde kargo,
 * platform komisyonu ve CAC alanları boş görünüyordu. Bu üç kalem için
 * ürün sayfasında tek tek fiyat yazmıyor; ama platformların YAYINLANMIŞ
 * komisyon oranları, ülke kargo benchmark'ları ve CPC/CVR verileri var.
 * Bunları kullanmak, boş bırakmaktan daha yararlı — YETER Kİ hesap olduğu
 * gizlenmesin.
 *
 * DÜRÜSTLÜK KURALLARI:
 *   • Ölçülmüş maliyet (cost_breakdown) HER ZAMAN modelin önüne geçer.
 *   • Net kâr yalnız tedarik fiyatı GERÇEKTEN ölçüldüyse hesaplanır; tedarik
 *     eşleşmediyse net kâr uydurulmaz.
 *   • Her değer `basis: "measured" | "model" | "none"` ve kaynak etiketi taşır;
 *     arayüz "hesaplandı" ile "ölçüldü"yü ayırabilir.
 */

import { measuredGrossMarginPct, measuredMoney } from "./economics-evidence";
import type { Platform, WinningProduct } from "./gemini.functions";
import { PLATFORM_MARKETS, shipDays } from "./platform-market";
import { realEconomics, type RealEconomics } from "./real-economics";
import { supplierMatchKind } from "./supplier-economics";

export type CostBasis = "measured" | "model" | "none";

export type CostValue = {
  usd: number | null;
  basis: CostBasis;
  /** Kısa kaynak etiketi (arayüzde satır altında/tooltip'te gösterilir). */
  source: string;
  /** Kaynağın ayrıntısı: yayınlanmış tarife/benchmark adı. */
  detail?: string;
};

export type DeliveryEstimate = {
  min: number;
  max: number;
  basis: "measured" | "model";
  source: string;
  detail?: string;
};

export type ProductCostBreakdown = {
  supplier: CostValue;
  shipping: CostValue;
  platformFee: CostValue;
  adSpend: CostValue;
  grossProfit: CostValue;
  netProfit: CostValue;
  grossMarginPct: number | null;
  netMarginPct: number | null;
  delivery: DeliveryEstimate | null;
  /** Modelin hesaplandığı ham çıktı — kaynak/tarife paneli için. */
  model: RealEconomics | null;
  /** En az bir kalem modelden geldiyse true. */
  usedModel: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function platformOf(channel?: string): Platform | null {
  const value = String(channel ?? "").trim();
  if (!value) return null;
  const exact = (Object.keys(PLATFORM_MARKETS) as Platform[]).find(
    (key) => key.toLowerCase() === value.toLowerCase(),
  );
  if (exact) return exact;
  if (/amazon/i.test(value)) return "Amazon";
  if (/hepsi/i.test(value)) return "Hepsiburada";
  if (/trendyol/i.test(value)) return "Trendyol";
  if (/etsy/i.test(value)) return "Etsy";
  if (/ebay/i.test(value)) return "eBay";
  if (/tiktok/i.test(value)) return "TikTok Shop";
  if (/walmart/i.test(value)) return "Walmart";
  if (/shopify/i.test(value)) return "Shopify";
  return null;
}

function benchmarkSource(model: RealEconomics, scope: string): string | undefined {
  return model.benchmarks.find((b) => b.scope === scope)?.source;
}

const none = (source: string): CostValue => ({ usd: null, basis: "none", source });

export function buildProductCostBreakdown(
  p: Pick<
    WinningProduct,
    | "cost_breakdown"
    | "selling_price_usd"
    | "supplier_price_usd"
    | "supplier_evidence"
    | "gross_margin_pct"
    | "fee_budget_usd"
    | "platform_fit"
    | "competition_level"
    | "trend_score"
    | "conversion"
    | "startup_cost_usd"
    | "real_economics"
    | "sourcing"
    | "name"
  >,
): ProductCostBreakdown {
  const cb = p.cost_breakdown;
  const sell = measuredMoney(p.selling_price_usd);
  const supplierKind = p.supplier_evidence ? supplierMatchKind(p.supplier_evidence) : null;
  const supplierCost = measuredMoney(cb?.supplier_cost) ?? measuredMoney(p.supplier_price_usd);
  // Eski kayıtlarda `supplier_evidence` olmayabilir ama ölçülmüş tedarik
  // fiyatı vardır; fiyat varsa ve niş bandı DEĞİLSE ölçüm kabul edilir.
  const supplierMeasured = supplierCost !== null && supplierKind !== "niche";
  const channel = p.platform_fit?.[0];
  const platform = platformOf(channel);
  const country = p.real_economics?.context?.country || "GLOBAL";

  // Ücretsiz kargo, ölçülmüş $0'dır; `measuredMoney(0)` onu "ölçülmedi"
  // saydığı için burada açıkça taşınır.
  const measuredShipping =
    measuredMoney(cb?.shipping_cost) ?? (p.supplier_evidence?.freeShipping === true ? 0 : null);

  // Model YALNIZ gerçek satış fiyatı varsa çalışır. `realEconomics` fiyat
  // yoksa 29.9 varsayar; o bir senaryodur, ürünün değeri değildir.
  const model =
    sell !== null
      ? realEconomics({
          selling_price_usd: sell,
          supplier_price_usd: supplierCost,
          shipping_cost: measuredShipping ?? undefined,
          competition_level: p.competition_level,
          platform: channel,
          trend_score: p.trend_score,
          cvr_pct: p.conversion?.cvr_pct,
          startup_cost_usd: p.startup_cost_usd,
          category: p.name,
          country,
          supplier_price_measured: supplierMeasured,
        })
      : null;

  const measuredPlatform = measuredMoney(cb?.platform_fee);
  const measuredAd = measuredMoney(cb?.ad_spend);
  const measuredNet = measuredMoney(cb?.net_profit);

  const shipping: CostValue =
    measuredShipping !== null
      ? {
          usd: measuredShipping,
          basis: "measured",
          source: measuredShipping === 0 ? "Tedarikçi ücretsiz kargo" : "Ürün sayfası / tedarikçi",
        }
      : model
        ? {
            usd: model.shipping,
            basis: "model",
            source: "Ülke kargo benchmark'ı",
            detail: benchmarkSource(model, "Lojistik"),
          }
        : none("Satış fiyatı ölçülmedi");

  const platformFee: CostValue =
    measuredPlatform !== null
      ? { usd: measuredPlatform, basis: "measured", source: "Ürün sayfası" }
      : model
        ? {
            usd: model.platform_fee,
            basis: "model",
            source: platform ? `${platform} komisyon tarifesi` : "Platform komisyon tarifesi",
            detail: benchmarkSource(model, "Pazaryeri"),
          }
        : none("Satış fiyatı ölçülmedi");

  const adSpend: CostValue =
    measuredAd !== null
      ? { usd: measuredAd, basis: "measured", source: "Ürün sayfası" }
      : model
        ? {
            usd: model.cac,
            basis: "model",
            source: "Pazaryeri TACoS / CPC modeli",
            detail: benchmarkSource(model, "Reklam"),
          }
        : none("Satış fiyatı ölçülmedi");

  const grossProfitUsd =
    sell !== null && supplierCost !== null && sell > supplierCost
      ? r2(sell - supplierCost)
      : measuredMoney(p.fee_budget_usd);
  const grossProfit: CostValue =
    grossProfitUsd !== null
      ? {
          usd: grossProfitUsd,
          basis: "measured",
          source: "Satış − tedarik",
        }
      : none("Tedarik fiyatı ölçülmedi");

  // NET KÂR: doğrudan ölçülmüş net varsa o. Yoksa dört kalem de ölçülmüşse
  // aritmetik yapılabilir. Hiçbiri yoksa model yalnız TEDARİK ÖLÇÜLDÜYSE
  // devreye girer; ölçülmemiş tedarikten net kâr üretmek uydurma olurdu.
  const measuredNetComplete =
    measuredNet !== null ||
    (sell !== null &&
      supplierCost !== null &&
      measuredShipping !== null &&
      measuredPlatform !== null &&
      measuredAd !== null);
  const measuredNetValue =
    measuredNet ??
    (measuredNetComplete && sell !== null
      ? r2(sell - (supplierCost! + measuredShipping! + measuredPlatform! + measuredAd!))
      : null);

  // Modelin net kârı, modelin kargo/komisyon/CAC kalemlerini içerir. Ölçülmüş
  // bir kalem varsa modeldeki karşılığını çıkarıp ölçümü koyarız; böylece
  // "ücretsiz kargo" gibi gerçek bir $0 modelde kaybolmaz.
  const modelNetAdjusted =
    supplierMeasured && model
      ? r2(
          model.net_per_unit -
            (model.shipping - (measuredShipping ?? model.shipping)) -
            (model.platform_fee - (measuredPlatform ?? model.platform_fee)) -
            (model.cac - (measuredAd ?? model.cac)),
        )
      : null;

  const netProfit: CostValue =
    measuredNetValue !== null
      ? {
          usd: measuredNetValue,
          basis: "measured",
          source: "Tam maliyet dökümü",
        }
      : modelNetAdjusted !== null
        ? {
            usd: modelNetAdjusted,
            basis: "model",
            source: "Kargo + komisyon + CAC hesabı",
            detail: "Tedarik fiyatı ölçüldü; diğer kalemler yayınlanmış tarifelerden hesaplandı.",
          }
        : none(
            supplierKind === "niche" ? "Birebir tedarik teklifi yok" : "Tedarik fiyatı ölçülmedi",
          );

  const grossMarginPct =
    measuredGrossMarginPct(p) ??
    (grossProfitUsd !== null && sell !== null && sell > 0
      ? Math.round((grossProfitUsd / sell) * 1000) / 10
      : null);
  const netMarginPct =
    netProfit.usd !== null && sell !== null && sell > 0
      ? Math.round((netProfit.usd / sell) * 1000) / 10
      : null;

  const supplierDeliveryMin = p.supplier_evidence?.deliveryMinDays;
  const supplierDeliveryMax = p.supplier_evidence?.deliveryMaxDays;
  const leadTime = String(p.sourcing?.lead_time_days ?? "").trim();
  const delivery: DeliveryEstimate | null = (() => {
    if (
      typeof supplierDeliveryMin === "number" &&
      typeof supplierDeliveryMax === "number" &&
      supplierDeliveryMin > 0 &&
      supplierDeliveryMax >= supplierDeliveryMin
    ) {
      return {
        min: supplierDeliveryMin,
        max: supplierDeliveryMax,
        basis: "measured",
        source: "Tedarik teklifi teslimatı",
      };
    }
    if (leadTime) {
      const numbers = leadTime.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const min = Number(numbers[0]?.replace(",", "."));
      const max = Number(numbers[1]?.replace(",", ".") ?? numbers[0]?.replace(",", "."));
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0) {
        return {
          min: Math.round(min),
          max: Math.round(Math.max(min, max)),
          basis: "measured",
          source: "Tedarik sözleşmesi",
        };
      }
    }
    if (platform) {
      const [min, max] = shipDays(platform, country);
      return {
        min,
        max,
        basis: "model",
        source: "Platform teslimat tarifesi",
        detail: PLATFORM_MARKETS[platform]?.source,
      };
    }
    return null;
  })();

  const usedModel =
    [shipping, platformFee, adSpend, netProfit].some((row) => row.basis === "model") ||
    delivery?.basis === "model";

  const nicheLow = measuredMoney(p.supplier_evidence?.supplierLowUsd);
  const nicheHigh = measuredMoney(p.supplier_evidence?.supplierHighUsd);

  return {
    supplier:
      supplierCost !== null
        ? { usd: supplierCost, basis: "measured", source: "Tedarik teklifi" }
        : supplierKind === "niche" && nicheLow !== null && nicheHigh !== null
          ? {
              usd: null,
              basis: "none",
              source: `Niş bandı $${nicheLow.toFixed(2)}–$${nicheHigh.toFixed(2)}`,
              detail: "Birebir ürün eşleşmedi; benzer tekliflerin ölçülen fiyat aralığı.",
            }
          : none(supplierKind === "niche" ? "Birebir ürün eşleşmedi" : "Tedarik teklifi eşleşmedi"),
    shipping,
    platformFee,
    adSpend,
    grossProfit,
    netProfit,
    grossMarginPct,
    netMarginPct,
    delivery,
    model,
    usedModel,
  };
}
