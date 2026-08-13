import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Bell, Check, Loader2, Settings, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationRow,
} from "@/lib/notifications.functions";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/notifications")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Notifications — Velora" },
      { name: "description", content: "Your notifications and alert preferences." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: NotificationsPage,
});

const TYPE_LABELS: Record<string, string> = {
  low_credit: "Low Credit",
  payment_success: "Payment",
  trend_alert: "Trend Alert",
};

function NotificationsPage() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const prefsFn = useServerFn(getNotificationPreferences);
  const updatePrefsFn = useServerFn(updateNotificationPreferences);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const notifQ = useQuery({ queryKey: ["notifications", user?.id], queryFn: () => listFn(), enabled: !!user });
  const prefsQ = useQuery({ queryKey: ["notification-preferences", user?.id], queryFn: () => prefsFn(), enabled: !!user });

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const notifications: NotificationRow[] = (notifQ.data as NotificationRow[] | undefined) ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;
  const prefs = prefsQ.data as { low_credit: boolean; trend_alert: boolean; payment_success: boolean; marketing: boolean } | undefined;

  const handleMarkRead = async (id: string) => {
    await markFn({ data: { id } });
    queryClient.invalidateQueries({ queryKey: ["notifications", user.id] });
  };

  const handleMarkAll = async () => {
    await markAllFn({ data: {} });
    queryClient.invalidateQueries({ queryKey: ["notifications", user.id] });
  };

  const togglePref = async (key: "low_credit" | "trend_alert" | "payment_success" | "marketing") => {
    const current = prefs?.[key] ?? true;
    await updatePrefsFn({ data: { [key]: !current } });
    queryClient.invalidateQueries({ queryKey: ["notification-preferences", user.id] });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="font-bold">Notifications</div>
          </div>
          <Link to="/dashboard" className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5">
            <ArrowLeft size={14} /> Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Settings size={16} />
              <h2 className="font-semibold">Preferences</h2>
            </div>
          </div>
          <div className="space-y-4">
            <PrefRow label="Low credit alerts" checked={prefs?.low_credit ?? true} onToggle={() => togglePref("low_credit")} />
            <PrefRow label="Trend alerts" checked={prefs?.trend_alert ?? true} onToggle={() => togglePref("trend_alert")} />
            <PrefRow label="Payment confirmations" checked={prefs?.payment_success ?? true} onToggle={() => togglePref("payment_success")} />
            <PrefRow label="Marketing updates" checked={prefs?.marketing ?? false} onToggle={() => togglePref("marketing")} />
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell size={16} />
              <h2 className="font-semibold">Inbox</h2>
              {unreadCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">{unreadCount} unread</span>}
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAll} className="text-xs flex items-center gap-1.5 text-[oklch(0.85_0.15_265)] hover:underline">
                <Check size={14} /> Mark all read
              </button>
            )}
          </div>

          {notifQ.isLoading && <div className="text-sm text-muted-foreground py-6 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
          {!notifQ.isLoading && notifications.length === 0 && <div className="text-sm text-muted-foreground py-6">No notifications yet.</div>}

          <ul className="divide-y divide-white/5">
            {notifications.map((n) => (
              <li key={n.id} className={`py-3 flex items-start justify-between gap-3 ${n.read ? "opacity-60" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">{TYPE_LABELS[n.type] || n.type}</span>
                    <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                  </div>
                  <div className="font-medium text-sm mt-1">{n.title}</div>
                  {n.body && <div className="text-sm text-muted-foreground mt-0.5">{n.body}</div>}
                </div>
                {!n.read && (
                  <button onClick={() => handleMarkRead(n.id)} className="text-xs rounded-lg bg-white/5 border border-white/10 px-2 py-1 hover:bg-white/10 flex items-center gap-1 shrink-0">
                    <Check size={12} /> Read
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

function PrefRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onToggle} />
    </div>
  );
}
