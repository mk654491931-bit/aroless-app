import { memo } from "react";
import { Search, Copy, Download, FileJson, ArrowDownWideNarrow, ArrowUpWideNarrow, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { enrichProduct, formatCurrency } from "@/lib/recommendation";
import { buyersPer1000 } from "@/lib/consistency";
import { SORTS, sortProducts, toResultsCsv, type FinderProduct, type SortKey } from "@/lib/finder-derivations";

export const ResultsToolbar = memo(function ResultsToolbar({
  products,
  sortBy,
  onSortBy,
  onlyLaunch,
  onToggleLaunch,
  sortDesc,
  onToggleDir,
  query,
  onQuery,
  niche,
  country,
}: {
  products: FinderProduct[];
  sortBy: SortKey;
  onSortBy: (key: SortKey) => void;
  onlyLaunch: boolean;
  onToggleLaunch: () => void;
  sortDesc: boolean;
  onToggleDir: () => void;
  query: string;
  onQuery: (value: string) => void;
  niche: string;
  country: string;
}) {
  const shown = sortProducts(products, sortBy, onlyLaunch, sortDesc, {
    enrichProduct: (p) => enrichProduct(p as never),
    buyersPer1000: (p) => buyersPer1000(p as never).value,
  });
  const avgBuyers = shown.length
    ? Math.round(
        shown.reduce(
          (sum, product) => sum + buyersPer1000(product as never).value,
          0,
        ) / shown.length,
      )
    : 0;
  const totalProfit = shown.reduce(
    (sum, product) => sum + enrichProduct(product as never).est_monthly_net_profit_usd,
    0,
  );
  const launches = products.filter(
    (product) => enrichProduct(product as never).recommendation === "Launch",
  ).length;
  const avgScore = shown.length
    ? Math.round(
        shown.reduce((sum, product) => sum + enrichProduct(product as never).ai_score, 0) /
          shown.length,
      )
    : 0;
  const avgMargin = shown.length
    ? Math.round(
        shown.reduce(
          (sum, product) =>
            sum + (product.cost_breakdown?.net_margin_pct ?? product.profit_margin_pct ?? 0),
          0,
        ) / shown.length,
      )
    : 0;
  const stamp = new Date().toISOString().slice(0, 10);

  const download = () => {
    const blob = new Blob(
      [
        toResultsCsv(shown, {
          enrichProduct: (p) => enrichProduct(p as never),
          buyersPer1000: (p) => buyersPer1000(p as never).value,
        }),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aroless-winners-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    const blob = new Blob(
      [JSON.stringify({ niche, country, generated_at: new Date().toISOString(), products: shown }, null, 2)],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aroless-winners-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = async () => {
    const lines = shown.slice(0, 20).map((product, i) => {
      const enriched = enrichProduct(product as never);
      return `${i + 1}. ${product.name} — AI ${enriched.ai_score} · ${product.selling_price_usd ?? "?"} · marj ${product.cost_breakdown?.net_margin_pct ?? product.profit_margin_pct ?? "?"}% · ${enriched.recommendation}`;
    });
    await navigator.clipboard.writeText(
      [`Aroless — ${niche || "product finder"} (${country}) · ${stamp}`, ...lines].join("\n"),
    );
    toast.success("Özet panoya kopyalandı");
  };

  return (
    <div className="premium-card grain rounded-2xl p-4 mb-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <SummaryStat label="Products" value={String(shown.length)} />
        <SummaryStat
          label="Avg Winner Score"
          value={String(
            shown.length
              ? Math.round(shown.reduce((sum, product) => sum + (product.winner_score ?? 0), 0) / shown.length)
              : 0,
          )}
          highlight
        />
        <SummaryStat label="Launch-ready" value={String(launches)} />
        <SummaryStat label="Avg AI score" value={String(avgScore)} />
        <SummaryStat label="Avg net margin" value={`${avgMargin}%`} />
        <SummaryStat label="Avg buyers / 1k" value={String(avgBuyers)} />
        <SummaryStat
          label="Doğrulanmış"
          value={`${shown.filter((product) => (product.realism_score ?? 0) >= 75).length}/${shown.length}`}
        />
        <SummaryStat label="Est. monthly profit" value={formatCurrency(totalProfit)} highlight />
      </div>
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Sonuçlarda ara — ürün adı, kitle veya platform"
          className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-8 py-2 text-xs outline-none focus:border-[oklch(0.62_0.17_255)]"
        />
        {query && (
          <button
            type="button"
            aria-label="Aramayı temizle"
            onClick={() => onQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <XIcon size={11} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mr-1">Sort</span>
        {SORTS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSortBy(s.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              sortBy === s.id
                ? "border-[oklch(0.62_0.17_255)] bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 text-foreground"
                : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={onToggleDir}
          title={sortDesc ? "Yüksekten düşüğe" : "Düşükten yükseğe"}
          className="text-xs px-2.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
        >
          {sortDesc ? <ArrowDownWideNarrow size={12} /> : <ArrowUpWideNarrow size={12} />}
          {sortDesc ? "Azalan" : "Artan"}
        </button>
        <button
          onClick={onToggleLaunch}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            onlyLaunch
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
          }`}
        >
          🟢 Launch only
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={copySummary}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <Copy size={12} /> Özet kopyala
          </button>
          <button
            onClick={downloadJson}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <FileJson size={12} /> JSON
          </button>
          <button
            onClick={download}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>
    </div>
  );
});

const SummaryStat = memo(function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${highlight ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5" : "border-white/10 bg-white/[0.04]"}`}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-lg font-black tracking-tight">{value}</div>
    </div>
  );
});

export type { SortKey };
