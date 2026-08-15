import { X, Columns3, Trash2 } from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { MarketFitPanel } from "@/components/market-fit-panel";

/** Floating bar showing the current compare selection. */
export function CompareTray({
  products,
  onRemove,
  onClear,
  onOpen,
}: {
  products: WinningProduct[];
  onRemove: (name: string) => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  if (products.length === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="premium-card grain flex max-w-full flex-wrap items-center gap-2 rounded-2xl px-3 py-2 shadow-[0_20px_60px_-20px_oklch(0.68_0.20_265/0.6)]">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <Columns3 size={12} /> Karşılaştırma
        </span>
        {products.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
            <span className="max-w-[140px] truncate">{p.emoji} {p.name}</span>
            <button type="button" aria-label={`${p.name} çıkar`} onClick={() => onRemove(p.name)} className="opacity-50 hover:opacity-100">
              <X size={10} />
            </button>
          </span>
        ))}
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10">
          <Trash2 size={11} /> Temizle
        </button>
        <button
          type="button"
          onClick={onOpen}
          disabled={products.length < 2}
          className="rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Yan yana karşılaştır ({products.length})
        </button>
      </div>
    </div>
  );
}

function num(v: unknown, suffix = "") {
  if (v === undefined || v === null || v === "") return "—";
  return `${v}${suffix}`;
}

/** Full-screen side-by-side comparison including country/platform reasoning. */
export function CompareModal({
  products,
  onClose,
  onRemove,
}: {
  products: WinningProduct[];
  onClose: () => void;
  onRemove: (name: string) => void;
}) {
  const rows: { label: string; get: (p: WinningProduct) => string }[] = [
    { label: "Winner Score", get: (p) => num(p.winner_score) },
    { label: "Satış fiyatı", get: (p) => String(p.selling_price_usd ?? "—") },
    { label: "Tedarik maliyeti", get: (p) => String(p.cost_breakdown?.supplier_cost ?? p.supplier_price_usd ?? "—") },
    { label: "Net kâr", get: (p) => String(p.cost_breakdown?.net_profit ?? "—") },

    { label: "Net marj", get: (p) => num(p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct, "%") },
    { label: "Rekabet", get: (p) => String(p.competition_level ?? "—") },
    { label: "Kanıt seviyesi", get: (p) => String(p.evidence_level ?? "—") },
    { label: "Gerçekçilik", get: (p) => num(p.realism_score) },
    { label: "Trend momentumu", get: (p) => num(p.market_evidence?.trend_momentum_pct, "%") },
    { label: "Viral olasılık (90g)", get: (p) => num(p.viral_probability_90d, "%") },
    { label: "Hedef kitle", get: (p) => String(p.target_audience ?? "—") },
    { label: "Platform uyumu", get: (p) => (p.platform_fit ?? []).join(", ") || "—" },
    { label: "Birincil pazarlar", get: (p) => (p.demand?.primary_markets ?? []).join(", ") || "—" },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="premium-card grain mx-auto max-w-6xl rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
            <Columns3 size={15} className="text-[oklch(0.75_0.18_265)]" />
            Yan yana karşılaştırma · {products.length} ürün
          </h3>
          <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-full border border-white/10 bg-white/5 p-1.5 hover:bg-white/10">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-40 p-2 text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Metrik</th>
                {products.map((p) => (
                  <th key={p.name} className="p-2 text-left align-top">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{p.emoji} {p.name}</span>
                      <button type="button" aria-label={`${p.name} çıkar`} onClick={() => onRemove(p.name)} className="opacity-50 hover:opacity-100">
                        <X size={12} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-white/10">
                  <td className="p-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{r.label}</td>
                  {products.map((p) => (
                    <td key={p.name} className="p-2 align-top tabular-nums">{r.get(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <div key={p.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="text-xs font-semibold">{p.emoji} {p.name}</div>
              {p.market_verdict ? (
                <MarketFitPanel verdict={p.market_verdict} defaultOpen />
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">Bu ürün için ülke-platform gerekçesi üretilmedi.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
