import { getUiLang } from "@/lib/auto-i18n/lang";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Newspaper,
  Target,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Clock,
  Zap,
} from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";

export const Route = createFileRoute("/news")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "E-Com News & AI Explainer — Aroless" },
      {
        name: "description",
        content:
          "Daily e-commerce headlines with AI explainers: what changed, why it matters, and how to act on it as a seller.",
      },
      { property: "og:title", content: "E-Com News & AI Explainer — Aroless" },
      {
        property: "og:description",
        content: "Daily e-commerce headlines with AI explainers for sellers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewsPage,
});

type NewsItem = {
  title: string;
  source: string;
  date: string;
  category: string;
  summary: string;
  impact: "high" | "medium" | "low";
  explainer: { means: string; actions: string[]; risk: string };
};

type LiveItem = {
  title: string;
  source: string;
  date: string;
  time_ago?: string;
  category: string;
  summary: string;
  impact: "high" | "medium" | "low";
  action?: string;
};

async function callNews<T>(input: Record<string, string>): Promise<T[]> {
  const res = await apiFetch("/api/public/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "news", input: { ...input, uiLang: getUiLang() } }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Haberler alınamadı");
  const json = (await res.json()) as { items?: T[] };
  return (json.items ?? []).filter((i) => i && (i as { title?: string }).title);
}

const fetchNews = () => callNews<NewsItem>({ today: new Date().toISOString().slice(0, 10) });

const fetchLive = () =>
  callNews<LiveItem>({
    mode: "live",
    today: new Date().toISOString().slice(0, 10),
    hour: new Date().toISOString().slice(11, 13) + ":00",
  });

const impactTone: Record<string, string> = {
  high: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  medium:
    "border-[var(--accent-active)]/40 bg-[var(--accent-active)]/10 text-[var(--accent-active)]",
  low: "border-white/15 bg-white/5 text-muted-foreground",
};

function SkeletonCard() {
  return (
    <div className="premium-card animate-pulse p-4">
      <div className="h-3 w-24 rounded bg-white/10" />
      <div className="mt-3 h-4 w-3/4 rounded bg-white/10" />
      <div className="mt-2 h-3 w-full rounded bg-white/[0.06]" />
      <div className="mt-1.5 h-3 w-5/6 rounded bg-white/[0.06]" />
      <div className="mt-4 h-20 rounded-lg bg-white/[0.04]" />
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="premium-card flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={`text-[10px] ${impactTone[item.impact] ?? impactTone["low"]}`}
        >
          {item.impact === "high"
            ? "Yüksek etki"
            : item.impact === "medium"
              ? "Orta etki"
              : "Düşük etki"}
        </Badge>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {item.category} · {item.date}
        </span>
      </div>

      <h3 className="mt-2.5 text-sm font-bold leading-snug">{item.title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
      <span className="mt-2 text-[10px] text-muted-foreground/70">Kaynak: {item.source}</span>

      <div className="mt-3 rounded-xl border border-[var(--ai)]/25 bg-[var(--ai)]/[0.07] p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ai)]">
          <Target size={12} /> 🎯 AI Explainer
        </div>
        <p className="mt-1.5 text-xs leading-relaxed">{item.explainer?.means}</p>
        {item.explainer?.actions?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {item.explainer.actions.map((a, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--profit)]" /> {a}
              </li>
            ))}
          </ul>
        )}
        {item.explainer?.risk && (
          <p className="mt-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-2 text-[11px] text-[var(--warning)]">
            ⚠ {item.explainer.risk}
          </p>
        )}
      </div>
    </article>
  );
}

const HOUR = 60 * 60 * 1000;

function LiveFeed() {
  const q = useQuery({
    queryKey: ["ecom-news-live"],
    queryFn: fetchLive,
    staleTime: HOUR,
    refetchInterval: HOUR,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null;

  return (
    <aside className="lg:sticky lg:top-20">
      <div className="premium-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--warning)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--warning)]" />
            </span>
            Canlı Akış
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            {q.isFetching ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
          </Button>
        </div>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock size={10} /> Saat başı güncellenir
          {updated &&
            ` · son: ${updated.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`}
        </p>

        {q.isError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-[11px] text-[var(--warning)]">
            <AlertTriangle size={12} className="mt-0.5" /> {(q.error as Error).message}
          </div>
        )}

        <div className="mt-3 space-y-2 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1">
          {q.isLoading &&
            [0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="h-3 w-3/4 rounded bg-white/10" />
                <div className="mt-2 h-2.5 w-full rounded bg-white/[0.06]" />
              </div>
            ))}

          {!q.isLoading &&
            (q.data ?? []).map((item, i) => (
              <article
                key={i}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${impactTone[item.impact] ?? impactTone["low"]}`}
                  >
                    {item.impact === "high"
                      ? "Yüksek"
                      : item.impact === "medium"
                        ? "Orta"
                        : "Düşük"}
                  </Badge>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {item.time_ago || item.date}
                  </span>
                </div>
                <h3 className="mt-1.5 text-xs font-bold leading-snug">{item.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {item.summary}
                </p>
                {item.action && (
                  <p className="mt-1.5 flex gap-1.5 text-[10px] text-[var(--profit)]">
                    <Zap size={10} className="mt-0.5 shrink-0" /> {item.action}
                  </p>
                )}
                <span className="mt-1.5 block text-[9px] text-muted-foreground/70">
                  {item.source} · {item.category}
                </span>
              </article>
            ))}

          {!q.isLoading && !q.isError && (q.data ?? []).length === 0 && (
            <p className="text-[11px] text-muted-foreground">Şu an öne çıkan yeni gelişme yok.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function NewsPage() {
  const q = useQuery({
    queryKey: ["ecom-news"],
    queryFn: fetchNews,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <PageHero
          icon={<Newspaper size={18} />}
          title="E-Com News & AI Explainer"
          description='Pazar yerleri, lojistik, vergi ve reklam tarafındaki güncel gelişmeler — her başlığın altında "bu senin için ne anlama geliyor?" kutusuyla.'
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => q.refetch()}
                disabled={q.isFetching}
              >
                {q.isFetching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}{" "}
                Yenile
              </Button>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
              >
                <ArrowLeft size={13} /> Product Finder
              </Link>
            </>
          }
        />

        <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <Newspaper size={14} className="text-[var(--accent-active)]" /> Latest E-Com News
            </h2>

            {q.isError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 text-xs text-[var(--warning)]">
                <AlertTriangle size={14} className="mt-0.5" /> {(q.error as Error).message}
              </div>
            )}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {q.isLoading && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}
              {!q.isLoading && (q.data ?? []).map((item, i) => <NewsCard key={i} item={item} />)}
            </div>
          </section>

          <LiveFeed />
        </div>
      </main>
    </div>
  );
}
