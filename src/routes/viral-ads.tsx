import { withProGate } from "@/components/pro-route-gate";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Search,
  Play,
  TrendingUp,
  Heart,
  Filter,
  Megaphone,
  Flame,
  Youtube,
  Clock,
  ExternalLink,
  RefreshCw,
  X,
  Sparkles,
  Zap,
  Target,
  Copy,
  Check,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  buildViralAd,
  type GeneratedViralAd,
  type ViralAdScriptBeat,
} from "@/lib/viral_ads.functions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/viral-ads")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Viral Ads Library — Aroless" },
      {
        name: "description",
        content:
          "Live feed of trending real-world viral ad videos with hooks, thumbnails and playable previews.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: withProGate(ViralAdsPage),
});

type LiveAdMetrics = {
  engagement_pct: number;
  views_per_hour: number;
  age_hours: number;
  virality_score: number;
  format: string;
  verdict: string;
};

type LiveAd = {
  id: string;
  title: string;
  niche: string;
  country: string;
  platform: string;
  views: number;
  likes: number;
  video_url: string;
  thumbnail: string | null;
  hook_script: string | null;
  cta_text?: string | null;
  why_viral?: string | null;
  copy_source?: "ai" | "real";
  source_description?: string;
  channel: string;
  duration_sec: number;
  created_at: string;
  /** Gerçek dünya metriklerinden hesaplanan viralite verisi (feed'den gelir). */
  metrics?: LiveAdMetrics;
};

/** Skora göre renk — kart üzerindeki rozet ve çubuklar için. */
function viralityColor(score: number): string {
  if (score >= 75) return "oklch(0.75 0.19 145)";
  if (score >= 58) return "oklch(0.82 0.16 90)";
  if (score >= 40) return "oklch(0.68 0.15 255)";
  return "oklch(0.62 0.03 260)";
}

const PLATFORMS = ["TikTok", "Instagram", "Facebook", "YouTube"];
const NICHES = [
  "Trending",
  "Beauty",
  "Fitness",
  "Home",
  "Tech",
  "Pets",
  "Fashion",
  "Kitchen",
  "Outdoor",
];

async function fetchLiveAds(): Promise<LiveAd[]> {
  const res = await fetch("/api/public/viral-feed");
  if (!res.ok) throw new Error("Failed to load feed");
  const json = (await res.json()) as { items: LiveAd[] };
  return json.items ?? [];
}

function youTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function ViralAdsPage() {
  useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [niche, setNiche] = useState("");
  const [playing, setPlaying] = useState<LiveAd | null>(null);
  const [building, setBuilding] = useState<LiveAd | null>(null);

  useEffect(() => {
    if (!loading && !user)
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
  }, [user, loading, nav]);

  const adsQ = useQuery({
    queryKey: ["viral-live"],
    queryFn: fetchLiveAds,
    enabled: !!user,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Sunucu taramayı arka planda yaparken boş liste döner ("warming"); bu
    // durumda kısa aralıkla tekrar sor, böylece tarama biter bitmez reklamlar
    // kendiliğinden görünür ve kullanıcı elle yenilemek zorunda kalmaz.
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? false : 8_000),
  });

  const filtered = useMemo(() => {
    const rows = adsQ.data ?? [];
    return rows.filter((a) => {
      if (platform && a.platform !== platform) return false;
      if (niche && a.niche !== niche) return false;
      if (q.trim()) {
        const t = q.toLowerCase();
        if (
          !a.title.toLowerCase().includes(t) &&
          !a.channel.toLowerCase().includes(t) &&
          !a.niche.toLowerCase().includes(t)
        )
          return false;
      }
      return true;
    });
  }, [adsQ.data, q, platform, niche]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const totalViews = (adsQ.data ?? []).reduce((s, a) => s + a.views, 0);
  const totalLikes = (adsQ.data ?? []).reduce((s, a) => s + a.likes, 0);
  const nicheCount = new Set((adsQ.data ?? []).map((a) => a.niche)).size;
  const avgVirality = (() => {
    const scores = (adsQ.data ?? [])
      .map((a) => a.metrics?.virality_score ?? 0)
      .filter((n) => n > 0);
    return scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
  })();
  const topVelocity = Math.max(0, ...(adsQ.data ?? []).map((a) => a.metrics?.views_per_hour ?? 0));

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandLogo subtitle="Viral Ads Library" />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button
              onClick={() => adsQ.refetch()}
              className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
              disabled={adsQ.isFetching}
            >
              <RefreshCw size={14} className={adsQ.isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <Link
              to="/"
              className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
            >
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center relative">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.62_0.17_255)]/30 bg-[oklch(0.62_0.17_255)]/10 px-3 py-1 text-[11px] font-semibold text-[oklch(0.85_0.15_255)] mb-4">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            Live feed · real videos from YouTube
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            <span className="text-gradient">Viral</span> Ad Archive
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
            Real ad videos pulled live and ranked by <strong>measured</strong> virality — views per
            hour, engagement rate and freshness, not total views. Pick any one and generate a
            ready-to-shoot ad blueprint grounded in its real numbers.
          </p>
        </div>

        {!adsQ.isLoading && (adsQ.data?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Megaphone}
              label="Live ads"
              value={(adsQ.data?.length ?? 0).toLocaleString()}
            />{" "}
            <StatCard icon={TrendingUp} label="Total views" value={formatViews(totalViews)} />
            <StatCard icon={Heart} label="Total likes" value={formatViews(totalLikes)} />
            <StatCard icon={Zap} label="Ort. viralite" value={`${avgVirality}/100`} />
            <StatCard
              icon={Filter}
              label="En yüksek hız"
              value={`${formatViews(topVelocity)}/sa`}
            />
          </div>
        )}

        <section className="glass rounded-2xl p-4 md:p-5 space-y-4">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles, channels, niches..."
              className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <FilterSelect
              label="Platform"
              value={platform}
              onChange={setPlatform}
              options={PLATFORMS}
              icon={Megaphone}
            />
            <FilterSelect
              label="Niche"
              value={niche}
              onChange={setNiche}
              options={NICHES}
              icon={TrendingUp}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length} ads · {nicheCount} niş · gerçek virality skoruna göre sıralı
            </span>
            {(q || platform || niche) && (
              <button
                onClick={() => {
                  setQ("");
                  setPlatform("");
                  setNiche("");
                }}
                className="text-[oklch(0.85_0.15_255)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </section>

        {adsQ.isLoading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="glass rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        )}

        {adsQ.isError && (
          <div className="glass rounded-xl p-8 text-center">
            <Flame className="mx-auto mb-3 text-rose-400" />
            <p className="text-sm text-muted-foreground">
              Couldn't fetch the live feed. Try refreshing.
            </p>
          </div>
        )}

        {!adsQ.isLoading && !adsQ.isError && filtered.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Megaphone className="mx-auto mb-3 text-[oklch(0.68_0.15_255)]" />
            No viral ads match your filters.
          </div>
        )}

        {!adsQ.isLoading && filtered.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                onPlay={() => setPlaying(ad)}
                onBuild={() => setBuilding(ad)}
              />
            ))}
          </div>
        )}
      </main>

      {playing && <VideoModal ad={playing} onClose={() => setPlaying(null)} />}
      {building && <ViralAdModal ad={building} onClose={() => setBuilding(null)} />}
    </div>
  );
}

