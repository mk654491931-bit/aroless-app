import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Columns3,
  Loader2,
  Scale,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { listFavorites, type FavoriteRow } from "@/lib/gemini.functions";
import { summarizeComparison } from "@/lib/compare.functions";
import { CompareModal } from "@/components/compare-tray";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Summary = { winner: string; reasoning: string; runner_up: string; risks: string[] };

export const COMPARE_MAX_SELECT = 4;

/**
 * Ürün Karşılaştır sayfası.
 *
 * Kayıtlı ürünler (favoriler) listelenir; kullanıcı 2–4 tanesini seçer ve yan yana
 * karşılaştırır ya da AI özetini ister. Panelin boş kalmaması için üç durum
 * ayrıca ele alınır: yükleniyor, kayıt yok, seçim yok. (Eskiden `/compare` yalnızca
 * bir yer tutucu metindi ve hiçbir şey açılmıyordu.)
 */
export function ComparePage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const favFn = useServerFn(listFavorites);
  const summarizeFn = useServerFn(summarizeComparison);

  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user)
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
  }, [user, loading, nav]);

  const favQ = useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: () => favFn(),
    enabled: !!user,
  });
  const favorites = useMemo<FavoriteRow[]>(
    () => (favQ.data as FavoriteRow[] | undefined) ?? [],
    [favQ.data],
  );

  const selectedFavorites = useMemo(
    () => favorites.filter((f) => selected.includes(f.id)),
    [favorites, selected],
  );
  const compareProducts = useMemo(
    () => selectedFavorites.map((f) => f.product),
    [selectedFavorites],
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= COMPARE_MAX_SELECT
          ? prev
          : [...prev, id],
    );

  const summaryMut = useMutation({
    mutationFn: async () => {
      const products = selectedFavorites.slice(0, COMPARE_MAX_SELECT).map((f) => ({
        name: f.product.name,
        trend_score: f.product.trend_score,
        profit_margin_pct: f.product.profit_margin_pct,
        competition_level: f.product.competition_level,
        sellability_verdict: f.product.sellability_verdict,
        why_winning: f.product.why_winning,
        platform_fit: f.product.platform_fit,
      }));
      return (await summarizeFn({ data: { products } })) as Summary;
    },
    onError: (e) =>
      toast.error("AI karşılaştırması başarısız", { description: (e as Error).message }),
  });

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">
        Yükleniyor…
      </div>
    );
  }

  const summary = summaryMut.data;

  return (
    <div className="min-h-screen">
      <header className="glass top-light sticky top-0 z-40 border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="inline-flex items-center gap-2 text-sm font-semibold">
            <Scale size={15} className="text-[var(--accent-active)]" /> Ürün Karşılaştır
          </h1>
          <Link
            to="/dashboard"
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="premium-card grain relative overflow-hidden rounded-2xl p-5">
          <div className="hero-halo" aria-hidden="true" />
          <h2 className="relative flex items-center gap-2 text-xl font-black tracking-tight">
            <Columns3 size={18} className="text-[var(--accent-active)]" /> Kayıtlı ürünlerini yan yana
            koy
          </h2>
          <p className="relative mt-2 max-w-2xl text-sm text-muted-foreground">
            Ürün Bulucu'dan kaydettiğin ürünlerden 2–4 tanesini seç; marj, rekabet, kanıt ve trend
            metrikleri tek tabloda karşılaştırılsın, AI hangisinin kazanacağını gerekçesiyle söylesin.
          </p>
        </section>

        {favQ.isLoading ? (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Kayıtlı ürünler yükleniyor…
          </p>
        ) : favorites.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Henüz kayıtlı ürün yok. Karşılaştırmak için önce Ürün Bulucu'dan ürün kaydet.
            </p>
            <Button asChild className="mt-4">
              <Link to="/">Ürün Bulucu'ya git</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-2">
              {favorites.map((f) => {
                const checked = selected.includes(f.id);
                const disabled = !checked && selected.length >= COMPARE_MAX_SELECT;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    disabled={disabled}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      checked
                        ? "border-[var(--accent-active)]/50 bg-[var(--accent-active)]/10"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                        checked
                          ? "border-[var(--accent-active)] bg-[var(--accent-active)] text-white"
                          : "border-white/25"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {f.product.emoji} {f.product.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        <span>Trend {f.product.trend_score ?? "—"}</span>
                        <span>· Marj %{f.product.profit_margin_pct ?? "—"}</span>
                        <span>· Rekabet {f.product.competition_level ?? "—"}</span>
                      </span>
                    </span>
                    {f.collection_name ? (
                      <Badge variant="outline" className="border-white/10 text-[10px]">
                        {f.collection_name}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <aside className="h-fit space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:sticky lg:top-20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Seçilen</span>
                <span className="text-[11px] text-muted-foreground">
                  {selected.length}/{COMPARE_MAX_SELECT}
                </span>
              </div>
              {selectedFavorites.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  En az 2 ürün seç. Seçtiğin ürünler burada listelenir.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedFavorites.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px]"
                    >
                      <span className="min-w-0 truncate">
                        {f.product.emoji} {f.product.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`${f.product.name} çıkar`}
                        onClick={() => toggle(f.id)}
                        className="opacity-60 hover:opacity-100"
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                className="w-full gap-2"
                disabled={selectedFavorites.length < 2}
                onClick={() => setOpen(true)}
              >
                <Columns3 size={14} /> Yan yana karşılaştır
              </Button>
              <Button
                variant="secondary"
                className="w-full gap-2"
                disabled={selectedFavorites.length < 2 || summaryMut.isPending}
                onClick={() => summaryMut.mutate()}
              >
                {summaryMut.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                AI ile karşılaştır
              </Button>
            </aside>
          </div>
        )}

        {summary && (
          <section className="mt-6 rounded-2xl border border-[var(--profit)]/30 bg-[var(--profit)]/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--profit)]">
              <Trophy size={15} /> AI kararı: {summary.winner || "belirsiz"}
            </h3>
            {summary.reasoning && (
              <p className="mt-2 text-xs leading-relaxed text-foreground/85">{summary.reasoning}</p>
            )}
            {summary.runner_up && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <TrendingUp size={11} /> Yedek seçenek: {summary.runner_up}
              </p>
            )}
            {summary.risks.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--warning)]">
                {summary.risks.map((r, i) => (
                  <li key={i} className="flex gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {open && compareProducts.length >= 2 && (
        <CompareModal
          products={compareProducts}
          onClose={() => setOpen(false)}
          onRemove={(name) =>
            setSelected((prev) =>
              prev.filter(
                (id) => selectedFavorites.find((f) => f.id === id)?.product.name !== name,
              ),
            )
          }
        />
      )}
    </div>
  );
}
