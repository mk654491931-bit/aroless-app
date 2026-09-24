import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini, callGroq, extractJson } from "./ai.server";
import { chargeForAi, withCreditRefund } from "@/lib/credit-guard.server";
import {
  sellersPrompt,
  sentimentPrompt,
  strategyPrompt,
  countryStrategyPrompt,
  copilotPrompt,
  type CompetitorReport,
  type CompetitorSeller,
  type CompetitorWeakness,
  type CounterStrategy,
} from "./competitor.server";
import { scrapeMarketplaceSellers, getGoogleTrends, getDomainRanks } from "./market-data.server";

export type { CompetitorReport, CompetitorSeller, CompetitorWeakness, CounterStrategy };

const AnalyzeInput = z.object({
  query: z.string().min(2).max(300),
  country: z.string().min(2).max(8).default("GLOBAL"),
});

/**
 * Rakip denetimi gövdesi. Kredi kapısından AYRI tutulur: iş çökerse
 * `withCreditRefund` düşülen jetonu iade edebilsin diye sarmalanabilir olmalı.
 */
async function buildCompetitorReport(data: {
  query: string;
  country: string;
}): Promise<{ report: CompetitorReport }> {
  const country = (data.country || "GLOBAL").toUpperCase();

  // Free external signals first — they ground the AI prompts (fewer tokens, real data).
  const [scraped, trends] = await Promise.all([
    scrapeMarketplaceSellers(data.query, country),
    getGoogleTrends(data.query, country),
  ]);
  const ranks = await getDomainRanks(scraped.map((s) => s.domain));

  const liveContext = [
    scraped.length
      ? `Top marketplace results: ${scraped.map((s) => `${s.seller} (${s.domain}${s.price_usd ? `, $${s.price_usd}` : ""})`).join("; ")}`
      : "",
    `Google Trends (${trends.source}) 30d interest: [${trends.monthly.slice(-14).join(",")}], 30d momentum ${trends.momentum_pct}%`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 900);

  type SellersRaw = { avg_price_usd?: number; sellers?: Partial<CompetitorSeller>[] };
  type SentimentRaw = { sentiment_summary?: string; weaknesses?: Partial<CompetitorWeakness>[] };
  const [sellersRaw, sentimentRaw] = await Promise.all([
    // apiKey bilinçli olarak verilmez: 5'li Gemini havuzu round-robin kullanılır.
    callGemini(sellersPrompt(data.query, country, liveContext), undefined, 0.4)
      .then((t) => extractJson<SellersRaw>(t, {}))
      .catch((): SellersRaw => ({})),
    callGroq(sentimentPrompt(data.query, country, liveContext), 0.3)
      .then((t) => extractJson<SentimentRaw>(t, {}))
      .catch((): SentimentRaw => ({})),
  ]);

  const aiSellers = (sellersRaw.sellers ?? []).slice(0, 5).map((s) => ({
    seller: String(s.seller ?? "Bilinmeyen satıcı"),
    platform: String(s.platform ?? "-"),
    price_usd: Number(s.price_usd) || 0,
    price_trend: String(s.price_trend ?? ""),
    est_monthly_sales: Math.max(0, Math.round(Number(s.est_monthly_sales) || 0)),
    est_stock: Math.max(0, Math.round(Number(s.est_stock) || 0)),
    rating: Math.max(0, Math.min(5, Number(s.rating) || 0)),
    traffic_sources: Array.isArray(s.traffic_sources)
      ? s.traffic_sources.slice(0, 4).map(String)
      : [],
    margin_note: String(s.margin_note ?? ""),
    domain: String(s.domain ?? ""),
    domain_rank: null as number | null,
    url: "",
  }));

  // Merge scraped listings (real domains) with the AI-enriched rows.
  const sellers: CompetitorSeller[] = scraped.map((sc, i) => {
    const ai =
      aiSellers.find((a) => a.seller.toLowerCase().includes(sc.seller.toLowerCase())) ??
      aiSellers[i];
    return {
      seller: sc.seller,
      platform: sc.platform,
      price_usd: sc.price_usd || ai?.price_usd || 0,
      price_trend: ai?.price_trend ?? "",
      est_monthly_sales: ai?.est_monthly_sales ?? 0,
      est_stock: ai?.est_stock ?? 0,
      rating: ai?.rating ?? 0,
      traffic_sources: ai?.traffic_sources ?? [],
      margin_note: ai?.margin_note ?? "",
      domain: sc.domain,
      domain_rank: ranks[sc.domain] ?? null,
      url: sc.url,
    };
  });
  if (sellers.length < 5) {
    for (const a of aiSellers) {
      if (sellers.length >= 5) break;
      if (!sellers.some((s) => s.seller.toLowerCase() === a.seller.toLowerCase()))
        sellers.push(a);
    }
  }

  const weaknesses = (sentimentRaw.weaknesses ?? [])
    .slice(0, 5)
    .map((w) => ({
      complaint: String(w.complaint ?? ""),
      frequency: String(w.frequency ?? ""),
      opportunity: String(w.opportunity ?? ""),
    }))
    .filter((w) => w.complaint);

  const context = [
    sellers
      .map(
        (s) =>
          `${s.seller} (${s.platform}) $${s.price_usd} · ~${s.est_monthly_sales} satış/ay · ${s.traffic_sources.join(", ")}`,
      )
      .join("\n"),
    weaknesses.map((w) => `Şikayet: ${w.complaint} (${w.frequency})`).join("\n"),
    `Trend momentumu: %${trends.momentum_pct}`,
  ]
    .join("\n")
    .slice(0, 2500);

  const strategy = await callGemini(strategyPrompt(data.query, country, context), undefined, 0.6)
    .then((t) => {
      const p = extractJson<Partial<CounterStrategy>>(t, {});
      if (!p.headline && !p.positioning) return null;
      return {
        headline: String(p.headline ?? ""),
        positioning: String(p.positioning ?? ""),
        price_advice: String(p.price_advice ?? ""),
        playbook: Array.isArray(p.playbook) ? p.playbook.slice(0, 5).map(String) : [],
        ad_angle: String(p.ad_angle ?? ""),
      } as CounterStrategy;
    })
    .catch(() => null);

  const priced = sellers.filter((s) => s.price_usd > 0);
  return {
    report: {
      query: data.query,
      country,
      sellers,
      avg_price_usd:
        Number(sellersRaw.avg_price_usd) ||
        (priced.length ? priced.reduce((a, s) => a + s.price_usd, 0) / priced.length : 0),
      weaknesses,
      sentiment_summary: String(sentimentRaw.sentiment_summary ?? ""),
      strategy,
      trend_momentum_pct: trends.momentum_pct,
      trend_monthly: trends.monthly,
      trend_source: trends.source,
    },
  };
}

