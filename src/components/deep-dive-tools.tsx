import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileDown, FileText, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { num } from "@/lib/deep-dive-complete";
import { buildProductCostBreakdown } from "@/lib/product-cost-breakdown";
import { sourceLabel } from "@/features/finder/utils/source-label";
import { getBrandedItem, setBrandedItem } from "@/lib/brand-storage";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/* ------------------------------------------------------------------ */
/* Aksiyon planı ilerleme durumu (checklist)                           */
/* ------------------------------------------------------------------ */

export function useChecklist(scope: string) {
  const storageKey = `aroless.checklist.${scope}`;
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = getBrandedItem(storageKey);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* yoksay */
    }
  }, [storageKey]);

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        setBrandedItem(storageKey, JSON.stringify(next));
      } catch {
        /* yoksay */
      }
      return next;
    });

  return { done, toggle };
}

export function CheckItem({
  id,
  label,
  done,
  onToggle,
}: {
  id: string;
  label: string;
  done: boolean;
  onToggle: (id: string) => void;
}) {
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
              ? "border-[oklch(0.62_0.17_255)] bg-[oklch(0.62_0.17_255)] text-white"
              : "border-white/20 bg-white/[0.03] text-transparent group-hover:border-white/40"
          }`}
        >
          <Check size={10} strokeWidth={3} />
        </span>
        <span className={done ? "line-through text-muted-foreground/60" : "text-muted-foreground"}>
          {label}
        </span>
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
          className="h-full rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {completed}/{total} · %{pct}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Senaryo simülatörü / risk analizi                                    */
/* ------------------------------------------------------------------ */

type SimRow = { month: string; units: number; revenue: number; ad: number; net: number };

export function useScenario(p: WinningProduct) {
  const base = useMemo(() => {
    // Simülasyonun maliyet kalemleri, kart/derin analizle AYNI kaynak
    // etiketli modelden gelir. Eski kod tedarik yoksa `sell * 0.3` gibi
    // sessiz varsayımlar kullanıyordu; artık modelin kendi supplier/shipping/
    // platform/returns değerleri alınır ve blokta "ModelNote" gösterilir.
    const costs = buildProductCostBreakdown(p);
    const model = costs.model;
    const sell = num(p.selling_price_usd);
    const cost = costs.supplier.usd ?? model?.supplier ?? 0;
    const ship = costs.shipping.usd ?? model?.shipping ?? 0;
    const fee =
      (costs.platformFee.usd ?? model?.platform_fee ?? 0) +
      (model?.payment_fee ?? 0) +
      (model?.returns_cost ?? 0) +
      (model?.misc ?? 0);
    const overhead = model?.monthly.overhead_usd ?? 0;
    const rows = (p.financial_projection ?? []).map((f, i) => ({
      month: f.month ?? `${i + 1}. Ay`,
      units: Number(f.units) || 0,
      ad: num(f.ad_spend_usd),
    }));
    return { sell, cost, ship, fee, overhead, rows };
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
      net: units * (price - base.cost - base.ship - base.fee) - ad - base.overhead,
    };
  });

  return { rows, priceMul, setPriceMul, adMul, setAdMul, basePrice: base.sell };
}

export function ScenarioSimulator({ p }: { p: WinningProduct }) {
  const { rows, priceMul, setPriceMul, adMul, setAdMul, basePrice } = useScenario(p);
  const totals = rows.reduce(
    (a, r) => ({
      units: a.units + r.units,
      revenue: a.revenue + r.revenue,
      ad: a.ad + r.ad,
      net: a.net + r.net,
    }),
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
          <thead className="sticky top-0 bg-[oklch(0.19_0.03_255)] text-[10px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Ay</th>
              <th className="px-2 py-1 text-right font-normal">Adet</th>
              <th className="px-2 py-1 text-right font-normal">Ciro</th>
              <th className="px-2 py-1 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="px-2 py-1">{r.month}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.units}</td>
                <td className="px-2 py-1 text-right tabular-nums">{usd(r.revenue)}</td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${r.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                >
                  {usd(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => {
          setPriceMul(1);
          setAdMul(1);
        }}
        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition"
      >
        <RotateCcw size={11} /> Varsayılana dön
      </button>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <SlidersHorizontal size={10} className="inline mr-1" />
        Simülasyon; reklam bütçesinde azalan getiri (üs 0.7) ve fiyat esnekliği (üs 1.3)
        varsayımıyla hesaplanır.
      </p>
    </div>
  );
}

function SimSlider({
  label,
  value,
  onChange,
  display,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-[oklch(0.85_0.15_255)]">{display}</span>
      </div>
      <input
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[oklch(0.62_0.17_255)]"
        aria-label={label}
      />
    </div>
  );
}

function SimStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-semibold ${tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dışa aktar / rapor al                                                */
/* ------------------------------------------------------------------ */

function buildRows(p: WinningProduct): string[][] {
  const rows: string[][] = [["Bölüm", "Başlık", "Detay", "Ek"]];
  // Dışa aktarılan raporda model planı/ölçüm ayrımı kaybolmasın.
  rows.push([
    "Kaynak notu",
    "Plan ve projeksiyon",
    "Lansman, içerik ve finansal projeksiyon bölümleri model çıktısıdır; ölçülmüş mağaza performansı değildir.",
    "",
  ]);
  rows.push(["Ürün", p.name ?? "", p.target_audience ?? "", p.selling_price_usd ?? ""]);

  // ÖLÇÜLEN VERİ — kaynakta gerçekten okunan alanlar. Boş alan "0" değil,
  // "ölçülmedi" olarak yazılır; rapor da kartla aynı dürüstlük kuralını taşır.
  const measuredRows: Array<[string, unknown]> = [
    ["Satış fiyatı", p.selling_price_usd || "ölçülmedi"],
    ["Puan", p.measured?.rating ? `${p.measured.rating.toFixed(1)}/5` : "ölçülmedi"],
    ["Değerlendirme sayısı", p.measured?.ratingCount ?? "ölçülmedi"],
    ["Satış adedi", p.measured?.salesVolume ?? "ölçülmedi"],
    ["90 gün görüntülenme", p.measured?.viewed90d ?? "ölçülmedi"],
    ["Tedarik fiyatı", p.supplier_price_usd || "ölçülmedi"],
    [
      "Brüt marj",
      p.gross_margin_pct !== null && p.gross_margin_pct !== undefined
        ? `%${p.gross_margin_pct}`
        : "ölçülmedi",
    ],
    ["Kargoya kalan pay", p.fee_budget_usd ?? "ölçülmedi"],
  ];
  measuredRows.forEach(([label, value]) => rows.push(["Ölçülen veri", label, String(value), ""]));
  rows.push([
    "Kaynaklar",
    "Veri kaynakları",
    (p.data_sources ?? []).map(sourceLabel).join(", ") || "ölçülmedi",
    p.source_url ?? "",
  ]);

  // MALİYET DÖKÜMÜ — her kalemin kaynağı ve ölçüm/hesap durumu raporda kalır.
  const costs = buildProductCostBreakdown(p);
  const costRows = [
    ["Tedarik maliyeti", costs.supplier],
    ["Kargo", costs.shipping],
    ["Platform komisyonu", costs.platformFee],
    ["Reklam / CAC", costs.adSpend],
    ["Brüt kâr", costs.grossProfit],
    ["Net kâr", costs.netProfit],
  ] as const;
  costRows.forEach(([label, row]) =>
    rows.push([
      "Maliyet dökümü",
      label,
      row.usd === null ? row.source : `$${row.usd.toFixed(2)}`,
      row.basis === "measured"
        ? `ölçüldü · ${row.source}`
        : row.basis === "model"
          ? `hesaplandı · ${row.source}`
          : "ölçülmedi",
    ]),
  );
  if (costs.grossMarginPct !== null)
    rows.push(["Maliyet dökümü", "Brüt marj", `%${costs.grossMarginPct}`, "ölçülen fiyatlardan"]);
  if (costs.netMarginPct !== null)
    rows.push([
      "Maliyet dökümü",
      "Net marj",
      `%${costs.netMarginPct}`,
      costs.netProfit.basis === "measured" ? "ölçüldü" : "hesaplandı",
    ]);
  if (costs.delivery) {
    rows.push([
      "Maliyet dökümü",
      "Teslimat",
      costs.delivery.min === costs.delivery.max
        ? `${costs.delivery.min} gün`
        : `${costs.delivery.min}-${costs.delivery.max} gün`,
      costs.delivery.basis === "measured"
        ? `ölçüldü · ${costs.delivery.source}`
        : `hesaplandı · ${costs.delivery.source}`,
    ]);
  }

  (p.competitor_prices ?? []).forEach((cp) =>
    rows.push([
      "Fiyat karşılaştırması",
      cp.store,
      cp.note || "ölçülmüş ilan",
      `${cp.price}${cp.url ? ` · ${cp.url}` : ""}`,
    ]),
  );

  if (p.demand) {
    rows.push([
      "Talep",
      "Trend",
      p.demand.trend_direction,
      `Aylık arama: ${p.demand.monthly_search_volume}`,
    ]);
    if (p.demand.primary_markets?.length)
      rows.push(["Talep", "Öne çıkan pazarlar", p.demand.primary_markets.join(", "), ""]);
    if (p.demand.seasonality) rows.push(["Talep", "Mevsimsellik", p.demand.seasonality, ""]);
  }

  if (p.market_verdict) {
    rows.push([
      "Pazar kararı",
      p.market_verdict.country_name,
      p.market_verdict.summary,
      p.market_verdict.channels.map((channel) => channel.platform).join(" · "),
    ]);
  }

  (p.differentiation ?? []).forEach((item, index) =>
    rows.push(["Farklılaşma", `${index + 1}. madde`, item, ""]),
  );
  (p.risks ?? []).forEach((risk) =>
    rows.push(["Riskler", risk.risk, risk.mitigation, `Şiddet: ${risk.severity}`]),
  );
  (p.keyword_opportunities ?? []).forEach((keyword) =>
    rows.push([
      "Anahtar kelimeler",
      keyword.keyword,
      keyword.intent,
      `${keyword.monthly_volume} · ${keyword.difficulty} zorluk`,
    ]),
  );

  (p.financial_projection ?? []).forEach((f) =>
    rows.push([
      "Finansal projeksiyon (model)",
      String(f.month ?? ""),
      `Adet: ${f.units} | Ciro: ${f.revenue_usd}`,
      `Reklam: ${f.ad_spend_usd} | Net: ${f.net_profit_usd}`,
    ]),
  );
  (p.launch_roadmap ?? []).forEach((ph) =>
    rows.push([
      "Lansman planı (model)",
      `${ph.phase} (${ph.days})`,
      (ph.actions ?? []).join(" • "),
      `Bütçe: ${ph.budget_usd} | KPI: ${ph.kpi}`,
    ]),
  );
  (p.content_calendar ?? []).forEach((w) =>
    rows.push([
      "İçerik takvimi (model)",
      `${w.week} — ${w.theme}`,
      (w.posts ?? []).join(" • "),
      "",
    ]),
  );
  (p.supplier_shortlist ?? []).forEach((s) =>
    rows.push([
      "Tedarikçi (model)",
      s.name ?? "",
      `${s.region ?? ""} | MOQ ${s.moq ?? ""} | ${s.lead_time ?? ""}`,
      s.unit_price_usd ?? "",
    ]),
  );
  return rows;
}

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportReport({ p }: { p: WinningProduct }) {
  const slug = (p.name ?? "urun")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  const exportCsv = () => {
    const csv = buildRows(p)
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download(`${slug}-rapor.csv`, "text/csv;charset=utf-8", "\uFEFF" + csv);
  };

  const exportJson = () =>
    download(`${slug}-rapor.json`, "application/json", JSON.stringify(p, null, 2));

  const exportPdf = () => {
    const rows = buildRows(p);
    // HTML-escape every value sourced from AI/marketplace data before it is
    // written into the export document (prevents markup/script injection).
    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(p.name ?? "Rapor")} — Aroless Raporu</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1220;color:#e9e9f2;padding:32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:12px;color:#a9a9c4;font-weight:500;margin:0 0 20px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;background:#1b1f38;color:#b9b9d8;padding:6px 8px}
td{padding:6px 8px;border-top:1px solid #262a45;vertical-align:top}
tr:nth-child(even) td{background:#14172a}</style>
<h1>${esc(p.name ?? "Ürün")} — 90 günlük model strateji raporu</h1>
<h2>Aroless · ${new Date().toLocaleDateString("tr-TR")}</h2>
<table><thead><tr>${rows[0]!.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows
      .slice(1)
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>
<script>window.onload=()=>window.print()</${"s"}cript>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
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
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition ${
        primary
          ? "bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] text-white hover:opacity-90"
          : "border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10"
      }`}
    >
      {icon} {label}
    </button>
  );
}
