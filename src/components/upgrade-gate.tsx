import type { ReactNode } from "react";
import { Lock, LockOpen, Sparkles } from "lucide-react";

/** Small green pill shown to Starter/Pro/admin users. */
export function UnlockedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ${className}`}
    >
      <LockOpen size={10} /> Unlocked
    </span>
  );
}

/**
 * Wraps premium content. Free (non-admin) users see a blurred preview with a
 * "Locked" overlay; clicking anywhere opens the purchase screen.
 */
export function LockedGate({
  locked,
  onUpgrade,
  label = "Sadece abonelik alanlara özel",
  note = "Starter, Pro ve yönetici hesaplarına özel. Paket almak için dokunun.",
  children,
}: {
  locked: boolean;
  onUpgrade: () => void;
  label?: string;
  note?: string;
  children: ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. ${note}`}
      onClick={onUpgrade}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onUpgrade();
        }
      }}
      className="relative mt-3 cursor-pointer overflow-hidden rounded-xl border border-white/10"
      title="Locked — click to upgrade"
    >
      <div
        aria-hidden
        className="pointer-events-none select-none blur-[6px] opacity-35 max-h-56 overflow-hidden"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-black/50 to-black/75 px-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
          <Lock size={12} /> {label}
        </span>
        <span className="text-[11px] text-white/70">{note}</span>
        <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-3 py-1.5 text-[11px] font-semibold text-white">
          <Sparkles size={11} /> Unlock now
        </span>
      </div>
    </div>
  );
}

/** Full-panel lock used for whole tabs / pages. */
export function LockedPanel({
  onUpgrade,
  title = "Sadece abonelik alanlara özel",
  note = "Bu özellik Starter, Pro ve yönetici hesaplarına özeldir. Paket alarak hemen açabilirsiniz.",
}: {
  onUpgrade: () => void;
  title?: string;
  note?: string;
}) {
  return (
    <div className="glass mx-auto max-w-xl rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10">
        <Lock size={20} className="text-amber-300" />
      </div>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{note}</p>
      <button
        onClick={onUpgrade}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-4 py-2 text-sm font-semibold text-white"
      >
        <Sparkles size={14} /> Unlock now
      </button>
    </div>
  );
}
