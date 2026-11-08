import type { WinningProduct } from "./gemini.functions";
import { measuredMoney } from "./economics-evidence";
import { parseMoneyNumber } from "./money";
import { realEconomics } from "./real-economics";

export type Issue = {
  level: "error" | "warn";
  field: string;
  message: string;
};

export type ConsistencyReport = {
  score: number; // 0-100 data trust score
  issues: Issue[];
  checked: number;
};

/**
 * Tek para parserına delege eder.
 *
 * Eski gövde `"12.033,41"` → `12.03341` okuyordu; aynı ürünün bir panelinde
 * `$12.033,41`, diğerinde `$12,03` görünmesinin nedeni buydu. Artık bütün
 * sayısal para alanları `src/lib/money.ts` sözleşmesini kullanır.
 */
export function parseMoneyNum(s: string | undefined | null): number {
  return parseMoneyNumber(s);
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/**
 * Deterministic cross-field validation of an AI-generated product record.
 * Catches internally contradictory numbers before the user acts on them.
 */
export function checkConsistency(p: WinningProduct): ConsistencyReport {
  const issues: Issue[] = [];
  let checked = 0;

  const supplier = parseMoneyNum(p.supplier_price_usd);
  const sell = parseMoneyNum(p.selling_price_usd);
  const cb = p.cost_breakdown;

  // 1. selling price must exceed supplier price
  checked++;
  if (sell > 0 && supplier > 0 && sell <= supplier) {
    issues.push({
      level: "error",
      field: "price",
      message: "Selling price is not above supplier cost.",
    });
  }

  // 2. cost breakdown must reconcile with net profit
  //
  // YALNIZ ölçülmüş net_profit varken anlamlıdır. Ölçümlü keşif hattında toptan
  // fiyat ölçülür ama kargo/komisyon/reklam ÖLÇÜLMEZ; döküm kısmi olduğu için
  // "net_profit = ''" gelir. Bunu 0 sayıp "net kâr uyuşmuyor" uyarısı üretmek
  // YANLIŞTIR: kısmi döküm dürüsttür, çelişki değildir (ölçülen hata).
  const netProfitMeasured = measuredMoney(cb?.net_profit) !== null;
  if (cb && netProfitMeasured) {
    checked++;
    const costs =
      parseMoneyNum(cb.supplier_cost) +
      parseMoneyNum(cb.shipping_cost) +
      parseMoneyNum(cb.platform_fee) +
      parseMoneyNum(cb.ad_spend);
    const net = parseMoneyNum(cb.net_profit);
    if (sell > 0 && !near(sell - costs, net, Math.max(1, sell * 0.08))) {
      issues.push({
        level: "warn",
        field: "cost_breakdown",
        message: `Net profit (${cb.net_profit}) doesn't reconcile with sell price minus costs (≈$${(sell - costs).toFixed(2)}).`,
      });
    }
    // 3. net margin % must match net / sell
    checked++;
    if (sell > 0 && net !== 0) {
      const implied = (net / sell) * 100;
      if (!near(implied, cb.net_margin_pct ?? 0, 8)) {
        issues.push({
          level: "warn",
          field: "net_margin_pct",
          message: `Stated margin ${cb.net_margin_pct}% vs implied ${implied.toFixed(0)}%.`,
        });
      }
    }
    // 4. supplier cost in breakdown vs headline supplier price
    checked++;
    if (
      supplier > 0 &&
      parseMoneyNum(cb.supplier_cost) > 0 &&
      !near(supplier, parseMoneyNum(cb.supplier_cost), Math.max(0.75, supplier * 0.2))
    ) {
      issues.push({
        level: "warn",
        field: "supplier_cost",
        message: "Supplier cost differs between summary and breakdown.",
      });
    }
  }

  // 5. margin percentages in range
  checked++;
  if (p.profit_margin_pct < 0 || p.profit_margin_pct > 95) {
    issues.push({
      level: "error",
      field: "profit_margin_pct",
      message: `Margin ${p.profit_margin_pct}% is outside a believable range.`,
    });
  }

  // 6. verdict vs scores
  checked++;
  const health = p.health_score ?? 70;
  if (
    p.sellability_verdict === "Highly Sellable" &&
    (health < 55 || p.competition_level === "High")
  ) {
    issues.push({
      level: "warn",
      field: "sellability_verdict",
      message: "Verdict looks optimistic versus health score / competition.",
    });
  }
  if (p.sellability_verdict === "Do Not Sell" && health >= 80) {
    issues.push({
      level: "warn",
      field: "sellability_verdict",
      message: "Verdict looks pessimistic versus a high health score.",
    });
  }

  // 7. scores bounded
  checked++;
  for (const [k, v] of Object.entries({
    trend_score: p.trend_score,
    health_score: p.health_score,
    viral_probability_90d: p.viral_probability_90d,
  })) {
    if (v !== undefined && (v < 0 || v > 100)) {
      issues.push({ level: "error", field: k, message: `${k} out of 0-100 range.` });
    }
  }

  // 8. conversion funnel coherence
  const conv = p.conversion;
  if (conv) {
    checked++;
    const b = conv.buyers_per_1000_views;
    if (!(b >= 0 && b <= 120)) {
      issues.push({
        level: "error",
        field: "conversion",
        message: "Buyers per 1,000 viewers is outside a realistic range.",
      });
    }
    checked++;
    if (conv.cvr_pct !== undefined && !near(conv.cvr_pct, b / 10, 1.5)) {
      issues.push({
        level: "warn",
        field: "conversion",
        message: "Conversion rate and buyers-per-1,000 disagree.",
      });
    }
    const f = conv.funnel;
    if (f) {
      checked++;
      const steps = [1000, f.product_page_views, f.add_to_cart, f.checkout_started, f.purchases];
      if (steps.some((s, i) => i > 0 && (s === undefined || s > steps[i - 1]))) {
        issues.push({
          level: "warn",
          field: "conversion.funnel",
          message: "Funnel steps do not decrease monotonically.",
        });
      }
      checked++;
      if (f.purchases !== undefined && !near(f.purchases, b, Math.max(2, b * 0.25))) {
        issues.push({
          level: "warn",
          field: "conversion.funnel",
          message: "Funnel purchases don't match buyers per 1,000 viewers.",
        });
      }
    }
  }

  // 9. links must be real URLs
  checked++;
  const badLink = [...(p.supplier_links ?? []), ...(p.alibaba_links ?? [])].find(
    (l) => !/^https?:\/\//i.test(l),
  );
  if (badLink)
    issues.push({
      level: "warn",
      field: "links",
      message: "One or more supplier links are not valid URLs.",
    });

  // 10. sourcing must exist for a physical product
  checked++;
  if (!p.data_sources || p.data_sources.length === 0) {
    issues.push({
      level: "warn",
      field: "data_sources",
      message: "No data sources cited for these figures.",
    });
  }

  const penalty = issues.reduce((a, i) => a + (i.level === "error" ? 18 : 7), 0);
  return { score: Math.max(0, 100 - penalty), issues, checked };
}

/** Industry-grounded fallback: buyers out of every 1,000 people who view the product. */
export function buyersPer1000(p: WinningProduct): { value: number; estimated: boolean } {
  const explicit = p.conversion?.buyers_per_1000_views;
  if (typeof explicit === "number" && explicit > 0 && explicit <= 120) {
    return { value: Math.round(explicit * 10) / 10, estimated: false };
  }
  // Benchmark: global ecommerce product-page CVR ≈ 1.5-3%; adjust by price, trend, competition.
  const sell = parseMoneyNum(p.selling_price_usd);
  let cvr = 2.2;
  if (sell > 150) cvr -= 1.0;
  else if (sell > 70) cvr -= 0.5;
  else if (sell < 25) cvr += 0.6;
  const trend = p.trend_score ?? 60;
  cvr += ((trend - 60) / 40) * 0.8;
  if (p.competition_level === "High") cvr -= 0.4;
  if (p.competition_level === "Low") cvr += 0.3;
  cvr = Math.max(0.3, Math.min(8, cvr));
  return { value: Math.round(cvr * 10 * 10) / 10, estimated: true };
}

export function conversionTone(per1000: number) {
  if (per1000 >= 30)
    return { label: "Excellent", cls: "border-emerald-500/40 bg-emerald-500/12 text-emerald-300" };
  if (per1000 >= 18)
    return { label: "Strong", cls: "border-teal-500/40 bg-teal-500/12 text-teal-300" };
  if (per1000 >= 10)
    return { label: "Average", cls: "border-amber-500/40 bg-amber-500/12 text-amber-300" };
  return { label: "Weak", cls: "border-rose-500/40 bg-rose-500/12 text-rose-300" };
}

/**
 * Repairs internally inconsistent AI output so the UI never shows contradicting numbers.
 *
 * DÜRÜSTLÜK KURALI (2026-11): bu fonksiyon artık HİÇBİR bölümü "boş kalmasın"
 * diye doldurmaz. Eski gövde pazar doygunluğu ("2.000+ satıcı"), fiyat
 * basamakları, tedarikçi kısa listesi, 90 günlük finansal projeksiyon, içerik
 * takvimi ve reklam brifinglerini ürünün kendi rakamlarından TÜRETİYORDU;
 * arayüz bunları araştırma sonucu gibi gösteriyordu. Artık yalnız:
 *   • mevcut alanların sınır/çelişki onarımı,
 *   • açıkça "benchmark modeli" etiketli dönüşüm tahmini,
 *   • `real_economics` (ayrı ve model olduğu işaretli senaryo)
 * üretilir. Kaynak/AI bir bölümü vermediyse o bölüm BOŞ kalır ve arayüz
 * "ölçülmedi" der — uydurma sayı göstermez.
 */
export function normalizeProduct(
  p: WinningProduct,
  ctx?: { country?: string; category?: string },
): WinningProduct {
  const out: WinningProduct = { ...p };
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  out.trend_score = clamp(Math.round(Number(out.trend_score) || 50), 0, 100);
  if (out.health_score !== undefined)
    out.health_score = clamp(Math.round(Number(out.health_score) || 0), 0, 100);
  if (out.viral_probability_90d !== undefined)
    out.viral_probability_90d = clamp(Math.round(Number(out.viral_probability_90d) || 0), 0, 100);
  out.profit_margin_pct = clamp(Math.round(Number(out.profit_margin_pct) || 0), -100, 100);

  const c = out.conversion;
  if (c) {
    const b = clamp(Number(c.buyers_per_1000_views) || 0, 0, 120);
    out.conversion = {
      ...c,
      buyers_per_1000_views: Math.round(b * 10) / 10,
      cvr_pct: Math.round((b / 10) * 100) / 100,
      funnel: c.funnel
        ? {
            product_page_views: clamp(
              Math.round(Number(c.funnel.product_page_views) || 1000),
              1,
              1000,
            ),
            add_to_cart: Math.max(0, Math.round(Number(c.funnel.add_to_cart) || 0)),
            checkout_started: Math.max(0, Math.round(Number(c.funnel.checkout_started) || 0)),
            purchases: Math.round(b),
          }
        : undefined,
    };
  } else {
    const est = buyersPer1000(out);
    out.conversion = {
      buyers_per_1000_views: est.value,
      cvr_pct: Math.round((est.value / 10) * 100) / 100,
      benchmark:
        "Category benchmark model (avg ecommerce CVR 1.5-3%, adjusted for price, trend and competition)",
      reasoning:
        "Derived from category conversion benchmarks because the live source did not report a verified rate.",
    };
  }

  // ---- Gerçek dünya birim ekonomisi (AYRI MODEL — ölçüm değil) ----
  //
  // Ölçülen hata: bu modelin çıktısı `cost_breakdown` ve `supplier_price_usd`
  // alanlarına YAZILIYOR, böylece "ölçülmüş tedarik/marj" gibi görünüyordu.
  // Model tedarik fiyatı yoksa perakendenin ~%30'unu varsayar; bu bir senaryo
  // varsayımıdır, sayfadan ölçülmüş fiyat değildir. Artık model yalnız
  // `real_economics` içinde KALIR; ölçüm alanlarına dokunmaz.
  const platform = out.platform_fit?.[0] ?? "Shopify";
  const re = realEconomics({
    selling_price_usd: out.selling_price_usd,
    supplier_price_usd: out.supplier_price_usd ?? out.cost_breakdown?.supplier_cost,
    shipping_cost: out.cost_breakdown?.shipping_cost,
    competition_level: out.competition_level,
    platform,
    trend_score: out.trend_score ?? 60,
    cvr_pct: out.conversion?.cvr_pct,
    startup_cost_usd: out.startup_cost_usd,
    country: ctx?.country,
    category: ctx?.category || out.name,
    // AI'ın yazdığı tedarik fiyatı ÖLÇÜM DEĞİLDİR; model onu bandına çekebilir
    // ama bu çıktı ölçülmüş fiyat diye hiçbir alana yazılmaz.
    supplier_price_measured: false,
  });
  out.real_economics = re;

  return out;
}
