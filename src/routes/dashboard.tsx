import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, Bookmark, History, TrendingUp, Loader2, Sparkles,
  Bell, Zap, Activity, Package, CreditCard,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { listFavorites, type FavoriteRow } from "@/lib/gemini.functions";
import { listAnalyses, getFullProfile, type AnalysisRow } from "@/lib/analysis.functions";
import { listNotifications, type NotificationRow } from "@/lib/notifications.functions";
import { LanguageSwitcher } from "@/components/language-switcher";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Velora" },
      { name: "description", content: "Your analytics, saved products, and recent product research activity." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DashboardPage,
});

const COLORS = ["oklch(0.68 0.20 265)", "oklch(0.66 0.24 305)", "oklch(0.75 0.18 200)", "oklch(0.78 0.16 90)", "oklch(0.70 0.20 25)"];

function DashboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const favFn = useServerFn(listFavorites);
  const anaFn = useServerFn(listAnalyses);
  const profileFn = useServerFn(getFullProfile);
  const notifFn = useServerFn(listNotifications);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const favQ = useQuery({ queryKey: ["favorites", user?.id], queryFn: () => favFn(), enabled: !!user });
  const anaQ = useQuery({ queryKey: ["analyses", user?.id], queryFn: () => anaFn(), enabled: !!user });
  const profileQ = useQuery({ queryKey: ["profile", user?.id], queryFn: () => profileFn(), enabled: !!user });
  const notifQ = useQuery({ queryKey: ["notifications", user?.id], queryFn: () => notifFn(), enabled: !!user });

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const favorites: FavoriteRow[] = (favQ.data as FavoriteRow[] | undefined) ?? [];
  const analyses: AnalysisRow[] = (anaQ.data as AnalysisRow[] | undefined) ?? [];
  const notifications: NotificationRow[] = (notifQ.data as NotificationRow[] | undefined) ?? [];
  const profile = profileQ.data as { credits: number; credits_spent: number; subscription_tier: string } | undefined;

  const credits = profile?.credits ?? 0;
  const spent = profile?.credits_spent ?? 0;

  // by collection
  const collectionCounts: Record<string, number> = {};
  for (const f of favorites) {
    const c = f.collection_name || "Default";
    collectionCounts[c] = (collectionCounts[c] ?? 0) + 1;
  }
  const collectionData = Object.entries(collectionCounts).map(([name, value]) => ({ name, value }));

  // analyses over last 14 days
  const days: { date: string; count: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    days.push({ date: label, count: 0 });
  }
  for (const a of analyses) {
    const d = new Date(a.created_at);
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff >= 0 && diff <= 13) days[13 - diff].count++;
  }

  // top recommendations
  const topNames: Record<string, number> = {};
  for (const a of analyses) {
    const list = (a.results as { name?: string }[]) || [];
    for (const p of list) if (p?.name) topNames[p.name] = (topNames[p.name] ?? 0) + 1;
  }
  const topBar = Object.entries(topNames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, count }));

  // engine performance radar from favorites
  const healthScores: number[] = [];
  const viralScores: number[] = [];
  const trendScores: number[] = [];
  const verdictCounts: Record<string, number> = {};
  for (const f of favorites) {
    const p = f.product;
    if (typeof p.health_score === "number") healthScores.push(p.health_score);
    if (typeof p.viral_probability_90d === "number") viralScores.push(p.viral_probability_90d);
    if (typeof p.trend_score === "number") trendScores.push(p.trend_score);
    const v = p.sellability_verdict || "Unknown";
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
  }
  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const engineRadar = [
    { metric: "Health", score: avg(healthScores) },
    { metric: "Viral", score: avg(viralScores) },
    { metric: "Trend", score: avg(trendScores) },
    { metric: "Confidence", score: favorites.length ? Math.min(100, favorites.length * 10) : 0 },
    { metric: "Diversity", score: collectionData.length ? Math.min(100, collectionData.length * 20) : 0 },
  ];

  const verdictPie = Object.entries(verdictCounts).map(([name, value]) => ({ name, value }));

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="font-bold">{t("dashboard")}</div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/notifications" className="relative text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5">
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] flex items-center justify-center font-semibold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <Link to="/" className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi icon={History} label="Analyses" value={analyses.length} />
          <Kpi icon={Bookmark} label="Saved Items" value={favorites.length} />
          <Kpi icon={TrendingUp} label="Collections" value={collectionData.length || 1} />
          <Kpi icon={CreditCard} label="Credits Left" value={credits} />
        </section>

        <section className="grid lg:grid-cols-3 gap-4">
          <div className="glass rounded-2xl p-5 lg:col-span-2">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Activity size={16} /> Analyses (last 14 days)</h2>
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={days}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.75 0.18 265)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="oklch(0.75 0.18 265)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="oklch(0.72 0.03 260)" fontSize={11} tickLine={false} />
                  <YAxis stroke="oklch(0.72 0.03 260)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="count" stroke="oklch(0.75 0.18 265)" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Zap size={16} /> Credit Balance</h2>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[
                    { name: "Remaining", value: credits },
                    { name: "Spent", value: spent },
                  ]} dataKey="value" nameKey="name" innerRadius={60} outerRadius={80}>
                    <Cell fill="oklch(0.75 0.18 265)" />
                    <Cell fill="oklch(0.70 0.20 25)" />
                  </Pie>
                  <Legend />
                  <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Saved Product Quality Radar</h2>
            <div className="h-64">
              {favorites.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Save products to see AI quality scores.</div>
              ) : (
                <ResponsiveContainer>
                  <RadarChart data={engineRadar}>
                    <PolarGrid stroke="oklch(1 0 0 / 0.1)" />
                    <PolarAngleAxis dataKey="metric" stroke="oklch(0.72 0.03 260)" fontSize={11} />
                    <PolarRadiusAxis stroke="oklch(0.72 0.03 260)" fontSize={10} angle={30} domain={[0, 100]} />
                    <Radar name="Avg Score" dataKey="score" stroke="oklch(0.75 0.18 265)" fill="oklch(0.75 0.18 265)" fillOpacity={0.35} />
                    <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Sellability Verdicts</h2>
            <div className="h-64">
              {verdictPie.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Save products to see verdict distribution.</div>
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={verdictPie} dataKey="value" nameKey="name" outerRadius={80}>
                      {verdictPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-3 gap-4">
          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Saves by Collection</h2>
            <div className="h-56">
              {collectionData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Save a product to see this chart.</div>
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={collectionData} dataKey="value" nameKey="name" outerRadius={80}>
                      {collectionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="glass rounded-2xl p-5 lg:col-span-2">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Package size={16} /> Top AI Recommendations</h2>
            <div className="h-64">
              {topBar.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Run a search to populate this chart.</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={topBar}>
                    <XAxis dataKey="name" stroke="oklch(0.72 0.03 260)" fontSize={10} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis stroke="oklch(0.72 0.03 260)" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "oklch(0.20 0.035 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 8 }} />
                    <Bar dataKey="count" fill="oklch(0.68 0.20 265)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Recent Notifications</h2>
            {notifQ.isLoading && <div className="text-sm text-muted-foreground py-6 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
            {!notifQ.isLoading && notifications.length === 0 && <div className="text-sm text-muted-foreground py-6">No notifications yet.</div>}
            <ul className="divide-y divide-white/5">
              {notifications.slice(0, 5).map((n) => (
                <li key={n.id} className={`py-2.5 flex items-start justify-between gap-3 text-sm ${n.read ? "opacity-60" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-muted-foreground truncate">{n.body}</div>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(n.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            <Link to="/notifications" className="mt-3 inline-block text-xs text-[oklch(0.85_0.15_265)] hover:underline">View all notifications →</Link>
          </div>

          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Recent Queries</h2>
            {anaQ.isLoading && <div className="text-sm text-muted-foreground py-6 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
            {!anaQ.isLoading && analyses.length === 0 && <div className="text-sm text-muted-foreground py-6">No searches yet.</div>}
            <ul className="divide-y divide-white/5">
              {analyses.slice(0, 8).map((a) => (
                <li key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{a.search_query}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 flex items-center justify-center">
          <Icon size={14} className="text-[oklch(0.85_0.15_265)]" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}
