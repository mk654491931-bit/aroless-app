import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";
import { serveStaleWhileRevalidate } from "@/lib/swr-cache.server";
import { computeViralMetrics, type ViralMetrics } from "@/lib/viral-metrics";

/**
 * Public viral ads feed backed by YouTube (via the Piped public API).
 * No auth required. Fetches real video content across advertising / product
 * niches and maps it into the viral ad row shape the UI renders.
 *
 * Sıralama artık "toplam izlenme" değil: her video için GERÇEK metriklerden
 * (izlenme, beğeni, yayın yaşı, süre) viralite skoru hesaplanır. Ardından en iyi
 * videoların GERÇEK sayıları tek bir AI turunda verilir ve hook / CTA / açı
 * metinleri bu sayılara dayandırılarak yazılır — sayı uydurulmaz, kaynak
 * metrikler kartın üzerinde görünür.
 */

type FeedItem = {
  id: string;
  title: string;
  niche: string;
  country: string;
  platform: string;
  views: number;
  likes: number;
  video_url: string | null;
  thumbnail: string | null;
  hook_script: string | null;
  cta_text: string | null;
  created_at: string;
  channel: string;
  duration_sec: number;
  /** Gerçek metriklerden hesaplanan viralite verisi. */
  metrics: ViralMetrics;
  /** AI'nın bu reklamı neden işe yaradığına dair gerçek sayılara dayalı notu. */
  why_viral: string | null;
  /** Hook/CTA metni AI'dan mı geldi, yoksa gerçek açıklamadan mı? */
  copy_source: "ai" | "real";
  /** Gerçek video açıklaması (AI prompt'una da girer). */
  source_description: string;
};

const PIPED_HOSTS = [
  "https://api.piped.private.coffee",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
];

/** Birincil tarama: niş bazlı aramalar (gerçek mağaza/reklam nişleri). */
const QUERIES: Array<{ q: string; niche: string; country: string; platform: string }> = [
  { q: "viral tiktok product ad", niche: "Trending", country: "US", platform: "TikTok" },
  { q: "best beauty tiktok ads 2025", niche: "Beauty", country: "US", platform: "TikTok" },
  { q: "fitness gear ad tiktok", niche: "Fitness", country: "US", platform: "Instagram" },
  { q: "smart home gadget commercial", niche: "Home", country: "US", platform: "Facebook" },
  { q: "tech gadget unboxing viral", niche: "Tech", country: "US", platform: "YouTube" },
  { q: "pet product tiktok ad", niche: "Pets", country: "US", platform: "TikTok" },
  { q: "fashion brand instagram reel ad", niche: "Fashion", country: "UK", platform: "Instagram" },
  { q: "kitchen gadget viral ad", niche: "Kitchen", country: "US", platform: "Facebook" },
  { q: "outdoor gear commercial short", niche: "Outdoor", country: "US", platform: "YouTube" },
];

/** Birincil tarama zayıf kalırsa (host değişimi/az sonuç) kullanılan geniş tur. */
const BROADER_QUERIES: Array<{ q: string; niche: string; country: string; platform: string }> = [
  { q: "product ad short", niche: "Trending", country: "US", platform: "YouTube" },
  { q: "dropshipping winning product ad", niche: "Trending", country: "US", platform: "TikTok" },
  { q: "shopify product video ad", niche: "Home", country: "US", platform: "Facebook" },
];

const MIN_VIEWS = 2000;
const MAX_ITEMS = 48;
const AI_COPY_LIMIT = 6;

async function pipedFetch(path: string): Promise<Record<string, unknown> | null> {
  for (const host of PIPED_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "Aroless/1.0" },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) return await res.json();
    } catch {
      /* try next host */
    }
  }
  return null;
}

