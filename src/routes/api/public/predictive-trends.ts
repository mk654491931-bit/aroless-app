import { createFileRoute } from "@tanstack/react-router";
import { guardAuthed } from "@/lib/api-guard.server";

/**
 * Predictive Trends & Seasonality engine.
 * Groq demand analysis + Google Trends series, refreshed hourly per
 * (country, view) in server memory + CDN cache.
 */

export type TrendView = "now" | "next" | "season";

export type TrendItem = {
  id: string;
  name: string;
  keyword: string;
  category: string;
  why: string;
  peak_month: string;
  spike_window: string;
  season: string;
  momentum_pct: number;
  series: number[];
  trend_source: "google-trends" | "estimated";
  competition: "Low" | "Medium" | "High";
  marketplace: string;
  audience: string;
  ad_angle: string;
  score: number;
};

export type TrendPayload = {
  view: TrendView;
  country: string;
  refreshed_at: string;
  next_refresh_at: string;
  items: TrendItem[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const cache = new Map<string, TrendPayload>();
const inflight = new Map<string, Promise<TrendPayload>>();

const hourKey = (d = new Date()) => d.toISOString().slice(0, 13);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const VIEW_BRIEF: Record<TrendView, string> = {
  now: "Products whose search demand is SPIKING RIGHT NOW (last 7-14 days) in the target country. Prioritise live spikes over evergreen demand.",
  next: "Predictive seasonality: products whose historical search volume reliably spikes 30-60 days FROM TODAY (e.g. Halloween goods in September, winter gear in October). Buy/list now, sell at the peak.",
  season: "Fast-track winners for the CURRENT season in the target country (respect the hemisphere), already converting this month.",
};

async function build(view: TrendView, country: string): Promise<TrendPayload> {
  const { callGroq, extractJson } = await import("@/lib/ai.server");
  const { getGoogleTrends } = await import("@/lib/market-data.server");
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);

  const prompt = `You are a seasonal e-commerce demand analyst. Today is ${iso}. Target market: ${country}.

Task: ${VIEW_BRIEF[view]}

Rules:
- 8 real, specific, nameable products currently sold online. No vague categories.
- "keyword" must be the exact English Google search term buyers use (2-4 words).
- "peak_month" must be one of: ${MONTHS.join(", ")}.
- "spike_window" is a short human window like "15 Sep - 31 Oct".
- Ground every "why" in real demand evidence (search seasonality, holidays, weather, culture of ${country}).

Return ONLY JSON:
{"items":[{"name":string,"keyword":string,"category":string,"why":string,"peak_month":string,"spike_window":string,"season":string,"competition":"Low"|"Medium"|"High","marketplace":string,"audience":string,"ad_angle":string,"score":number 1-100}]}`;

  const text = await callGroq(prompt, 0.5);
  const parsed = extractJson<{ items?: any[] }>(text, { items: [] });
  const raws = (parsed.items ?? []).slice(0, 8);

  const items: TrendItem[] = await Promise.all(
    raws.map(async (raw: any, i: number): Promise<TrendItem | null> => {
      const name = String(raw?.name ?? "").trim();
      if (!name) return null;
      const keyword = String(raw?.keyword ?? name).trim().slice(0, 80);
      const comp = String(raw?.competition ?? "Medium");
      const peak = MONTHS.find((m) => m.toLowerCase() === String(raw?.peak_month ?? "").toLowerCase())
        ?? MONTHS[(now.getUTCMonth() + (view === "next" ? 1 : 0)) % 12];
      let series: number[] = [];
      let momentum = 0;
      let source: TrendItem["trend_source"] = "estimated";
      try {
        const t = await getGoogleTrends(keyword, country);
        series = (view === "now" ? t.monthly : t.yearly).slice(-52);
        momentum = t.momentum_pct;
        source = t.source;
      } catch { /* graceful */ }
      return {
        id: `${slug(name)}-${i}`,
        name: name.slice(0, 90),
        keyword,
        category: String(raw?.category ?? "General").slice(0, 40),
        why: String(raw?.why ?? "").slice(0, 260),
        peak_month: peak,
        spike_window: String(raw?.spike_window ?? "").slice(0, 40),
        season: String(raw?.season ?? "").slice(0, 40),
        momentum_pct: Math.round(momentum),
        series,
        trend_source: source,
        competition: comp === "Low" || comp === "High" ? comp : "Medium",
        marketplace: String(raw?.marketplace ?? "Shopify").slice(0, 40),
        audience: String(raw?.audience ?? "").slice(0, 160),
        ad_angle: String(raw?.ad_angle ?? "").slice(0, 220),
        score: Math.max(0, Math.min(100, Math.round(Number(raw?.score) || 70))),
      };
    }),
  ).then((r) => r.filter((x): x is TrendItem => !!x).sort((a, b) => b.score - a.score));

  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);

  return { view, country, refreshed_at: now.toISOString(), next_refresh_at: next.toISOString(), items };
}

async function getPayload(view: TrendView, country: string): Promise<TrendPayload> {
  const key = `${hourKey()}|${view}|${country}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const p = build(view, country)
    .then((res) => {
      if (res.items.length) {
        cache.clear();
        cache.set(key, res);
      }
      return res;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const Route = createFileRoute("/api/public/predictive-trends")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await guardAuthed(request, "predictive-trends", 30, 60);
        if ("response" in guard) return guard.response;
        const url = new URL(request.url);
        const rawView = url.searchParams.get("view") ?? "now";
        const view: TrendView = rawView === "next" || rawView === "season" ? rawView : "now";
        const country = (url.searchParams.get("country") ?? "GLOBAL").toUpperCase().slice(0, 8);
        try {
          const payload = await getPayload(view, country);
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=600" },
          });
        } catch (e) {
          console.error("[predictive-trends]", e);
          return new Response(JSON.stringify({ view, country, items: [], error: "Trend verisi alınamadı." }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
