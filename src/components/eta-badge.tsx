import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Check } from "lucide-react";

/**
 * Glassmorphism ETA badge: counts down while the AI pipeline runs, then morphs
 * into a "Completed in X.Xs" benchmark badge.
 */
export function EtaBadge({ running, etaMs }: { running: boolean; etaMs: number }) {
  const [remaining, setRemaining] = useState(etaMs / 1000);
  const [elapsedDone, setElapsedDone] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      startedAt.current = Date.now();
      setElapsedDone(null);
      setRemaining(etaMs / 1000);
      const id = window.setInterval(() => {
        const left = (etaMs - (Date.now() - (startedAt.current ?? Date.now()))) / 1000;
        setRemaining(Math.max(0.1, left));
      }, 100);
      return () => window.clearInterval(id);
    }
    if (startedAt.current) {
      setElapsedDone((Date.now() - startedAt.current) / 1000);
      startedAt.current = null;
    }
    return;
  }, [running, etaMs]);

  const { t } = useTranslation();
  if (!running && elapsedDone === null) return null;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-xl transition-all duration-500 ${
        running
          ? "border-[var(--brand)]/50 bg-[var(--brand)]/12 text-[var(--brand)] glow"
          : "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
      }`}
    >
      {running ? (
        <>
          <span className="relative flex h-3.5 w-3.5 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-[var(--brand-2)]/70 border-t-transparent animate-spin" />
            <span className="absolute inset-0 rounded-full bg-[var(--brand-2)]/40 animate-ping" />
          </span>
          <Cpu size={11} className="opacity-80" />
          {t("ui.eta_running")} ~{remaining.toFixed(1)}s
        </>
      ) : (
        <>
          <Check size={12} />
          {t("ui.eta_done")} {(elapsedDone ?? 0).toFixed(1)}s
        </>
      )}
    </span>
  );
}
