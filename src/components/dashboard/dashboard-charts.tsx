import { memo, useMemo } from "react";
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
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Package, Zap } from "lucide-react";
import { EmptyState, Panel, PanelHeader } from "@/components/dashboard/dashboard-primitives";
import {
  AXIS_STYLE,
  CHART_COLORS,
  LEGEND_STYLE,
  TOOLTIP_STYLE,
} from "@/components/dashboard/dashboard-tokens";
import type {
  ActivityPoint,
  NamedCount,
  NamedValue,
  RadarPoint,
} from "@/lib/dashboard-metrics";

// ============================================================================
// Dashboard charts.
//
// Every chart from the previous route is preserved, including the areaGrad
// gradient, the 14-day window, the credit donut colours, the radar domain and
// the bar geometry (barSize 24, radius [6,6,0,0]).
//
// The difference is isolation: each panel is memoized, so one resolving query
// no longer forces recharts to re-measure and re-render all six trees. The
// datasets recharts receives are memoized too, because a new array identity
// on every render defeats its own internal memoization.
// ============================================================================

const AREA_GRADIENT_ID = "areaGrad";

export const ActivityPanel = memo(function ActivityPanel({
  data,
  className,
}: {
  data: readonly ActivityPoint[];
  className?: string;
}) {
  const series = useMemo(() => [...data], [data]);
  const total = useMemo(() => series.reduce((sum, point) => sum + point.count, 0), [series]);

  return (
    <Panel className={className}>
      <PanelHeader
        icon={<Activity size={15} className="text-indigo-400" />}
        title="Analiz Aktivitesi"
        subtitle={`Son 14 gün · ${total} analiz`}
      />
      <div className="mt-4 h-52">
        <ResponsiveContainer>
          <AreaChart data={series}>
            <defs>
              <linearGradient id={AREA_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" {...AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              {...AXIS_STYLE}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ stroke: "#6366f1", strokeWidth: 1, strokeDasharray: "4 4" }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#6366f1"
              strokeWidth={2}
              fill={`url(#${AREA_GRADIENT_ID})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
});

export const CreditPanel = memo(function CreditPanel({
  remaining,
  spent,
  className,
}: {
  remaining: number;
  spent: number;
  className?: string;
}) {
  const series = useMemo(
    () => [
      { name: "Kalan", value: remaining },
      { name: "Harcanan", value: spent },
    ],
    [remaining, spent],
  );

  return (
    <Panel className={className}>
      <PanelHeader
        icon={<Zap size={15} className="text-amber-400" />}
        title="Kredi Bakiyesi"
        subtitle={`${remaining} kalan`}
      />
      <div className="mt-4 h-52">
        {remaining === 0 && spent === 0 ? (
          <EmptyState text="Kredi hareketi yok." />
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={series}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={74}
                strokeWidth={0}
              >
                <Cell fill="#6366f1" />
                <Cell fill="#f59e0b" />
              </Pie>
              <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND_STYLE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
});

export const QualityRadarPanel = memo(function QualityRadarPanel({
  data,
  hasFavorites,
  className,
}: {
  data: readonly RadarPoint[];
  hasFavorites: boolean;
  className?: string;
}) {
  const series = useMemo(() => [...data], [data]);

  return (
    <Panel className={className}>
      <PanelHeader
        title="Ürün Kalite Radarı"
        subtitle="Kaydedilen ürünlerin ortalama skorları"
      />
      <div className="mt-4 h-60">
        {!hasFavorites ? (
          <EmptyState text="Radar görmek için ürün kaydedin." />
        ) : (
          <ResponsiveContainer>
            <RadarChart data={series}>
              <PolarGrid stroke="rgba(99,102,241,0.15)" />
              <PolarAngleAxis dataKey="metric" stroke="#475569" fontSize={11} />
              <PolarRadiusAxis stroke="#334155" fontSize={10} angle={30} domain={[0, 100]} />
              <Radar
                name="Ort. Skor"
                dataKey="score"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.25}
                strokeWidth={2}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
});

/** Shared donut body for the verdict and collection breakdowns. */
const BreakdownPie = memo(function BreakdownPie({
  data,
  outerRadius,
}: {
  data: readonly NamedValue[];
  outerRadius: number;
}) {
  const series = useMemo(() => [...data], [data]);
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie
          data={series}
          dataKey="value"
          nameKey="name"
          outerRadius={outerRadius}
          strokeWidth={0}
        >
          {series.map((slice, index) => (
            <Cell key={slice.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND_STYLE} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
});

export const VerdictPanel = memo(function VerdictPanel({
  data,
  className,
}: {
  data: readonly NamedValue[];
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader title="Satılabilirlik Kararları" subtitle="AI verdict dağılımı" />
      <div className="mt-4 h-60">
        {data.length === 0 ? (
          <EmptyState text="Verdict görmek için ürün kaydedin." />
        ) : (
          <BreakdownPie data={data} outerRadius={78} />
        )}
      </div>
    </Panel>
  );
});

export const CollectionsPanel = memo(function CollectionsPanel({
  data,
  className,
}: {
  data: readonly NamedValue[];
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader title="Koleksiyona Göre Kaydedilenler" />
      <div className="mt-4 h-52">
        {data.length === 0 ? (
          <EmptyState text="Koleksiyon görmek için ürün kaydedin." />
        ) : (
          <BreakdownPie data={data} outerRadius={72} />
        )}
      </div>
    </Panel>
  );
});

export const TopRecommendationsPanel = memo(function TopRecommendationsPanel({
  data,
  className,
}: {
  data: readonly NamedCount[];
  className?: string;
}) {
  const series = useMemo(() => [...data], [data]);

  return (
    <Panel className={className}>
      <PanelHeader
        icon={<Package size={15} className="text-emerald-400" />}
        title="Top AI Önerileri"
        subtitle="En sık önerilen ürünler"
      />
      <div className="mt-4 h-60">
        {series.length === 0 ? (
          <EmptyState text="Arama yaparak önerileri görün." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={series} barSize={24}>
              <XAxis
                dataKey="name"
                {...AXIS_STYLE}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-12}
                textAnchor="end"
                height={56}
              />
              <YAxis
                {...AXIS_STYLE}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "rgba(99,102,241,0.07)" }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
});
