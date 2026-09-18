import { useMoney } from "@/lib/currency";

export function FxBadge() {
  const { currency, rate, isLive, updated, fmt } = useMoney();
  if (currency === "USD") return null;
  return (
    <span
      title={`1 USD = ${rate.toFixed(2)} ${currency} · ${isLive ? `canlı kur (${updated})` : "yedek kur"}`}
      className="morph-pill heartbeat hidden md:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"} animate-pulse-soft`} />
      {currency} · {fmt(rate, currency)}/$
    </span>
  );
}
