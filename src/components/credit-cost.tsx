import { Coins, Gamepad2, Gift } from "lucide-react";

type Kind = "credit" | "sim" | "free";

const STYLES: Record<Kind, string> = {
  credit: "border-[oklch(0.85_0.18_90)]/40 bg-[oklch(0.85_0.18_90)]/10 text-[oklch(0.88_0.16_90)]",
  sim: "border-[oklch(0.68_0.20_265)]/40 bg-[oklch(0.68_0.20_265)]/10 text-[oklch(0.86_0.10_265)]",
  free: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

/**
 * Small, always-visible badge that tells the user exactly what an action costs.
 * `kind="free"` marks features that never spend credits (Academy, Quick Drill).
 */
export function CreditCost({
  amount = 1,
  kind = "credit",
  className = "",
  label,
}: {
  amount?: number;
  kind?: Kind;
  className?: string;
  label?: string;
}) {
  const Icon = kind === "free" ? Gift : kind === "sim" ? Gamepad2 : Coins;
  const text =
    label ??
    (kind === "free"
      ? "Dahil · kredi harcamaz"
      : kind === "sim"
        ? `${amount} simülasyon kredisi`
        : `${amount} kredi`);
  return (
    <span
      title={kind === "free" ? "Bu özellik kredi harcamaz" : `Bu işlem ${text} harcar`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STYLES[kind]} ${className}`}
    >
      <Icon size={10} /> {text}
    </span>
  );
}
