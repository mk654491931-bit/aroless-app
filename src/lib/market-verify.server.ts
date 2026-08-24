// Live market verification: cross-checks AI-generated product numbers against
// real, free data sources so the Product Finder only surfaces realistic,
// market-accurate results. Every step degrades gracefully — if a source is
// unavailable the product is still returned, just with a lower realism score.

import {
  getGoogleTrends,
  getSourcingEstimate,
  scrapeMarketplaceSellers,
} from "@/lib/market-data.server";
import { median, type MarketEvidence } from "@/lib/market-evidence";
import { parseMoney } from "@/lib/unit-economics";

export type VerifiableProduct = {
  name?: string;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  competition_level?: string;
  trend_score?: number;
  viral_proof?: Array<{ url?: string; views?: string }>;
  competitor_prices?: Array<{ store: string; price: string; note?: string; url?: string }>;
  cost_breakdown?: { supplier_cost?: string; net_margin_pct?: number };
};

/** Live evidence block injected into the research prompt (real numbers first). */
export async function buildLiveEvidenceBlock(niche: string, country: string): Promise<string> {
  const [trends, sellers] = await Promise.all([
    getGoogleTrends(niche, country).catch(() => null),
    scrapeMarketplaceSellers(niche, country).catch(() => []),
  ]);
  const lines: string[] = [];
  if (trends && trends.source === "google-trends") {
    lines.push(
      `- Google Trends (${trends.geo || "GLOBAL"}) for "${trends.keyword}": 30-day momentum ${trends.momentum_pct > 0 ? "+" : ""}${trends.momentum_pct}%, last 12-month interest range ${Math.min(...trends.yearly)}-${Math.max(...trends.yearly)} (0-100 scale).`,
    );
  }
  if (sellers.length) {
    lines.push(
      `- Live marketplace listings found right now: ${sellers
        .map((s) => `${s.platform} (${s.domain})${s.price_usd ? ` ~$${s.price_usd}` : ""}`)
        .join("; ")}.`,
    );
    const m = median(sellers.map((s) => s.price_usd));
    if (m > 0)
      lines.push(
        `- Real observed retail median in this niche: ~$${m.toFixed(2)}. Keep selling prices within a defensible range of this figure.`,
      );
  }
  if (!lines.length) return "";
  return `\nLIVE MARKET EVIDENCE (retrieved seconds ago from real sources — treat as ground truth and stay consistent with it):\n${lines.join("\n")}\n`;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Verify one product against live sources and score how realistic it is. */
export async function verifyProduct(
  p: VerifiableProduct,
  country: string,
): Promise<{ market_evidence: MarketEvidence; realism_score: number }> {
  const name = (p.name ?? "").trim();
  const sellingPrice = parseMoney(p.selling_price_usd);

  const [trends, sourcing, sellers] = await Promise.all([
    getGoogleTrends(name, country).catch(() => null),
    getSourcingEstimate(name, sellingPrice || 49).catch(() => null),
    scrapeMarketplaceSellers(name, country).catch(() => []),
  ]);

  const marketPrice = median(sellers.map((s) => s.price_usd));
  const priceDelta =
    marketPrice > 0 && sellingPrice > 0
      ? Math.round(((sellingPrice - marketPrice) / marketPrice) * 100)
      : 0;

  const verified: string[] = [];
  const unverified: string[] = [];

  if (trends?.source === "google-trends") verified.push("Google Trends talep eğrisi");
  else unverified.push("Talep eğrisi (tahmini)");

  if (sourcing?.source === "aliexpress") verified.push("AliExpress tedarik fiyatı");
  else unverified.push("Tedarik fiyatı (tahmini)");

  if (sellers.length >= 2) verified.push(`${sellers.length} canlı pazaryeri ilanı`);
  else unverified.push("Rakip fiyatları (canlı ilan bulunamadı)");

  const hasViral = (p.viral_proof ?? []).some((v) => /^https?:\/\//i.test(v?.url ?? ""));
  if (hasViral) verified.push("Viral içerik kanıtı (URL)");
  else unverified.push("Viral kanıt doğrulanamadı");

  // ---- realism scoring -------------------------------------------------
  let score = 40;
  if (trends?.source === "google-trends") score += 15;
  if (sourcing?.source === "aliexpress") score += 15;
  score += Math.min(15, sellers.length * 5);
  if (hasViral) score += 8;

  // Price sanity: the further the AI price sits from the real market median,
  // the less trustworthy the whole economics block is.
  const absDelta = Math.abs(priceDelta);
  if (marketPrice > 0) {
    if (absDelta <= 20) score += 10;
    else if (absDelta <= 45) score += 3;
    else if (absDelta <= 80) score -= 10;
    else score -= 22;
  }

  // Supplier sanity: claimed supplier cost should not be wildly below the real
  // AliExpress median for the same search.
  const claimedSupplier = parseMoney(p.cost_breakdown?.supplier_cost ?? p.supplier_price_usd);
  if (sourcing?.source === "aliexpress" && claimedSupplier > 0 && sourcing.supplier_price_usd > 0) {
    const ratio = claimedSupplier / sourcing.supplier_price_usd;
    if (ratio >= 0.5 && ratio <= 2) score += 8;
    else if (ratio < 0.25 || ratio > 4) score -= 15;
  }

  // Momentum vs. claimed trend score: a "hot" product with collapsing search
  // interest is a red flag.
  if (trends?.source === "google-trends" && typeof p.trend_score === "number") {
    if (p.trend_score >= 80 && trends.momentum_pct < -20) score -= 12;
    if (p.trend_score >= 70 && trends.momentum_pct > 10) score += 6;
  }

  const market_evidence: MarketEvidence = {
    trend_monthly: trends?.monthly ?? [],
    trend_yearly: trends?.yearly ?? [],
    trend_momentum_pct: trends?.momentum_pct ?? 0,
    trend_source: trends?.source ?? "estimated",
    supplier_price_usd: sourcing?.supplier_price_usd ?? 0,
    supplier_shipping_usd: sourcing?.shipping_usd ?? 0,
    supplier_source: sourcing?.source ?? "estimated",
    sellers,
    market_price_usd: Math.round(marketPrice * 100) / 100,
    price_delta_pct: priceDelta,
    verified_signals: verified,
    unverified_signals: unverified,
    checked_at: new Date().toISOString(),
  };

  return { market_evidence, realism_score: clamp(score) };
}
