import {
  Trophy,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingBag,
  Star,
  AlertTriangle,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { SIM_LENGTH, type SandboxState, roiPct } from "@/lib/sandbox-engine";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function PostRunAnalytics({
  state,
  onRestart,
}: {
  state: SandboxState;
  onRestart: () => void;
}) {
  const days = state.history.length;
  const roi = roiPct(state);
  const totalAd = state.history.reduce((a, d) => a + d.adSpend, 0);
  const totalRefunds = state.history.reduce((a, d) => a + d.refunds, 0);
  const totalFees = state.history.reduce((a, d) => a + d.fees, 0);
  const roas = totalAd > 0 ? state.totalRevenue / totalAd : 0;
  const avgOrder = state.totalOrders > 0 ? state.totalRevenue / state.totalOrders : 0;
  const avgCvr = days > 0 ? state.history.reduce((a, d) => a + d.cvr, 0) / days : 0;
  const bestDay = state.history.reduce<null | (typeof state.history)[number]>(
    (b, d) => (!b || d.profit > b.profit ? d : b),
    null,
  );
  const worstDay = state.history.reduce<null | (typeof state.history)[number]>(
    (w, d) => (!w || d.profit < w.profit ? d : w),
    null,
  );
  const profitDays = state.history.filter((d) => d.profit > 0).length;
  const grade = computeGrade(roi, state.rating, roas);
  const wins = buildWins(state, roas);
  const misses = buildMisses(state, roas, avgCvr);

  const maxAbs = Math.max(1, ...state.history.map((d) => Math.abs(d.profit)));
  const maxCap = Math.max(state.startingCapital, ...state.history.map((d) => d.capital));

  return (
    <div className="space-y-5">
      {/* Grade hero */}
      <div
        className={`glass rounded-2xl p-6 md:p-8 relative overflow-hidden border-2 ${grade.borderCls}`}
      >
        <div
          className={`absolute -top-24 -right-16 w-72 h-72 rounded-full ${grade.glowCls} blur-3xl`}
        />
        <div className="relative flex flex-wrap items-center gap-6">
          <div
            className={`w-28 h-28 rounded-2xl grid place-items-center ${grade.bgCls} border ${grade.borderCls}`}
          >
            <div className={`text-6xl font-black ${grade.textCls}`}>{grade.letter}</div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 mb-2">
              <Trophy size={12} /> Run report · Day {Math.min(state.day - 1, SIM_LENGTH)} /{" "}
              {SIM_LENGTH}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold">
              {state.status === "bankrupt" ? "Insolvent — study the drills below." : grade.headline}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{grade.subline}</p>
          </div>
          <button
            onClick={onRestart}
            className="rounded-xl px-5 py-3 text-sm font-bold bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow flex items-center gap-2"
          >
            <RotateCcw size={15} /> New run
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi icon={DollarSign} label="Revenue" value={money(state.totalRevenue)} />
        <Kpi
          icon={roi >= 0 ? TrendingUp : TrendingDown}
          label="Net profit"
          value={money(state.totalProfit)}
          tone={state.totalProfit >= 0 ? "good" : "bad"}
          sub={`${roi}% ROI`}
        />
        <Kpi
          icon={ShoppingBag}
          label="Orders"
          value={String(state.totalOrders)}
          sub={`AOV ${money(avgOrder)}`}
        />
        <Kpi
          icon={TrendingUp}
          label="ROAS"
          value={`${roas.toFixed(2)}x`}
          tone={roas >= 2.5 ? "good" : roas >= 1.5 ? undefined : "bad"}
        />
        <Kpi
          icon={Star}
          label="Store rating"
          value={`${state.rating.toFixed(0)}/100`}
          tone={state.rating >= 80 ? "good" : state.rating >= 55 ? undefined : "bad"}
        />
        <Kpi
          icon={TrendingUp}
          label="Avg CVR"
          value={`${avgCvr.toFixed(1)}%`}
          sub={`${profitDays}/${days} profit days`}
        />
      </div>

      {/* Spend breakdown */}
      <div className="glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3">Where the money went</h3>
        <StackedBar
          rows={[
            { label: "Ad spend", value: totalAd, color: "oklch(0.68 0.20 265)" },
            { label: "Platform fees", value: totalFees, color: "oklch(0.75 0.18 200)" },
            { label: "Refunds", value: totalRefunds, color: "oklch(0.7 0.20 20)" },
            {
              label: "Net kept",
              value: Math.max(0, state.totalProfit),
              color: "oklch(0.75 0.18 150)",
            },
          ]}
        />
      </div>

      {/* Day-by-day P&L */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Day-by-day P&L</h3>
          <div className="flex gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Profit
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              Loss
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[oklch(0.75_0.18_265)]" />
              Capital
            </span>
          </div>
        </div>
        <div className="relative h-40">
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/10" />
          <div className="flex items-stretch justify-between gap-[2px] h-full">
            {state.history.map((d) => {
              const h = Math.max(2, (Math.abs(d.profit) / maxAbs) * 48);
              const capPct = (d.capital / maxCap) * 100;
              return (
                <div key={d.day} className="flex-1 flex flex-col justify-center relative group">
                  <div className="absolute inset-0 flex flex-col justify-center">
                    <div className="w-full h-1/2 flex items-end justify-center">
                      {d.profit >= 0 && (
                        <div
                          className="w-full bg-emerald-400/80 rounded-t-sm"
                          style={{ height: `${h}%` }}
                        />
                      )}
                    </div>
                    <div className="w-full h-1/2 flex items-start justify-center">
                      {d.profit < 0 && (
                        <div
                          className="w-full bg-rose-400/80 rounded-b-sm"
                          style={{ height: `${h}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="absolute inset-x-0" style={{ top: `${100 - capPct}%` }}>
                    <div className="w-full h-[2px] bg-[oklch(0.75_0.18_265)]/60" />
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 z-10 text-[10px] whitespace-nowrap bg-black/90 border border-white/10 rounded px-1.5 py-1">
                    D{d.day} · {money(d.profit)} · cap {money(d.capital)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {bestDay && worstDay && (
          <div className="grid md:grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">
                Best day
              </div>
              <div className="text-sm">
                Day {bestDay.day} · <b>{money(bestDay.profit)}</b> · {bestDay.orders} orders · CVR{" "}
                {bestDay.cvr}%
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-rose-300 mb-1">
                Worst day
              </div>
              <div className="text-sm">
                Day {worstDay.day} · <b>{money(worstDay.profit)}</b> · {worstDay.orders} orders ·
                CVR {worstDay.cvr}%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Wins & misses */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-emerald-300" />
            <h3 className="font-bold text-sm">What worked</h3>
          </div>
          {wins.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not many wins this run — the drills below can fix that.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {wins.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-300">✓</span>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-300" />
            <h3 className="font-bold text-sm">What to fix next run</h3>
          </div>
          {misses.length === 0 ? (
            <p className="text-xs text-muted-foreground">Excellent — no obvious mistakes to fix.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {misses.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-300">→</span>
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        <Icon size={12} />
        {label}
      </div>
      <div
        className={`text-lg font-bold ${tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StackedBar({ rows }: { rows: { label: string; value: number; color: string }[] }) {
  const total = Math.max(
    1,
    rows.reduce((a, r) => a + r.value, 0),
  );
  return (
    <>
      <div className="h-4 rounded-full overflow-hidden flex bg-white/5 border border-white/10">
        {rows.map((r) => (
          <div
            key={r.label}
            style={{ width: `${(r.value / total) * 100}%`, background: r.color }}
            title={`${r.label} ${money(r.value)}`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg bg-white/5 border border-white/10 p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </div>
            <div className="text-sm font-semibold mt-0.5">{money(r.value)}</div>
            <div className="text-[10px] text-muted-foreground">
              {Math.round((r.value / total) * 100)}%
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function computeGrade(roi: number, rating: number, roas: number) {
  const score = roi * 0.6 + (rating - 60) * 0.4 + (roas - 1) * 15;
  if (score >= 60)
    return {
      letter: "S",
      headline: "Legendary run.",
      subline: "You'd close funding on these numbers.",
      textCls: "text-amber-300",
      bgCls: "bg-amber-500/15",
      borderCls: "border-amber-500/40",
      glowCls: "bg-amber-500/25",
    };
  if (score >= 35)
    return {
      letter: "A",
      headline: "Strong operator.",
      subline: "Healthy margins, controlled spend, happy customers.",
      textCls: "text-emerald-300",
      bgCls: "bg-emerald-500/15",
      borderCls: "border-emerald-500/40",
      glowCls: "bg-emerald-500/25",
    };
  if (score >= 15)
    return {
      letter: "B",
      headline: "Solid learner.",
      subline: "Profitable overall but room to tighten fundamentals.",
      textCls: "text-[oklch(0.75_0.18_265)]",
      bgCls: "bg-[oklch(0.68_0.20_265)]/15",
      borderCls: "border-[oklch(0.68_0.20_265)]/40",
      glowCls: "bg-[oklch(0.68_0.20_265)]/25",
    };
  if (score >= -10)
    return {
      letter: "C",
      headline: "Break-even territory.",
      subline: "You survived. Fix the leaks below before next launch.",
      textCls: "text-amber-200",
      bgCls: "bg-white/5",
      borderCls: "border-white/15",
      glowCls: "bg-white/5",
    };
  return {
    letter: "D",
    headline: "Loss run.",
    subline: "Study the misses — most first launches fail here.",
    textCls: "text-rose-300",
    bgCls: "bg-rose-500/15",
    borderCls: "border-rose-500/40",
    glowCls: "bg-rose-500/20",
  };
}

function buildWins(s: SandboxState, roas: number): string[] {
  const out: string[] = [];
  if (roas >= 2.5) out.push(`ROAS ${roas.toFixed(2)}x — ad efficiency in the top tier.`);
  if (s.rating >= 85)
    out.push(`Store rating held at ${s.rating.toFixed(0)}/100 — customers trusted the brand.`);
  if (s.badges.length > 0)
    out.push(
      `Unlocked ${s.badges.length} achievement${s.badges.length === 1 ? "" : "s"}: ${s.badges.join(", ")}.`,
    );
  const profitStreak = maxStreak(s.history.map((d) => d.profit > 0));
  if (profitStreak >= 5) out.push(`Chained ${profitStreak} profitable days in a row.`);
  if (s.crisesResolved >= 2)
    out.push(`Handled ${s.crisesResolved} crisis events without going under.`);
  if (s.totalProfit > s.startingCapital) out.push(`Made more profit than your starting capital.`);
  return out;
}

function buildMisses(s: SandboxState, roas: number, avgCvr: number): string[] {
  const out: string[] = [];
  if (roas > 0 && roas < 1.5)
    out.push(
      `ROAS ${roas.toFixed(2)}x — cut broad audiences, double-down on the winning creative.`,
    );
  if (avgCvr < 1.2)
    out.push(
      `Avg CVR ${avgCvr.toFixed(1)}% — landing page trust signals and price framing need work.`,
    );
  if (s.rating < 65)
    out.push(
      `Rating dropped to ${s.rating.toFixed(0)}/100 — faster shipping or better QA next time.`,
    );
  const stockouts = s.products.reduce((a, p) => a + p.stockouts, 0);
  if (stockouts > 2)
    out.push(`${stockouts} stockouts — hold at least 10 days of forecast inventory.`);
  if (s.status === "bankrupt")
    out.push("You ran out of capital — protect runway with a hard daily ad-spend cap.");
  const heaviestLoss = Math.min(0, ...s.history.map((d) => d.profit));
  if (heaviestLoss < -s.startingCapital * 0.15)
    out.push(
      `One day lost ${Math.round(-heaviestLoss).toLocaleString()} — never let a single day burn >10% of capital.`,
    );
  return out;
}

function maxStreak(arr: boolean[]): number {
  let best = 0,
    cur = 0;
  for (const v of arr) {
    if (v) {
      cur++;
      best = Math.max(best, cur);
    } else cur = 0;
  }
  return best;
}
