import { useState } from "react";
import {
  Sparkles,
  ExternalLink,
  Percent,
  Package,
  Wand2,
  Film,
  Heart,
  Truck,
  Receipt,
  Store,
  Megaphone,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  Lock,
  CalendarDays,
  Target,
  Radar,
  Activity,
  ChevronUp,
  ChevronDown,
  Columns3,
  FileText,
  Users,
} from "lucide-react";
import { ConsensusBadge } from "@/components/consensus-report";
import { CountryFlag } from "@/components/country-flag";
import { MarketEvidencePanel, ProofBadge, RealismBadge } from "@/components/market-evidence-panel";
import { MarketFitPanel } from "@/components/market-fit-panel";
import { ProductDeepDive } from "@/components/product-deep-dive";
import { BuyerSimulation } from "@/components/buyer-simulation";
import { UnlockedBadge } from "@/components/upgrade-gate";
import { DecisionStrip, WinnerBadge, WinnerScorePanel } from "@/components/winner-score-panel";
import { countryName } from "@/lib/countries";
import { logoForStore } from "@/lib/platform-logos";
import { checkConsistency, buyersPer1000, conversionTone, type Issue } from "@/lib/consistency";
import { councilAgentSummary, hybridBadge } from "@/lib/consensus-types";
import type { WinningProduct } from "@/lib/gemini.functions";
import { enrichProduct, recommendationStyle, reliabilityStyle } from "@/lib/recommendation";
import { useMoney } from "@/lib/currency";
import { netMarginView } from "../utils/export";
import { resolveProductImage, useRealProductImage } from "../utils/product-image";

