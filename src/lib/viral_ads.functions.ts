import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ViralAdRow = {
  id: string;
  title: string;
  niche: string;
  country: string;
  platform: string;
  views: number;
  likes: number;
  video_url: string | null;
  hook_script: string | null;
  cta_text: string | null;
  created_at: string;
};

const ListInput = z.object({
  niche: z.string().max(60).optional(),
  platform: z.string().max(40).optional(),
  country: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const listViralAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }): Promise<ViralAdRow[]> => {
    let q = context.supabase
      .from("viral_ads")
      .select("id, title, niche, country, platform, views, likes, video_url, hook_script, cta_text, created_at")
      .order("views", { ascending: false })
      .limit(data.limit);

    if (data.niche) q = q.ilike("niche", `%${data.niche}%`);
    if (data.platform) q = q.ilike("platform", `%${data.platform}%`);
    if (data.country) q = q.ilike("country", `%${data.country}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ViralAdRow[];
  });
