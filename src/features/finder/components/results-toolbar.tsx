import { toast } from "sonner";
import { Search, Copy, Download, ArrowDownWideNarrow, ArrowUpWideNarrow, FileJson, X as XIcon } from "lucide-react";
import { buyersPer1000 } from "@/lib/consistency";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct, formatCurrency } from "@/lib/recommendation";
import { SORTS, type SortKey, sortProducts } from "../utils/sorting";
import { toCsv } from "../utils/export";

function SummaryStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${highlight ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5" : "border-white/10 bg-white/[0.04]"}`}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-lg font-black tracking-tight">{value}</div>
    </div>
  );
}

export function ResultsToolbar({
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
  products: WinningProduct[];
  sortBy: SortKey;
  onSortBy: (k: SortKey) => void;
  onlyLaunch: boolean;
  onToggleLaunch: () => void;
  sortDesc: boolean;
  onToggleDir: () => void;
  query: string;
  onQuery: (v: string) => void;
  niche: string;
  country: string;
}) {
  const shown = sortProducts(products, sortBy, onlyLaunch, sortDesc);
  const avgBuyers = shown.length ? Math.round(shown.reduce((a, p) => a + buyersPer1000(p).value, 0) / shown.length) : 0;
  const totalProfit = shown.reduce((a, p) => a + enrichProduct(p).est_monthly_net_profit_usd, 0);
  const launches = products.filter((p) => enrichProduct(p).recommendation === "Launch").length;
  const avgScore = shown.length ? Math.round(shown.reduce((a, p) => a + enrichProduct(p).ai_score, 0) / shown.length) : 0;
  const avgMargin = shown.length
    ? Math.round(shown.reduce((a, p) => a + (p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0), 0) / shown.length)
    : 0;
  const stamp = new Date().toISOString().slice(0, 10);

  const download = () => {
    const blob = new Blob([toCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aroless-winners-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ niche, country, generated_at: new Date().toISOString(), products: shown }, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aroless-winners-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = async () => {
    const lines = shown.slice(0, 20).map((p, i) => {
      const e = enrichProduct(p);
      return `${i + 1}. ${p.name} — AI ${e.ai_score} · ${p.selling_price_usd ?? "?"} · marj ${p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? "?"}% · ${e.recommendation}`;
    });
    await navigator.clipboard.writeText([`Aroless — ${niche || "product finder"} (${country}) · ${stamp}`, ...lines].join("\n"));
    toast.success("Özet panoya kopyalandı");
  };

  return (
    <div className="premium-card grain rounded-2xl p-4 mb-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <SummaryStat label="Products" value={String(shown.length)} />
        <SummaryStat
          label="Avg Winner Score"
          value={String(shown.length ? Math.round(shown.reduce((s, p) => s + (p.winner_score ?? 0), 0) / shown.length) : 0)}
          highlight
        />
        <SummaryStat label="Launch-ready" value={String(launches)} />
        <SummaryStat label="Avg AI score" value={String(avgScore)} />
        <SummaryStat label="Avg net margin" value={`${avgMargin}%`} />
        <SummaryStat label="Avg buyers / 1k" value={String(avgBuyers)} />
        <SummaryStat label="Doğrulanmış" value={`${shown.filter((p) => (p.realism_score ?? 0) >= 75).length}/${shown.length}`} />
        <SummaryStat label="Est. monthly profit" value={formatCurrency(totalProfit)} highlight />
      </div>

      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="chip-rail flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mr-1">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => onSortBy(s.id)}
              data-active={sortBy === s.id}
              className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition sm:min-h-0 ${
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
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10 sm:min-h-0"
          >
            {sortDesc ? <ArrowDownWideNarrow size={12} /> : <ArrowUpWideNarrow size={12} />}
            {sortDesc ? "Azalan" : "Artan"}
          </button>
          <button
            onClick={onToggleLaunch}
            className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition sm:min-h-0 ${
              onlyLaunch
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
            }`}
          >
            🟢 Launch only
          </button>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={copySummary}
            aria-label="Özeti panoya kopyala"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 sm:min-h-0"
          >
            <Copy size={12} />
            <span className="hidden sm:inline">Özet kopyala</span>
          </button>
          <button
            onClick={downloadJson}
            aria-label="JSON olarak indir"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 sm:min-h-0"
          >
            <FileJson size={12} />
            <span className="hidden sm:inline">JSON</span>
          </button>
          <button
            onClick={download}
            aria-label="CSV olarak indir"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 sm:min-h-0"
          >
            <Download size={12} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
}
