import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Flame, Loader2, TrendingUp } from "lucide-react";
import { fetchHotProducts, HOT_FEED_QUERY_KEY, type HotProduct } from "@/lib/hot-products";

const KEY = "omni_hot_ticker_open";

function TickerCard({ p }: { p: HotProduct }) {
  return (
    <Link
      to="/hot/$id"
      params={{ id: p.id }}
      className="block rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition hover:border-primary/60 hover:bg-card"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold text-foreground">{p.name}</span>
        <span className="shrink-0 text-[11px]">{p.country_flag}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">{p.marketplace}</span>
        <span className="truncate">{p.budget_usd}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400">
        <TrendingUp className="h-3 w-3 shrink-0" /> {p.score}/100 · {p.margin_pct}% marj
      </div>
    </Link>
  );
}

/** Collapsible, viewport-contained live watermark of the most sellable products right now. */
export function HotTicker() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== null) setOpen(raw === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: HOT_FEED_QUERY_KEY,
    queryFn: fetchHotProducts,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    enabled: open,
  });

  const items = data?.items ?? [];

  if (!open) {
    return (
      <button
        onClick={toggle}
        className="fixed right-0 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 border-border/60 bg-background/80 px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-md hover:text-foreground xl:flex"
        style={{ writingMode: "vertical-rl" }}
        aria-label="Canlı listeyi aç"
      >
        <Flame className="h-3.5 w-3.5 text-orange-400" /> Canlı fırsatlar
      </button>
    );
  }

  return (
    <aside
      className="pointer-events-none fixed right-3 top-24 z-20 hidden w-56 xl:block"
      style={{ maxHeight: "calc(100dvh - 8rem)" }}
    >
      <div className="pointer-events-auto flex max-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-xl border border-border/60 bg-background/70 backdrop-blur-md">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Flame className="h-4 w-4 shrink-0 text-orange-400" />
            <span className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">
              Şu an satılmaya en müsait
            </span>
          </span>
          <button
            onClick={toggle}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Paneli kapat"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent)]">
          {isLoading && (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <p className="p-3 text-[11px] text-muted-foreground">Canlı veri şu an alınamadı.</p>
          )}
          {items.length > 0 && (
            <div className="ticker-scroll space-y-2 p-2">
              {[...items, ...items].map((p, i) => (
                <TickerCard key={`${p.id}-${i}`} p={p} />
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
          Her saat başı yenilenir
        </div>
      </div>
    </aside>
  );
}
