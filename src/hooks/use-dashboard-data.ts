import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFavorites, type FavoriteRow } from "@/lib/gemini.functions";
import { listAnalyses, getFullProfile, type AnalysisRow } from "@/lib/analysis.functions";
import { listNotifications, type NotificationRow } from "@/lib/notifications.functions";
import { buildDashboardMetrics, type DashboardMetrics } from "@/lib/dashboard-metrics";

// ============================================================================
// Dashboard data access.
//
// The route used to own four queries plus ~90 lines of derivation that ran on
// every render -- including renders triggered only by an unrelated query
// resolving. Everything is consolidated here and the derivation is memoized on
// the two arrays it actually depends on.
//
// Query keys are unchanged, so any existing cache entry or invalidation
// elsewhere in the app keeps working.
// ============================================================================

export type DashboardProfile = {
  credits: number;
  credits_spent: number;
  subscription_tier: string;
};

export type DashboardData = {
  favorites: FavoriteRow[];
  analyses: AnalysisRow[];
  notifications: NotificationRow[];
  profile: DashboardProfile | undefined;
  metrics: DashboardMetrics;
  credits: number;
  spent: number;
  tier: string;
  unreadCount: number;
  loading: {
    favorites: boolean;
    analyses: boolean;
    notifications: boolean;
    profile: boolean;
    /** True until the first section has any data to show. */
    initial: boolean;
  };
};

const EMPTY_FAVORITES: FavoriteRow[] = [];
const EMPTY_ANALYSES: AnalysisRow[] = [];
const EMPTY_NOTIFICATIONS: NotificationRow[] = [];

export function useDashboardData(userId: string | undefined): DashboardData {
  const favFn = useServerFn(listFavorites);
  const anaFn = useServerFn(listAnalyses);
  const profileFn = useServerFn(getFullProfile);
  const notifFn = useServerFn(listNotifications);

  const enabled = !!userId;

  const favQ = useQuery({ queryKey: ["favorites", userId], queryFn: () => favFn(), enabled });
  const anaQ = useQuery({ queryKey: ["analyses", userId], queryFn: () => anaFn(), enabled });
  const profileQ = useQuery({ queryKey: ["profile", userId], queryFn: () => profileFn(), enabled });
  const notifQ = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => notifFn(),
    enabled,
  });

  // Stable empty-array identities keep the memo below from invalidating on
  // every render while a query is still pending.
  const favorites = (favQ.data as FavoriteRow[] | undefined) ?? EMPTY_FAVORITES;
  const analyses = (anaQ.data as AnalysisRow[] | undefined) ?? EMPTY_ANALYSES;
  const notifications = (notifQ.data as NotificationRow[] | undefined) ?? EMPTY_NOTIFICATIONS;
  const profile = profileQ.data as DashboardProfile | undefined;

  const metrics = useMemo(
    () => buildDashboardMetrics({ favorites, analyses }),
    [favorites, analyses],
  );

  const unreadCount = useMemo(
    () => notifications.reduce((count, n) => (n.read ? count : count + 1), 0),
    [notifications],
  );

  return {
    favorites,
    analyses,
    notifications,
    profile,
    metrics,
    credits: profile?.credits ?? 0,
    spent: profile?.credits_spent ?? 0,
    tier: profile?.subscription_tier ?? "Free",
    unreadCount,
    loading: {
      favorites: favQ.isLoading,
      analyses: anaQ.isLoading,
      notifications: notifQ.isLoading,
      profile: profileQ.isLoading,
      initial: favQ.isLoading && anaQ.isLoading && profileQ.isLoading,
    },
  };
}