async function fetchQuery(
  q: string,
  niche: string,
  country: string,
  platform: string,
  perQuery = 8,
): Promise<FeedItem[]> {
  const data = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=videos`);
  const items = (data?.items ?? []) as Record<string, unknown>[];
  const out: FeedItem[] = [];
  for (const it of items) {
    if (it.type !== "stream") continue;
    if (!it.url || typeof it.url !== "string") continue;
    const videoId = it.url.startsWith("/watch?v=") ? it.url.slice(9) : null;
    if (!videoId) continue;
    const views = Number(it.views ?? 0);
    if (views < MIN_VIEWS) continue;
    const title = String(it.title ?? "").slice(0, 140);
    const created_at = it.uploaded
      ? new Date(Number(it.uploaded)).toISOString()
      : new Date().toISOString();
    const duration_sec = Number(it.duration ?? 0);
    const item: FeedItem = {
      id: `yt_${videoId}`,
      title,
      niche,
      country,
      platform,
      views,
      likes: 0, // gerçek video istatistiklerinden doldurulur
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      hook_script: null,
      cta_text: null,
      created_at,
      channel: String(it.uploaderName ?? ""),
      duration_sec,
      metrics: computeViralMetrics({ views, likes: 0, duration_sec, created_at, title }),
      why_viral: null,
      copy_source: "real",
      source_description: "",
    };
    out.push(item);
    if (out.length >= perQuery) break;
  }
  return out;
}

/** Pulls the real like count + real description hook for a video. */
async function enrich(item: FeedItem): Promise<void> {
  const id = item.id.replace(/^yt_/, "");
  const data = await pipedFetch(`/streams/${id}`);
  if (!data) return;
  const likes = Number(data.likes ?? -1);
  if (Number.isFinite(likes) && likes > 0) item.likes = likes;
  const views = Number(data.views ?? 0);
  if (views > 0) item.views = views;
  const desc = String(data.description ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (desc) {
    item.source_description = desc.slice(0, 600);
    item.hook_script = desc.slice(0, 220);
  }
  // Gerçek beğeni/izlenme geldikten SONRA skoru yeniden hesapla.
  item.metrics = computeViralMetrics({
    views: item.views,
    likes: item.likes,
    duration_sec: item.duration_sec,
    created_at: item.created_at,
    title: item.title,
  });
}

async function enrichAll(items: FeedItem[], concurrency = 6): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await enrich(item);
      } catch {
        /* keep unenriched */
      }
    }
  });
  await Promise.all(workers);
}

/**
 * En iyi videolar için hook / CTA / açı yazar — girdi olarak YALNIZCA gerçek
 * ölçülmüş sayılar verilir, model bunlara dayanmak zorundadır. AI yanıt
 * vermezse feed bozulmaz: gerçek açıklama hook olarak kalır.
 */
async function addAiCopy(items: FeedItem[]): Promise<boolean> {
  const target = items.slice(0, AI_COPY_LIMIT);
  if (!target.length) return false;
  try {
    const { callAiMesh, extractJson } = await import("@/lib/ai.server");
    const table = target
      .map((it, i) =>
        [
          `#${i + 1} id=${it.id}`,
          `  title: ${it.title}`,
          `  channel: ${it.channel} | platform: ${it.platform} | niche: ${it.niche}`,
          `  MEASURED: ${it.views} views, ${it.likes} likes, ${it.metrics.engagement_pct}% engagement, ${it.metrics.views_per_hour} views/hour, published ${it.metrics.age_hours}h ago, ${it.duration_sec}s long`,
          `  computed virality: ${it.metrics.virality_score}/100 (${it.metrics.verdict}), detected format: ${it.metrics.format}`,
          `  real description: ${(it.source_description || "(none)").slice(0, 300)}`,
        ].join("\n"),
      )
      .join("\n\n");

    const prompt = `You are a direct-response creative strategist. Below are REAL, measured YouTube ad videos with their actual performance metrics.

${table}

For EACH id write a ready-to-shoot ad blueprint for a seller who wants to copy what works. Rules:
- Use ONLY the measured numbers above; quote at least one real number per item (never invent metrics, never guess views/likes).
- The hook must be the first spoken line (max 12 words) and must match the detected format.
- The CTA must be short and concrete.
- "why" explains the mechanism in one sentence AND cites the measured number that proves it.
- Language: English for hook/cta/angle/why.

Return ONLY JSON:
{"items":[{"id":string,"hook":string,"cta":string,"angle":string,"why":string}]}`;

    const text = await callAiMesh(prompt, { temperature: 0.6, grounded: false });
    const parsed = extractJson<{ items?: Array<Record<string, unknown>> }>(text, { items: [] });
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of parsed.items ?? []) {
      const id = String((row as Record<string, unknown>)?.id ?? "");
      if (id) byId.set(id, row as Record<string, unknown>);
    }
    let applied = 0;
    for (const it of target) {
      const row = byId.get(it.id);
      if (!row) continue;
      const hook = String(row["hook"] ?? "").trim();
      const cta = String(row["cta"] ?? "").trim();
      const why = String(row["why"] ?? "").trim();
      if (hook) it.hook_script = hook.slice(0, 220);
      if (cta) it.cta_text = cta.slice(0, 120);
      if (why) it.why_viral = why.slice(0, 320);
      if (hook || cta || why) {
        it.copy_source = "ai";
        applied++;
      }
    }
    return applied > 0;
  } catch {
    return false;
  }
}

