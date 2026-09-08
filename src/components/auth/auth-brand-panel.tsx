import { memo, useEffect, useState } from "react";
import { ArrowRight, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";

// ============================================================================
// Left-hand brand / value panel (desktop only).
//
// Pure presentation, moved out of the route. Same copy, same 3200ms rotation,
// same staggered entrance, same stats.
//
// It owns its own rotation timer now, which means the headline no longer
// re-renders the auth form four times a minute.
// ============================================================================

const ROTATION_INTERVAL_MS = 3200;

const ROTATING = [
  "Find winning products in seconds.",
  "See the market first with the trend radar.",
  "Reverse-engineer viral ads.",
  "Analyze competitor stores in one click.",
];

const PERKS = [
  { icon: TrendingUp, label: "Live trend radar", note: "Data from 20 platforms" },
  { icon: Zap, label: "Hybrid AI scoring", note: "3 models in parallel" },
  { icon: ShieldCheck, label: "Profit simulation", note: "ROI forecasting" },
];

const STATS = [
  { v: "12M+", l: "products scanned" },
  { v: "20", l: "platforms" },
  { v: "<25s", l: "search time" },
];

export const AuthBrandPanel = memo(function AuthBrandPanel() {
  const [rotIndex, setRotIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setRotIndex((index) => (index + 1) % ROTATING.length),
      ROTATION_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="animate-rise-in hidden lg:block">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
        <Sparkles className="h-3.5 w-3.5 animate-pulse-soft" />
        AI-powered product intelligence
      </div>

      <div className="mt-6 flex items-center gap-5">
        <img
          src="/logo-mark.png"
          alt="Aroless"
          className="h-16 w-16 object-contain drop-shadow-[0_6px_28px_color-mix(in_oklab,var(--brand)_50%,transparent)]"
        />
        <h1 className="relative leading-none">
          <span aria-hidden className="velora-halo" />
          <span
            className="relative block text-[52px] font-extralight uppercase tracking-[0.34em]"
            aria-label="Aroless"
          >
            {"AROLESS".split("").map((ch, i) => (
              <span
                key={`${ch}-${i}`}
                aria-hidden
                className="velora-letter velora-shine"
                style={{ animationDelay: `${i * 0.09}s` }}
              >
                {ch}
              </span>
            ))}
          </span>
          <span className="velora-underline mt-3 block w-56" />
          <span className="mt-3 block text-[10px] font-medium uppercase tracking-[0.42em] text-[var(--brand)]">
            AI Commerce OS
          </span>
        </h1>
      </div>

      <div className="mt-4 h-7 overflow-hidden">
        <p key={rotIndex} className="animate-rise-in text-lg text-muted-foreground">
          {ROTATING[rotIndex]}
        </p>
      </div>

      <ul className="mt-9 space-y-3">
        {PERKS.map((p, i) => (
          <li
            key={p.label}
            className="premium-card card-lift group flex items-center gap-4 p-4 hover:-translate-y-0.5"
            style={{
              animation: `rise-in 0.6s cubic-bezier(0.22,1,0.36,1) ${0.1 + i * 0.09}s both`,
            }}
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card/60 text-foreground transition-transform group-hover:scale-110">
              <p.icon className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.note}</span>
            </span>
            <ArrowRight className="h-4 w-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
          </li>
        ))}
      </ul>

      <div className="mt-9 flex items-center gap-6">
        {STATS.map((s) => (
          <div key={s.l}>
            <div className="text-2xl font-bold text-gradient">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
});
