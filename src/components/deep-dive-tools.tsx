import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileDown, FileText, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { num } from "@/lib/deep-dive-complete";

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/* ------------------------------------------------------------------ */
/* Aksiyon planı ilerleme durumu (checklist)                           */
/* ------------------------------------------------------------------ */

export function useChecklist(scope: string) {
  const storageKey = `velora.checklist.${scope}`;
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch { /* yoksay */ }
  }, [storageKey]);

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* yoksay */ }
      return next;
    });

  return { done, toggle };
}

export function CheckItem({
  id, label, done, onToggle,
}: { id: string; label: string; done: boolean; onToggle: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="group flex w-full items-start gap-2 text-left rounded px-1 py-0.5 hover:bg-white/[0.04] transition"
      >
        <span
          className={`mt-[2px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded border transition ${
            done
              ? "border-[oklch(0.68_0.20_265)] bg-[oklch(0.68_0.20_265)] text-white"
              : "border-white/20 bg-white/[0.03] text-transparent group-hover:border-white/40"
          }`}
        >
          <Check size={10} strokeWidth={3} />
        </span>
        <span className={done ? "line-through text-muted-foreground/60" : "text-muted-foreground"}>{label}</span>
      </button>
    </li>
  );
}

export function ChecklistProgress({ total, completed }: { total: number; completed: number }) {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{completed}/{total} · %{pct}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Senaryo simülatörü / risk analizi                                    */
/* ------------------------------------------------------------------ */

type SimRow = { month: string; units: number; revenue: number; ad: number; net: number };

export function useScenario(p: WinningProduct) {
  const base = useMemo(() => {
    const sell = num(p.selling_price_usd, 29.9);
    const cost = num(p.cost_breakdown?.supplier_cost ?? p.supplier_price_usd, sell * 0.3);
    const ship = num(p.cost_breakdown?.shipping_cost, sell * 0.08);
    const fee = num(p.cost_breakdown?.platform_fee, sell * 0.06);
    const rows = (p.financial_projection ?? []).map((f, i) => ({
      month: f.month ?? `${i + 1}. Ay`,
      units: Number(f.units) || 0,
      ad: num(f.ad_spend_usd),
    }));
    return { sell, cost, ship, fee, rows };
  }, [p]);

  const [priceMul, setPriceMul] = useState(1);
  const [adMul, setAdMul] = useState(1);

  const rows: SimRow[] = base.rows.map((r) => {
    // Reklam bütçesi arttıkça adet azalan getiriyle artar; fiyat arttıkça talep düşer.
    const volume = Math.pow(adMul, 0.7) * Math.pow(1 / priceMul, 1.3);
    const units = Math.max(0, Math.round(r.units * volume));
    const price = base.sell * priceMul;
    const ad = r.ad * adMul;
    return {
      month: r.month,
      units,
      revenue: units * price,
      ad,
      net: units * (price - base.cost - base.ship - base.fee) - ad,
    };
  });

  return { rows, priceMul, setPriceMul, adMul, setAdMul, basePrice: base.sell };
}

export function ScenarioSimulator({ p }: { p: WinningProduct }) {
  const { rows, priceMul, setPriceMul, adMul, setAdMul, basePrice } = useScenario(p);
  const totals = rows.reduce(
    (a, r) => ({ units: a.units + r.units, revenue: a.revenue + r.revenue, ad: a.ad + r.ad, net: a.net + r.net }),
    { units: 0, revenue: 0, ad: 0, net: 0 },
  );
  const marginPct = totals.revenue > 0 ? Math.round((totals.net / totals.revenue) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <SimSlider
          label="Satış fiyatı"
          value={priceMul}
          onChange={setPriceMul}
          display={`${usd(basePrice * priceMul)} (${priceMul >= 1 ? "+" : ""}${Math.round((priceMul - 1) * 100)}%)`}
        />
        <SimSlider
          label="Reklam bütçesi"
          value={adMul}
          onChange={setAdMul}
          display={`${usd(totals.ad)} / 90 gün (${adMul >= 1 ? "+" : ""}${Math.round((adMul - 1) * 100)}%)`}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <SimStat label="3 aylık ciro" value={usd(totals.revenue)} />
        <SimStat label="Toplam adet" value={totals.units.toLocaleString("tr-TR")} />
        <SimStat
          label="Net kâr"
          value={usd(totals.net)}
          tone={totals.net >= 0 ? "good" : "bad"}
          sub={`net marj %${marginPct}`}
        />
      </div>

      <div className="max-h-40 overflow-y-auto rounded border border-white/10">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-[oklch(0.19_0.03_265)] text-[10px] text-muted-foreground">
            <tr><th className="px-2 py-1 text-left font-normal">Ay</th><th className="px-2 py-1 text-right font-normal">Adet</th><th className="px-2 py-1 text-right font-normal">Ciro</th><th className="px-2 py-1 text-right font-normal">Net</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="px-2 py-1">{r.month}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.units}</td>
                <td className="px-2 py-1 text-right tabular-nums">{usd(r.revenue)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${r.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => { setPriceMul(1); setAdMul(1); }}
        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
      >
        <RotateCcw size={11} /> Varsayılana dön
      </button>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <SlidersHorizontal size={10} className="inline mr-1" />
        Simülasyon; reklam bütçesinde azalan getiri (üs 0.7) ve fiyat esnekliği (üs 1.3) varsayımıyla hesaplanır.
      </p>
    </div>
  );
}

function SimSlider({
  label, value, onChange, display,
}: { label: string; value: number; onChange: (v: number) => void; display: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-[oklch(0.85_0.15_265)]">{display}</span>
      </div>
      <input
        type="range" min={0.5} max={2} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[oklch(0.68_0.20_265)]"
        aria-label={label}
      />
    </div>
  );
}

function SimStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : ""}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dışa aktar / rapor al                                                */
/* ------------------------------------------------------------------ */

