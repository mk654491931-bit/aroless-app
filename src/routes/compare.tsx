import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Loader2, Scale, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { listFavorites, type FavoriteRow } from "@/lib/gemini.functions";
import {
  loadFavoritesForComparison,
  summarizeComparison,
  type ComparisonProduct,
} from "@/lib/compare.functions";

export const Route = createFileRoute("/compare")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Compare Products — Aroless" },
      { name: "description", content: "Side-by-side comparison of your saved winning products." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ComparePage,
});

function ComparePage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const listFn = useServerFn(listFavorites);
  const loadFn = useServerFn(loadFavoritesForComparison);
  const summarizeFn = useServerFn(summarizeComparison);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const favQ = useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: () => listFn(),
    enabled: !!user,
  });
  const favorites: FavoriteRow[] = (favQ.data as FavoriteRow[] | undefined) ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<ComparisonProduct[] | null>(null);
  const [summary, setSummary] = useState<{
    winner: string;
    reasoning: string;
    runner_up: string;
    risks: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const runCompare = async () => {
    if (selectedIds.length < 2 || !user) return;
    setBusy(true);
    try {
      const products = await loadFn({ data: { ids: selectedIds } });
      setCompareData(products);
      const summaryInput = products.map((p) => ({
        name: p.name,
        trend_score: p.product.trend_score,
        profit_margin_pct: p.product.profit_margin_pct,
        competition_level: p.product.competition_level,
        sellability_verdict: p.product.sellability_verdict,
        why_winning: p.product.why_winning,
        platform_fit: p.product.platform_fit,
      }));
      const ai = await summarizeFn({ data: { products: summaryInput } });
      setSummary(ai);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="font-bold">Compare Products</div>
          </div>
          <Link
            to="/dashboard"
            className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
          >
            <ArrowLeft size={14} /> Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Scale size={16} />
              <h2 className="font-semibold">Select up to 4 saved products</h2>
            </div>
            <button
              onClick={runCompare}
              disabled={selectedIds.length < 2 || busy}
              className="text-xs rounded-lg bg-[oklch(0.68_0.20_265)] text-white px-4 py-2 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Compare
            </button>
          </div>

          {favQ.isLoading && (
            <div className="text-sm text-muted-foreground py-6 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {!favQ.isLoading && favorites.length === 0 && (
            <div className="text-sm text-muted-foreground py-6">
              No saved products yet. Save products from the finder to compare them.
            </div>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {favorites.map((f) => {
              const selected = selectedIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className={`text-left rounded-xl border p-3 transition-colors ${selected ? "border-[oklch(0.68_0.20_265)] bg-[oklch(0.68_0.20_265)]/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm truncate">{f.name}</div>
                    <div
                      className={`h-5 w-5 rounded border flex items-center justify-center ${selected ? "bg-[oklch(0.68_0.20_265)] border-[oklch(0.68_0.20_265)]" : "border-white/30"}`}
                    >
                      {selected && <Check size={12} className="text-white" />}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {f.collection_name || "Default"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {compareData && compareData.length > 0 && (
          <div className="space-y-4">
            {summary && (
              <div className="glass rounded-2xl p-5 border-l-4 border-[oklch(0.68_0.20_265)]">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} />
                  <h2 className="font-semibold">AI Verdict</h2>
                </div>
                <div className="text-sm space-y-2">
                  <p>
                    <span className="font-medium">Winner:</span> {summary.winner || "—"}
                  </p>
                  <p>
                    <span className="font-medium">Runner-up:</span> {summary.runner_up || "—"}
                  </p>
                  <p className="text-muted-foreground">{summary.reasoning}</p>
                  {summary.risks.length > 0 && (
                    <ul className="list-disc list-inside text-muted-foreground">
                      {summary.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="glass rounded-2xl p-5 overflow-x-auto">
              <h2 className="font-semibold mb-3">Side-by-side</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                      Metric
                    </th>
                    {compareData.map((p) => (
                      <th key={p.id} className="text-left py-2 px-2 font-medium min-w-[180px]">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <Row
                    label="Trend score"
                    values={compareData.map((p) => p.product.trend_score ?? "—")}
                  />
                  <Row
                    label="Profit margin"
                    values={compareData.map((p) => `${p.product.profit_margin_pct ?? "—"}%`)}
                  />
                  <Row
                    label="Competition"
                    values={compareData.map((p) => p.product.competition_level ?? "—")}
                  />
                  <Row
                    label="Verdict"
                    values={compareData.map((p) => p.product.sellability_verdict ?? "—")}
                  />
                  <Row
                    label="Platforms"
                    values={compareData.map((p) => (p.product.platform_fit ?? []).join(", "))}
                  />
                  <Row
                    label="Why winning"
                    values={compareData.map((p) => p.product.why_winning ?? "—")}
                    long
                  />
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Row({
  label,
  values,
  long,
}: {
  label: string;
  values: (string | number)[];
  long?: boolean;
}) {
  return (
    <tr>
      <td className="py-2.5 px-2 text-muted-foreground align-top whitespace-nowrap">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`py-2.5 px-2 align-top ${long ? "max-w-xs" : ""}`}>
          <div className={long ? "text-xs leading-relaxed line-clamp-4" : ""}>{v || "—"}</div>
        </td>
      ))}
    </tr>
  );
}
