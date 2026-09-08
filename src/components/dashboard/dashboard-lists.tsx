import { memo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronRight, History } from "lucide-react";
import {
  EmptyState,
  Panel,
  PanelHeader,
  Skeleton,
} from "@/components/dashboard/dashboard-primitives";

// ============================================================================
// Notification and recent-search lists.
//
// Behaviour is unchanged except that recent searches are now interactive.
// ============================================================================

export type NotificationItem = {
  id: string | number;
  title: string;
  body?: string | null;
  read?: boolean | null;
  created_at: string;
};

export type SearchItem = {
  id: string | number;
  search_query: string;
  created_at: string;
};

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-4 space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export const NotificationsPanel = memo(function NotificationsPanel({
  notifications,
  loading,
}: {
  notifications: NotificationItem[];
  loading: boolean;
}) {
  return (
    <Panel>
      <PanelHeader icon={<Bell size={15} className="text-slate-400" />} title="Son Bildirimler" />

      {loading && <ListSkeleton />}
      {!loading && notifications.length === 0 && (
        <EmptyState text="Henüz bildirim yok." className="mt-4" />
      )}

      {!loading && notifications.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-800/60">
          {notifications.slice(0, 5).map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-3 py-3 text-sm ${
                n.read ? "opacity-50" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-200">{n.title}</p>
                {n.body && <p className="truncate text-xs text-slate-500">{n.body}</p>}
              </div>
              <span className="whitespace-nowrap text-xs text-slate-600">
                {new Date(n.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/notifications"
        className="mt-4 inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-400 transition hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
      >
        Tüm bildirimler <ChevronRight size={12} />
      </Link>
    </Panel>
  );
});

export const RecentSearchesPanel = memo(function RecentSearchesPanel({
  analyses,
  loading,
}: {
  analyses: SearchItem[];
  loading: boolean;
}) {
  const nav = useNavigate();

  // Navigates to the finder with the query preserved as ?q=. Reading that
  // parameter arrives with the index.tsx decomposition; until then this is a
  // plain route change, which is why it is safe to ship now.
  const openSearch = (query: string) => {
    nav({ to: "/", search: { q: query } as never });
  };

  return (
    <Panel>
      <PanelHeader
        icon={<History size={15} className="text-slate-400" />}
        title="Son Aramalar"
        subtitle={analyses.length > 0 ? "Tekrar açmak için seçin" : undefined}
      />

      {loading && <ListSkeleton rows={6} />}
      {!loading && analyses.length === 0 && (
        <EmptyState text="Henüz arama yok." className="mt-4" />
      )}

      {!loading && analyses.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-800/60">
          {analyses.slice(0, 8).map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => openSearch(a.search_query)}
                className="flex w-full items-center justify-between gap-3 rounded-lg py-2.5 text-left text-sm transition-colors hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
              >
                <span className="truncate text-slate-300">{a.search_query}</span>
                <span className="whitespace-nowrap text-xs text-slate-600">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});
