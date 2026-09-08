import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, CreditCard, History, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import {
  KpiCard,
  PanelSkeleton,
} from "@/components/dashboard/dashboard-primitives";
import {
  ActivityPanel,
  CollectionsPanel,
  CreditPanel,
  QualityRadarPanel,
  TopRecommendationsPanel,
  VerdictPanel,
} from "@/components/dashboard/dashboard-charts";
import {
  NotificationsPanel,
  RecentSearchesPanel,
} from "@/components/dashboard/dashboard-lists";

// ============================================================================
// Dashboard route.
//
// Composition only. Data lives in useDashboardData, derivations in
// src/lib/dashboard-metrics.ts, and rendering in the memoized panels under
// src/components/dashboard/.
//
// Route options, ssr: false, head meta and the auth redirect behaviour are
// unchanged from the previous implementation.
// ============================================================================

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Aroless" },
      {
        name: "description",
        content: "Your analytics, saved products, and recent product research activity.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user)
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
  }, [user, loading, nav]);

  const data = useDashboardData(user?.id);

  // Auth is still resolving, or the redirect above is about to fire. Render the
  // skeleton layout rather than a bare spinner so there is no layout shift when
  // the real content mounts.
  if (loading || !user) return <DashboardSkeleton />;

  const { metrics } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <DashboardHero
          title={t("dashboard")}
          tier={data.tier}
          credits={data.credits}
          spent={data.spent}
          unreadCount={data.unreadCount}
          loadingProfile={data.loading.profile}
        />

        <DashboardQuickActions />

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            icon={History}
            label="Toplam Analiz"
            value={data.analyses.length}
            accent="indigo"
          />
          <KpiCard
            icon={Bookmark}
            label="Kaydedilen"
            value={data.favorites.length}
            accent="emerald"
          />
          <KpiCard
            icon={TrendingUp}
            label="Koleksiyon"
            value={metrics.collectionData.length || 1}
            accent="violet"
          />
          <KpiCard
            icon={CreditCard}
            label="Kalan Kredi"
            value={data.credits}
            accent="amber"
            hint={`${data.spent} harcandı`}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <ActivityPanel data={metrics.activity} className="lg:col-span-2" />
          <CreditPanel remaining={data.credits} spent={data.spent} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <QualityRadarPanel
            data={metrics.engineRadar}
            hasFavorites={data.favorites.length > 0}
          />
          <VerdictPanel data={metrics.verdictPie} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <CollectionsPanel data={metrics.collectionData} />
          <TopRecommendationsPanel
            data={metrics.topRecommendations}
            className="lg:col-span-2"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <NotificationsPanel
            notifications={data.notifications}
            loading={data.loading.notifications}
          />
          <RecentSearchesPanel analyses={data.analyses} loading={data.loading.analyses} />
        </section>
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <PanelSkeleton lines={2} />
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <PanelSkeleton key={i} lines={1} />
          ))}
        </section>
        <section className="grid gap-4 lg:grid-cols-3">
          <PanelSkeleton className="lg:col-span-2" lines={5} />
          <PanelSkeleton lines={5} />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton lines={5} />
          <PanelSkeleton lines={5} />
        </section>
      </main>
    </div>
  );
}
