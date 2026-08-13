import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WinningProduct } from "./gemini.functions";

export type ProductRow = {
  id: string;
  title: string;
  category: string | null;
  cost_price: number;
  selling_price: number;
  target_country: string;
  trend_score: number;
  competition_level: "Low" | "Medium" | "High" | null;
  profit_margin: number | null;
  viral_probability_90d: number;
  health_score: number;
  sellability_verdict: "Highly Sellable" | "Moderate Risk" | "Do Not Sell" | null;
  status_message: string | null;
  created_at: string;
  updated_at: string;
};

const InsertInput = z.object({
  products: z.array(z.any()),
  target_country: z.string().max(10).default("US"),
});

function parseMoney(s: string | undefined): number {
  if (!s) return 0;
  const m = String(s).match(/[\d,.]+/);
  if (!m) return 0;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export const insertProductsFromAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const items = (data.products as WinningProduct[]).map((p) => {
      const verdict = p.sellability_verdict;
      const safeVerdict =
        verdict === "Highly Sellable" || verdict === "Moderate Risk" || verdict === "Do Not Sell"
          ? verdict
          : "Moderate Risk";
      return {
        user_id: context.userId,
        title: p.name,
        category: null,
        cost_price: parseMoney(p.supplier_price_usd),
        selling_price: parseMoney(p.selling_price_usd),
        target_country: data.target_country,
        trend_score: clamp(p.trend_score ?? 50, 0, 100),
        competition_level: p.competition_level ?? "Medium",
        profit_margin: clamp(p.profit_margin_pct ?? 30, -100, 100),
        viral_probability_90d: clamp(p.viral_probability_90d ?? 50, 0, 100),
        health_score: clamp(p.health_score ?? 70, 0, 100),
        sellability_verdict: safeVerdict,
        status_message: p.ai_insight?.slice(0, 240) ?? null,
      };
    });

    const { error } = await context.supabase.from("products").insert(items);
    if (error) {
      // Don't fail the user-facing request; log and continue.
      console.error("products insert failed", error.message);
    }
    return { ok: true };
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ limit: z.number().int().min(1).max(100).default(20) }).parse(input))
  .handler(async ({ data, context }): Promise<ProductRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("products")
      .select("id, title, category, cost_price, selling_price, target_country, trend_score, competition_level, profit_margin, viral_probability_90d, health_score, sellability_verdict, status_message, created_at, updated_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProductRow[];
  });

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
