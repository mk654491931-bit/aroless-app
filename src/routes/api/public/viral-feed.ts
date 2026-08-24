import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";

/**
 * Public viral ads feed backed by YouTube (via the Piped public API).
 * No auth required. Fetches real video content across advertising / product
 * niches and maps it into the viral ad row shape the UI renders.
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
};

const PIPED_HOSTS = [
  "https://api.piped.private.coffee",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.kavin.rocks",
];

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

async function pipedFetch(path: string): Promise<any | null> {
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
): Promise<FeedItem[]> {
  const data = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=videos`);
  const items = (data?.items ?? []) as any[];
  const out: FeedItem[] = [];
  for (const it of items) {
    if (it.type !== "stream") continue;
    if (!it.url || typeof it.url !== "string") continue;
    const videoId = it.url.startsWith("/watch?v=") ? it.url.slice(9) : null;
    if (!videoId) continue;
    const views = Number(it.views ?? 0);
    if (views < 5000) continue;
    const title = String(it.title ?? "").slice(0, 140);
    out.push({
      id: `yt_${videoId}`,
      title,
      niche,
      country,
      platform,
      views,
      likes: 0, // filled in from the real video stats below
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      hook_script: null, // filled in from the real video description below
      cta_text: null,
      created_at: it.uploaded
        ? new Date(Number(it.uploaded)).toISOString()
        : new Date().toISOString(),
      channel: String(it.uploaderName ?? ""),
      duration_sec: Number(it.duration ?? 0),
    });
    if (out.length >= 8) break;
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
  if (desc) item.hook_script = desc.slice(0, 220);
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

export const Route = createFileRoute("/api/public/viral-feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "viral-feed", 20, 60);
        if (limited) return limited;
        try {
          const results = await Promise.allSettled(
            QUERIES.map((q) => fetchQuery(q.q, q.niche, q.country, q.platform)),
          );
          const items: FeedItem[] = [];
          for (const r of results) {
            if (r.status === "fulfilled") items.push(...r.value);
          }
          const seen = new Set<string>();
          const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
          unique.sort((a, b) => b.views - a.views);
          const top = unique.slice(0, 60);
          // Replace estimated engagement with the real stats from each video.
          await enrichAll(top.slice(0, 36));
          return new Response(JSON.stringify({ items: top }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300, s-maxage=300",
            },
          });
        } catch (e) {
          return new Response(JSON.stringify({ items: [], error: (e as Error).message }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