function buildRows(p: WinningProduct): string[][] {
  const rows: string[][] = [["Bölüm", "Başlık", "Detay", "Ek"]];
  rows.push(["Ürün", p.name ?? "", p.target_audience ?? "", p.selling_price_usd ?? ""]);
  (p.financial_projection ?? []).forEach((f) =>
    rows.push(["Finansal projeksiyon", String(f.month ?? ""), `Adet: ${f.units} | Ciro: ${f.revenue_usd}`, `Reklam: ${f.ad_spend_usd} | Net: ${f.net_profit_usd}`]),
  );
  (p.launch_roadmap ?? []).forEach((ph) =>
    rows.push(["Lansman planı", `${ph.phase} (${ph.days})`, (ph.actions ?? []).join(" • "), `Bütçe: ${ph.budget_usd} | KPI: ${ph.kpi}`]),
  );
  (p.content_calendar ?? []).forEach((w) =>
    rows.push(["İçerik takvimi", `${w.week} — ${w.theme}`, (w.posts ?? []).join(" • "), ""]),
  );
  (p.supplier_shortlist ?? []).forEach((s) =>
    rows.push(["Tedarikçi", s.name ?? "", `${s.region ?? ""} | MOQ ${s.moq ?? ""} | ${s.lead_time ?? ""}`, s.unit_price_usd ?? ""]),
  );
  return rows;
}

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function ExportReport({ p }: { p: WinningProduct }) {
  const slug = (p.name ?? "urun").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

  const exportCsv = () => {
    const csv = buildRows(p)
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download(`${slug}-rapor.csv`, "text/csv;charset=utf-8", "\uFEFF" + csv);
  };

  const exportJson = () => download(`${slug}-rapor.json`, "application/json", JSON.stringify(p, null, 2));

  const exportPdf = () => {
    const rows = buildRows(p);
    const html = `<!doctype html><meta charset="utf-8"><title>${p.name ?? "Rapor"} — Aroless Raporu</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1220;color:#e9e9f2;padding:32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:12px;color:#a9a9c4;font-weight:500;margin:0 0 20px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;background:#1b1f38;color:#b9b9d8;padding:6px 8px}
td{padding:6px 8px;border-top:1px solid #262a45;vertical-align:top}
tr:nth-child(even) td{background:#14172a}</style>
<h1>${p.name ?? "Ürün"} — 90 günlük strateji raporu</h1>
<h2>Aroless · ${new Date().toLocaleDateString("tr-TR")}</h2>
<table><thead><tr>${rows[0]!.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${String(c).replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("")}</tbody></table>
<script>window.onload=()=>window.print()<\/script>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      <ExportBtn icon={<FileText size={11} />} label="PDF olarak al" onClick={exportPdf} primary />
      <ExportBtn icon={<FileDown size={11} />} label="CSV indir" onClick={exportCsv} />
      <ExportBtn icon={<Download size={11} />} label="JSON indir" onClick={exportJson} />
    </div>
  );
}

function ExportBtn({
  icon, label, onClick, primary,
}: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition ${
        primary
          ? "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white hover:opacity-90"
          : "border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10"
      }`}
    >
      {icon} {label}
    </button>
  );
}
