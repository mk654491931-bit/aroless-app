import { memo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Bell, Sparkles } from "lucide-react";
import { CreditRing } from "@/components/dashboard/dashboard-primitives";
import { PANEL_ENTER, PANEL_SURFACE } from "@/components/dashboard/dashboard-tokens";
import { LanguageSwitcher } from "@/components/language-switcher";

// ============================================================================
// Dashboard hero.
//
// Replaces the generic PageHero on this route only. The old header showed the
// title, a notification bell and a back link; the credit balance was buried in
// a chart legend further down the page, which is the first thing a user
// actually wants after logging in.
// ============================================================================

const LOW_CREDIT_THRESHOLD = 3;

const TIER_STYLES: Record<string, string> = {
  free: "border-slate-700 bg-slate-800/70 text-slate-300",
  starter: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  pro: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  business: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

export const DashboardHero = memo(function DashboardHero({
  title,
  tier,
  credits,
  spent,
  unreadCount,
  loadingProfile,
}: {
  title: string;
  tier: string;
  credits: number;
  spent: number;
  unreadCount: number;
  loadingProfile: boolean;
}) {
  const tierKey = String(tier || "Free").toLowerCase();
  const tierClass = TIER_STYLES[tierKey] ?? TIER_STYLES.free;
  const lowCredits = !loadingProfile && credits <= LOW_CREDIT_THRESHOLD;

  return (
    <section className={`${PANEL_SURFACE} ${PANEL_ENTER} overflow-hidden`}>
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-400" />
            <h1 className="truncate text-xl font-bold text-slate-100">{title}</h1>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tierClass}`}
            >
              {tier || "Free"}
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-slate-400">
            Analizleriniz, kayıtlı ürünleriniz ve kredi kullanımınızın canlı özeti.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <HeaderLink to="/notifications" label="Bildirimler">
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </HeaderLink>
            <HeaderLink to="/" label="Geri">
              <ArrowLeft size={14} /> Back
            </HeaderLink>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <CreditRing remaining={credits} spent={spent} />
          <div className="text-xs text-slate-500">
            <p>
              Harcanan: <span className="tabular-nums text-slate-300">{spent}</span>
            </p>
            <Link
              to="/pricing"
              className="mt-1 inline-block font-medium text-indigo-400 transition-colors hover:text-indigo-300"
            >
              Kredi yükselt
            </Link>
          </div>
        </div>
      </div>

      {lowCredits && (
        <Link
          to="/pricing"
          className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/10 px-6 py-3 text-xs text-amber-300 transition-colors hover:bg-amber-500/15"
        >
          <AlertTriangle size={14} className="shrink-0" />
          Krediniz azaldı ({credits} kaldı). Analizlere kesintisiz devam etmek için planınızı
          yükseltin.
        </Link>
      )}
    </section>
  );
});

function HeaderLink({
  to,
  label,
  children,
}: {
  to: "/" | "/notifications";
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
    >
      {children}
    </Link>
  );
}
