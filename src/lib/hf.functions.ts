import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WinningProduct } from "@/lib/gemini.functions";
import { withCreditRefund } from "@/lib/credit-guard.server";

const HfInput = z.object({
  niche: z.string().min(2).max(120),
  category: z.string().max(60).optional().default("Any"),
  audience: z.string().max(120).optional().default(""),
  platforms: z.array(z.string().max(40)).max(20).optional().default([]),
  budget: z.string().max(40).optional().default("$500 - $2,000"),
  target_country: z.string().max(10).optional().default("GLOBAL"),
  marketplace: z.enum(["global", "turkey"]).optional().default("global"),
  lang: z.enum(["en", "tr", "es", "de", "fr", "ar"]).optional().default("en"),
  engine: z.enum(["qwen", "llama", "hybrid"]),
  token: z.string().max(200).optional(),
});

/** Runs a product search through the Hugging Face Qwen 2.5 / Llama 3.1 engines (or both in Hybrid mode). */
export const huggingFaceSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => HfInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildHfPrompt, callHuggingFace, mapHfProducts, mergeHfProducts, HF_MODELS } =
      await import("@/lib/hf.server");

    // Every search costs 1 credit, regardless of engine.
    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }

    const base = {
      niche: data.niche,
      category: data.category,
      audience: data.audience,
      platforms: data.platforms,
      budget: data.budget,
      target_country: data.target_country,
      marketplace: data.marketplace,
      lang: data.lang,
    };

    const runOne = async (engine: "qwen" | "llama") => {
      const text = await callHuggingFace(buildHfPrompt({ ...base, engine }), engine, {
        token: data.token,
      });
      return mapHfProducts(text, data.platforms, engine);
    };

    const { rankProfitable } = await import("@/lib/profitability");

    /**
     * CANLI VERİ KATMANI (HF motorları için).
     *
     * Hugging Face modelleri Google aramalı zeminli çağrı yapamaz; bu yüzden
     * eskiden bu yol "canlı veri" olmadan, yalnızca model hafızasıyla sonuç
     * döndürüyordu ve kartlar diğer motorlarla aynı görünüyordu (kanıtsız veri
     * doğrulanmış gibi okunuyordu). Artık aynı gerçek kaynaklar burada da
     * çalışır:
     *   Google Trends talep eğrisi + AliExpress tedarik fiyatı + canlı
     *   pazaryeri ilanları → gerçeklik puanı ve kanıt seviyesi.
     *
     * Süre güvenliği: yalnızca ilk 6 ürün, 2 eşzamanlılık, ürün başına 15 sn
     * sert sınır. Doğrulanamayan ürün elenmez; kanıt seviyesi dürüst kalır.
     */
    const enrichWithLiveData = async (list: WinningProduct[]) => {
      if (list.length === 0) return list;
      const [
        { normalizeProduct },
        { verifyProduct },
        { computeWinnerScore },
        { mapWithConcurrency, withDeadline },
      ] = await Promise.all([
        import("@/lib/consistency"),
        import("@/lib/market-verify.server"),
        import("@/lib/winner-score"),
        import("@/lib/ai.server"),
      ]);
      const country = (data.target_country || "GLOBAL").toUpperCase();
      const normalized = list.map((p) =>
        normalizeProduct(p, {
          country: data.target_country,
          category: data.category && data.category !== "Any" ? data.category : data.niche,
        }),
      );
      const LIVE_LIMIT = 6;
      const head = normalized.slice(0, LIVE_LIMIT);
      const tail = normalized.slice(LIVE_LIMIT);
      const verified = await mapWithConcurrency(head, 2, async (p) => {
        const outcome = await withDeadline(verifyProduct(p, country), 15_000, "hf-verify").catch(
          () => null,
        );
        if (!outcome) return p;
        const { market_evidence, realism_score } = outcome;
        return { ...p, market_evidence, realism_score };
      });
      return [...verified, ...tail]
        .map((p) => {
          const breakdown = computeWinnerScore(p);
          return {
            ...p,
            winner_score: breakdown.winner_score,
            score_breakdown: breakdown,
            evidence_level: breakdown.evidence_level,
          };
        })
        .sort((a, b) => (b.winner_score ?? 0) - (a.winner_score ?? 0));
    };

    // Motor hata verirse düşülen kredi iade edilir.
    return withCreditRefund(context.userId, async () => {
      if (data.engine === "hybrid") {
        const settled = await Promise.allSettled([runOne("llama"), runOne("qwen")]);
        const lists = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
        if (lists.length === 0)
          throw new Error((settled[0] as PromiseRejectedResult).reason?.message ?? "HF_ERROR");
        const merged = mergeHfProducts(lists) as unknown as WinningProduct[];
        const products = await enrichWithLiveData(rankProfitable(merged));
        return {
          products,
          model: `${HF_MODELS.llama} + ${HF_MODELS.qwen}`,
          engines: lists.length,
          live: true,
        };
      }

      const products = await enrichWithLiveData(
        rankProfitable((await runOne(data.engine)) as unknown as WinningProduct[]),
      );
      return { products, model: HF_MODELS[data.engine], engines: 1, live: true };
    });
  });

/** Connection probe for the settings panel. */
export const huggingFaceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { pingHuggingFace, hfToken } = await import("@/lib/hf.server");
    const configured = !!hfToken(data.token);
    if (!configured) return { configured: false, ok: false, message: "No token configured" };
    const res = await pingHuggingFace(data.token);
    return { configured: true, ...res };
  });
