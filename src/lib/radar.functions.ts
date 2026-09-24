import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { callAiMesh, extractJson } from "@/lib/ai.server";
import { chargeForAi, refundCredit } from "@/lib/credit-guard.server";
import {
  applyTrendEvidence,
  radarPrompt,
  sanitizeRadar,
  trendFallbackSeeds,
  RADAR_COUNTRIES,
  type RadarEvidence,
  type RadarSeed,
} from "@/lib/radar.server";

export type RadarItem = RadarSeed & {
  id: string;
  day: string;
  created_at: string;
  payload?: Partial<RadarEvidence>;
};

const RadarInput = z.object({
  country: z.enum(RADAR_COUNTRIES).default("US"),
  refresh: z.boolean().optional().default(false),
});

/** Google Trends zenginleştirmesi: en fazla bu kadar ürün + paralellik. */
const ENRICH_LIMIT = 8;
const ENRICH_CONCURRENCY = 4;
/** Tek ürün için trend sorgusu üst sınırı — toplam süre patlamasın. */
const ENRICH_PER_ITEM_MS = 12_000;
/** Bütün zenginleştirme turu için toplam üst sınır. */
const ENRICH_TOTAL_MS = 35_000;
/** AI üretimi için üst sınır: mesh + yedek yol her koşulda bu sürede biter. */
const GENERATE_TIMEOUT_MS = 45_000;

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("RADAR_TIMEOUT")), ms)),
  ]);
}

/**
 * Ürünleri üretir.
 *
 * 1) Çok motorlu AI (zeminli Gemini → tüm anahtar havuzu). Radar artık tek bir
 *    Gemini çağrısına bağlı değil: sağlayıcılardan hangisi müsaitse cevabı o verir.
 * 2) AI tamamen yanıt vermezse canlı Google Trends yedeği — radar yine BOŞ KALMAZ.
 */
async function generateSeeds(country: string): Promise<{
  seeds: RadarSeed[];
  keywords: Map<string, string>;
  generatedBy: RadarEvidence["generated_by"];
}> {
  const keywords = new Map<string, string>();
  try {
    const text = await timeout(
      callAiMesh(radarPrompt(country, 10), { temperature: 0.85, grounded: true }),
      GENERATE_TIMEOUT_MS,
    );
    const parsed = extractJson<{ items?: unknown[] }>(text, { items: [] });
    const raw = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of raw) {
      const it = item as Record<string, unknown>;
      const title = String(it?.["title"] ?? "")
        .trim()
        .toLowerCase();
      const kw = String(it?.["keyword"] ?? "").trim();
      if (title && kw) keywords.set(title, kw.slice(0, 80));
    }
    const seeds = sanitizeRadar(raw, country);
    if (seeds.length) return { seeds, keywords, generatedBy: "ai" };
  } catch {
    /* yedek yola düş */
  }
  const fallback = trendFallbackSeeds(country, 10);
  for (const s of fallback) keywords.set(s.title.toLowerCase(), s.title);
  return { seeds: fallback, keywords, generatedBy: "trends" };
}

/**
 * Her ürün için GERÇEK Google Trends serisini çeker; momentum ve skor artık
 * ölçülmüş arama verisinden hesaplanır. Kaynak erişilemezse `estimated`
 * döner ve mevcut değer korunur — akış yine dolu kalır.
 */
