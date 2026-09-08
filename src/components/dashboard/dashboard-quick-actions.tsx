import { memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Calculator,
  Megaphone,
  Radar,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ACCENT_MAP, PANEL_ENTER, type AccentColor } from "@/components/dashboard/dashboard-tokens";

// ============================================================================
// Quick actions.
//
// The dashboard previously ended every session in a dead end: the only way
// out was the Back link. These are the tools that already exist in the app
// but were reachable only from the landing page.
//
// Only routes that exist today are listed, and none of them take required
// search params, so every link is type-safe against the generated route tree.
// ============================================================================

type QuickAction = {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: AccentColor;
};

const ACTIONS: readonly QuickAction[] = [
  {
    to: "/",
    label: "Ürün Bul",
    hint: "Yeni AI araması başlat",
    icon: Search,
    accent: "indigo",
  },
  {
    to: "/competitor-analysis",
    label: "Rakip Analizi",
    hint: "Pazarı karşılaştır",
    icon: BarChart3,
    accent: "sky",
  },
  {
    to: "/trend-radar",
    label: "Trend Radarı",
    hint: "Yükselen nişleri gör",
    icon: Radar,
    accent: "emerald",
  },
  {
    to: "/council",
    label: "AI Konseyi",
    hint: "Çoklu ajan değerlendirmesi",
    icon: Users,
    accent: "violet",
  },
  {
    to: "/roi",
    label: "ROI Hesabı",
    hint: "Kâr marjını modelle",
    icon: Calculator,
    accent: "amber",
  },
  {
    to: "/viral-ads",
    label: "Viral Reklam",
    hint: "Kreatif fikirleri üret",
    icon: Megaphone,
    accent: "indigo",
  },
] as const;

export const DashboardQuickActions = memo(function DashboardQuickActions() {
  return (
    <section aria-label="Hızlı işlemler">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-slate-500">
        Hızlı işlemler
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ACTIONS.map(({ to, label, hint, icon: Icon, accent }) => {
          const a = ACCENT_MAP[accent];
          return (
            <Link
              key={label}
              to={to}
              title={hint}
              className={`group rounded-2xl border border-slate-800/60 bg-slate-900/70 p-4 shadow-lg shadow-black/30 backdrop-blur-sm transition-transform duration-200 will-change-transform hover:border-indigo-500/40 motion-safe:hover:-translate-y-0.5 ${PANEL_ENTER}`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.bg}`}
              >
                <Icon size={15} className={a.icon} />
              </div>
              <p className="mt-3 truncate text-sm font-semibold text-slate-200 group-hover:text-white">
                {label}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
});
