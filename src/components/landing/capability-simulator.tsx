import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  GitBranch,
  Loader2,
  Play,
  Rocket,
  Sparkles,
} from "lucide-react";

type VerticalId = "consumer-tech" | "health-wellness" | "fashion-apparel";

type Vertical = {
  id: VerticalId;
  label: string;
  tagline: string;
  roi: string;
  commission: string;
  gmv: string;
  hooks: string[];
  pairs: Array<{ merchant: string; creator: string; score: string; width: string }>;
};

const STAGES = [
  "Data Ingestion",
  "Trend Scan",
  "Merchant Match",
  "Content Orchestration",
  "Payout & Attribution",
];

const VERTICALS: Vertical[] = [
  {
    id: "consumer-tech",
    label: "Consumer Tech",
    tagline: "Dropshipping-adjacent gadgets · creator-led launches",
    roi: "+312%",
    commission: "$24.8k",
    gmv: "$348k",
    hooks: [
      "Hook A · “This $12 gadget replaced 3 products in my setup.”",
      "Hook B · “Creators sold 18k units off one 22-second demo.”",
      "Hook C · “We run the affiliate loop so you don't have to.”",
    ],
    pairs: [
      { merchant: "NeonDesk", creator: "TechWraps (1.2M)", score: "0.94", width: "w-[94%]" },
      { merchant: "AeroCharge", creator: "GadgetDaily (860k)", score: "0.87", width: "w-[87%]" },
      { merchant: "PulseAudio", creator: "StudioSound (410k)", score: "0.81", width: "w-[81%]" },
    ],
  },
  {
    id: "health-wellness",
    label: "Health & Wellness",
    tagline: "Recurring consumables · compliance-aware content",
    roi: "+268%",
    commission: "$18.1k",
    gmv: "$276k",
    hooks: [
      "Hook A · “Daily protocol, backed by a compliant claims engine.”",
      "Hook B · “Matched to nutrition creators with engaged, verified audiences.”",
      "Hook C · “Subscription payload scheduled before the trend plateaus.”",
    ],
    pairs: [
      { merchant: "VitaCore", creator: "MindfulFuel (980k)", score: "0.91", width: "w-[91%]" },
      { merchant: "ZenSleep", creator: "RestReset (640k)", score: "0.84", width: "w-[84%]" },
      { merchant: "FlexFit", creator: "MoveDaily (520k)", score: "0.78", width: "w-[78%]" },
    ],
  },
  {
    id: "fashion-apparel",
    label: "Fashion & Apparel",
    tagline: "Seasonal drops · region-aware fit & sizing signals",
    roi: "+241%",
    commission: "$21.3k",
    gmv: "$302k",
    hooks: [
      "Hook A · “One drop, three markets, zero localization guesswork.”",
      "Hook B · “Styling creators pre-matched to your size curve.”",
      "Hook C · “Returns-signal guardrail blocked a costly misfire.”",
    ],
    pairs: [
      { merchant: "AuraWear", creator: "StudioMode (1.1M)", score: "0.89", width: "w-[89%]" },
      { merchant: "NoirLinen", creator: "Atelier Edit (780k)", score: "0.83", width: "w-[83%]" },
      { merchant: "KnitLab", creator: "LayeredLife (330k)", score: "0.76", width: "w-[76%]" },
    ],
  },
];

type RunState = "idle" | "running" | "done";

/**
 * Platform Capabilities Simulator — pre-loaded, deterministic local data.
 * Running it activates the agent pipeline visually for ~1.2s, then renders the
 * simulated output summary. No network, no accounts.
 */
