import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bookmark,
  History,
  TrendingUp,
  Loader2,
  Sparkles,
  Bell,
  Zap,
  Activity,
  Package,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { listFavorites, type FavoriteRow } from "@/lib/gemini.functions";
import { listAnalyses, getFullProfile, type AnalysisRow } from "@/lib/analysis.functions";
import { listNotifications, type NotificationRow } from "@/lib/notifications.functions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PageHero } from "@/components/page-hero";

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

// ─── Design tokens ─────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#6366f1", // indigo-500
  "#818cf8", // indigo-400
  "#34d399", // emerald-400
  "#a78bfa", // violet-400
  "#f59e0b", // amber-400
  "#38bdf8", // sky-400
];

const TOOLTIP_STYLE = {
  background: "#0f172a",
  border: "1px solid rgba(99,102,241,0.25)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e2e8f0",
};

const AXIS_STYLE = { stroke: "#475569", fontSize: 11 };

// ─── Page ───────────────────────────────────────────────────────────────────

function DashboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const favFn = useServerFn(listFavorites);
  const anaFn = useServerFn(listAnalyses);
  const profileFn = useServerFn(getFullProfile);
  const notifFn = useServerFn(listNotifications);

  useEffect(() => {
    if (!loading && !user)
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
  }, [user, loading, nav]);

  const favQ = useQuery({ queryKey: ["favorites", user?.id], queryFn: () => favFn(), enabled: !!user });
  const anaQ = useQuery({ queryKey: ["analyses", user?.id], queryFn: () => anaFn(), enabled: !!user });
  const profileQ = useQuery({ queryKey: ["profile", user?.id], queryFn: () => profileFn(), enabled: !!user });
  const notifQ = useQuery({ queryKey: ["notifications", user?.id], queryFn: () => notifFn(), enabled: !!user });

  if (loading || !user)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-400" size={28} />
      </div>
    );

  const favorites: FavoriteRow[] = (favQ.data as FavoriteRow[] | undefined) ?? [];
  const analyses: AnalysisRow[] = (anaQ.data as AnalysisRow[] | undefined) ?? [];
  const notifications: NotificationRow[] = (notifQ.data as NotificationRow[] | undefined) ?? [];
  const profile = profileQ.data as
    | { credits: number; credits_spent: number; subscription_tier: string }
    | undefined;

  const credits = profile?.credits ?? 0;
  const spent   = profile?.credits_spent ?? 0;

  // By collection
  const collectionCounts: Record<string, number> = {};
  for (const f of favorites) {
    const c = f.collection_name || "Default";
    collectionCounts[c] = (collectionCounts[c] ?? 0) + 1;
  }
  const collectionData = Object.entries(collectionCounts).map(([name, value]) => ({ name, value }));

  // Analyses over last 14 days
  const days: { date: string; count: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push({ date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), count: 0 });
  }
  for (const a of analyses) {
    const diff = Math.floor((now.getTime() - new Date(a.created_at).getTime()) / 86_400_000);
    if (diff >= 0 && diff <= 13) days[13 - diff].count++;
  }

  // Top recommendations
  const topNames: Record<string, number> = {};
  for (const a of analyses) {
    const list = (a.results as { name?: string }[]) || [];
    for (const p of list) if (p?.name) topNames[p.name] = (topNames[p.name] ?? 0) + 1;
  }
  const topBar = Object.entries(topNames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, count }));

  // Engine performance radar
  const healthScores: number[] = [];
  const viralScores:  number[] = [];
  const trendScores:  number[] = [];
  const verdictCounts: Record<string, number> = {};
  for (const f of favorites) {
    const p = f.product;
    if (typeof p.health_score           === "number") healthScores.push(p.health_score);
    if (typeof p.viral_probability_90d  === "number") viralScores.push(p.viral_probability_90d);
    if (typeof p.trend_score            === "number") trendScores.push(p.trend_score);
    const v = p.sellability_verdict || "Unknown";
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
  }
  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const engineRadar = [
    { metric: "Health",     score: avg(healthScores) },
    { metric: "Viral",      score: avg(viralScores) },
    { metric: "Trend",      score: avg(trendScores) },
    { metric: "Confidence", score: favorites.length ? Math.min(100, favorites.length * 10) : 0 },
    { metric: "Diversity",  score: collectionData.length ? Math.min(100, collectionData.length * 20) : 0 },
  ];

  const verdictPie   = Object.entries(verdictCounts).map(([name, value]) => ({ name, value }));
  const unreadCount  = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">

        {/* Header */}
        <PageHero
          icon={<Sparkles size={18} className="text-indigo-400" />}
          title={t("dashboard")}
          description="Analizleriniz, kayıtlı ürünleriniz ve kredi kullanımınızın canlı özeti."
          actions={
            <>
              <LanguageSwitcher />
              <Link
                to="/notifications"
                className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-slate-800 hover:text-white"
              >
                <Bell size={14} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:bg-slate-800 hover:text-white"
              >
                <ArrowLeft size={14} /> Back
              </Link>
            </>
          }
        />

        {/* ―― KPI Cards ――――――――――――――――――――――――――――――――――――――――― */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={History}    label="Toplam Analiz"   value={analyses.length}          accent="indigo" />
          <KpiCard icon={Bookmark}   label="Kaydedilen"      value={favorites.length}          accent="emerald" />
          <KpiCard icon={TrendingUp} label="Koleksiyon"      value={collectionData.length || 1} accent="violet" />
          <KpiCard icon={CreditCard} label="Kalan Kredi"     value={credits}                   accent="amber" />
        </section>

        {/* ―― Row 2: Area + Credit Donut ――――――――――――――――――――――――――― */}
        <section className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader icon={<Activity size={15} className="text-indigo-400" />} title="Analiz Aktivitesi" subtitle="Son 14 gün" />
            <div className="h-52 mt-4">
              <ResponsiveContainer>
                <AreaChart data={days}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" {...AXIS_STYLE} tickLine={false} axisLine={false} />
                  <YAxis {...AXIS_STYLE} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "#6366f1", strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#areaGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Zap size={15} className="text-amber-400" />} title="Kredi Bakiyesi" subtitle={`${credits} kalan`} />
            <div className="h-52 mt-4">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[{ name: "Kalan", value: credits }, { name: "Harcanan", value: spent }]}
                    dataKey="value" nameKey="name" innerRadius={55} outerRadius={74} strokeWidth={0}>
                    <Cell fill="#6366f1" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>

        {/* ―― Row 3: Radar + Verdict ――――――――――――――――――――――――――――――― */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Ürün Kalite Radarı" subtitle="Kaydedilen ürünlerin ortalama skorları" />
            <div className="h-60 mt-4">
              {favorites.length === 0 ? (
                <EmptyState text="Radar görmek için ürün kaydedin." />
              ) : (
                <ResponsiveContainer>
                  <RadarChart data={engineRadar}>
                    <PolarGrid stroke="rgba(99,102,241,0.15)" />
                    <PolarAngleAxis dataKey="metric" stroke="#475569" fontSize={11} />
                    <PolarRadiusAxis stroke="#334155" fontSize={10} angle={30} domain={[0, 100]} />
                    <Radar name="Ort. Skor" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Satılabilirlik Kararları" subtitle="AI verdict dağılımı" />
            <div className="h-60 mt-4">
              {verdictPie.length === 0 ? (
                <EmptyState text="Verdict görmek için ürün kaydedin." />
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={verdictPie} dataKey="value" nameKey="name" outerRadius={78} strokeWidth={0}>
                      {verdictPie.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </section>

        {/* ―― Row 4: Collections pie + Top Recs bar ――――――――――――――――― */}
        <section className="grid lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader title="Koleksiyona Göre Kaydedilenler" />
            <div className="h-52 mt-4">
              {collectionData.length === 0 ? (
                <EmptyState text="Koleksiyon görmek için ürün kaydedin." />
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={collectionData} dataKey="value" nameKey="name" outerRadius={72} strokeWidth={0}>
                      {collectionData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader icon={<Package size={15} className="text-emerald-400" />} title="Top AI Önerileri" subtitle="En sık önerilen ürünler" />
            <div className="h-60 mt-4">
              {topBar.length === 0 ? (
                <EmptyState text="Arama yaparak önerileri görün." />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={topBar} barSize={24}>
                    <XAxis dataKey="name" {...AXIS_STYLE} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={56} />
                    <YAxis {...AXIS_STYLE} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(99,102,241,0.07)" }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </section>

        {/* ―― Row 5: Notifications + Recent Queries ――――――――――――――― */}
        <section className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader icon={<Bell size={15} className="text-slate-400" />} title="Son Bildirimler" />
            {notifQ.isLoading && <LoadingRow />}
            {!notifQ.isLoading && notifications.length === 0 && (
              <EmptyState text="Henüz bildirim yok." className="mt-4" />
            )}
            <ul className="mt-3 divide-y divide-slate-800/60">
              {notifications.slice(0, 5).map((n) => (
                <li key={n.id} className={`flex items-start justify-between gap-3 py-3 text-sm ${n.read ? "opacity-50" : ""}`}>
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
            <Link
              to="/notifications"
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
            >
              Tüm bildirimler <ChevronRight size={12} />
            </Link>
          </Card>

          <Card>
            <CardHeader icon={<History size={15} className="text-slate-400" />} title="Son Aramalar" />
            {anaQ.isLoading && <LoadingRow />}
            {!anaQ.isLoading && analyses.length === 0 && (
              <EmptyState text="Henüz arama yok." className="mt-4" />
            )}
            <ul className="mt-3 divide-y divide-slate-800/60">
              {analyses.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="truncate text-slate-300">{a.search_query}</span>
                  <span className="whitespace-nowrap text-xs text-slate-600">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </main>
    </div>
  );
}

// ─── Reusable primitives ────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-slate-800/60 bg-slate-900/70 p-6 shadow-lg shadow-black/30 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

type AccentColor = "indigo" | "emerald" | "violet" | "amber";

const ACCENT_MAP: Record<AccentColor, { bg: string; icon: string; value: string }> = {
  indigo:  { bg: "bg-indigo-500/10",  icon: "text-indigo-400",  value: "text-indigo-100" },
  emerald: { bg: "bg-emerald-500/10", icon: "text-emerald-400", value: "text-emerald-100" },
  violet:  { bg: "bg-violet-500/10",  icon: "text-violet-400",  value: "text-violet-100" },
  amber:   { bg: "bg-amber-500/10",   icon: "text-amber-400",   value: "text-amber-100" },
};

function KpiCard({
  icon: Icon,
  label,
  value,
  accent = "indigo",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  accent?: AccentColor;
}) {
  const a = ACCENT_MAP[accent];
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-lg shadow-black/30 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.bg}`}>
          <Icon size={15} className={a.icon} />
        </div>
      </div>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${a.value}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function EmptyState({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`flex h-full min-h-[80px] items-center justify-center text-xs text-slate-600 ${className}`}>
      {text}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
      <Loader2 size={13} className="animate-spin" /> Yükleniyor…
    </div>
  );
}
