import { useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronDown, CircleDashed, ExternalLink, ShieldCheck, Sigma, Trophy } from "lucide-react";
import { evidenceLabel, evidenceStyle, type ScoreComponent, type WinnerBreakdown } from "@/lib/winner-score";


const barColor = (v: number) =>
  v >= 75 ? "bg-emerald-400" : v >= 55 ? "bg-[var(--brand,oklch(0.68_0.20_265))]" : v >= 40 ? "bg-amber-400" : "bg-rose-400";

export function WinnerBadge({ score, level }: { score?: number; level?: WinnerBreakdown["evidence_level"] }) {
  if (typeof score !== "number") return null;
  const tone =
    score >= 80
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : score >= 65
        ? "border-[oklch(0.68_0.20_265)]/40 bg-[oklch(0.68_0.20_265)]/10 text-[oklch(0.85_0.15_265)]"
        : score >= 50
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
        <Trophy size={10} /> Winner {score}
      </span>
      {level && (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${evidenceStyle(level)}`}>
          <ShieldCheck size={10} /> {evidenceLabel(level)}
        </span>
      )}
    </span>
  );
}

/** Tek bileşen: puan çubuğu + açılır kanıt tablosu (metrik · değer · kaynak · ağırlık). */
function ComponentRow({ c }: { c: ScoreComponent }) {
  const [open, setOpen] = useState(false);
  const ev = c.evidence ?? [];
  const verified = ev.filter((e) => e.verified).length;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={ev.length === 0 && !c.formula}
        className="w-full text-left disabled:cursor-default"
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {(ev.length > 0 || c.formula) && <ChevronDown size={11} className={`transition ${open ? "rotate-180" : "-rotate-90"}`} />}
            {c.label} <span className="opacity-60">· ağırlık %{Math.round(c.weight * 100)}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            {ev.length > 0 && (
              <span className="text-[9px] text-muted-foreground">
                {verified}/{ev.length} kanıt doğrulandı
              </span>
            )}
            <b className="text-foreground">{c.score}</b>
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${barColor(c.score)}`} style={{ width: `${c.score}%` }} />
        </div>
      </button>

      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{c.reason}</p>

      {open && (
        <div className="mt-2 space-y-1.5">
          {c.formula && (
            <div className="flex items-start gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground">
              <Sigma size={10} className="mt-0.5 shrink-0 text-[oklch(0.78_0.16_265)]" />
              <span>
                <b className="text-foreground">Hesap:</b> {c.formula}
              </span>
            </div>
          )}
          {ev.map((e, i) => (
            <div key={i} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {e.verified ? (
                    <BadgeCheck size={10} className="text-emerald-400" />
                  ) : (
                    <CircleDashed size={10} className="text-amber-400/80" />
                  )}
                  {e.metric}
                </span>
                <b className="shrink-0 text-foreground">{e.value}</b>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                <span className="truncate">
                  Kaynak: {e.source}
                  {e.verified ? "" : " · doğrulanmadı"}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  {typeof e.weight === "number" && <span>katkı %{Math.round(e.weight * 100)}</span>}
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      onClick={(evt) => evt.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[oklch(0.82_0.15_265)] hover:underline"
                    >
                      kanıt <ExternalLink size={9} />
                    </a>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Winner Score kırılımı: her bileşen için puan çubuğu + "neden bu puan". */
export function WinnerScorePanel({ breakdown }: { breakdown?: WinnerBreakdown }) {
  const [open, setOpen] = useState(false);
  if (!breakdown) return null;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[11px] font-semibold text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Trophy size={12} className="text-amber-300" />
          Winner Score {breakdown.winner_score}/100 · {breakdown.verdict}
        </span>
        <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>

      <div className="mt-2 flex gap-1">
        {breakdown.components.map((c) => (
          <div key={c.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" title={`${c.label}: ${c.score}`}>
            <div className={`h-full ${barColor(c.score)}`} style={{ width: `${c.score}%` }} />
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {breakdown.components.map((c) => (
            <ComponentRow key={c.key} c={c} />
          ))}


          {(breakdown.penalties.length > 0 || breakdown.flags.length > 0) && (
            <ul className="mt-2 space-y-1">
              {[...breakdown.penalties, ...breakdown.flags].map((t, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] text-amber-200">
                  <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export type RejectedCandidate = {
  name?: string;
  emoji?: string;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  competition_level?: string;
  rejection_reason: string;
};

/** Şeffaflık: kaliteyi geçemeyen adaylar ve gerekçeleri. */
export function RejectedPanel({ items }: { items: RejectedCandidate[] }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-semibold text-foreground"
      >
        <span>Elenen {items.length} aday ve sebepleri</span>
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-3 space-y-2">
          {items.map((r, i) => (
            <li key={i} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-foreground">
                  {r.emoji ? `${r.emoji} ` : ""}{r.name ?? "Adsız aday"}
                </span>
                {r.selling_price_usd && <span className="text-[10px] text-muted-foreground">{r.selling_price_usd}</span>}
              </div>
              <p className="mt-1 text-[11px] text-rose-300/90">{r.rejection_reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
