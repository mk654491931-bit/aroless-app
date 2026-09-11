import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WinningProduct } from "@/lib/gemini.functions";

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

/** Kullanıcıya gösterilecek, anlaşılır zaman aşımı mesajı. */
const HF_TIMEOUT_MESSAGE =
  "Hugging Face araması 90 saniyelik sunucu sınırına takıldı. Krediniz iade edildi — lütfen tekrar deneyin.";

/** Runs a product search through the Hugging Face Qwen 2.5 / Llama 3.1 engines (or both in Hybrid mode). */
export const huggingFaceSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => HfInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildHfPrompt, callHuggingFace, mapHfProducts, mergeHfProducts, HF_MODELS } =
      await import("@/lib/hf.server");

    // Every search costs 1 credit, regardless of engine.
    const { data: remainingAfterDeduct, error: deductErr } =
      await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }

    // Cloudflare 100s'yi aşan isteği 524 ile keser. HF modelleri yavaş
    // cevap verebildiği için aramayı bütçeye bağla; süre dolarsa krediyi iade
    // edip anlaşılır bir hata dön.
    const { createDeadline, JSON_BUDGET_MS } = await import("@/lib/deadline.server");
    const { settleWithDeadline } = await import("@/lib/concurrency.server");
    const deadline = createDeadline(JSON_BUDGET_MS);

    const refund = async () => {
      if (typeof remainingAfterDeduct !== "number") return;
      try {
        await context.supabase
          .from("profiles")
          .update({ credits: remainingAfterDeduct + 1 })
          .eq("id", context.userId);
      } catch {
        /* iade başarısız olsa da istek bozulmaz */
      }
    };

    // Aylık AI araç kullanım sayacı.
    const { recordUsage } = await import("@/lib/usage.server");
    await recordUsage(context.supabase, "ai_tools");

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

    if (data.engine === "hybrid") {
      const settled = await settleWithDeadline(
        [() => runOne("llama"), () => runOne("qwen")],
        deadline,
      );
      deadline.dispose();
      const lists = settled.results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
      if (lists.length === 0) {
        if (settled.timedOut) {
          await refund();
          throw new Error(HF_TIMEOUT_MESSAGE);
        }
        throw new Error(
          (settled.results[0] as PromiseRejectedResult).reason?.message ?? "HF_ERROR",
        );
      }
      const merged = mergeHfProducts(lists) as unknown as WinningProduct[];
      const products = rankProfitable(merged);
      return { products, model: `${HF_MODELS.llama} + ${HF_MODELS.qwen}`, engines: lists.length };
    }

    const single = await deadline.race(runOne(data.engine));
    deadline.dispose();
    if (single === null) {
      await refund();
      throw new Error(HF_TIMEOUT_MESSAGE);
    }
    const products = rankProfitable(single as unknown as WinningProduct[]);
    return { products, model: HF_MODELS[data.engine], engines: 1 };
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