type FeedPayload = {
  items: FeedItem[];
  generated_at: string;
  copy_source: "ai" | "real";
  /** Ölçülmüş metriklerden gelen en yüksek skor (UI rozeti için). */
  top_virality: number;
};

/**
 * Ağır canlı tarama: ~20 gerçek YouTube sorgusu + en iyi 36 videonun gerçek
 * beğeni/açıklama zenginleştirmesi + tek AI hook/CTA turu.
 *
 * Bu iş 20-60 sn sürebildiği için İSTEK İÇİNDE her seferinde çalıştırılmaz:
 * `serveStaleWhileRevalidate` altında koşar, sonuç hem belleğe hem kalıcı
 * katmana (Supabase `ai_cache`) yazılır. Böylece sunucusuz ortamda örnek
 * değişse bile pahalı tarama tekrar edilmez ve kullanıcı dakikalarca beklemez.
 */
async function buildFeed(): Promise<FeedPayload> {
  const results = await Promise.allSettled(
    QUERIES.map((q) => fetchQuery(q.q, q.niche, q.country, q.platform)),
  );
  const items: FeedItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
  }

  // Birincil tur zayıf kaldıysa (host değişimi/az sonuç) geniş tur.
  if (items.length < 12) {
    const extra = await Promise.allSettled(
      BROADER_QUERIES.map((q) => fetchQuery(q.q, q.niche, q.country, q.platform, 10)),
    );
    for (const r of extra) if (r.status === "fulfilled") items.push(...r.value);
  }

  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));

  unique.sort((a, b) => b.metrics.virality_score - a.metrics.virality_score);
  const top = unique.slice(0, MAX_ITEMS);

  // Gerçek beğeni + gerçek açıklamayı çek, skorları tazele.
  await enrichAll(top.slice(0, 36));
  top.sort((a, b) => b.metrics.virality_score - a.metrics.virality_score);

  // Gerçek sayılara dayalı hook/CTA turu (başarısız olursa feed yine dolu).
  const aiCopy = await addAiCopy(top);

  return {
    items: top.slice(0, 60),
    generated_at: new Date().toISOString(),
    copy_source: aiCopy ? "ai" : "real",
    top_virality: top.length ? top[0]!.metrics.virality_score : 0,
  };
}

/** Tarama en az 5 dakika taze sayılır (eski `s-maxage=300` davranışı). */
const FEED_FRESH_MS = 5 * 60_000;

export const Route = createFileRoute("/api/public/viral-feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "viral-feed", 60, 60);
        if (limited) return limited;
        try {
          const { data, status } = await serveStaleWhileRevalidate<FeedPayload>({
            key: "viral-feed:v1",
            freshMs: FEED_FRESH_MS,
            isValid: (value) => value.items.length > 0,
            build: buildFeed,
          });

          if (data) {
            return new Response(
              JSON.stringify({
                ...data,
                // `live` = bu tazeleme turunun sonucu; `stale` = önceki tamamlanmış
                // tarama gösteriliyor, yenisi arka planda hazırlanıyor.
                status: status === "ready" ? "live" : "stale",
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control":
                    status === "ready"
                      ? "public, max-age=300, s-maxage=300"
                      : "public, max-age=15, s-maxage=15",
                },
              },
            );
          }

          // Henüz hiç tamamlanmış tarama yok (soğuk ilk istek): tarama arka
          // planda sürüyor, istemci kısa süre sonra tekrar sorar.
          return new Response(
            JSON.stringify({
              items: [],
              status: status === "failed" ? "unavailable" : "warming",
              generated_at: new Date().toISOString(),
              copy_source: "real",
              top_virality: 0,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        } catch (e) {
          console.error("[viral-feed] feed generation failed", e);
          return new Response(
            JSON.stringify({
              items: [],
              status: "unavailable",
              error: "Feed temporarily unavailable",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
