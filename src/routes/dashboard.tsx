import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bell,
  Bookmark,
  CreditCard,
  History,
  Loader2,
  Package,
  Radar,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar as RadarShape,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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

const COLORS = [
  "oklch(0.62 0.17 255)",
  "oklch(0.52 0.15 262)",
  "oklch(0.75 0.18 200)",
  "oklch(0.78 0.16 90)",
  "oklch(0.70 0.20 25)",
];

/** Shared tooltip look so every chart is consistent (kills 5x duplication). */
const TOOLTIP_STYLE = {
  background: "oklch(0.20 0.035 255)",
  border: "1px solid oklch(1 0 0 / 0.1)",
  borderRadius: 8,
} as const;

const AXIS_STROKE = "oklch(0.72 0.03 255)";
const BRAND = "oklch(0.75 0.18 255)";

function DashboardPage() {
  useTranslation();
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

  const favQ = useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: () => favFn(),
    enabled: !!user,
  });
  const anaQ = useQuery({
    queryKey: ["analyses", user?.id],
    queryFn: () => anaFn(),
    enabled: !!user,
  });
  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileFn(),
    enabled: !!user,
  });
  const notifQ = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => notifFn(),
    enabled: !!user,
  });

  const favorites = useMemo(
    () => (favQ.data as FavoriteRow[] | undefined) ?? [],
    [favQ.data],
  );
  const analyses = useMemo(() => (anaQ.data as AnalysisRow[] | undefined) ?? [], [anaQ.data]);
  const notifications = useMemo(
    () => (notifQ.data as NotificationRow[] | undefined) ?? [],
    [notifQ.data],
  );
  const profile = profileQ.data as
    | { credits: number; credits_spent: number; subscription_tier: string }
    | undefined;

  // ---- derived datasets (all memoized — zero recompute on unrelated renders) ----
  const { credits, spent, tier } = useMemo(
    () => ({
      credits: profile?.credits ?? 0,
      spent: profile?.credits_spent ?? 0,
      tier: profile?.subscription_tier ?? "Free",
    }),
    [profile],
  );

  const collectionData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of favorites) {
      const c = f.collection_name || "Default";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [favorites]);

  const days = useMemo(() => {
    const now = new Date();
    const out: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      out.push({
        date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: 0,
      });
    }
    for (const a of analyses) {
      const diff = Math.floor((now.getTime() - new Date(a.created_at).getTime()) / 86400000);
      if (diff >= 0 && diff <= 13) out[13 - diff].count++;
    }
    return out;
  }, [analyses]);

  const topBar = useMemo(() => {
    const names: Record<string, number> = {};
    for (const a of analyses) {
      const list = (a.results as { name?: string }[]) || [];
      for (const p of list) if (p?.name) names[p.name] = (names[p.name] ?? 0) + 1;
    }
    return Object.entries(names)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({
        name: name.length > 20 ? name.slice(0, 20) + "…" : name,
        count,
      }));
  }, [analyses]);

  const { engineRadar, verdictPie } = useMemo(() => {
    const health: number[] = [];
    const viral: number[] = [];
    const trend: number[] = [];
    const verdictCounts: Record<string, number> = {};
    for (const f of favorites) {
      const p = f.product;
      if (typeof p.health_score === "number") health.push(p.health_score);
      if (typeof p.viral_probability_90d === "number") viral.push(p.viral_probability_90d);
      if (typeof p.trend_score === "number") trend.push(p.trend_score);
      const v = p.sellability_verdict || "Unknown";
      verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
    }
    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    return {
      engineRadar: [
        { metric: "Health", score: avg(health) },
        { metric: "Viral", score: avg(viral) },
        { metric: "Trend", score: avg(trend) },
        { metric: "Confidence", score: favorites.length ? Math.min(100, favorites.length * 10) : 0 },
        {
          metric: "Diversity",
          score: collectionData.length ? Math.min(100, collectionData.length * 20) : 0,
        },
      ],
      verdictPie: Object.entries(verdictCounts).map(([name, value]) => ({ name, value })),
    };
  }, [favorites, collectionData]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return "Gece";
    if (h < 12) return "Günaydın";
    if (h < 18) return "İyi günler";
    return "İyi akşamlar";
  }, []);

  if (loading || !user)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );

  const paid = tier === "Starter" || tier === "Pro" || tier === "Business";

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* ── Hero: greeting + status + quick actions ─────────────────────── */}
      <header className="glass relative overflow-hidden rounded-2xl p-6">
        <div className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-[oklch(0.62_0.17_255)]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="text-gradient">{greeting}</span> 👋
              </h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  paid
                    ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]"
                    : "border-white/10 bg-white/5 text-muted-foreground"
                }`}
              >
                <Zap size={11} /> {tier}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Araştırma motorun seni bekliyor — bugünün fırsatlarını keşfet.
            </p>

            {/* Quick actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <QuickAction
                to="/"
                icon={<Target size={14} />}
                label="Ürün Bulucu"
                primary
              />
              <QuickAction to="/trend-radar" icon={<Radar size={14} />} label="Trend Radar" />
              <QuickAction to="/compare" icon={<Scale size={14} />} label="Karşılaştır" />
              <Link
                to="/notifications"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium hover:bg-white/10"
              >
                <Bell size={13} />
                {unreadCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
                Bildirimler
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Kredi bakiyesi
              </div>
              <div className="text-lg font-bold leading-tight text-[oklch(0.85_0.15_255)]">
                {credits.toLocaleString()}
              </div>
            </div>
            <LanguageSwitcher />
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              <ArrowLeft size={13} /> Geri
            </Link>
          </div>
        </div>
      </header>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={History} label="Analiz" value={analyses.length} />
        <Kpi icon={Bookmark} label="Kayıtlı ürün" value={favorites.length} />
        <Kpi icon={TrendingUp} label="Koleksiyon" value={collectionData.length || 1} />
        <Kpi icon={CreditCard} label="Kalan kredi" value={credits} />
      </section>

      {/* ── Activity + credit balance ───────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          icon={<Sparkles size={15} />}
          title="Analiz aktivitesi (son 14 gün)"
          className="lg:col-span-2"
        >
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={days}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke={AXIS_STROKE} fontSize={11} tickLine={false} />
                <YAxis stroke={AXIS_STROKE} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={BRAND}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard icon={<Zap size={15} />} title="Kredi dağılımı">
          <div className="h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={[
                    { name: "Kalan", value: credits },
                    { name: "Harcanan", value: spent },
                  ]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={80}
                >
                  <Cell fill={BRAND} />
                  <Cell fill="oklch(0.70 0.20 25)" />
                </Pie>
                <Legend />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </section>

      {/* ── Engine quality radar + verdict distribution ─────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard icon={<Target size={15} />} title="Kayıtlı ürün kalite radarı">
          <div className="h-64">
            {favorites.length === 0 ? (
              <EmptyState>Ürün kaydet — yapay zekâ kalite skorlarını burada görürsün.</EmptyState>
            ) : (
              <ResponsiveContainer>
                <RadarChart data={engineRadar}>
                  <PolarGrid stroke="oklch(1 0 0 / 0.1)" />
                  <PolarAngleAxis dataKey="metric" stroke={AXIS_STROKE} fontSize={11} />
                  <PolarRadiusAxis stroke={AXIS_STROKE} fontSize={10} angle={30} domain={[0, 100]} />
                  <RadarShape
                    name="Ortalama skor"
                    dataKey="score"
                    stroke={BRAND}
                    fill={BRAND}
                    fillOpacity={0.35}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard icon={<Package size={15} />} title="Satılabilirlik kararları">
          <div className="h-64">
            {verdictPie.length === 0 ? (
              <EmptyState>Ürün kaydet — karar dağılımını burada görürsün.</EmptyState>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={verdictPie} dataKey="value" nameKey="name" outerRadius={80}>
                    {verdictPie.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>
      </section>

      {/* ── Top recommendations + collections ───────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard icon={<Bookmark size={15} />} title="Koleksiyonlara göre kayıtlar">
          <div className="h-56">
            {collectionData.length === 0 ? (
              <EmptyState>Bir ürün kaydet — bu grafiği görmek için.</EmptyState>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={collectionData} dataKey="value" nameKey="name" outerRadius={80}>
                    {collectionData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard
          icon={<TrendingUp size={15} />}
          title="En çok önerilen ürünler"
          className="lg:col-span-2"
        >
          <div className="h-64">
            {topBar.length === 0 ? (
              <EmptyState>Bu grafiği doldurmak için bir arama çalıştır.</EmptyState>
            ) : (
              <ResponsiveContainer>
                <BarChart data={topBar}>
                  <XAxis
                    dataKey="name"
                    stroke={AXIS_STROKE}
                    fontSize={10}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis stroke={AXIS_STROKE} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="oklch(0.62 0.17 255)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>
      </section>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard icon={<Bell size={15} />} title="Son bildirimler">
          {notifQ.isLoading ? (
            <div className="space-y-2 py-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState>Henüz bildirim yok.</EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {notifications.slice(0, 5).map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start justify-between gap-3 py-2.5 text-sm ${n.read ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{n.title}</div>
                    {n.body && (
                      <div className="truncate text-xs text-muted-foreground">{n.body}</div>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/notifications"
            className="mt-3 inline-block text-xs text-[oklch(0.85_0.15_255)] hover:underline"
          >
            Tüm bildirimleri gör →
          </Link>
        </ChartCard>

        <ChartCard icon={<History size={15} />} title="Son sorgular">
          {anaQ.isLoading ? (
            <div className="space-y-2 py-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : analyses.length === 0 ? (
            <EmptyState>Henüz arama yok.</EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {analyses.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="truncate">{a.search_query}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </section>
    </main>
  );
}

/* ── Shared building blocks (memoized — stable across re-renders) ─────── */

function QuickAction({
  to,
  icon,
  label,
  primary,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
        primary
          ? "bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] text-white hover:brightness-110"
          : "border border-white/10 bg-white/5 text-foreground hover:bg-white/10"
      }`}
    >
      {icon} {label}
    </Link>
  );
}

const Kpi = memo(function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="glass rounded-2xl p-5 transition hover:bg-white/[0.04]">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25">
          <Icon size={14} className="text-[oklch(0.85_0.15_255)]" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
});

const ChartCard = memo(function ChartCard({
  icon,
  title,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-5 ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-[oklch(0.85_0.15_255)]">{icon}</span> {title}
      </h2>
      {children}
    </div>
  );
});

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SkeletonRow() {
  return <div className="h-8 animate-pulse rounded-lg bg-white/5" />;
}