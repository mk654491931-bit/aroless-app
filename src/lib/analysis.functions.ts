import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { profileSummary, type ProfileSummary } from "@/lib/profile-summary";

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

/**
 * Profil okuması TEK sorgu.
 *
 * NEDEN: tek bir sütun (ör. sonradan eklenen `public_id` veya `finder_credits`)
 * uygulanmamış bir kurulumda eksikse PostgREST TÜM sorguyu hata ile döndürür.
 * Üst bardaki jeton rozeti `data` boş kaldığı için "bilinmiyor" yazıyordu —
 * yani tek bir eksik sütun, kullanıcının bakiyesini gizliyordu. Eski çözüm
 * sütun kümesini kademeli daraltıyordu: dört ardışık gidiş-dönüş ve her sütun
 * birleşimi için kırılgan `select` tipleri. Artık `*` ile tek okuma yapılır:
 * eksik sütun sorguyu düşürmez, ekstra turlar yoktur ve dönen özet ayrı tiplenir.
 */
export const getFullProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileSummary | null> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error || !data) {
      if (error)
        console.warn(`[profile] okunamadı: ${error.message?.slice(0, 120) || "bilinmeyen hata"}`);
      return null;
    }
    return profileSummary(data);
  });
