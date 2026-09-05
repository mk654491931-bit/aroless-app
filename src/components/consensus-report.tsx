import {
  ShieldCheck,
  ShieldAlert,
  X,
  TrendingUp,
  Gavel,
  AlertTriangle,
  Percent,
  Swords,
} from "lucide-react";
import type { ConsensusResult } from "@/lib/consensus-types";
import type { ValidationReport } from "@/lib/gemini.functions";
import { AiDisclaimer } from "@/components/ai-disclaimer";

export function ConsensusBadge({
  consensus,
  compact,
}: {
  consensus?: ConsensusResult;
  compact?: boolean;
}) {
  if (!consensus) return null;
  const ok = consensus.approved;
  return (
    <span
      title={`Agent 1: ${consensus.agent1.score} · Agent 2: ${consensus.agent2.score}${consensus.agent4 ? ` · Agent 4: ${consensus.agent4.score}` : ""}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
        ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-rose-400/40 bg-rose-400/10 text-rose-300"
      }`}
    >
      {ok ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
      {compact
        ? consensus.average_score
        : ok
          ? `Multi-Agent Approved · ${consensus.average_score}`
          : `High Risk · ${consensus.average_score}`}
    </span>
  );
}

function AgentCard({
  title,
  role,
  icon,
  verdict,
  accent,
}: {
  title: string;
  role: string;
  icon: React.ReactNode;
  verdict: ConsensusResult["agent1"];
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={accent}>{icon}</span>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{role}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{verdict.score}</div>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
              verdict.decision === "APPROVED"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : "border-rose-400/40 bg-rose-400/10 text-rose-300"
            }`}
          >
            {verdict.decision}
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{verdict.summary}</p>
      {verdict.points.length > 0 && (
        <ul className="mt-2 space-y-1">
          {verdict.points.map((pt, i) => (
            <li key={i} className="text-xs flex gap-2">
              <span className={accent}>•</span>
              <span className="text-muted-foreground">{pt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConsensusPanel({ consensus }: { consensus: ConsensusResult }) {
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <AgentCard
          title="Agent 1 — Product Finder"
          role="Growth angles"
          icon={<TrendingUp size={16} />}
          verdict={consensus.agent1}
          accent="text-[var(--brand)]"
        />
        <AgentCard
          title="Agent 2 — Risk & Audit"
          role="Risk audit"
          icon={<Gavel size={16} />}
          verdict={consensus.agent2}
          accent="text-amber-400"
        />
        {consensus.agent4 && (
          <AgentCard
            title="Agent 4 — Independent Verifier"
            role="Groq cross-check"
            icon={<ShieldCheck size={16} />}
            verdict={consensus.agent4}
            accent="text-emerald-400"
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Percent size={10} /> Est. profit margin
          </div>
          <div className="text-sm font-semibold mt-1">{consensus.profit_margin_pct || "—"}%</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Swords size={10} /> Competition
          </div>
          <div className="text-sm font-semibold mt-1">{consensus.competition_level}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Consensus score
          </div>
          <div className="text-sm font-semibold mt-1">{consensus.average_score}/100</div>
        </div>
      </div>

      {consensus.risk_flags.length > 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-300 mb-2 flex items-center gap-1">
            <AlertTriangle size={11} /> Top risk flags
          </div>
          <ul className="space-y-1">
            {consensus.risk_flags.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-amber-400">•</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ConsensusReportModal({
  report,
  onClose,
}: {
  report: ValidationReport | null;
  onClose: () => void;
}) {
  if (!report) return null;
  const c = report.consensus;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="premium-card grain w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Multi-Agent Consensus Report
            </div>
            <h2 className="text-2xl font-bold mt-1">{report.product_name}</h2>
            {report.market_note && (
              <p className="text-xs text-muted-foreground mt-1">{report.market_note}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${
              c.approved
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                : "border-rose-400/40 bg-rose-400/10 text-rose-300"
            }`}
          >
            {c.approved ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            {c.approved ? "DUAL-APPROVED" : "HIGH RISK / REJECTED"}
          </span>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Average consensus score
            </div>
            <div className="text-2xl font-extrabold">{c.average_score}/100</div>
          </div>
        </div>

        <div className="mt-5">
          <ConsensusPanel consensus={c} />
        </div>
        <AiDisclaimer />
      </div>
    </div>
  );
}