export function CapabilitySimulator(): ReactElement {
  const [activeId, setActiveId] = useState<VerticalId>("consumer-tech");
  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [activeStage, setActiveStage] = useState(-1);
  const timersRef = useRef<number[]>([]);

  const vertical = VERTICALS.find((v) => v.id === activeId) ?? VERTICALS[0]!;

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const runSimulation = () => {
    if (state === "running") return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setState("running");
    setProgress(0);
    setActiveStage(-1);

    const startedAt = performance.now();
    const DURATION = 1200;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const p = Math.min(1, elapsed / DURATION);
      const eased = 1 - Math.pow(1 - p, 2);
      setProgress(eased);
      setActiveStage(Math.min(STAGES.length - 1, Math.floor(eased * STAGES.length)));
      if (p < 1) {
        timersRef.current.push(window.setTimeout(tick, 66));
      } else {
        setState("done");
      }
    };
    timersRef.current.push(window.setTimeout(tick, 66));
  };

  const selectVertical = (id: VerticalId) => {
    setActiveId(id);
    if (state === "done") setState("idle");
  };

  return (
    // No backdrop blur: this panel floats over the animated ambient layers, so a
    // blur would be recomputed every frame. A more opaque surface looks identical.
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/90 shadow-[0_40px_120px_-50px_rgba(16,185,129,0.15)]">
      {/* Header / vertical pills */}
      <div className="border-b border-white/10 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              <Sparkles size={12} /> Platform Capabilities Simulator
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Pick a vertical and run the multi-agent pipeline — everything executes locally.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
            SIMULATION MODE · NO NETWORK
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Industry verticals">
          {VERTICALS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={activeId === v.id}
              onClick={() => selectVertical(v.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                activeId === v.id
                  ? "border-indigo-400/60 bg-indigo-400/15 text-slate-100"
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stage pipeline + trigger */}
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-200">
              Agent pipeline · {vertical.label}
            </p>
            <button
              type="button"
              onClick={runSimulation}
              disabled={state === "running"}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-400 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {state === "running" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} className="fill-current" />
              )}
              {state === "running" ? "Running pipeline…" : "Run Agent Simulation"}
            </button>
          </div>

          {/* Stage bars */}
          <div className="mt-4 space-y-2">
            {STAGES.map((stage, i) => {
              const active = state === "running" && i <= activeStage;
              const done = state === "done";
              const lit = done || (state === "running" && i < activeStage);
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] transition-colors ${
                      done || lit
                        ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
                        : active
                          ? "border-indigo-400/60 bg-indigo-400/15 text-indigo-300"
                          : "border-white/15 bg-white/5 text-slate-500"
                    }`}
                  >
                    {done || lit ? (
                      <CheckCircle2 size={12} />
                    ) : active ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={active || done ? "text-slate-200" : "text-slate-500"}>
                        {stage}
                      </span>
                      {active && (
                        <span className="font-mono text-[10px] text-indigo-300">
                          {Math.round(progress * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-[width] duration-150 ease-linear ${
                          done || lit
                            ? "bg-emerald-400/80"
                            : active
                              ? "progress-stripe bg-indigo-400"
                              : "bg-white/5"
                        }`}
                        style={{
                          width: done || lit ? "100%" : active ? `${progress * 100}%` : "0%",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Output view */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
          {state === "done" ? (
            <div className="console-log-in">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                  <Rocket size={13} /> Simulation complete
                </span>
                <span className="text-[10px] text-slate-500">1.2s · local payload</span>
              </div>

              {/* Projections */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-200/70">
                    Efficiency
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-emerald-300">{vertical.roi}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Commission</p>
                  <p className="mt-1 text-lg font-extrabold text-slate-100">
                    {vertical.commission}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    Projected GMV
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-slate-100">{vertical.gmv}</p>
                </div>
              </div>

              {/* Match graph */}
              <div className="mt-4">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <GitBranch size={13} className="text-indigo-300" /> Merchant ↔ Creator match graph
                </p>
                <div className="mt-2 space-y-2">
                  {vertical.pairs.map((pair) => (
                    <div
                      key={pair.merchant}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-200">
                        {pair.merchant}
                      </span>
                      <span className="flex items-center gap-1 text-indigo-300">
                        <span className="hidden size-1 rounded-full bg-indigo-300 sm:block" />
                        <span className="hidden rounded border border-indigo-400/30 bg-indigo-400/10 px-1 text-[9px] sm:inline">
                          match {pair.score}
                        </span>
                      </span>
                      <ChevronRight size={12} className="shrink-0 text-slate-600" />
                      <span className="min-w-0 flex-1 truncate text-right text-[11px] font-medium text-emerald-200">
                        {pair.creator}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                  <span
                    className={`h-1 rounded-full bg-emerald-400/70 ${vertical.pairs[0]?.width ?? "w-1/2"}`}
                  />
                  <span>match strength</span>
                </div>
              </div>

              {/* Hook briefs */}
              <div className="mt-4">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <CircleDollarSign size={13} className="text-emerald-300" /> Generated campaign
                  hook briefs
                </p>
                <ul className="mt-2 space-y-1.5">
                  {vertical.hooks.map((hook) => (
                    <li
                      key={hook}
                      className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-400"
                    >
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />
                      <span>{hook}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-56 flex-col items-center justify-center text-center">
              <div className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
                <Rocket size={20} className="text-slate-500" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-300">Output view</p>
              <p className="mt-1 max-w-60 text-[11px] leading-relaxed text-slate-500">
                Run the pipeline to see ROI projections, match-graph pairs and generated hook briefs
                for {vertical.label.toLowerCase()} — from a pre-loaded local payload.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
