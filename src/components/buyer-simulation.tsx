import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Loader2, ThumbsDown, ThumbsUp, Trophy, Users } from "lucide-react";
import { simulateBuyers, type BuyerSimulation } from "@/lib/gemini.functions";
import type { WinningProduct } from "@/lib/gemini.functions";

function Bar({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function BuyerSimulation({ p }: { p: WinningProduct }) {
  const run = useServerFn(simulateBuyers);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState<BuyerSimulation | null>(null);

  const start = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await run({
        data: {
          name: p.name,
          description: p.description ?? "",
          selling_price_usd: p.selling_price_usd ?? "",
          target_audience: p.target_audience ?? "",
          platform: p.platform_fit?.[0] ?? "",
        },
      });
      setSim(res as BuyerSimulation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  // build 100 dots ordered by segment
  const dots: Array<{ buy: boolean; label: string }> = [];
  sim?.segments.forEach((s) => {
    for (let i = 0; i < s.count; i++) dots.push({ buy: i < s.buyers, label: s.label });
  });
  while (sim && dots.length < 100) dots.push({ buy: false, label: "Undecided shopper" });

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Users size={11} /> 100-persona simulation & A/B test
        </span>
        <button
          type="button"
          onClick={start}
          disabled={loading}
          className="rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 px-2.5 py-1 text-[11px] font-semibold inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <FlaskConical size={11} />}
          {loading ? "Simulating…" : sim ? "Re-run" : "Run simulation"}
        </button>
      </div>

      {err && <p className="mt-2 text-[11px] text-rose-300">{err}</p>}

      {sim && (
        <div className="mt-3 space-y-3 text-xs">
          {/* Verdict */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
              <div className="flex items-center gap-1.5 text-emerald-300 text-[10px] uppercase tracking-wider">
                <ThumbsUp size={11} /> Would buy
              </div>
              <div className="text-2xl font-bold text-emerald-200">{sim.buyers}<span className="text-sm font-medium opacity-70">/100</span></div>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5">
              <div className="flex items-center gap-1.5 text-rose-300 text-[10px] uppercase tracking-wider">
                <ThumbsDown size={11} /> Would not buy
              </div>
              <div className="text-2xl font-bold text-rose-200">{sim.non_buyers}<span className="text-sm font-medium opacity-70">/100</span></div>
            </div>
          </div>

          {/* 100 dots */}
          <div className="grid grid-cols-20 gap-1" style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }}>
            {dots.slice(0, 100).map((d, i) => (
              <span
                key={i}
                title={`${d.label} — ${d.buy ? "buys" : "does not buy"}`}
                className={`aspect-square rounded-sm ${d.buy ? "bg-emerald-400" : "bg-white/15"}`}
              />
            ))}
          </div>

          <p className="text-muted-foreground">{sim.summary}</p>
          <p className="text-[11px] text-muted-foreground">Confidence: {sim.confidence_pct}%</p>

          {/* Segments */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Personality segments</div>
            {sim.segments.map((s, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-white/[0.02] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{s.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    <span className="text-emerald-300 font-semibold">{s.buyers}</span>/{s.count} buy
                  </span>
                </div>
                <div className="mt-1"><Bar pct={s.count ? (s.buyers / s.count) * 100 : 0} className="bg-emerald-400/80" /></div>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.profile}</p>
                <p className="text-[11px] text-muted-foreground/80">{s.reason}</p>
              </div>
            ))}
          </div>

          {/* Reasons / objections */}
          {!!sim.top_buy_reasons?.length && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Why they buy</div>
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                {sim.top_buy_reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {!!sim.top_objections?.length && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Top objections</div>
              {sim.top_objections.map((o, i) => (
                <div key={i} className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-amber-200">{o.objection}</span>
                    <span className="text-[11px] text-amber-300/80">{o.share_pct}%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Fix: {o.fix}</p>
                </div>
              ))}
            </div>
          )}

          {/* A/B test */}
          {sim.ab_test?.variants?.length === 2 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">A/B test</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {sim.ab_test.variants.map((v) => {
                  const win = v.id === sim.ab_test.winner;
                  return (
                    <div
                      key={v.id}
                      className={`rounded-lg border p-2.5 ${win ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.02]"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">Variant {v.id}</span>
                        {win && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                            <Trophy size={10} /> Winner
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-semibold">{v.headline}</p>
                      <p className="text-[11px] text-muted-foreground">{v.angle}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{v.creative}</p>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                        <span className="text-muted-foreground">Price</span><span className="text-right font-medium">{v.price_usd}</span>
                        <span className="text-muted-foreground">CVR</span><span className="text-right font-medium">{v.predicted_cvr_pct}%</span>
                        <span className="text-muted-foreground">CTR</span><span className="text-right font-medium">{v.predicted_ctr_pct}%</span>
                        <span className="text-muted-foreground">AOV</span><span className="text-right font-medium">{v.predicted_aov_usd}</span>
                        <span className="text-muted-foreground">Buyers</span><span className="text-right font-medium">{v.buyers_of_100}/100</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Expected lift: <span className="text-emerald-300 font-semibold">+{sim.ab_test.lift_pct}%</span> — {sim.ab_test.significance_note}
              </p>
              <p className="text-[11px] text-muted-foreground">{sim.ab_test.recommended_test_plan}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
