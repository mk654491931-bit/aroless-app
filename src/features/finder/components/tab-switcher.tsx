import { useEffect, useRef, useState } from "react";
import type { Tab } from "../constants";

export function TabSwitcher({
  tabDefs,
  tab,
  onTab,
  favoritesCount,
}: {
  tabDefs: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[];
  tab: Tab;
  onTab: (t: Tab) => void;
  favoritesCount: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number; top: number; height: number } | null>(null);

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
                <span className="ml-1 text-[10px] rounded-full bg-white/15 px-1.5 py-0.5">{favoritesCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