async function enrichWithTrends(
  seeds: RadarSeed[],
  keywords: Map<string, string>,
  country: string,
  generatedBy: RadarEvidence["generated_by"],
): Promise<{ seed: RadarSeed; evidence: RadarEvidence }[]> {
  const { getGoogleTrends } = await import("@/lib/market-data.server");
  const { mapWithConcurrency } = await import("@/lib/ai.server");
  const target = seeds.slice(0, ENRICH_LIMIT);
  const started = Date.now();

  const enriched = await mapWithConcurrency(target, ENRICH_CONCURRENCY, async (seed) => {
    const keyword = keywords.get(seed.title.toLowerCase()) ?? seed.title;
    const evidence: RadarEvidence = {
      keyword,
      trend_source: "estimated",
      trend_momentum_pct: seed.momentum,
      series: [],
      generated_by: generatedBy,
    };
    // Toplam zenginleştirme süresi sınırlı: süre dolduysa kalan ürünler ham
    // değerle döner, sayfa asla trend sorguları yüzünden bekletilmez.
    if (Date.now() - started > ENRICH_TOTAL_MS) return { seed, evidence };
    try {
      const t = await timeout(getGoogleTrends(keyword, country), ENRICH_PER_ITEM_MS);
      evidence.trend_source = t.source;
      evidence.trend_momentum_pct = t.momentum_pct;
      evidence.series = t.yearly.slice(-26);
    } catch {
      /* tahmini değerle devam */
    }
    return { seed: applyTrendEvidence(seed, evidence), evidence };
  });

  // Zenginleştirme sınırının üstünde kalan ürünler ham hâliyle döner.
  const rest = seeds.slice(ENRICH_LIMIT).map((seed) => ({
    seed,
    evidence: {
      keyword: keywords.get(seed.title.toLowerCase()) ?? seed.title,
      trend_source: "estimated" as const,
      trend_momentum_pct: seed.momentum,
      series: [] as number[],
      generated_by: generatedBy,
    },
  }));
  return [...enriched, ...rest];
}

/**
 * Bugünün radar akışı — boşsa üretir.
 *
 * JETON KURALI: Yalnızca AÇIK "tazele" isteği (`refresh: true`, kullanıcı
 * düğmeye bastı) ücretlidir; sayfa açılışındaki otomatik okuma ve önbellek
 * isabeti ücretsizdir. AI hiç üretim yapmazsa (Google Trends yedeğine düşerse)
 * jeton İADE edilir — kullanıcı boş bir tur için ödeme yapmaz.
 */
export const getRadar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RadarInput.parse(input ?? {}))
  .handler(async ({ data, context: ctx }) => {
    const today = new Date().toISOString().slice(0, 10);

    const read = async () =>
      (
        await ctx.supabase
          .from("radar_items")
          .select("*")
          .eq("day", today)
          .eq("country", data.country)
          .order("winner_score", { ascending: false })
          .limit(12)
      ).data as RadarItem[] | null;

    const existing = await read();
    if (!data.refresh && existing && existing.length > 0) {
      return { day: today, items: existing, generated: false, source: "cache" as const };
    }

    // Fail-closed: üretim başlamadan tahsil et; sonuç boş/yedek ise iade et.
    const charged = data.refresh ? 1 : 0;
    if (charged) await chargeForAi(() => ctx.supabase.rpc("deduct_product_finder_credit"));

    const { seeds, keywords, generatedBy } = await generateSeeds(data.country);
    if (seeds.length === 0) {
      if (charged) await refundCredit(ctx.userId, charged, "radar_refresh_empty");
      return { day: today, items: [], generated: false, source: "unavailable" as const };
    }
    // AI yanıt vermedi (Google Trends yedeği koştu): bu tur için jeton alınmaz.
    if (charged && generatedBy !== "ai") {
      await refundCredit(ctx.userId, charged, "radar_refresh_no_ai");
    }

    const enriched = await enrichWithTrends(seeds, keywords, data.country, generatedBy);
    const liveCount = enriched.filter((e) => e.evidence.trend_source === "google-trends").length;

    const now = new Date().toISOString();
    const rows = enriched.map(({ seed, evidence }) => ({
      ...seed,
      day: today,
      payload: evidence as unknown as Json,
    }));

    // Kalıcılık "best effort": tablo yazamasa bile kullanıcı bugünün radarını görür.
    // (Eskiden yazma hatası sessizce yutuluyor ve ekran KALICI olarak boş kalıyordu.)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("radar_items").insert(rows);
      if (error) {
        // Tek bir çakışma (aynı gün + aynı başlık) toplu insert'i düşürmesin:
        // satır satır dene, kaydedilebilenleri kaydet.
        for (const row of rows) {
          await supabaseAdmin.from("radar_items").insert(row);
        }
      }
    } catch {
      /* yazamadıysa aşağıda bellek içi liste döner */
    }

    const stored = await read();
    const items: RadarItem[] =
      stored && stored.length > 0
        ? stored
        : enriched.map(({ seed, evidence }, i) => ({
            ...seed,
            id: `live-${today}-${i}`,
            day: today,
            created_at: now,
            payload: evidence,
          }));

    return {
      day: today,
      items,
      generated: true,
      source: generatedBy,
      live_evidence: liveCount,
    };
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
