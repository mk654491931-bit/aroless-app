import { withProGate } from "@/components/pro-route-gate";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
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
  channel: string;
  duration_sec: number;
  created_at: string;
};

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

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const adsQ = useQuery({
    queryKey: ["viral-live"],
    queryFn: fetchLiveAds,
    enabled: !!user,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
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
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--brand)] mb-4">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            Live feed · real videos from YouTube
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            <span className="text-gradient">Viral</span> Ad Archive
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Real trending ad videos pulled live. Preview thumbnails, watch inline, and steal the
            hooks.
          </p>
        </div>

        {!adsQ.isLoading && (adsQ.data?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={Megaphone}
              label="Live ads"
              value={(adsQ.data?.length ?? 0).toLocaleString()}
            />
            <StatCard icon={TrendingUp} label="Total views" value={formatViews(totalViews)} />
            <StatCard icon={Heart} label="Total likes" value={formatViews(totalLikes)} />
            <StatCard icon={Filter} label="Niches" value={String(nicheCount)} />
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
              className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
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
            <span>{filtered.length} ads · sorted by views</span>
            {(q || platform || niche) && (
              <button
                onClick={() => {
                  setQ("");
                  setPlatform("");
                  setNiche("");
                }}
                className="text-[var(--brand)] hover:underline"
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
            <Megaphone className="mx-auto mb-3 text-[var(--brand)]" />
            No viral ads match your filters.
          </div>
        )}

        {!adsQ.isLoading && filtered.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((ad) => (
              <AdCard key={ad.id} ad={ad} onPlay={() => setPlaying(ad)} />
            ))}
          </div>
        )}
      </main>

      {playing && <VideoModal ad={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

function AdCard({ ad, onPlay }: { ad: LiveAd; onPlay: () => void }) {
  const engagement = ad.views > 0 ? Math.round((ad.likes / ad.views) * 100) : 0;
  return (
    <article className="group glass rounded-xl overflow-hidden border border-transparent hover:border-[var(--brand)]/50 hover:shadow-[0_20px_60px_-20px_color-mix(in_oklab,var(--brand)_45%,transparent)] transition-all flex flex-col">
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
      </button>

      <div className="p-4 flex-1 flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-[var(--brand)] mb-1 font-semibold">
          {ad.niche}
        </div>
        <h3 className="font-bold text-[15px] leading-snug line-clamp-2">{ad.title}</h3>
        <div className="text-xs text-muted-foreground mt-1 truncate">{ad.channel}</div>

        {ad.hook_script && (
          <div className="mt-3 rounded-lg bg-gradient-to-br from-[var(--brand)]/10 to-[var(--brand-2)]/5 border border-[var(--brand)]/20 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[var(--brand)] mb-1 flex items-center gap-1">
              <Play size={10} /> Hook
            </div>
            <p className="text-xs leading-relaxed line-clamp-2">{ad.hook_script}</p>
          </div>
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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onPlay}
            className="rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] hover:brightness-110 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 text-white"
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
            <div className="text-[10px] uppercase tracking-wider text-[var(--brand)] font-semibold">
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
            <div className="text-[10px] uppercase tracking-wider text-[var(--brand)] mb-1 font-semibold flex items-center gap-1">
              <Play size={10} /> Hook
            </div>
            <p className="text-sm">{ad.hook_script}</p>
          </div>
        )}
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
        className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--brand)] appearance-none"
      >
        <option value="" className="bg-[var(--surface)]">
          All {label}s
        </option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-[var(--surface)]">
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
    <div className="glass rounded-xl p-3 flex items-center gap-3 hover:border-[var(--brand)]/40 border border-transparent transition">
      <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[var(--brand)]/25 to-[var(--brand-2)]/15 flex items-center justify-center">
        <Icon size={16} className="text-[var(--brand)]" />
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
