import { useMemo } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct } from "@/lib/recommendation";
import { buyersPer1000, parseMoneyNum } from "@/lib/consistency";

export type FinderFilters = {
  priceMin: number;
  priceMax: number;
  marginMin: number;
  aiMin: number;
  healthMin: number;
  viralMin: number;
  buyersMin: number;
  competition: "Any" | "Low" | "Medium" | "High";
  country: string;
};

export const DEFAULT_FILTERS: FinderFilters = {
  priceMin: 0,
  priceMax: 100000,
  marginMin: 0,
  aiMin: 0,
  healthMin: 0,
  viralMin: 0,
  buyersMin: 0,
  competition: "Any",
  country: "Any",
};

export function applyFilters(list: WinningProduct[], f: FinderFilters): WinningProduct[] {
  return list.filter((p) => {
    const price = parseMoneyNum(p.selling_price_usd);
    // price 0 = unparsed / no live price → never hide the product for it
    if (price > 0 && (price < f.priceMin || price > f.priceMax)) return false;
    const margin = p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0;
    if (f.marginMin > 0 && margin < f.marginMin) return false;
    const e = enrichProduct(p);
    if (f.aiMin > 0 && e.ai_score < f.aiMin) return false;
    if (f.healthMin > 0 && (p.health_score ?? 0) < f.healthMin) return false;
    if (f.viralMin > 0 && (p.viral_probability_90d ?? 0) < f.viralMin) return false;
    if (f.buyersMin > 0 && buyersPer1000(p).value < f.buyersMin) return false;
    if (f.competition !== "Any" && p.competition_level !== f.competition) return false;
    if (f.country !== "Any") {
      const markets = p.demand?.primary_markets ?? [];
      if (!markets.some((m) => m.toLowerCase().includes(f.country.toLowerCase()))) return false;
    }
    return true;
  });
}


export function AdvancedFilters({
  products, filters, onChange, onReset,
}: {
  products: WinningProduct[];
  filters: FinderFilters;
  onChange: (f: FinderFilters) => void;
  onReset: () => void;
}) {
  const countries = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.demand?.primary_markets?.forEach((m) => set.add(m)));
    return ["Any", ...Array.from(set).slice(0, 20)];
  }, [products]);

  const set = <K extends keyof FinderFilters>(k: K, v: FinderFilters[K]) =>
    onChange({ ...filters, [k]: v });

  const matched = applyFilters(products, filters).length;
  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="premium-card grain rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal size={14} className="text-[oklch(0.75_0.18_265)]" />
          Advanced filters
          <span className="text-[11px] font-normal text-muted-foreground">
            · {matched} / {products.length} match
          </span>
        </div>
        {isDirty && (
          <button onClick={onReset} className="text-[11px] inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1">
            <X size={11} /> Reset
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        <RangePair label="Price ($)" min={filters.priceMin} max={filters.priceMax}
          onMin={(v) => set("priceMin", v)} onMax={(v) => set("priceMax", v)} maxCap={100000} />

        <SliderRow label="Min margin %" value={filters.marginMin} onChange={(v) => set("marginMin", v)} min={0} max={90} />
        <SliderRow label="Min AI score" value={filters.aiMin} onChange={(v) => set("aiMin", v)} min={0} max={100} />
        <SliderRow label="Min buyers / 1k" value={filters.buyersMin} onChange={(v) => set("buyersMin", v)} min={0} max={60} />
        <SliderRow label="Min health" value={filters.healthMin} onChange={(v) => set("healthMin", v)} min={0} max={100} />
        <SliderRow label="Min viral 90d" value={filters.viralMin} onChange={(v) => set("viralMin", v)} min={0} max={100} />
        <SelectRow label="Competition" value={filters.competition} onChange={(v) => set("competition", v as FinderFilters["competition"])}
          options={["Any", "Low", "Medium", "High"]} />
        <SelectRow label="Country" value={filters.country} onChange={(v) => set("country", v)} options={countries} />
      </div>
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="tabular-nums font-semibold text-foreground">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[oklch(0.68_0.20_265)]" />
    </label>
  );
}

function RangePair({ label, min, max, onMin, onMax, maxCap }: { label: string; min: number; max: number; onMin: (v: number) => void; onMax: (v: number) => void; maxCap: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">{label} <span className="text-foreground font-semibold tabular-nums">{min}–{max}</span></div>
      <div className="flex gap-2">
        <input type="number" min={0} max={maxCap} value={min} onChange={(e) => onMin(Math.max(0, Number(e.target.value) || 0))}
          className="w-1/2 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]" />
        <input type="number" min={0} max={maxCap} value={max} onChange={(e) => onMax(Math.max(min, Number(e.target.value) || 0))}
          className="w-1/2 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]" />
      </div>
    </div>
  );
}

function SelectRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]">
        {options.map((o) => <option key={o} value={o} className="bg-[#0b0d16]">{o}</option>)}
      </select>
    </label>
  );
}