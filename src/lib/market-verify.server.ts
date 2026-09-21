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

/**
 * VİRAL KANIT DOĞRULAMASI — "URL biçiminde" olmak kanıt değildir.
 *
 * Model, var olmayan bir TikTok/YouTube adresini sorunsuz üretebilir; eskiden
 * skor katmanı yalnızca `https://` ile başlamasına bakıp viral bonusu veriyordu
 * (uydurma kanıt → hak etmediği puan). Artık adres AĞ ÜZERİNDEN açılır.
 *
 * Maliyet güvenliği: ürün başına en fazla 2 adres, adresler PARALEL yoklanır,
 * adres başına 2 sn sert sınır, sonuç 10 dk bellek önbelleğinde ve önbellek
 * boyutu sınırlı. Kaynak yanıt vermezse ceza YOK; yalnızca bonus verilmez
 * (kanıt seviyesi dürüst kalır).
 *
 * Neden paralel ve neden kısa: çağıran taraf bu fonksiyonu `withDeadline`
 * penceresi içinde bekliyor (`verifyPerProductMs` ≈ 7,5 sn). Seri yoklama bu
 * pencereyi tek başına yiyip canlı doğrulamayı iptal ettirebilirdi; o zaman
 * ürün TÜM kanıtını kaybederdi. Artık yoklama diğer kaynaklarla aynı anda koşar.
 */
const VIRAL_PROOF_TTL_MS = 10 * 60_000;
const VIRAL_PROOF_TIMEOUT_MS = 2_000;
const VIRAL_PROOF_MAX_URLS = 2;
const VIRAL_PROOF_CACHE_MAX = 200;
const viralProofCache = new Map<string, { ok: boolean; at: number }>();

function cachedViralProof(url: string): boolean | undefined {
  const hit = viralProofCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > VIRAL_PROOF_TTL_MS) {
    viralProofCache.delete(url);
    return undefined;
  }
  return hit.ok;
}

function rememberViralProof(url: string, ok: boolean): void {
  if (viralProofCache.size >= VIRAL_PROOF_CACHE_MAX) {
    const oldest = viralProofCache.keys().next().value;
    if (oldest !== undefined) viralProofCache.delete(oldest);
  }
  viralProofCache.set(url, { ok, at: Date.now() });
}

/** Tek bir kanıt adresi gerçekten yanıt veriyor mu? (HEAD → GET yedeği) */
async function probeUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  const headers = {
    "user-agent": "Mozilla/5.0 (compatible; ArolessEvidenceBot/1.0; +https://aroless.tech)",
    accept: "text/html,application/xhtml+xml",
  };
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, {
      method,
      headers: method === "GET" ? { ...headers, range: "bytes=0-1024" } : headers,
      redirect: "follow",
      signal: AbortSignal.timeout(VIRAL_PROOF_TIMEOUT_MS),
    });
    // 404/410 = içerik yok. 403/429 gibi bot engelleri VAR OLDUĞUNU gösterir.
    return res.status < 400 || res.status === 403 || res.status === 429;
  };
  try {
    return await attempt("HEAD");
  } catch {
    try {
      return await attempt("GET");
    } catch {
      return false;
    }
  }
}

/**
 * Ürünün viral kanıt adreslerini PARALEL doğrular.
 * Dönen değer: en az bir adres gerçekten açıldıysa `true`.
 */
export async function verifyViralProof(
  proof: Array<{ url?: string }> | undefined,
): Promise<boolean> {
  const urls = (proof ?? [])
    .map((v) => (v?.url ?? "").trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, VIRAL_PROOF_MAX_URLS);
  if (!urls.length) return false;
  const results = await Promise.all(
    urls.map(async (url) => {
      const cached = cachedViralProof(url);
      if (cached !== undefined) return cached;
      const ok = await probeUrl(url);
      rememberViralProof(url, ok);
      return ok;
    }),
  );
  return results.some(Boolean);
}

/** Verify one product against live sources and score how realistic it is. */
export async function verifyProduct(
  p: VerifiableProduct,
  country: string,
): Promise<{ market_evidence: MarketEvidence; realism_score: number }> {
  const name = (p.name ?? "").trim();
  const sellingPrice = parseMoney(p.selling_price_usd);

  // Viral kanıt adresi GERÇEKTEN açılmalı; yalnızca "https://" biçiminde olmak
  // yeterli değildir (model var olmayan bir adres üretebilir). Yoklama diğer
  // kaynaklarla PARALEL koşar ki `withDeadline` penceresini tek başına yemesin.
  const claimedViral = (p.viral_proof ?? []).some((v) => /^https?:\/\//i.test(v?.url ?? ""));

  const [trends, sourcing, sellers, viralVerified] = await Promise.all([
    getGoogleTrends(name, country).catch(() => null),
    getSourcingEstimate(name, sellingPrice || 49).catch(() => null),
    scrapeMarketplaceSellers(name, country).catch(() => []),
    claimedViral ? verifyViralProof(p.viral_proof) : Promise.resolve(false),
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

  // Viral kanıt sonucu yukarıdaki paralel turdan gelir.
  if (viralVerified) verified.push("Viral içerik kanıtı (canlı URL doğrulandı)");
  else if (claimedViral) unverified.push("Viral kanıt adresi açılamadı (doğrulanmadı)");
  else unverified.push("Viral kanıt bulunamadı");
  const hasViral = viralVerified;

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
    viral_verified: viralVerified,
    verified_signals: verified,
    unverified_signals: unverified,
    checked_at: new Date().toISOString(),
  };

  return { market_evidence, realism_score: clamp(score) };
}
