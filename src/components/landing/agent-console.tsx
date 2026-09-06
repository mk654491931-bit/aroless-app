import { useEffect, useRef, useState } from "react";
import { Activity, Radio, ShieldCheck, Terminal } from "lucide-react";

type LogKind = "agent" | "success" | "warn" | "info";

type LogLine = {
  text: string;
  kind: LogKind;
  badge: string;
};

const SIMULATION_LOGS: LogLine[] = [
  { badge: "Trend-Scan-01", kind: "agent", text: "Identified viral TikTok item (+420% demand surge)." },
  { badge: "Deal-Engine-04", kind: "agent", text: "Matched merchant deal with 18 tier-1 creators (3.4k projected GMV)." },
  { badge: "Content-Orchestrator", kind: "success", text: "Dispatched 8 automated ad copy variations across channels." },
  { badge: "Attribution-Mesh", kind: "info", text: "Attribution graph updated — 14 conversions re-mapped to top performer." },
  { badge: "Deal-Engine-04", kind: "agent", text: "Negotiated fee override: 12% → 9.4% on recurring subscription tier." },
  { badge: "Payout-Infra", kind: "success", text: "Scheduled 32 creator payouts · compliant, auditable ledger." },
  { badge: "Trend-Scan-01", kind: "warn", text: "Flagged 3 items with anomalous return-rate signals for review." },
  { badge: "Content-Orchestrator", kind: "agent", text: "A/B test launched — 6 hook variants, 2 market segments." },
  { badge: "Attribution-Mesh", kind: "success", text: "ROAS attribution window consolidated across 9 networks." },
  { badge: "Swarm-Orchestrator", kind: "info", text: "Pipeline idle → next scheduled sweep in 4m 12s." },
];

const kindStyles: Record<LogKind, string> = {
  agent: "text-indigo-300 border-indigo-400/30 bg-indigo-400/10",
  success: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  warn: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  info: "text-slate-300 border-white/15 bg-white/5",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Autonomous Operations Console — streams a deterministic, pre-loaded log set
 * locally (setInterval only; zero network). Purely illustrative.
 */
export function AgentConsole() {
  const clock = useClock();
  const tickRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<LogLine[]>(() => SIMULATION_LOGS.slice(0, 4));

  useEffect(() => {
    const id = window.setInterval(() => {
      tickRef.current = (tickRef.current + 1) % SIMULATION_LOGS.length;
      setLines((prev) => {
        const next = [...prev, SIMULATION_LOGS[tickRef.current]!];
        return next.length > 14 ? next.slice(next.length - 14) : next;
      });
    }, 2800);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/80 shadow-[0_30px_90px_-30px_rgba(99,102,241,0.35)] backdrop-blur-xl">
      {/* Top status bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <span className="grid size-6 place-items-center rounded-md bg-indigo-500/15 text-indigo-300">
            <Terminal size={13} />
          </span>
          Autonomous Operations Console
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          SYSTEM OPERATIONAL
        </div>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-white/[0.02] px-4 py-2 text-[10px] tracking-wide text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={11} className="text-emerald-400" /> 99.99% UPTIME
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Activity size={11} className="text-indigo-300" /> 0 LATENCY SPIKES
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-amber-300">
          <Radio size={10} /> SIMULATION MODE
        </span>
      </div>

      {/* Stream */}
      <div ref={scrollRef} className="scroll-thin h-64 space-y-2 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={`${i}-${line.badge}-${line.text.slice(0, 12)}`}
            className="console-log-in flex flex-wrap items-baseline gap-x-2 text-slate-300"
          >
            <span className="shrink-0 text-slate-500">[{clock}]</span>
            <span
              className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${kindStyles[line.kind]}`}
            >
              {line.badge}
            </span>
            <span className="min-w-0 flex-1">{line.text}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-slate-500">
        <span>Deterministic local payload · 2.8s cadence</span>
        <span className="inline-flex items-center gap-1 text-emerald-400/90">
          <span className="size-1 rounded-full bg-emerald-400" /> streaming
        </span>
      </div>
    </div>
  );
}
