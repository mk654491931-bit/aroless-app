import { memo } from "react";
import {
  Activity,
  Package,
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
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
// Dashboard chart panels.
//
// Each panel is memoized and takes only the data it draws, so a change in one
// query cannot re-render the other five charts. Recharts re-renders are the
// most expensive thing on this page, which is why the boundaries are drawn
// here rather than in the route.
// ============================================================================

export const ActivityPanel = memo(function ActivityPanel({
  data,
  className = "",
}: {
  data: ActivityPoint[];
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader
        icon={<Activity size={15} className="text-indigo-400" />}
        title="Analiz Aktivitesi"
        subtitle="Son 14 gün"
      />
      <div className="mt-4 h-52">
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
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
              fill="url(#areaGrad)"
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
}: {
  remaining: number;
  spent: number;
}) {
  const data = [
    { name: "Kalan", value: remaining },
    { name: "Harcanan", value: spent },
  ];
  return (
    <Panel>
      <PanelHeader
        icon={<Zap size={15} className="text-amber-400" />}
        title="Kredi Bakiyesi"
        subtitle={`${remaining} kalan`}
      />
      <div className="mt-4 h-52">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
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
      </div>
    </Panel>
  );
});

export const QualityRadarPanel = memo(function QualityRadarPanel({
  data,
  hasFavorites,
}: {
  data: RadarPoint[];
  hasFavorites: boolean;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Ürün Kalite Radarı"
        subtitle="Kaydedilen ürünlerin ortalama skorları"
      />
      <div className="mt-4 h-60">
        {!hasFavorites ? (
          <EmptyState text="Radar görmek için ürün kaydedin." />
        ) : (
          <ResponsiveContainer>
            <RadarChart data={data}>
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

/** Shared pie panel — the verdict and collection charts differ only in labels. */
const PiePanel = memo(function PiePanel({
  title,
  subtitle,
  data,
  emptyText,
  outerRadius,
  height,
}: {
  title: string;
  subtitle?: string;
  data: NamedValue[];
  emptyText: string;
  outerRadius: number;
  height: string;
}) {
  return (
    <Panel>
      <PanelHeader title={title} subtitle={subtitle} />
      <div className={`mt-4 ${height}`}>
        {data.length === 0 ? (
          <EmptyState text={emptyText} />
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                outerRadius={outerRadius}
                strokeWidth={0}
              >
                {data.map((entry, i) => (
                  <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
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

export const VerdictPanel = memo(function VerdictPanel({ data }: { data: NamedValue[] }) {
  return (
    <PiePanel
      title="Satılabilirlik Kararları"
      subtitle="AI verdict dağılımı"
      data={data}
      emptyText="Verdict görmek için ürün kaydedin."
      outerRadius={78}
      height="h-60"
    />
  );
});

export const CollectionsPanel = memo(function CollectionsPanel({ data }: { data: NamedValue[] }) {
  return (
    <PiePanel
      title="Koleksiyona Göre Kaydedilenler"
      data={data}
      emptyText="Koleksiyon görmek için ürün kaydedin."
      outerRadius={72}
      height="h-52"
    />
  );
});

export const TopRecommendationsPanel = memo(function TopRecommendationsPanel({
  data,
  className = "",
}: {
  data: NamedCount[];
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader
        icon={<Package size={15} className="text-emerald-400" />}
        title="Top AI Önerileri"
        subtitle="En sık önerilen ürünler"
      />
      <div className="mt-4 h-60">
        {data.length === 0 ? (
          <EmptyState text="Arama yaparak önerileri görün." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={data} barSize={24}>
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