export const analyzeCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AnalyzeInput.parse(i))
  .handler(async ({ data, context: ctx }): Promise<{ report: CompetitorReport }> => {
    // Rakip denetimi çok motorlu gerçek bir AI turudur: jeton düşmeden koşmaz,
    // iş çökerse iade edilir (yoksa anahtar havuzu karşılıksız yanar).
    await chargeForAi(() => ctx.supabase.rpc("deduct_product_finder_credit"));
    return withCreditRefund(ctx.userId, () => buildCompetitorReport(data));
  });

const CountryStrategyInput = z.object({
  niche: z.string().max(200).default(""),
  country: z.string().min(2).max(8).default("GLOBAL"),
});

/** Ülke/niş stratejisi gövdesi — kredi iadesiyle sarmalanabilsin diye ayrı. */
async function buildCountryStrategy(niche: string, country: string): Promise<string> {
  const { hasAnyAiProvider } = await import("./ai.server");
  if (!hasAnyAiProvider()) {
    throw new Error(
      "AI servisi yapılandırılmadı (anahtar yok). Yönetici panelinden AI anahtarlarını ekleyin.",
    );
  }
  const withBudget = <T>(p: Promise<T>, ms = 18_000): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("STRATEGY_TIMEOUT")), ms)),
    ]);
  try {
    const text = await withBudget(callGemini(countryStrategyPrompt(niche, country), undefined, 0.6, false));
    const p = extractJson<{ strategy?: string }>(text, {});
    const s = String(p.strategy ?? "").trim();
    if (!s) throw new Error("AI boş strateji döndürdü — tekrar deneyin.");
    return s;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (msg === "STRATEGY_TIMEOUT")
      throw new Error("Strateji zaman aşımına uğradı (18sn) — tekrar deneyin.");
    if (/AI anahtarı|not configured|AI servisi/i.test(msg)) throw e;
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg))
      throw new Error("AI kotası dolu — 20-30 sn sonra tekrar deneyin.");
    throw new Error(msg || "Strateji üretilemedi — tekrar deneyin.");
  }
}

export const getCountryStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CountryStrategyInput.parse(i))
  .handler(async ({ data, context: ctx }): Promise<{ strategy: string }> => {
    // Pazar karnesi AI stratejisi tek jetonluk bir iştir; iade garantisiyle koşar.
    await chargeForAi(() => ctx.supabase.rpc("deduct_product_finder_credit"));
    return withCreditRefund(ctx.userId, async () => ({
      strategy: await buildCountryStrategy(data.niche, data.country),
    }));
  });

const CopilotInput = z.object({
  message: z.string().min(1).max(1000),
  context: z.string().max(600).default(""),
  history: z.string().max(2000).default(""),
});

/**
 * AI Co-Pilot — hafif sohbet yardımcısı.
 *
 * Bilinçli olarak jeton harcamaz: her sohbet mesajından kredi düşmek, panelde
 * gömülü duran bir yardımcıyı kullanılamaz hâle getirirdi. Ağır analizler
 * (rakip denetimi, karşılaştırma, kreatif üretimi) jeton kapısının arkasındadır.
 */
export const askCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CopilotInput.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    try {
      const text = await callGemini(
        copilotPrompt(data.message, data.context, data.history),
        undefined,
        0.8,
        false,
      );
      const p = extractJson<{ reply?: string }>(text, {});
      return {
        reply: String(p.reply ?? "").trim() || "Şu an yanıt üretemedim, tekrar dener misin?",
      };
    } catch {
      return { reply: "AI Co-Pilot şu an yanıt veremiyor. Birazdan tekrar dene." };
    }
  });
