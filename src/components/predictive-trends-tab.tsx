import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Flame,
  Loader2,
  Snowflake,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { TrendAnalysisModal } from "@/components/trend-analysis-modal";
import type { TrendItem, TrendPayload, TrendView } from "@/routes/api/public/predictive-trends";
import { apiFetch } from "@/lib/api-client";

const VIEWS: { id: TrendView; label: string; icon: typeof Flame; hint: string }[] = [
  {
    id: "now",
    label: "🔥 Trending Right Now",
    icon: Flame,
    hint: "Son 7-14 günde arama hacmi patlayan ürünler",
  },
  {
    id: "next",
    label: "🔮 Next Month's Winners",
    icon: CalendarClock,
    hint: "30-60 gün içinde zirveye çıkacak sezonluk fırsatlar",
  },
  {
    id: "season",
    label: "❄️/☀️ Seasonal Fast-Track",
    icon: Snowflake,
    hint: "Bu sezonun ülkeye özel en iyi performansçıları",
  },
];

async function fetchTrends(view: TrendView, country: string): Promise<TrendPayload> {
  const res = await apiFetch(
    `/api/public/predictive-trends?view=${view}&country=${encodeURIComponent(country)}`,
  );
  if (!res.ok) throw new Error("Trend verisi alınamadı");
  return (await res.json()) as TrendPayload;
}

function TrendCard({ p, onOpen }: { p: TrendItem; onOpen: () => void }) {
  const up = p.momentum_pct >= 0;
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title="Detaylı AI analizi için tıkla"
      className="premium-card cursor-pointer rounded-2xl p-4 space-y-3 transition hover:border-white/20 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.68_0.20_265)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold">{p.name}</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {p.category} · {p.marketplace}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-2 py-0.5 text-[11px] font-semibold text-white">
          {p.score}
        </span>
      </div>

      <Sparkline values={p.series} height={38} />

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
          <CalendarClock size={10} /> Peak Demand Month: <b>{p.peak_month}</b>
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${up ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}
        >
          {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {up ? "+" : ""}
          {p.momentum_pct}%
        </span>
        {p.spike_window && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
            {p.spike_window}
          </span>
        )}
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
          Rekabet: {p.competition}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground">
          {p.trend_source === "google-trends" ? "Google Trends" : "tahmini seri"}
        </span>
      </div>

      {p.why && <p className="text-[11px] leading-relaxed text-muted-foreground">{p.why}</p>}
      {p.ad_angle && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px]">
          <Sparkles size={10} className="mr-1 inline" /> {p.ad_angle}
        </p>
      )}
      {p.audience && <p className="text-[10px] text-muted-foreground">🎯 {p.audience}</p>}
      <p className="text-[10px] font-semibold text-[oklch(0.78_0.16_290)]">
        Detaylı AI analizi için tıkla →
      </p>
    </article>
  );
}

/** Predictive Trends & Seasonality module — hourly refreshed Groq + Google Trends engine. */
export function PredictiveTrendsTab({ country }: { country: string }) {
  const [view, setView] = useState<TrendView>("now");
  const [selected, setSelected] = useState<TrendItem | null>(null);
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["predictive-trends", view, country],
    queryFn: () => fetchTrends(view, country),
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });

  const active = VIEWS.find((v) => v.id === view)!;
  const items = data?.items ?? [];

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <header className="text-center">
        <h2 className="text-2xl font-extrabold md:text-3xl">🔮 Predictive Trends & Seasonality</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Google Trends verisi + Groq talep analizi · her saat başı yenilenir · pazar:{" "}
          <b>{country}</b>
        </p>
      </header>

      <div className="flex flex-wrap justify-center gap-2">
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${on ? "border-transparent bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"}`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">{active.hint}</p>

      {(isLoading || isFetching) && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Talep sinyalleri taranıyor…
        </div>
      )}
      {!isLoading && !isFetching && (isError || items.length === 0) && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Şu anda trend verisi alınamadı, birazdan tekrar dene.
        </p>
      )}
      {!isFetching && items.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <TrendCard key={p.id} p={p} onOpen={() => setSelected(p)} />
          ))}
        </div>
      )}

      {selected && (
        <TrendAnalysisModal
          product={selected}
          country={country}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
