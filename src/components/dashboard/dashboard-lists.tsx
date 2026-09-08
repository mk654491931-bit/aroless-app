import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, ChevronRight, History } from "lucide-react";
import type { AnalysisRow } from "@/lib/analysis.functions";
import type { NotificationRow } from "@/lib/notifications.functions";
import {
  EmptyState,
  Panel,
  PanelHeader,
  Skeleton,
} from "@/components/dashboard/dashboard-primitives";

// ============================================================================
// Dashboard lists.
//
// Same data, same limits (5 notifications, 8 searches) and same empty-state
// copy as before. Two changes:
//
// - The loading state was a spinner row that pushed the list down when it
//   disappeared. It is now skeleton rows shaped like the real rows, so the
//   panel height is stable.
// - Unread notifications are marked with a dot as well as opacity, because
//   opacity alone is not an accessible way to convey state.
// ============================================================================

export const NOTIFICATION_LIMIT = 5;
export const RECENT_SEARCH_LIMIT = 8;

const ListSkeleton = memo(function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="mt-3 space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
});

export const NotificationsPanel = memo(function NotificationsPanel({
  notifications,
  loading,
  className,
}: {
  notifications: readonly NotificationRow[];
  loading: boolean;
  className?: string;
}) {
  const visible = notifications.slice(0, NOTIFICATION_LIMIT);

  return (
    <Panel className={className}>
      <PanelHeader icon={<Bell size={15} className="text-slate-400" />} title="Son Bildirimler" />

      {loading ? (
        <ListSkeleton rows={3} />
      ) : visible.length === 0 ? (
        <EmptyState text="Henüz bildirim yok." className="mt-4" />
      ) : (
        <ul className="mt-3 divide-y divide-slate-800/60">
          {visible.map((notification) => (
            <li
              key={notification.id}
              className={`flex items-start justify-between gap-3 py-3 text-sm ${
                notification.read ? "opacity-50" : ""
              }`}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {!notification.read && (
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400"
                    aria-label="Okunmadı"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-200">{notification.title}</p>
                  {notification.body && (
                    <p className="truncate text-xs text-slate-500">{notification.body}</p>
                  )}
                </div>
              </div>
              <span className="whitespace-nowrap text-xs text-slate-600">
                {new Date(notification.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/notifications"
        className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
      >
        Tüm bildirimler <ChevronRight size={12} />
      </Link>
    </Panel>
  );
});

export const RecentSearchesPanel = memo(function RecentSearchesPanel({
  analyses,
  loading,
  className,
}: {
  analyses: readonly AnalysisRow[];
  loading: boolean;
  className?: string;
}) {
  const visible = analyses.slice(0, RECENT_SEARCH_LIMIT);

  return (
    <Panel className={className}>
      <PanelHeader icon={<History size={15} className="text-slate-400" />} title="Son Aramalar" />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState text="Henüz arama yok." className="mt-4" />
      ) : (
        <ul className="mt-3 divide-y divide-slate-800/60">
          {visible.map((analysis) => (
            <li
              key={analysis.id}
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <span className="truncate text-slate-300">{analysis.search_query}</span>
              <span className="whitespace-nowrap text-xs text-slate-600">
                {new Date(analysis.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});
