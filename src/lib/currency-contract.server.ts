// ============================================================================
// SUNUCU TARAFI PARA BİRİMİ SÖZLEŞMESİ
//
// AI bazen `selling_price_usd` alanına yerel tutar yazıyor (ör. "₺12.033,41").
// Bu modül, metinde AÇIKÇA görülen yerel para birimini gerçek FX kuruyla USD'ye
// çevirir. Sembolsüz tutarı USD varsaymaz; çevrilemezse dokunmaz.
//
// NEDEN AYRI DOSYA: `consistency.ts` istemci paketine girer; FX çağrısı
// yapamaz. Dönüşüm yalnızca sunucu hattında, normalizasyondan ÖNCE çalışır.
// ============================================================================
import type { WinningProduct } from "@/lib/gemini.functions";
import { detectCurrency, parseNumber } from "@/lib/money";
import { toUsd } from "@/lib/fx-rates.server";

type Cache = Map<string, Promise<number | null>>;

async function convertText(
  value: string | undefined | null,
  cache: Cache,
  counter: { converted: number; failed: number },
): Promise<string> {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const currency = detectCurrency(text);
  if (!currency || currency === "USD") return text;

  const amount = parseNumber(text);
  if (amount === null) return text;

  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  if (abs === 0) return "$0.00";

  const key = `${currency}:${abs}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = toUsd(abs, currency);
    cache.set(key, pending);
  }
  const usd = await pending;
  if (usd === null) {
    counter.failed += 1;
    return text;
  }
  counter.converted += 1;
  return `$${(sign * usd).toFixed(2)}`;
}

async function convertArray<T>(
  rows: T[] | undefined,
  pick: (row: T) => string | undefined,
  set: (row: T, value: string) => T,
  cache: Cache,
  counter: { converted: number; failed: number },
): Promise<T[] | undefined> {
  if (!Array.isArray(rows)) return rows;
  return Promise.all(
    rows.map(async (row) => {
      const value = pick(row);
      if (!value) return row;
      const converted = await convertText(value, cache, counter);
      return converted === value ? row : set(row, converted);
    }),
  );
}

/**
 * Ürünün para alanlarını, metinde görülen yerel para biriminden USD'ye çevirir.
 * Sembolsüz alanlara DOKUNMAZ; böylece "yerel tutarı USD sanma" hatası oluşmaz.
 */
export async function convertProductMoneyToUsd(p: WinningProduct): Promise<WinningProduct> {
  const cache: Cache = new Map();
  const counter = { converted: 0, failed: 0 };
  const out: WinningProduct = { ...p };

  out.selling_price_usd = await convertText(p.selling_price_usd, cache, counter);
  out.supplier_price_usd = await convertText(p.supplier_price_usd, cache, counter);
  out.startup_cost_usd = await convertText(p.startup_cost_usd, cache, counter);

  if (p.cost_breakdown) {
    out.cost_breakdown = {
      ...p.cost_breakdown,
      supplier_cost: await convertText(p.cost_breakdown.supplier_cost, cache, counter),
      shipping_cost: await convertText(p.cost_breakdown.shipping_cost, cache, counter),
      platform_fee: await convertText(p.cost_breakdown.platform_fee, cache, counter),
      ad_spend: await convertText(p.cost_breakdown.ad_spend, cache, counter),
      net_profit: await convertText(p.cost_breakdown.net_profit, cache, counter),
    };
  }

  out.competitor_prices = await convertArray(
    p.competitor_prices,
    (row) => row.price,
    (row, value) => ({ ...row, price: value }),
    cache,
    counter,
  );

  if (p.unit_economics) {
    out.unit_economics = {
      ...p.unit_economics,
      target_cpa_usd: await convertText(p.unit_economics.target_cpa_usd, cache, counter),
      ltv_usd: await convertText(p.unit_economics.ltv_usd, cache, counter),
    };
  }

  if (p.sourcing) {
    out.sourcing = {
      ...p.sourcing,
      sample_cost_usd: await convertText(p.sourcing.sample_cost_usd, cache, counter),
    };
  }

  out.bundles = await convertArray(
    p.bundles,
    (row) => row.price_usd,
    (row, value) => ({ ...row, price_usd: value }),
    cache,
    counter,
  );

  out.pricing_ladder = await convertArray(
    p.pricing_ladder,
    (row) => row.price_usd,
    (row, value) => ({ ...row, price_usd: value }),
    cache,
    counter,
  );

  out.supplier_shortlist = await convertArray(
    p.supplier_shortlist,
    (row) => row.unit_price_usd,
    (row, value) => ({ ...row, unit_price_usd: value }),
    cache,
    counter,
  );

  if (Array.isArray(p.financial_projection)) {
    out.financial_projection = await Promise.all(
      p.financial_projection.map(async (row) => ({
        ...row,
        revenue_usd: await convertText(row.revenue_usd, cache, counter),
        ad_spend_usd: await convertText(row.ad_spend_usd, cache, counter),
        net_profit_usd: await convertText(row.net_profit_usd, cache, counter),
      })),
    );
  }

  if (counter.converted > 0 || counter.failed > 0) {
    const note = [
      counter.converted > 0 ? `${counter.converted} yerel para tutarı FX ile USD'ye çevrildi.` : "",
      counter.failed > 0
        ? `${counter.failed} yerel para tutarı için kur alınamadı; alan çevrilmedi.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    out.confidence_reason = `${out.confidence_reason ?? ""} ${note}`.trim();
  }

  return out;
}
