import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Radar as RadarIcon, TrendingUp, Loader2, Flame, RefreshCw, Star, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHero } from "@/components/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { getRadar, radarWatchlist, type RadarItem } from "@/lib/radar.functions";

export const Route = createFileRoute("/radar")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Kazanan Ürün Radarı — Velora" },
      { name: "description", content: "Her gün otomatik taranan yükselen ürünler: momentum, kazanan skoru, fiyat bandı ve satış kanalı önerisiyle." },
      { property: "og:title", content: "Kazanan Ürün Radarı — Velora" },
      { property: "og:description", content: "Bugün yükselen ürünleri arama yapmadan gör." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RadarPage,
});

const COUNTRIES = [
  { code: "US", label: "🇺🇸 ABD" },
  { code: "TR", label: "🇹🇷 Türkiye" },
  { code: "DE", label: "🇩🇪 Almanya" },
  { code: "GB", label: "🇬🇧 İngiltere" },
  { code: "AE", label: "🇦🇪 BAE" },
  { code: "FR", label: "🇫🇷 Fransa" },
] as const;

function scoreColor(v: number) {
  if (v >= 80) return "var(--profit)";
  if (v >= 65) return "var(--accent-active)";
  if (v >= 50) return "oklch(0.85 0.18 90)";
  return "oklch(0.7 0.02 260)";
}

function RadarCard({ item, rank }: { item: RadarItem; rank: number }) {
  const nav = useNavigate();
  const color = scoreColor(item.winner_score);
  return (
    <Card className="premium-card group relative overflow-hidden border-white/10">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                #{rank}
              </span>
              <h3 className="truncate text-sm font-bold">{item.title}</h3>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
              <Badge variant="outline" className="border-white/10">{item.niche}</Badge>
              <Badge variant="outline" className="border-white/10">{item.category}</Badge>
              <Badge variant="outline" className="border-white/10">{item.platform}</Badge>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-black leading-none" style={{ color }}>{item.winner_score}</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">score</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="flex items-center justify-center gap-1 text-sm font-bold" style={{ color: item.momentum >= 0 ? "var(--profit)" : "var(--loss, #f87171)" }}>
              <TrendingUp size={12} /> {item.momentum >= 0 ? "+" : ""}{item.momentum}%
            </div>
            <div className="text-[9px] uppercase text-muted-foreground">momentum</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="text-sm font-bold">${item.price_min}-{item.price_max}</div>
            <div className="text-[9px] uppercase text-muted-foreground">fiyat bandı</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="text-sm font-bold">%{item.est_margin_pct}</div>
            <div className="text-[9px] uppercase text-muted-foreground">tah. marj</div>
          </div>
        </div>

        {item.reason && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>}

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 text-xs"
            onClick={() => nav({ to: "/", search: { q: item.title } as never })}
          >
            <Search size={12} className="mr-1" /> Derin analiz
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => nav({ to: "/studio", search: { product: item.title } as never })}
          >
            <Flame size={12} className="mr-1" /> Kreatif
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RadarPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [country, setCountry] = useState<string>("US");
  const radarFn = useServerFn(getRadar);
  const watchFn = useServerFn(radarWatchlist);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const q = useQuery({
    queryKey: ["radar", country],
    queryFn: () => radarFn({ data: { country: country as "US" } }),
    enabled: !!user,
    staleTime: 30 * 60 * 1000,
  });

  const watch = useQuery({
    queryKey: ["radar-watch"],
    queryFn: () => watchFn(),
    enabled: !!user && !!q.data,
    staleTime: 60 * 60 * 1000,
  });

  const items = useMemo(() => (q.data?.items ?? []) as RadarItem[], [q.data]);
  const avg = items.length ? Math.round(items.reduce((s, i) => s + i.winner_score, 0) / items.length) : 0;
  const top = items.length ? Math.max(...items.map((i) => i.momentum)) : 0;

  if (loading || !user) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PageHero
        icon={<RadarIcon size={20} />}
        title="Kazanan Ürün Radarı"
        description="Her gün otomatik taranan yükselen ürünler. Arama yapmadan, bugünün fırsatlarını gör."
        actions={
          <div className="flex items-center gap-2">
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code} className="text-xs">{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw size={13} className={q.isFetching ? "animate-spin" : ""} />
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Bugünkü ürün", value: items.length },
          { label: "Ortalama skor", value: avg },
          { label: "En yüksek momentum", value: `+${top}%` },
          { label: "Favori eşleşmesi", value: watch.data?.matches.length ?? 0 },
        ].map((s) => (
          <div key={s.label} className="premium-card p-3 text-center">
            <div className="text-xl font-black text-[var(--accent-active)]">{s.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {(watch.data?.matches.length ?? 0) > 0 && (
        <div className="premium-card mb-5 border-[var(--profit)]/30 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--profit)]">
            <Star size={14} /> Favorilerinden yükselenler
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {watch.data!.matches.slice(0, 5).map((m, i) => (
              <li key={i}>
                <span className="text-foreground">{m.favorite}</span> → radarda <span className="text-foreground">{m.radar}</span> (+{m.momentum}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      {q.isLoading ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" /> Bugünün radarı hazırlanıyor…
        </div>
      ) : items.length === 0 ? (
        <div className="premium-card p-8 text-center text-sm text-muted-foreground">
          Bugün için henüz veri yok. Birkaç dakika sonra tekrar dene.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => <RadarCard key={it.id} item={it} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}
