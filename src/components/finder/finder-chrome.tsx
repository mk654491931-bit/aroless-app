import { memo, useEffect, useRef, useState } from "react";
import { useMoney } from "@/lib/currency";

const SLOGANS = [
  "Real data in. Winning products out.",
  "Stop guessing. Start sourcing.",
  "Every number verified on the live web.",
  "From trend signal to first sale.",
];

export const FxBadge = memo(function FxBadge() {
  const { currency, rate, isLive, updated, fmt } = useMoney();
  if (currency === "USD") return null;
  return (
    <span
      title={`1 USD = ${rate.toFixed(2)} ${currency} · ${isLive ? `canlı kur (${updated})` : "yedek kur"}`}
      className="morph-pill heartbeat hidden md:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"} animate-pulse-soft`}
      />
      {currency} · {fmt(rate, currency)}/$
    </span>
  );
});

export type FinderTabDef<T extends string> = {
  id: T;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

export const TabSwitcher = memo(function TabSwitcher<T extends string>({
  tabDefs,
  tab,
  onTab,
  favoritesCount,
}: {
  tabDefs: FinderTabDef<T>[];
  tab: T;
  onTab: (tab: T) => void;
  favoritesCount: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const el = btnRefs.current[tab];
      if (!wrap || !el) return;
      const w = wrap.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (b.left < w.left || b.right > w.right) {
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
      window.setTimeout(() => {
        const w2 = wrapRef.current;
        const el2 = btnRefs.current[tab];
        if (!w2 || !el2) return;
        const wr = w2.getBoundingClientRect();
        const br = el2.getBoundingClientRect();
        setPill({ left: br.left - wr.left, width: br.width, top: br.top - wr.top, height: br.height });
      }, 80);
      setPill({ left: b.left - w.left, width: b.width, top: b.top - w.top, height: b.height });
    };
    measure();
    const id = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
    };
  }, [tab, favoritesCount]);

  return (
    <div className="tab-switch relative mx-auto mb-6 w-full max-w-4xl">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-20 w-6 bg-gradient-to-r from-[oklch(0.14_0.03_265)] to-transparent md:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-20 w-6 bg-gradient-to-l from-[oklch(0.14_0.03_265)] to-transparent md:hidden"
      />
      <div
        ref={wrapRef}
        className="tab-switch-track premium-card relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1 text-sm md:flex-wrap md:justify-center md:overflow-visible"
      >
        {pill && (
          <span
            aria-hidden
            className="mercury-pill"
            style={{ left: pill.left, width: pill.width, top: pill.top, height: pill.height }}
          />
        )}
        {tabDefs.map((td) => {
          const Icon = td.icon;
          const on = tab === td.id;
          return (
            <button
              key={td.id}
              ref={(el) => {
                btnRefs.current[td.id] = el;
              }}
              role="tab"
              aria-selected={on}
              onClick={() => onTab(td.id)}
              className={`relative z-10 shrink-0 px-3 md:px-4 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap transition-colors duration-300 ${on ? "text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon size={14} /> {td.label}
              {td.id === "library" && favoritesCount > 0 && (
                <span className="ml-1 text-[10px] rounded-full bg-white/15 px-1.5 py-0.5">
                  {favoritesCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export const RotatingSlogan = memo(function RotatingSlogan() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((value) => (value + 1) % SLOGANS.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-6 flex justify-center">
      <div className="premium-card rounded-full px-5 py-2 h-10 flex items-center gap-2 overflow-hidden">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[oklch(0.66_0.15_255)] animate-pulse-soft" />
        <span
          key={index}
          className="text-sm font-semibold text-foreground/90 animate-rise-in whitespace-nowrap"
        >
          {SLOGANS[index]}
        </span>
      </div>
    </div>
  );
});