function AdCard({ ad, onPlay, onBuild }: { ad: LiveAd; onPlay: () => void; onBuild: () => void }) {
  const engagement =
    ad.metrics?.engagement_pct ?? (ad.views > 0 ? Math.round((ad.likes / ad.views) * 100) : 0);
  const score = ad.metrics?.virality_score ?? 0;
  return (
    <article className="group glass rounded-xl overflow-hidden border border-transparent hover:border-[oklch(0.62_0.17_255)]/50 hover:shadow-[0_20px_60px_-20px_oklch(0.68_0.20_265/0.45)] transition-all flex flex-col">
      <button onClick={onPlay} className="relative aspect-video overflow-hidden bg-black">
        {ad.thumbnail && (
          <img
            src={ad.thumbnail}
            alt={ad.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.2")}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
          <div className="h-14 w-14 rounded-full bg-white/95 flex items-center justify-center shadow-2xl">
            <Play size={22} className="text-black ml-1" fill="currentColor" />
          </div>
        </div>
        {ad.duration_sec > 0 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white flex items-center gap-1">
            <Clock size={9} /> {formatDuration(ad.duration_sec)}
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-2 py-1 text-[10px] font-semibold">
          <Youtube size={11} className="text-rose-400" /> {ad.platform}
        </div>
        {score > 0 && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/75 backdrop-blur px-2 py-1 text-[10px] font-bold"
            style={{ color: viralityColor(score) }}
            title={`Gerçek metriklerden hesaplanan viralite skoru: ${score}/100 (${ad.metrics?.verdict ?? ""})`}
          >
            <Zap size={11} /> {score}
          </div>
        )}
      </button>

      <div className="p-4 flex-1 flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] mb-1 font-semibold">
          {ad.niche}
        </div>
        <h3 className="font-bold text-[15px] leading-snug line-clamp-2">{ad.title}</h3>
        <div className="text-xs text-muted-foreground mt-1 truncate">{ad.channel}</div>

        {ad.hook_script && (
          <div className="mt-3 rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)]/10 to-[oklch(0.52_0.15_262)]/5 border border-[oklch(0.62_0.17_255)]/20 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] mb-1 flex items-center gap-1">
              <Play size={10} /> Hook
            </div>
            <p className="text-xs leading-relaxed line-clamp-2">{ad.hook_script}</p>
          </div>
        )}

        {ad.metrics && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
              <Zap size={9} className="mr-1 inline" />
              {formatViews(ad.metrics.views_per_hour)}/saat
            </span>
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
              {ad.metrics.format}
            </span>
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
              {ad.copy_source === "ai" ? "AI hook · gerçek metrik" : "gerçek açıklama"}
            </span>
          </div>
        )}

        {ad.why_viral && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
            {ad.why_viral}
          </p>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <TrendingUp size={12} /> {formatViews(ad.views)}
            </span>
            <span className="flex items-center gap-1">
              <Heart size={12} /> {ad.likes > 0 ? formatViews(ad.likes) : "—"}
            </span>
          </div>
          <span className="tabular-nums">{engagement}%</span>
        </div>

        <button
          onClick={onBuild}
          className="mt-3 w-full rounded-lg border border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/15 hover:bg-[oklch(0.62_0.17_255)]/25 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 text-[oklch(0.9_0.12_255)]"
        >
          <Sparkles size={12} /> Viral ad üret (gerçek metriklerden)
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={onPlay}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] hover:brightness-110 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 text-white"
          >
            <Play size={12} fill="currentColor" /> Watch
          </button>
          <a
            href={ad.video_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={12} /> Open
          </a>
        </div>
      </div>
    </article>
  );
}

function VideoModal({ ad, onClose }: { ad: LiveAd; onClose: () => void }) {
  const ytId = youTubeId(ad.video_url);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl glass rounded-2xl overflow-hidden border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b border-white/10">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] font-semibold">
              {ad.niche} · {ad.platform}
            </div>
            <h3 className="font-bold text-base leading-tight mt-0.5 truncate">{ad.title}</h3>
            <div className="text-xs text-muted-foreground mt-0.5">{ad.channel}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 p-2 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
        <div className="aspect-video bg-black">
          {ytId ? (
            <iframe
              key={ytId}
              src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`}
              title={ad.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Preview unavailable —{" "}
              <a href={ad.video_url} target="_blank" rel="noreferrer" className="underline ml-1">
                open source
              </a>
            </div>
          )}
        </div>
        {ad.hook_script && (
          <div className="p-4 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] mb-1 font-semibold flex items-center gap-1">
              <Play size={10} /> Hook
            </div>
            <p className="text-sm">{ad.hook_script}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ViralAdModal({ ad, onClose }: { ad: LiveAd; onClose: () => void }) {
  const build = useServerFn(buildViralAd);
  const [product, setProduct] = useState("");
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GeneratedViralAd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const metrics = ad.metrics;

  const run = async (withProduct: string) => {
    setLoading(true);
    setError(null);
    try {
      const out = await build({
        data: {
          title: ad.title,
          niche: ad.niche,
          platform: ad.platform,
          country: ad.country,
          views: ad.views,
          likes: ad.likes,
          duration_sec: ad.duration_sec,
          created_at: ad.created_at,
          channel: ad.channel,
          description: ad.source_description ?? ad.hook_script ?? "",
          product: withProduct,
        },
      });
      setResult(out);
    } catch (e) {
      setError((e as Error).message || "Reklam üretilemedi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyAll = async () => {
    if (!result) return;
    const script = result.script
      .map((b) => `${b.second} | ${b.visual} | VO: ${b.voiceover} | Yazi: ${b.text_overlay}`)
      .join("\n");
    const text = [
      `HOOK: ${result.hook_variants[0] ?? ""}`,
      result.hook_variants[1] ? `HOOK B: ${result.hook_variants[1]}` : "",
      result.hook_variants[2] ? `HOOK C: ${result.hook_variants[2]}` : "",
      "",
      "SCRIPT",
      script,
      "",
      `CTA: ${result.cta}`,
      `HEDEFLEME: ${result.targeting}`,
      `NEDEN: ${result.why}`,
      `Beklenen: hook ${result.predicted.hook_rate} · CTR ${result.predicted.ctr} · CPM ${result.predicted.cpm}`,
      `Ölçülen referans: ${result.source_numbers}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopyalanamadı", { description: "Tarayıcı pano iznini kontrol edin." });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl glass rounded-2xl border border-white/10 my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-white/10">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] font-semibold flex items-center gap-1">
              <Sparkles size={11} /> Viral ad üretici · gerçek metrik tabanlı
            </div>
            <h3 className="font-bold text-base leading-tight mt-0.5 truncate">{ad.title}</h3>
            <div className="text-xs text-muted-foreground mt-0.5">
              {ad.channel} · {ad.platform} · {ad.niche}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 p-2 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
              Ölçülen referans metrikler (API'den, tahmin değil)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-lg border border-white/10 p-2">
                <div className="font-bold">{formatViews(ad.views)}</div>
                <div className="text-[9px] uppercase text-muted-foreground">izlenme</div>
              </div>
              <div className="rounded-lg border border-white/10 p-2">
                <div className="font-bold">{formatViews(metrics?.views_per_hour ?? 0)}/saat</div>
                <div className="text-[9px] uppercase text-muted-foreground">gerçek hız</div>
              </div>
              <div className="rounded-lg border border-white/10 p-2">
                <div className="font-bold">%{metrics?.engagement_pct ?? 0}</div>
                <div className="text-[9px] uppercase text-muted-foreground">etkileşim</div>
              </div>
              <div
                className="rounded-lg border p-2"
                style={{ borderColor: viralityColor(metrics?.virality_score ?? 0) }}
              >
                <div
                  className="font-bold"
                  style={{ color: viralityColor(metrics?.virality_score ?? 0) }}
                >
                  {metrics?.virality_score ?? 0}/100
                </div>
                <div className="text-[9px] uppercase text-muted-foreground">
                  viralite · {metrics?.verdict ?? "—"}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Tespit edilen format:{" "}
              <span className="text-foreground">{metrics?.format ?? "—"}</span> · yayın yaşı{" "}
              {metrics?.age_hours ?? 0} sa
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Kendi ürünün (opsiyonel) — ör. ısıtmalı boyun yastığı"
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            />
            <button
              onClick={() => void run(product)}
              disabled={loading}
              className="rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] hover:brightness-110 px-4 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 text-white disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? "Yazılıyor…" : result ? "Yeniden üret" : "Üret"}
            </button>
          </div>

          {loading && !result && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={14} /> Ölçülen metrikler çok motorlu havuza
              veriliyor, reklam yazılıyor…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error} — birkaç saniye sonra "Yeniden üret" ile tekrar deneyin.
            </div>
          )}

          {result && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold flex items-center gap-1">
                  <Zap size={11} /> Hook varyantları (ilk söylenen cümle)
                </div>
                <div className="space-y-2">
                  {result.hook_variants.map((h, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)]/10 to-transparent border border-[oklch(0.62_0.17_255)]/20 p-2.5 text-sm"
                    >
                      <span className="text-[10px] font-bold text-[oklch(0.85_0.15_255)] mr-2">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {h}
                    </div>
                  ))}
                </div>
              </div>

              {result.script.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold flex items-center gap-1">
                    <Play size={11} /> Çekim planı
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="p-2 text-left">Saniye</th>
                          <th className="p-2 text-left">Görsel</th>
                          <th className="p-2 text-left">Seslendirme</th>
                          <th className="p-2 text-left">Ekran yazısı</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.script.map((b: ViralAdScriptBeat, i: number) => (
                          <tr key={i} className="border-t border-white/5 align-top">
                            <td className="p-2 font-semibold whitespace-nowrap">{b.second}</td>
                            <td className="p-2">{b.visual}</td>
                            <td className="p-2">{b.voiceover}</td>
                            <td className="p-2">{b.text_overlay}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                    CTA
                  </div>
                  <div className="text-sm font-semibold">{result.cta || "—"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold flex items-center gap-1">
                    <Target size={10} /> Hedefleme
                  </div>
                  <div className="text-xs">{result.targeting || "—"}</div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                  Neden işe yarıyor (ölçülen sayılara dayalı)
                </div>
                <p className="text-xs leading-relaxed">{result.why || "—"}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  { label: "hook oranı", value: result.predicted.hook_rate },
                  { label: "CTR", value: result.predicted.ctr },
                  { label: "CPM", value: result.predicted.cpm },
                ].map((p) => (
                  <div key={p.label} className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="font-bold">{p.value || "—"}</div>
                    <div className="text-[9px] uppercase text-muted-foreground">{p.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span>Kaynak: {result.source_numbers}</span>
                <button
                  onClick={copyAll}
                  className="shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Kopyalandı" : "Tümünü kopyala"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="relative">
      <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)] appearance-none"
      >
        <option value="" className="bg-[oklch(0.20_0.035_255)]">
          All {label}s
        </option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-[oklch(0.20_0.035_255)]">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3 hover:border-[oklch(0.62_0.17_255)]/40 border border-transparent transition">
      <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/15 flex items-center justify-center">
        <Icon size={16} className="text-[oklch(0.85_0.15_255)]" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
