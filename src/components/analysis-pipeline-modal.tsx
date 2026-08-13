import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Loader2, Cpu, Flame, Users } from "lucide-react";

const COUNCIL_AGENTS = [
  { name: "CFO Agent", task: "Birim ekonomisi, landed cost & 3PL marjları kontrol ediliyor.", base: 88 },
  { name: "CMO Agent", task: "Kitle uyumu & hedef ROAS/CPC simüle ediliyor.", base: 84 },
  { name: "CRO Agent", task: "USPTO veritabanında marka & IP riski taranıyor.", base: 91 },
  { name: "Trend Hunter", task: "Sosyal medya etkileşim & görüntüleme momentumu hesaplanıyor.", base: 87 },
  { name: "Competitor Intel", task: "Aktif Shopify/Amazon mağaza doygunluğu denetleniyor.", base: 79 },
  { name: "UX Specialist", task: "Müşteri yorum duygu skorları analiz ediliyor.", base: 86 },
  { name: "Supply Chain Agent", task: "Tedarikçi stok istikrarı & teslim SLA doğrulanıyor.", base: 83 },
];


/**
 * Live AI analysis pipeline. Steps advance against the engine's ETA so the user
 * always sees what the pipeline is doing right now, plus elapsed time.
 */
export function AnalysisPipelineModal({
  open,
  done,
  etaMs = 6500,
  engine,
}: {
  open: boolean;
  done: boolean;
  etaMs?: number;
  engine?: string;
}) {
  const { t } = useTranslation();
  const steps = [
    t("pipeline.s1"),
    t("pipeline.s2"),
    t("pipeline.s3"),
    t("pipeline.s4"),
    t("pipeline.s5"),
    t("pipeline.s6"),
  ];
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setStepIdx(0);
      setElapsed(0);
      return;
    }
    startedAt.current = Date.now();
    const target = Math.max(2000, etaMs);
    const id = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms / 1000);
      const natural = Math.min(94, (ms / target) * 100);
      const pct = done ? 100 : natural;
      setProgress(pct);
      setStepIdx(Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length)));
      if (done && pct >= 100) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [open, done, etaMs, steps.length]);

  if (!open) return null;

  const remaining = Math.max(0, etaMs / 1000 - elapsed);

  // Council agents advance concurrently with the main pipeline.
  const agentDone = (i: number) => progress >= (i + 1) * (100 / (COUNCIL_AGENTS.length + 0.5));
  const doneCount = COUNCIL_AGENTS.filter((_, i) => agentDone(i)).length;
  const councilScore = Math.round(
    COUNCIL_AGENTS.reduce((sum, a, i) => sum + (agentDone(i) ? a.base : 0), 0) / Math.max(1, doneCount),
  );
  const fingerScore = Math.round(60 + (progress / 100) * 32);
  const finalScore = doneCount ? Math.round(councilScore * 0.7 + fingerScore * 0.3) : 0;
  const winner = finalScore > 85;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="w-full max-w-4xl grid gap-4 md:grid-cols-2">
      <div className="glass rounded-2xl w-full p-6 md:p-7">

        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
            <Sparkles size={18} className="text-white animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{t("pipeline.title")}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 truncate">
              <span>{Math.floor(progress)}%</span>
              <span className="opacity-40">·</span>
              <span>{elapsed.toFixed(1)}s</span>
              <span className="opacity-40">·</span>
              <span>~{remaining.toFixed(1)}s</span>
            </div>
          </div>
          {engine && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.68_0.20_265)]/45 bg-[oklch(0.68_0.20_265)]/12 px-2.5 py-1 text-[10px] font-semibold text-[oklch(0.86_0.10_265)] max-w-[9rem] truncate">
              <Cpu size={10} /> {engine}
            </span>
          )}
        </div>
        <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mb-4 flex items-center gap-2 text-xs text-[oklch(0.88_0.10_265)]">
          <Loader2 size={12} className="animate-spin" />
          <span className="truncate">{steps[stepIdx]}</span>
        </div>
        <ul className="space-y-2.5">
          {steps.map((s, i) => {
            const complete = i < stepIdx || (i === stepIdx && progress >= 100);
            const active = i === stepIdx && !complete;
            return (
              <li key={i} className={`flex items-center gap-2.5 text-sm transition ${complete ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/60"}`}>
                <span className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center border ${complete ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300" : active ? "border-[oklch(0.68_0.20_265)] bg-[oklch(0.68_0.20_265)]/20 animate-pulse-soft" : "border-white/10 bg-white/5"}`}>
                  {complete ? <Check size={11} /> : active ? <Loader2 size={11} className="animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                </span>
                <span>{s}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* RIGHT — 7-Agent AI Council live status (70% weight) */}
      <div className="glass rounded-2xl w-full p-6 md:p-7">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg glow bg-gradient-to-br from-emerald-500 to-[oklch(0.66_0.24_305)] flex items-center justify-center">
            <Users size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-sm">7-Agent AI Council Real-Time Status</div>
            <div className="text-xs text-muted-foreground">
              Ağırlık %70 · {doneCount}/{COUNCIL_AGENTS.length} ajan tamamlandı
            </div>
          </div>
        </div>

        <ul className="space-y-2">
          {COUNCIL_AGENTS.map((a, i) => {
            const complete = agentDone(i);
            const active = !complete && (i === doneCount);
            return (
              <li
                key={a.name}
                className={`rounded-xl border p-2.5 flex items-start gap-2.5 transition ${
                  complete
                    ? "border-emerald-400/40 bg-emerald-500/10"
                    : active
                      ? "border-[oklch(0.68_0.20_265)]/50 bg-[oklch(0.68_0.20_265)]/10 animate-pulse-soft"
                      : "border-white/10 bg-white/5 opacity-60"
                }`}
              >
                <span className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center border border-white/10">
                  {complete ? (
                    <Check size={11} className="text-emerald-300" />
                  ) : active ? (
                    <Loader2 size={11} className="animate-spin text-[oklch(0.86_0.10_265)]" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{a.name}</span>
                    <span className={`text-[10px] font-bold ${complete ? "text-emerald-300" : "text-muted-foreground"}`}>
                      {complete ? `${a.base}/100` : active ? "çalışıyor" : "sırada"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">{a.task}</div>
                </div>
              </li>
            );
          })}
        </ul>

        <div
          className={`mt-4 rounded-xl border p-3 ${
            winner
              ? "border-emerald-400/60 bg-emerald-500/15 shadow-[0_0_28px_-6px_oklch(0.75_0.18_150)]"
              : "border-white/10 bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Final Score = (Council × 0.70) + (Product Finger × 0.30)
            </span>
            <span className={`text-lg font-black ${winner ? "text-emerald-300" : "text-foreground"}`}>
              {finalScore}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">Council {councilScore || 0} · Finger {fingerScore}</span>
            {winner && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">
                <Flame size={11} /> Winner Product
              </span>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

