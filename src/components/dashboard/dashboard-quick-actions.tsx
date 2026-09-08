import { memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Calculator,
  FlaskConical,
  Newspaper,
  Radar,
  Search,
  Users,
} from "lucide-react";
import { PANEL_ENTER, PANEL_SURFACE } from "@/components/dashboard/dashboard-tokens";

// ============================================================================
// Quick actions.
//
// The dashboard previously had no path to any of the product's tools -- a user
// landing here after login could only look at charts or press Back. These tiles
// route to pages that already existed; nothing new is introduced behind them.
// ============================================================================

type QuickAction = {
  to: "/" | "/trend-radar" | "/council" | "/studio" | "/roi" | "/news";
  label: string;
  description: string;
  icon: typeof Search;
  accent: string;
};

const ACTIONS: QuickAction[] = [
  {
    to: "/",
    label: "Ürün Bul",
    description: "AI ile kazanan ürün ara",
    icon: Search,
    accent: "text-indigo-400 bg-indigo-500/10",
  },
  {
    to: "/trend-radar",
    label: "Trend Radar",
    description: "Yükselen nişleri izle",
    icon: Radar,
    accent: "text-sky-400 bg-sky-500/10",
  },
  {
    to: "/council",
    label: "AI Konseyi",
    description: "Çok ajanlı değerlendirme",
    icon: Users,
    accent: "text-violet-400 bg-violet-500/10",
  },
  {
    to: "/studio",
    label: "Stüdyo",
    description: "Kreatif ve reklam üret",
    icon: FlaskConical,
    accent: "text-emerald-400 bg-emerald-500/10",
  },
  {
    to: "/roi",
    label: "ROI Hesabı",
    description: "Kar marjını doğrula",
    icon: Calculator,
    accent: "text-amber-400 bg-amber-500/10",
  },
  {
    to: "/news",
    label: "Pazar Haberleri",
    description: "Günlük sektör özeti",
    icon: Newspaper,
    accent: "text-slate-300 bg-slate-700/40",
  },
];

export const DashboardQuickActions = memo(function DashboardQuickActions() {
  return (
    <section aria-label="Hızlı işlemler" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.to + action.label}
            to={action.to}
            className={`${PANEL_SURFACE} ${PANEL_ENTER} group flex flex-col gap-2 p-4 transition-transform duration-200 will-change-transform hover:border-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 motion-safe:hover:-translate-y-0.5`}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${action.accent}`}
            >
              <Icon size={15} />
            </span>
            <span className="text-xs font-semibold text-slate-200">{action.label}</span>
            <span className="text-[11px] leading-snug text-slate-500">{action.description}</span>
          </Link>
        );
      })}
    </section>
  );
});
