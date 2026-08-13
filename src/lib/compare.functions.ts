import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini } from "@/lib/ai.server";
import type { WinningProduct } from "@/lib/gemini.functions";

const SummarizeInput = z.object({
  products: z.array(z.object({
    name: z.string(),
    trend_score: z.number().optional(),
    profit_margin_pct: z.number().optional(),
    competition_level: z.string().optional(),
    sellability_verdict: z.string().optional(),
    why_winning: z.string().optional(),
    platform_fit: z.array(z.string()).optional(),
  })).min(2).max(4),
});

export const summarizeComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SummarizeInput.parse(input))
  .handler(async ({ data }) => {
    const prompt = `Compare these winning product ideas and recommend the best one. Return ONLY a JSON object with keys: winner (product name), reasoning (2-3 sentences), runner_up, risks.\n\nProducts:\n${JSON.stringify(data.products, null, 2)}`;
    const text = await callGemini(prompt, undefined, 0.3, false);
    try {
      const json = JSON.parse(text.replace(/```json|```/g, "").trim());
      return {
        winner: String(json.winner || ""),
        reasoning: String(json.reasoning || ""),
        runner_up: String(json.runner_up || ""),
        risks: Array.isArray(json.risks) ? json.risks.map(String) : [],
      };
    } catch {
      return { winner: "", reasoning: text.slice(0, 400), runner_up: "", risks: [] };
    }
  });

const LoadInput = z.object({ ids: z.array(z.string().uuid()).min(2).max(4) });

export type ComparisonProduct = {
  id: string;
  name: string;
  collection_name: string;
  product: WinningProduct;
};

export const loadFavoritesForComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LoadInput.parse(input))
  .handler(async ({ data, context }): Promise<ComparisonProduct[]> => {
    const { data: rows, error } = await context.supabase
      .from("favorites")
      .select("id, name, collection_name, product")
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      collection_name: r.collection_name as string,
      product: r.product as WinningProduct,
    }));
  });