function DollarGap({ p }: { p: WinningProduct }) {
  const { money } = useMoney();
  const re = p.real_economics;
  const cb = p.cost_breakdown;
  const supplier = re ? re.supplier : Number(String(cb?.supplier_cost ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const shipping = re ? re.shipping : Number(String(cb?.shipping_cost ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const ad = re ? re.cac : Number(String(cb?.ad_spend ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const netPerUnit = re ? re.net_per_unit : Number(String(cb?.net_profit ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const breakeven =
    p.unit_economics?.breakeven_units ??
    (netPerUnit > 0 ? Math.ceil((supplier + shipping) / Math.max(0.1, netPerUnit)) : 0);
  const invest = supplier + shipping + ad;
  if (!cb && !re) return null;
  return (
    <div className="mt-3 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] to-sky-500/[0.06] px-3 py-2.5 text-[11px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-300 font-semibold mb-1.5">
        <DollarSign size={11} /> Dollar gap — ne koyar, ne kazanırsın
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Koyarsın</div>
          <div className="text-xs font-bold text-foreground mt-0.5">{money(invest, { showUsd: false })}</div>
          <div className="text-[9px] text-muted-foreground">tedarik+kargo+reklam</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2">
          <div className="text-[9px] uppercase text-emerald-300/80">Kazanırsın</div>
          <div className="text-xs font-bold text-emerald-300 mt-0.5">{money(netPerUnit, { showUsd: false })} / adet</div>
          <div className="text-[9px] text-muted-foreground">
            net marj %{re?.net_margin_pct ?? cb?.net_margin_pct ?? p.profit_margin_pct ?? 0}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2">
          <div className="text-[9px] uppercase text-muted-foreground">Başabaş</div>
          <div className="text-xs font-bold text-foreground mt-0.5">{breakeven ? breakeven + " adet" : "—"}</div>
          <div className="text-[9px] text-muted-foreground">
            {re ? re.monthly.units + " adet/ay ölçek" : "ilk siparişler"}
          </div>
        </div>
      </div>
      {re && (
        <div className="mt-1.5 text-[10px] text-muted-foreground text-center">
          Gerçekçi aylık net:{" "}
          <b className="text-emerald-300">
            {money(re.monthly.low_usd, { compact: true, showUsd: false })} –{" "}
            {money(re.monthly.high_usd, { compact: true, showUsd: false })}
          </b>{" "}
          · {re.context.country_label} · {re.context.category}
        </div>
      )}
    </div>
  );
}

function SevenDayPlan({ p }: { p: WinningProduct }) {
  const roadmap = p.launch_roadmap ?? [];
  const days: { day: string; title: string; actions: string[]; kpi: string; budget: string }[] = [];
  if (roadmap.length) {
    let d = 1;
    for (const ph of roadmap) {
      const acts = (ph.actions ?? []).slice(0, 3);
      if (!acts.length) continue;
      const label = ph.phase || "Aşama " + (days.length + 1);
      days.push({
        day: "Gün " + d + (acts.length > 1 ? "–" + (d + acts.length - 1) : ""),
        title: label,
        actions: acts,
        kpi: ph.kpi ?? "—",
        budget: ph.budget_usd ?? "—",
      });
      d += acts.length;
      if (days.length >= 4 || d > 7) break;
    }
  }
  if (!days.length) {
    const avgBudget = p.real_economics?.monthly.ad_budget_usd ? "$" + Math.round(p.real_economics.monthly.ad_budget_usd / 4) : "$20";
    days.push(
      {
        day: "Gün 1–2",
        title: "Kreatif hazırlık",
        actions: ["3 UGC varyasyonu çek (hook A/B/C)", "Ürün sayfasını kur + Trust badge ekle"],
        kpi: "3 kreatif hazır",
        budget: avgBudget,
      },
      {
        day: "Gün 3–4",
        title: "Test yayını",
        actions: ["Meta Advantage+ — 3 ad set x " + avgBudget, "Öldürme kuralı: CTR <%1 ise kapat"],
        kpi: "CTR ≥%1, CPC < $1.2",
        budget: avgBudget,
      },
      {
        day: "Gün 5–7",
        title: "Ölçek sinyali",
        actions: ["Kazanan kreatif %20 bütçe artışı", "Yeni açı: yorum şikayetini çözen bundle"],
        kpi: "ROAS ≥2.2",
        budget: avgBudget,
      },
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-indigo-500/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-300 font-semibold mb-2">
        <CalendarDays size={11} /> 7 günlük test planı — ilk hafta ne yaparsın
      </div>
      <div className="space-y-1.5">
        {days.slice(0, 3).map((d, i) => (
          <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">
                {d.day} · {d.title}
              </span>
              <span className="text-[10px] rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-muted-foreground">
                {d.budget}
              </span>
            </div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground list-disc pl-4">
              {d.actions.slice(0, 2).map((a, j) => (
                <li key={j}>{a}</li>
              ))}
            </ul>
            <div className="mt-1 text-[10px] text-violet-300/90">Hedef: {d.kpi}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? "text-emerald-400" : value >= 60 ? "text-amber-400" : value >= 40 ? "text-blue-400" : "text-muted-foreground";
  const glow = value >= 80 ? "shadow-[0_0_8px_-2px_oklch(0.75_0.18_155/0.4)]" : "";
  return (
    <div className={`rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-center transition-all ${glow}`}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xs font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function MetricPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border px-1.5 py-1 text-center ${highlight ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300" : "bg-white/[0.04] border-white/10"}`}
    >
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[11px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ConversionBlock({ p }: { p: WinningProduct }) {
  const { value, estimated } = buyersPer1000(p);
  const tone = conversionTone(value);
  const f = p.conversion?.funnel;
  const pct = Math.min(100, (value / 60) * 100);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-[radial-gradient(120%_120%_at_0%_0%,oklch(0.68_0.20_265/0.16),transparent_60%)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1">
          <Target size={11} /> Buyers per 1,000 viewers
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tone.cls}`}>{tone.label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-black tracking-tight text-aurora leading-none">{value}</span>
        <span className="text-xs text-muted-foreground mb-1">/ 1,000 people</span>
        <span className="ml-auto text-xs font-semibold text-foreground/80 mb-1">{(value / 10).toFixed(1)}% CVR</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {f && (
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
          {[
            ["Views", 1000],
            ["Cart", f.add_to_cart],
            ["Checkout", f.checkout_started],
            ["Buy", f.purchases],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-md bg-white/[0.04] border border-white/10 py-1">
              <div className="text-muted-foreground">{l}</div>
              <div className="font-semibold text-[11px]">{Number(v).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
        {estimated ? "Estimated from category conversion benchmarks (price, trend and competition adjusted)." : p.conversion?.reasoning}
      </p>
      {!estimated && p.conversion?.benchmark && (
        <p className="mt-1 text-[10px] text-muted-foreground/70">Benchmark: {p.conversion.benchmark}</p>
      )}
    </div>
  );
}

function ConsistencyBadge({ p }: { p: WinningProduct }) {
  const [open, setOpen] = useState(false);
  const report = checkConsistency(p);
  const clean = report.issues.length === 0;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] transition ${
          clean ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {clean ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
          {clean ? `Consistency verified · ${report.checked} checks` : `${report.issues.length} consistency warning${report.issues.length > 1 ? "s" : ""}`}
        </span>
        <span className="font-semibold">{report.score}/100</span>
      </button>
      {open && !clean && (
        <ul className="mt-1.5 space-y-1">
          {report.issues.map((i: Issue, idx: number) => (
            <li key={idx} className="text-[11px] text-muted-foreground rounded-md bg-white/[0.03] border border-white/10 px-2 py-1.5">
              <span className={i.level === "error" ? "text-rose-300" : "text-amber-300"}>[{i.field}]</span> {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProductCard({
  p,
  saved,
  onSave,
  onSeo,
  onCreative,
  onReport,
  onOpen: onOpenRaw,
  locked = false,
  onUpgrade = () => {},
  selected = false,
  onToggleSelect,
}: {
  p: WinningProduct;
  saved: boolean;
  onSave: () => void;
  onSeo: (name: string) => void;
  onCreative: (name: string) => void;
  onReport: () => void;
  onOpen: () => void;
  locked?: boolean;
  onUpgrade?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const onOpen = () => (locked ? onUpgrade() : onOpenRaw());

  const compColor = p.competition_level === "Low" ? "text-emerald-400" : p.competition_level === "Medium" ? "text-amber-400" : "text-rose-400";
  const cb = p.cost_breakdown;
  const enriched = enrichProduct(p);
  const { money, currency } = useMoney();
  const rec = recommendationStyle(enriched.recommendation);
  const realImg = useRealProductImage(p.name);
  const modelImg = resolveProductImage(p);
  const isTopWinner = (p.winner_score ?? 0) >= 75;
  const isElite = (p.winner_score ?? 0) >= 85;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <article
      className={`premium-card grain card-lift rounded-xl p-3 sm:p-5 hover:-translate-y-1 border flex flex-col animate-rise-in relative transition-all duration-300 ${
        isElite
          ? "border-amber-400/50 shadow-[0_0_30px_-5px_oklch(0.82_0.18_85/0.45),0_20px_60px_-20px_oklch(0.68_0.20_265/0.55)]"
          : isTopWinner
            ? "border-[oklch(0.62_0.17_255)]/50 shadow-[0_0_20px_-5px_oklch(0.68_0.20_265/0.35),0_20px_60px_-20px_oklch(0.68_0.20_265/0.45)]"
            : selected
              ? "border-[oklch(0.62_0.17_255)]/70 shadow-[0_0_0_1px_oklch(0.68_0.20_265/0.5)]"
              : "border-transparent hover:border-[oklch(0.62_0.17_255)]/30"
      }`}
    >
      {onToggleSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-pressed={selected}
          title={selected ? "Karşılaştırmadan çıkar" : "Karşılaştırmaya ekle"}
          className={`absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold backdrop-blur transition ${
            selected ? "border-[oklch(0.62_0.17_255)]/70 bg-[oklch(0.62_0.17_255)]/30 text-white" : "border-white/20 bg-black/40 text-white/80 hover:bg-black/60"
          }`}
        >
          <Columns3 size={11} /> {selected ? "Seçildi" : "Karşılaştır"}
        </button>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className="mb-3 -mx-3 -mt-3 sm:-mx-5 sm:-mt-5 aspect-[16/10] sm:aspect-[4/3] overflow-hidden rounded-t-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border-b border-white/10 relative group cursor-pointer"
      >
        {realImg || modelImg ? (
          <img
            src={realImg || modelImg!}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 animate-in fade-in duration-700"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-5xl opacity-60 animate-pulse-soft">{p.emoji || "🛍️"}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        {isElite && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
            👑 ELITE
          </div>
        )}
        {isTopWinner && !isElite && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/20 px-2 py-0.5 text-[10px] font-bold text-blue-300 backdrop-blur-sm">
            ⚡ WINNER
          </div>
        )}
      </div>

      <div className="flex items-start justify-between mb-2">
        <div className="text-3xl">{p.emoji || "🛍️"}</div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {p.hybrid && (
            <>
              <span
                className="text-[10px] font-semibold px-2 py-1 rounded-full border border-white/15 bg-white/5"
                title={`Hedef pazar: ${countryName(p.hybrid.target_country)} · Tahmini teslimat ${p.hybrid.estimated_shipping_days} gün`}
              >
                <CountryFlag code={p.hybrid.target_country} size={10} /> {p.hybrid.target_country}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${hybridBadge(p.hybrid.calculated_score).cls}`}
                title={p.hybrid.tooltip || `Pazar ${p.hybrid.ai_1_score} · Lojistik ${p.hybrid.ai_2_score}`}
              >
                {hybridBadge(p.hybrid.calculated_score).label} · {p.hybrid.calculated_score}
              </span>
            </>
          )}
          <ConsensusBadge consensus={p.consensus} />
          <RealismBadge score={p.realism_score} />
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${rec.cls}`} title="AI recommendation">
            {rec.emoji} {enriched.recommendation}
          </span>
          <button
            onClick={onSave}
            disabled={saved}
            title={saved ? "Saved" : "Save to Library"}
            className={`p-1.5 rounded-full border transition ${saved ? "border-rose-400/40 bg-rose-400/10 text-rose-300" : "border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground"}`}
          >
            <Heart size={13} className={saved ? "fill-current" : ""} />
          </button>
        </div>
      </div>
      <h3 className="font-bold text-lg leading-tight">{p.name}</h3>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <WinnerBadge score={p.winner_score} level={p.evidence_level} />
      </div>
      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
      <div className="mt-2">
        <DecisionStrip
          winner_score={p.winner_score}
          evidence_level={p.evidence_level}
          verdict={p.score_breakdown?.verdict}
          net_margin_pct={p.cost_breakdown?.net_margin_pct ?? p.real_economics?.net_margin_pct ?? p.profit_margin_pct}
          ad_budget_usd={p.real_economics?.monthly.ad_budget_usd}
        />
      </div>
      <WinnerScorePanel breakdown={p.score_breakdown} />
      <MarketFitPanel verdict={p.market_verdict} />

      {p.hybrid && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span>
              Pazar talebi <b className="text-foreground">{p.hybrid.ai_1_score}</b> (%55)
            </span>
            <span>
              Kâr & lojistik <b className="text-foreground">{p.hybrid.ai_2_score}</b> (%45)
            </span>
            <span>
              Rekabet <b className="text-foreground">{p.hybrid.local_competition_level}</b>
            </span>
            <span>
              <Truck size={11} className="inline -mt-0.5" /> ~{p.hybrid.estimated_shipping_days} gün
            </span>
          </div>
          {p.hybrid.tooltip && <p className="text-muted-foreground">{p.hybrid.tooltip}</p>}
          {p.hybrid.alt_country_code && (
            <p className="text-amber-300">
              <CountryFlag code={p.hybrid.alt_country_code} size={10} /> Bu ürün {p.hybrid.alt_country_name ?? countryName(p.hybrid.alt_country_code)}{" "}
              pazarında daha güçlü.
              {p.hybrid.alt_country_note ? ` ${p.hybrid.alt_country_note}` : ""}
            </p>
          )}
        </div>
      )}
      <MarketEvidencePanel ev={p.market_evidence} />

      {typeof p.unified_score === "number" && p.unified_score > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-[11px]">
          <span className="font-semibold">🤝 Ortak Karar Puanı</span>
          <span
            className="text-muted-foreground"
            title="Analiz hattı puanı ile 14 ajanlı AI Konsey puanı eşit ortaklıkla birleşir. Karne yoksa yalnızca analiz hattı kararı geçerlidir."
          >
            {(() => {
              const analysis = p.hybrid?.calculated_score ?? p.consensus?.average_score;
              const council = p.council?.velora_score;
              return council ? (
                <>
                  (Analiz {analysis ?? "—"} ⊕ Konsey {council}) ={" "}
                  <b className="text-foreground">{p.unified_score}/100</b>
                </>
              ) : (
                <>
                  (yalnızca analiz hattı) ={" "}
                  <b className="text-foreground">{p.unified_score}/100</b>
                </>
              );
            })()}
          </span>
        </div>
      )}

      {p.council && (
        <div className="mt-3 rounded-lg border border-[oklch(0.62_0.17_255)]/30 bg-[oklch(0.62_0.17_255)]/[0.07] px-3 py-2 text-[11px] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">🧠 14&apos;lü AI Konsey</span>
            <span className="font-extrabold text-foreground">Aroless Score {p.council.velora_score}/100</span>
          </div>
          <div className="text-muted-foreground">{p.council.verdict}</div>
          <div className="flex flex-wrap gap-1.5">
            {p.council.teams.map((t) => (
              <span
                key={t.team}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
                title={`${t.engine}${t.reviewer_engine ? ` + hakem ${t.reviewer_engine}` : ""} — ${t.summary}${t.review_note ? ` | Hakem: ${t.review_note}` : ""}`}
              >
                {t.title}: <b>{t.score}</b>
                {typeof t.review_score === "number" && <span className="text-muted-foreground"> (hakem {t.review_score})</span>}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {/* Etiket depth alanına DEĞİL, fiili çıktıya bakar: hakem notu olan
                ekip sayısı + denetçi puanı. Böylece 14 ajan koştuysa "14 ajan"
                yazar, bütçe bir aşamayı atladıysa kaç ajanın koştuğunu dürüstçe
                söyler (eskiden hep "6 uzman ekip" yazıyordu). */}
            <span
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5"
              title={`Konsey 14 üyeden oluşur: 6 ekip + 6 hakem + Müdür + Denetçi. Müdür motoru: ${p.council.director_engine}`}
            >
              {councilAgentSummary(p.council).label}
            </span>
            {(p.council.skipped_stages?.length ?? 0) > 0 && (
              <span
                className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200"
                title={p.council.skipped_stages?.join(" · ")}
              >
                Atlanan aşama: {p.council.skipped_stages?.length}
              </span>
            )}
            {typeof p.council.auditor_score === "number" && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5" title={p.council.auditor_note ?? ""}>
                Denetçi {p.council.auditor_engine ?? "AI"}: <b className="text-foreground">{p.council.auditor_score}</b>
              </span>
            )}
            {typeof p.council.confidence === "number" && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">Güven %{p.council.confidence}</span>
            )}
            {typeof p.council.disagreement === "number" && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">Fikir ayrılığı {p.council.disagreement}</span>
            )}
            {typeof p.council.data_coverage === "number" && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">Veri %{p.council.data_coverage}</span>
            )}
          </div>
          {p.council.action_plan.length > 0 && (
            <ul className="text-muted-foreground space-y-0.5">
              {p.council.action_plan.slice(0, 3).map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          )}
          {p.council.risks.length > 0 && <div className="text-amber-300">⚠ {p.council.risks[0]}</div>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <ScorePill label="AI" value={enriched.ai_score} />
        <ScorePill label="Opp" value={enriched.opportunity_score} />
        <ScorePill label="Trend" value={enriched.trend_score} />
        <ScorePill label="Conf" value={enriched.confidence_score} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <MetricPill label="Sales/mo" value={enriched.est_monthly_sales.toLocaleString()} />
        <MetricPill label="Revenue" value={money(enriched.est_monthly_revenue_usd, { compact: true, showUsd: false })} />
        <MetricPill label="Net/mo" value={money(enriched.est_monthly_net_profit_usd, { compact: true, showUsd: false })} highlight />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 border border-white/10 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Supplier</div>
          <div className="text-xs font-semibold mt-0.5">{money(p.supplier_price_usd, { showUsd: false })}</div>
          {currency !== "USD" && <div className="text-[9px] text-muted-foreground">{p.supplier_price_usd}</div>}
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Sell</div>
          <div className="text-xs font-semibold mt-0.5">{money(p.selling_price_usd, { showUsd: false })}</div>
          {currency !== "USD" && <div className="text-[9px] text-muted-foreground">{p.selling_price_usd}</div>}
        </div>
        {(() => {
          const nm = netMarginView(p);
          return (
            <div
              className={`rounded-lg border p-2 ${nm.bad ? "bg-destructive/15 border-destructive/40" : "bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/20"}`}
            >
              <div className={`text-[10px] uppercase ${nm.bad ? "text-destructive" : "text-emerald-300/80"}`}>Margin</div>
              <div className={`text-xs font-semibold mt-0.5 flex items-center justify-center gap-0.5 ${nm.bad ? "text-destructive" : "text-emerald-300"}`}>
                {!nm.bad && <Percent size={10} />}
                {nm.text}
              </div>
            </div>
          );
        })()}
      </div>

      <DollarGap p={p} />
      <div className="mt-3 flex items-center justify-center">
        {locked ? (
          <button
            onClick={onUpgrade}
            className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300"
          >
            <Lock size={10} /> Sadece abonelik alanlara özel
          </button>
        ) : (
          <UnlockedBadge />
        )}
      </div>

      {cb && (
        <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/10 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
            <Receipt size={11} /> Net profit calculator
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <Package size={10} /> Supplier{" "}
              <ProofBadge kind={p.market_evidence?.supplier_source === "aliexpress" ? "Canlı veri" : "AI tahmini"} />
            </span>
            <span className="text-right flex items-center justify-end gap-1">{money(cb.supplier_cost, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Truck size={10} /> Shipping <ProofBadge kind="Hesaplanmış" />
            </span>
            <span className="text-right flex items-center justify-end gap-1">{money(cb.shipping_cost, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Store size={10} /> Platform fee <ProofBadge kind="Hesaplanmış" />
            </span>
            <span className="text-right flex items-center justify-end gap-1">{money(cb.platform_fee, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Megaphone size={10} /> Ad spend <ProofBadge kind="Hesaplanmış" />
            </span>
            <span className="text-right flex items-center justify-end gap-1">{money(cb.ad_spend, { showUsd: false })}</span>
            <span className="font-semibold text-emerald-300 flex items-center gap-1 pt-1 border-t border-white/10 mt-1">
              <DollarSign size={10} /> Net / unit
            </span>
            <span className="text-right font-semibold text-emerald-300 pt-1 border-t border-white/10 mt-1">
              {money(cb.net_profit, { showUsd: false })} ({cb.net_margin_pct}%)
            </span>
          </div>
          {p.real_economics && (
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[10px] text-muted-foreground">
              <div className="text-foreground/90">
                Gerçekçi aylık net kâr:{" "}
                <b className="text-emerald-300">
                  {money(enriched.monthly_net_low_usd, { compact: true, showUsd: false })} –{" "}
                  {money(enriched.monthly_net_high_usd, { compact: true, showUsd: false })}
                </b>{" "}
                ({p.real_economics.monthly.units} adet/ay · ${p.real_economics.monthly.ad_budget_usd} reklam)
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px]">
                  Ülke: {p.real_economics.context.country_label}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px]">
                  Sektör: {p.real_economics.context.category}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px]">
                  Kanal: {p.real_economics.context.platform}
                </span>
              </div>
              <ul className="list-disc space-y-0.5 pl-3.5">
                {p.real_economics.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              {p.real_economics.benchmarks?.length > 0 && (
                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-[10px] font-semibold text-foreground/80">
                    Kullanılan gerçek dünya verileri & kaynaklar ({p.real_economics.benchmarks.length})
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {p.real_economics.benchmarks.map((b) => (
                      <div key={`${b.scope}-${b.label}`} className="rounded-md border border-white/10 bg-white/[0.03] p-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-full border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                            {b.scope}
                          </span>
                          <span className="text-[10px] font-semibold text-foreground/90">{b.value}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-foreground/80">{b.label}</div>
                        <div className="text-[10px] text-muted-foreground">{b.basis}</div>
                        <a
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[oklch(0.68_0.15_255)] hover:underline"
                        >
                          {b.source} ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <SevenDayPlan p={p} />
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((v) => !v)}
        className="card-detail-toggle mt-3 w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-3 text-xs font-semibold text-foreground transition hover:bg-white/10"
      >
        {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {detailsOpen ? "Analiz detaylarını gizle" : "Tam analizi göster — AI gerekçesi, konsey ve kanıt"}
      </button>

      <div className={`card-detail-fold ${detailsOpen ? "is-open" : ""}`}>
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex gap-2">
            <Sparkles size={14} className="text-[oklch(0.68_0.15_255)] shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{p.why_winning}</span>
          </div>
          <div className="flex gap-2">
            <Users size={14} className="text-[oklch(0.68_0.15_255)] shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{p.target_audience}</span>
          </div>
          <div className="flex gap-2">
            <DollarSign size={14} className="text-[oklch(0.68_0.15_255)] shrink-0 mt-0.5" />
            <span className={compColor}>{p.competition_level} competition</span>
          </div>
          {p.platform_strategy && (
            <div className="flex gap-2">
              <Store size={14} className="text-[oklch(0.68_0.15_255)] shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{p.platform_strategy}</span>
            </div>
          )}
        </div>

        {(p.health_score !== undefined || p.sellability_verdict || p.viral_probability_90d !== undefined) && (
          <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/10 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Activity size={11} /> Reliability
            </div>
            <div className="space-y-2">
              {p.sellability_verdict && (
                <div className="flex items-center justify-between text-xs">
                  <span>Verdict</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${reliabilityStyle(p.sellability_verdict).cls}`}>
                    {reliabilityStyle(p.sellability_verdict).icon} {p.sellability_verdict}
                  </span>
                </div>
              )}
              {p.health_score !== undefined && <ScoreBar label="Health" value={p.health_score} color="oklch(0.62 0.17 255)" />}
              {p.viral_probability_90d !== undefined && (
                <ScoreBar label="Viral Potential" value={p.viral_probability_90d} color="oklch(0.75 0.18 200)" />
              )}
              {p.data_sources && p.data_sources.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {p.data_sources.slice(0, 3).map((s, i) => (
                    <span key={i} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <ConversionBlock p={p} />
        <ConsistencyBadge p={p} />

        {p.ai_insight && (
          <div className="mt-3 rounded-lg border border-[oklch(0.62_0.17_255)]/30 bg-gradient-to-br from-[oklch(0.62_0.17_255)]/10 to-[oklch(0.52_0.15_262)]/5 p-3">
            <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[oklch(0.78_0.13_255)] mb-1">
              <Sparkles size={11} /> AI Insight
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed">{p.ai_insight}</p>
          </div>
        )}

        {p.sales_tactic && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-3">
            <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-300 mb-1">
              <Megaphone size={11} /> AI Sales Tactic
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">{p.sales_tactic}</p>
          </div>
        )}

        {p.platform_difficulty && p.platform_difficulty.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Store size={11} /> Platform Difficulty
            </div>
            <div className="space-y-1.5">
              {p.platform_difficulty.map((pd, i) => {
                const cls =
                  pd.difficulty === "Easy"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : pd.difficulty === "Hard"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-300";
                return (
                  <div key={i} className="flex items-start gap-2 text-xs bg-white/[0.03] border border-white/10 rounded px-2 py-1.5">
                    <img
                      src={logoForStore(pd.platform)}
                      alt=""
                      loading="lazy"
                      className="h-5 w-5 rounded bg-white/90 p-0.5 object-contain shrink-0"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{pd.platform}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>{pd.difficulty}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{pd.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {p.competitor_prices && p.competitor_prices.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <DollarSign size={11} /> Price Comparison
            </div>
            <div className="space-y-1">
              {p.competitor_prices.map((cp, i) => {
                const inner = (
                  <>
                    <img
                      src={logoForStore(cp.store)}
                      alt=""
                      loading="lazy"
                      className="h-5 w-5 rounded bg-white/90 p-0.5 object-contain shrink-0"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                    <span className="flex-1 truncate">
                      {cp.store}
                      {cp.note ? <span className="text-[10px] text-muted-foreground ml-1">({cp.note})</span> : null}
                    </span>
                    <span className="font-semibold tabular-nums">{cp.price}</span>
                    {cp.url && <ExternalLink size={10} className="text-muted-foreground" />}
                  </>
                );
                const cls = "flex items-center gap-2 text-xs bg-white/[0.03] border border-white/10 rounded px-2 py-1.5 hover:bg-white/[0.06] transition";
                return cp.url ? (
                  <a key={i} href={cp.url} target="_blank" rel="noreferrer" className={cls}>
                    {inner}
                  </a>
                ) : (
                  <div key={i} className={cls}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {p.ad_angles?.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              <Megaphone size={11} /> Ad angles
            </div>
            <ul className="space-y-1">
              {p.ad_angles.slice(0, 3).map((a, i) => (
                <li key={i} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {p.supplier_links?.map((u, i) => (
            <a
              key={`al-${i}`}
              href={u}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1"
            >
              <ExternalLink size={10} /> AliExpress
            </a>
          ))}
          {p.alibaba_links?.map((u, i) => (
            <a
              key={`ab-${i}`}
              href={u}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 px-2.5 py-1"
            >
              <ExternalLink size={10} /> Alibaba
            </a>
          ))}
        </div>

        <ProductDeepDive p={p} />
        <BuyerSimulation p={p} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => (locked ? onUpgrade() : onSeo(p.name))}
          className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          {locked ? <Lock size={12} className="text-amber-300" /> : <Wand2 size={12} />} SEO Kit{" "}
          {locked && <span className="text-amber-300">· Kilitli</span>}
        </button>
        <button
          onClick={() => (locked ? onUpgrade() : onCreative(p.name))}
          className="rounded-lg border border-white/10 bg-gradient-to-r from-[oklch(0.62_0.17_255)]/20 to-[oklch(0.52_0.15_262)]/20 hover:from-[oklch(0.62_0.17_255)]/35 hover:to-[oklch(0.52_0.15_262)]/35 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          {locked ? <Lock size={12} className="text-amber-300" /> : <Film size={12} />} Reels Script{" "}
          {locked && <span className="text-amber-300">· Kilitli</span>}
        </button>
      </div>
      <button
        onClick={onOpen}
        className="mt-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-2 text-xs font-semibold text-white w-full flex items-center justify-center gap-1.5"
      >
        {locked ? <Lock size={12} /> : <Radar size={12} />} Derinlemesine Analiz {locked && "· Kilitli"}
      </button>
      <button
        onClick={() => (locked ? onUpgrade() : onReport())}
        className="mt-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 w-full"
      >
        {locked ? <Lock size={12} className="text-amber-300" /> : <FileText size={12} />} View Full Report{" "}
        {locked && <span className="text-amber-300">· Kilitli</span>}
      </button>
    </article>
  );
}
