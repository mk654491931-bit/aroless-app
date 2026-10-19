import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveInput = z.object({
  search_query: z.string().min(1).max(400),
  results: z.any(),
});

export const saveAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("analysis_history")
      .insert({ user_id: context.userId, search_query: data.search_query, results: data.results });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type AnalysisRow = {
  id: string;
  search_query: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any;
  created_at: string;
};

export const listAnalyses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalysisRow[]> => {
    const { data, error } = await context.supabase
      .from("analysis_history")
      .select("id, search_query, results, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as AnalysisRow[];
  });

const PrefsInput = z.object({
  language: z.string().min(2).max(5).optional(),
  currency: z.string().min(2).max(6).optional(),
  notifications_enabled: z.boolean().optional(),
});

export const updateProfilePrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PrefsInput.parse(input))
  .handler(async ({ data, context }) => {
    const update: { language?: string; currency?: string; notifications_enabled?: boolean } = {};
    if (data.language !== undefined) update.language = data.language;
    if (data.currency !== undefined) update.currency = data.currency;
    if (data.notifications_enabled !== undefined)
      update.notifications_enabled = data.notifications_enabled;
    if (Object.keys(update).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("profiles")
      .update(update)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getFullProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select(
        "email, public_id, credits, finder_credits, credits_spent, subscription_tier, language, currency, notifications_enabled, created_at",
      )
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
