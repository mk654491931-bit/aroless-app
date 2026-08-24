import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGemini, extractJson } from "@/lib/ai.server";
import { radarPrompt, sanitizeRadar, RADAR_COUNTRIES, type RadarSeed } from "@/lib/radar.server";

export type RadarItem = RadarSeed & { id: string; day: string; created_at: string };

const RadarInput = z.object({
  country: z.enum(RADAR_COUNTRIES).default("US"),
  refresh: z.boolean().optional().default(false),
});

/** Bugünün radar akışı — boşsa AI ile üretir (kredi harcamaz). */
export const getRadar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RadarInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);

    const read = async () =>
      (
        await context.supabase
          .from("radar_items")
          .select("*")
          .eq("day", today)
          .eq("country", data.country)
          .order("winner_score", { ascending: false })
          .limit(12)
      ).data as RadarItem[] | null;

    let rows = await read();
    if (rows && rows.length > 0) return { day: today, items: rows, generated: false };

    // Üret ve kaydet
    let seeds: RadarSeed[] = [];
    try {
      const text = await callGemini(radarPrompt(data.country), undefined, 0.85);
      const parsed = extractJson<{ items?: unknown }>(text, { items: [] });
      seeds = sanitizeRadar(parsed.items, data.country);
    } catch {
      seeds = [];
    }
    if (seeds.length === 0) return { day: today, items: [], generated: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("radar_items").insert(seeds.map((s) => ({ ...s, day: today })));

    rows = await read();
    return { day: today, items: rows ?? [], generated: true };
  });

/** Kullanıcının favorileriyle bugünkü radar kesişimi + bildirim üretimi. */
export const radarWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: favs }, { data: items }] = await Promise.all([
      context.supabase.from("favorites").select("name").limit(200),
      context.supabase
        .from("radar_items")
        .select("title, winner_score, momentum, country")
        .eq("day", today)
        .limit(120),
    ]);
    const words = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9şğüöçı ]/gi, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);

    const matches: { favorite: string; radar: string; momentum: number; winner_score: number }[] =
      [];
    for (const f of favs ?? []) {
      const fw = new Set(words(String(f.name ?? "")));
      for (const it of items ?? []) {
        const hit = words(String(it.title ?? "")).some((w) => fw.has(w));
        if (hit) {
          matches.push({
            favorite: String(f.name),
            radar: String(it.title),
            momentum: Number(it.momentum ?? 0),
            winner_score: Number(it.winner_score ?? 0),
          });
          break;
        }
      }
    }

    if (matches.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing } = await context.supabase
        .from("notifications")
        .select("id")
        .eq("type", "radar_match")
        .gte("created_at", `${today}T00:00:00Z`)
        .limit(1);
      if (!existing || existing.length === 0) {
        await supabaseAdmin.from("notifications").insert({
          user_id: context.userId,
          type: "radar_match",
          title: "Radar: favorilerinden biri yükseliyor",
          body: `${matches[0]!.radar} bugün radarda (+${matches[0]!.momentum}%).`,
          data: { matches },
        });
      }
    }
    return { matches };
  });
