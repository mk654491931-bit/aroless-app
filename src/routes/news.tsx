import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, Target, ArrowLeft, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/news")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "E-Com News & AI Explainer — Velora" },
      { name: "description", content: "Daily e-commerce headlines with AI explainers: what changed, why it matters, and how to act on it as a seller." },
      { property: "og:title", content: "E-Com News & AI Explainer — Velora" },
      { property: "og:description", content: "Daily e-commerce headlines with AI explainers for sellers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewsPage,
});

type NewsItem = {
  title: string; source: string; date: string; category: string; summary: string;
  impact: "high" | "medium" | "low";
  explainer: { means: string; actions: string[]; risk: string };
};

async function fetchNews(): Promise<NewsItem[]> {
  const res = await fetch("/api/public/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "news", input: { today: new Date().toISOString().slice(0, 10) } }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Haberler alınamadı");
  const json = (await res.json()) as { items?: NewsItem[] };
  return (json.items ?? []).filter((i) => i && i.title);
}

const impactTone: Record<string, string> = {
  high: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  medium: "border-[var(--accent-active)]/40 bg-[var(--accent-active)]/10 text-[var(--accent-active)]",
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
        <Badge variant="outline" className={`text-[10px] ${impactTone[item.impact] ?? impactTone['low']}`}>
          {item.impact === "high" ? "Yüksek etki" : item.impact === "medium" ? "Orta etki" : "Düşük etki"}
        </Badge>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.category} · {item.date}</span>
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

function NewsPage() {
  const q = useQuery({ queryKey: ["ecom-news"], queryFn: fetchNews, staleTime: 30 * 60 * 1000, retry: 1 });

  return (
    <div className="min-h-screen">
      <header className="glass top-light sticky top-0 z-40 border-b border-white/10">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
          <BrandLogo subtitle="E-Com News & AI Explainer" />
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10">
            <ArrowLeft size={13} /> Product Finder
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight md:text-3xl">
              📰 E-Com News & AI Explainer
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Pazar yerleri, lojistik, vergi ve reklam tarafındaki güncel gelişmeler — her başlığın altında
              "bu senin için ne anlama geliyor?" kutusuyla.
            </p>
          </div>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Yenile
          </Button>
        </div>

        <section className="mt-7">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Newspaper size={14} className="text-[var(--accent-active)]" /> Latest E-Com News
          </h2>

          {q.isError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3 text-xs text-[var(--warning)]">
              <AlertTriangle size={14} className="mt-0.5" /> {(q.error as Error).message}
            </div>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.isLoading && <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>}
            {!q.isLoading && (q.data ?? []).map((item, i) => <NewsCard key={i} item={item} />)}
          </div>
        </section>
      </main>
    </div>
  );
}
