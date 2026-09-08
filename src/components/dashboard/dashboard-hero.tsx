import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Bell, Sparkles } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PageHero } from "@/components/page-hero";
import { CreditRing, Skeleton } from "@/components/dashboard/dashboard-primitives";

// ============================================================================
// Dashboard hero.
//
// Extracted from the route so the header does not re-render when a chart
// query resolves. Everything the old inline header rendered is kept: the
// PageHero shell, the language switcher, the notification bell with its
// unread badge, and the Back link.
//
// Added: the subscription tier is now visible (it was fetched but never
// shown), the credit balance is readable without decoding a donut legend,
// and a low balance offers the upgrade path instead of silently failing the
// next search.
// ============================================================================

/** At or below this many credits the hero surfaces an upgrade link. */
export const LOW_CREDIT_THRESHOLD = 3;

const TIER_STYLES: Record<string, string> = {
  free: "border-slate-700 bg-slate-800/70 text-slate-300",
  starter: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  pro: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  business: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

function tierStyle(tier: string): string {
  return TIER_STYLES[tier.toLowerCase()] ?? TIER_STYLES.free;
}

const ACTION_CLASS =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-slate-800 hover:text-white";

export type DashboardHeroProps = {
  title: string;
  tier: string;
  credits: number;
  spent: number;
  unreadCount: number;
  loadingProfile: boolean;
};

export const DashboardHero = memo(function DashboardHero({
  title,
  tier,
  credits,
  spent,
  unreadCount,
  loadingProfile,
}: DashboardHeroProps) {
  const lowCredits = !loadingProfile && credits <= LOW_CREDIT_THRESHOLD;

  return (
    <section className="space-y-4">
      <PageHero
        icon={<Sparkles size={18} className="text-indigo-400" />}
        title={title}
        description="Analizleriniz, kayıtlı ürünleriniz ve kredi kullanımınızın canlı özeti."
        actions={
          <>
            <LanguageSwitcher />
            <Link
              to="/notifications"
              aria-label={
                unreadCount > 0 ? `Bildirimler, ${unreadCount} okunmamış` : "Bildirimler"
              }
              className={`relative ${ACTION_CLASS}`}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <Link to="/" className={ACTION_CLASS}>
              <ArrowLeft size={14} /> Back
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-lg shadow-black/30 backdrop-blur-sm">
        {loadingProfile ? (
          <Skeleton className="h-[76px] w-[76px] rounded-full" />
        ) : (
          <CreditRing remaining={credits} spent={spent} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
              Plan
            </span>
            {loadingProfile ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${tierStyle(tier)}`}
              >
                {tier}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {loadingProfile
              ? "Kredi bilgisi yükleniyor…"
              : lowCredits
                ? "Krediniz azaldı. Yeni analizler için planınızı yükseltebilirsiniz."
                : `Bugüne kadar ${spent.toLocaleString()} kredi harcadınız.`}
          </p>
        </div>

        {lowCredits && (
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400"
          >
            Planı yükselt <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    </section>
  );
});
