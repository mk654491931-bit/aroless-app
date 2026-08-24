import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini, extractJson } from "./ai.server";
import {
  baselinePrompt,
  crisisPrompt,
  reviewsPrompt,
  coachPrompt,
  num,
  str,
  clamp,
  type CoachAdvice,
} from "./sandbox.server";
import { type MarketBaseline, type Crisis } from "./sandbox-engine";

const StartInput = z.object({
  platform: z.string().min(1),
  capital: z.number().positive(),
  product: z.string().min(1),
  price: z.number().positive(),
  cogs: z.number().nonnegative(),
});

export const startSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ baseline: MarketBaseline; simCreditsRemaining: number }> => {
      const { data: remaining, error } = await context.supabase.rpc("deduct_sim_credit");
      if (error) throw new Error("NO_SIM_CREDITS");

      const key = process.env.GEMINI_API_KEY;
      // Statik/mock baseline yok: veriler yalnızca canlı AI pazar taramasından gelir.
      const text = await callGemini(baselinePrompt(data), key, 0.4);
      const parsed = extractJson<Partial<MarketBaseline>>(text, {});
      if (parsed.cvr_pct == null || parsed.cpc_usd == null) {
        throw new Error("Canlı pazar verisi alınamadı. Lütfen tekrar deneyin.");
      }
      const baseline: MarketBaseline = {
        cvr_pct: num(parsed.cvr_pct, 0, 0.1, 20),
        ctr_pct: num(parsed.ctr_pct, 0, 0.1, 20),
        cpc_usd: num(parsed.cpc_usd, 0, 0.05, 12),
        cac_usd: num(parsed.cac_usd, 0, 1, 400),
        avg_market_price_usd: num(parsed.avg_market_price_usd, data.price, 1, 5000),
        refund_rate_pct: num(parsed.refund_rate_pct, 0, 0, 45),
        shipping_days: Math.round(num(parsed.shipping_days, 7, 1, 45)),
        organic_daily_visitors: num(parsed.organic_daily_visitors, 0, 0, 5000),
        seasonality: str(parsed.seasonality, ""),
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 4).map(String) : [],
        benchmark_note: str(parsed.benchmark_note, ""),
      };
      return { baseline, simCreditsRemaining: Number(remaining ?? 0) };
    },
  );

const CrisisInput = z.object({
  platform: z.string(),
  product: z.string(),
  day: z.number(),
  capital: z.number(),
  rating: z.number(),
  price: z.number(),
  adBudget: z.number(),
  recent: z.string().max(600),
});

export const getSimCrisis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CrisisInput.parse(i))
  .handler(async ({ data }): Promise<{ crisis: Crisis | null }> => {
    try {
      const text = await callGemini(crisisPrompt(data), process.env.GEMINI_API_KEY, 1.0);
      const parsed = extractJson<Partial<Crisis>>(text, {});
      if (!parsed.title || !Array.isArray(parsed.choices) || parsed.choices.length < 2)
        return { crisis: null };
      const scale = Math.max(1, data.capital / 2000);
      return {
        crisis: {
          title: String(parsed.title),
          body: String(parsed.body ?? ""),
          severity: (["low", "medium", "high"] as const).includes(parsed.severity as "low")
            ? parsed.severity!
            : "medium",
          choices: parsed.choices.slice(0, 3).map((c) => ({
            label: String(c.label ?? "Act"),
            detail: String(c.detail ?? ""),
            capital: clamp(Number(c.capital) || 0, -600 * scale, 600 * scale),
            ratingDelta: clamp(Number(c.ratingDelta) || 0, -20, 10),
            cvrDelta: clamp(Number(c.cvrDelta) || 0, -40, 30),
          })),
        },
      };
    } catch {
      return { crisis: null };
    }
  });

const ReviewInput = z.object({
  platform: z.string(),
  product: z.string(),
  price: z.number(),
  marketPrice: z.number(),
  shippingDays: z.number(),
  rating: z.number(),
  orders: z.number(),
});

export const getSimReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReviewInput.parse(i))
  .handler(
    async ({ data }): Promise<{ reviews: { stars: number; author: string; text: string }[] }> => {
      try {
        const text = await callGemini(reviewsPrompt(data), process.env.GEMINI_API_KEY, 1.0);
        const parsed = extractJson<{
          reviews?: { stars?: number; author?: string; text?: string }[];
        }>(text, {});
        return {
          reviews: (parsed.reviews ?? [])
            .slice(0, 3)
            .map((r) => ({
              stars: clamp(Math.round(Number(r.stars) || 4), 1, 5),
              author: String(r.author ?? "Customer"),
              text: String(r.text ?? ""),
            }))
            .filter((r) => r.text),
        };
      } catch {
        return { reviews: [] };
      }
    },
  );

const CoachInput = z.object({
  platform: z.string(),
  product: z.string(),
  day: z.number(),
  summary: z.string().max(800),
  state: z.string().max(800),
});

export const getSimCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CoachInput.parse(i))
  .handler(async ({ data }): Promise<{ advice: CoachAdvice | null }> => {
    try {
      const text = await callGemini(coachPrompt(data), process.env.GEMINI_API_KEY, 0.7);
      const p = extractJson<Partial<CoachAdvice>>(text, {});
      if (!p.verdict && !p.why) return { advice: null };
      return {
        advice: {
          verdict: String(p.verdict ?? ""),
          why: String(p.why ?? ""),
          actions: Array.isArray(p.actions) ? p.actions.slice(0, 4).map(String) : [],
          watch_out: String(p.watch_out ?? ""),
        },
      };
    } catch {
      return { advice: null };
    }
  });

const SubmitInput = z.object({
  store_name: z.string().min(1).max(60),
  platform: z.string(),
  starting_capital: z.number(),
  final_capital: z.number(),
  net_profit: z.number(),
  roi_pct: z.number(),
  orders: z.number(),
  store_rating: z.number(),
  days: z.number(),
  badges: z.array(z.string()),
});

export const submitSimRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SubmitInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sim_runs")
      .insert({ ...data, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SimLeaderboardRow = {
  id: string;
  store_name: string;
  platform: string;
  roi_pct: number;
  net_profit: number;
  orders: number;
  store_rating: number;
  created_at: string;
  is_me: boolean;
};

export const getSimLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Uses a security-definer function that exposes only non-identifying leaderboard fields.
    const { data, error } = await (
      context.supabase.rpc as unknown as (
        fn: string,
      ) => Promise<{ data: SimLeaderboardRow[] | null; error: { message: string } | null }>
    )("get_sim_leaderboard");
    if (error) throw new Error(error.message);
    const rows: SimLeaderboardRow[] = data ?? [];
    return { rows, me: context.userId };
  });

export const getSimCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("sim_credits")
      .eq("id", context.userId)
      .maybeSingle();
    return { simCredits: data?.sim_credits ?? 0 };
  });
