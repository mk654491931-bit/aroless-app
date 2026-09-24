import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAiMesh, extractJson } from "@/lib/ai.server";
import { computeViralMetrics, type ViralMetrics } from "@/lib/viral-metrics";
import { chargeForAi, withCreditRefund } from "@/lib/credit-guard.server";

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
      .select(
        "id, title, niche, country, platform, views, likes, video_url, hook_script, cta_text, created_at",
      )
      .order("views", { ascending: false })
      .limit(data.limit);

    if (data.niche) q = q.ilike("niche", `%${data.niche}%`);
    if (data.platform) q = q.ilike("platform", `%${data.platform}%`);
    if (data.country) q = q.ilike("country", `%${data.country}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ViralAdRow[];
  });

/* ------------------------------------------------------------------ */
/* Viral ad üretimi — gerçek ölçülmüş metriklerden                    */
/* ------------------------------------------------------------------ */

export type ViralAdScriptBeat = {
  second: string;
  visual: string;
  voiceover: string;
  text_overlay: string;
};

export type GeneratedViralAd = {
  /** Sunucuda yeniden hesaplanan (istemciye güvenilmez) gerçek metrikler. */
  metrics: ViralMetrics;
  /** Ölçülen sayıların özeti — model bunlara dayanmak zorunda. */
  source_numbers: string;
  hook_variants: string[];
  script: ViralAdScriptBeat[];
  cta: string;
  targeting: string;
  why: string;
  /** Tahmini bantlar (gerçek metriklerden türetilir, tek sayı uydurulmaz). */
  predicted: { hook_rate: string; ctr: string; cpm: string };
  provider: string;
};

const BuildAdInput = z.object({
  title: z.string().min(2).max(200),
  niche: z.string().max(60).default("Trending"),
  platform: z.string().max(40).default("TikTok"),
  country: z.string().max(40).default("US"),
  views: z.number().min(0).max(1_000_000_000),
  likes: z.number().min(0).max(100_000_000),
  duration_sec: z.number().min(0).max(7200).default(0),
  created_at: z.string().max(40),
  channel: z.string().max(160).optional().default(""),
  description: z.string().max(1200).optional().default(""),
  /** Kullanıcının kendi ürünü (boşsa video ile aynı ürün varsayılır). */
  product: z.string().max(160).optional().default(""),
  uiLang: z.string().max(8).optional().default("tr"),
});

type BuildAdInputType = z.infer<typeof BuildAdInput>;

const LANG_NAMES: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
};

/**
 * Seçilen gerçek videodan yola çıkıp satıcının çekebileceği viral reklamı üretir.
 *
 * Model YALNIZCA ölçülmüş sayıları görür (izlenme, beğeni, etkileşim, saatlik
 * izlenme, yaş, süre) ve her yorumda bu sayılardan en az birini alıntılamak
 * zorundadır; metrik uydurma yasaktır. Çıktı kalitesi için tam sağlayıcı havuzu
 * (callAiMesh) kullanılır — tek sağlayıcı kotası bu özelliği kilitleyemez.
 *
 * Gövde, kredi kapısından ayrı tutulur: iş çökerse düşülen jeton `buildViralAd`
 * içindeki `withCreditRefund` ile iade edilir.
 */
async function buildViralAdBlueprint(data: BuildAdInputType): Promise<GeneratedViralAd> {
  const metrics = computeViralMetrics({
    views: data.views,
    likes: data.likes,
    duration_sec: data.duration_sec,
    created_at: data.created_at,
    title: data.title,
  });
  const sourceNumbers = `${data.views.toLocaleString("en-US")} views · ${data.likes.toLocaleString("en-US")} likes · ${metrics.engagement_pct}% engagement · ${metrics.views_per_hour.toLocaleString("en-US")} views/hour · ${metrics.age_hours}h old · ${data.duration_sec}s`;

  const lang = LANG_NAMES[(data.uiLang ?? "en").slice(0, 2)] ?? "English";
  const focus = data.product.trim()
    ? `The seller's own product is: "${data.product.trim()}". Adapt the winning mechanics to THIS product, keep the same format.`
    : `No product given: keep the same product category as the reference video.`;

  const prompt = `You are a direct-response creative director. You are given a REAL ad video with MEASURED performance data:

REFERENCE VIDEO
- title: ${data.title}
- channel: ${data.channel || "(unknown)"} | niche: ${data.niche} | platform: ${data.platform} | target market: ${data.country}
- MEASURED: ${sourceNumbers}
- computed virality: ${metrics.virality_score}/100 (${metrics.verdict}), detected format: ${metrics.format}, duration fit: ${metrics.duration_fit}/100
- real description excerpt: ${(data.description ?? "").slice(0, 500) || "(none)"}

TASK
Write the ready-to-shoot blueprint of a NEW short-form ad that copies the mechanics that made this one work.
${focus}

RULES
- Ground every claim in the MEASURED numbers above: at least the "why" and the CPM/CTR reasoning must quote a real measured figure (engagement %, views/hour, virality score).
- NEVER invent alternative metrics for the reference video (no made-up view counts, no percent changes).
- Hook variants must be first spoken lines, max 12 words, each a different psychological angle (curiosity, pain, social proof).
- The script must be a 15-30 second shot list with real timings and on-screen text per beat.
- Predicted bands must be ranges derived from the ${metrics.engagement_pct}% engagement and ${metrics.views_per_hour} views/hour, not single fake-precise numbers.
- All human-readable text in ${lang}.

Return ONLY JSON:
{"hook_variants": string[3],
 "script": [{"second": string (e.g. "0-3s"), "visual": string, "voiceover": string, "text_overlay": string}] (4-7 beats),
 "cta": string (max 60 chars),
 "targeting": string (audience + interests + placement, 1-2 sentences),
 "why": string (3-4 sentences, cites the measured numbers),
 "predicted": {"hook_rate": string, "ctr": string, "cpm": string}}`;

  const text = await callAiMesh(prompt, { temperature: 0.7, grounded: false });
  const parsed = extractJson<Record<string, unknown>>(text, {});

  const strList = (v: unknown, n: number): string[] =>
    Array.isArray(v)
      ? v
          .slice(0, n)
          .map((x) => String(x).trim())
          .filter(Boolean)
      : [];
  const script: ViralAdScriptBeat[] = Array.isArray(parsed["script"])
    ? (parsed["script"] as unknown[]).slice(0, 7).flatMap((raw) => {
        const b = raw as Record<string, unknown>;
        const second = String(b?.["second"] ?? "").trim();
        if (!second) return [];
        return [
          {
            second: second.slice(0, 20),
            visual: String(b?.["visual"] ?? "").slice(0, 300),
            voiceover: String(b?.["voiceover"] ?? "").slice(0, 300),
            text_overlay: String(b?.["text_overlay"] ?? "").slice(0, 200),
          },
        ];
      })
    : [];

  const predictedRaw = (parsed["predicted"] ?? {}) as Record<string, unknown>;
  const hooks = strList(parsed["hook_variants"], 3);

  // AI bir alanı boş bırakırsa uydurma metin üretmeyiz: ölçülen gerçek
  // metriklerden türetilmiş dürüst bir varsayılana düşeriz.
  return {
    metrics,
    source_numbers: sourceNumbers,
    hook_variants: hooks.length
      ? hooks
      : [
          `Bu ${data.platform} reklamı ${metrics.views_per_hour.toLocaleString("en-US")} izlenme/saat hızıyla gidiyor — aynı kancayı kullan.`,
        ],
    script,
    cta: String(parsed["cta"] ?? "").slice(0, 80),
    targeting: String(parsed["targeting"] ?? "").slice(0, 300),
    why: String(parsed["why"] ?? "").slice(0, 900),
    predicted: {
      hook_rate: String(predictedRaw["hook_rate"] ?? "").slice(0, 40),
      ctr: String(predictedRaw["ctr"] ?? "").slice(0, 40),
      cpm: String(predictedRaw["cpm"] ?? "").slice(0, 40),
    },
    provider: "çok motorlu havuz (mesh)",
  };
}

export const buildViralAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BuildAdInput.parse(input))
  .handler(async ({ data, context: ctx }): Promise<GeneratedViralAd> => {
    // Viral reklam üretimi tam sağlayıcı havuzunda gerçek bir AI turudur:
    // jeton düşmeden koşmaz, üretim çökerse jeton iade edilir.
    await chargeForAi(() => ctx.supabase.rpc("deduct_product_finder_credit"));
    return withCreditRefund(ctx.userId, () => buildViralAdBlueprint(data));
  });
