import { memo, type ComponentType, type ReactNode } from "react";
import {
  ACCENT_MAP,
  PANEL_ENTER,
  PANEL_SURFACE,
  type AccentColor,
} from "@/components/dashboard/dashboard-tokens";

// ============================================================================
// Dashboard layout primitives.
//
// These used to live at the bottom of the route file, which meant nothing else
// could reuse them and every dashboard render re-created them. Each one is
// memoized: a panel whose props did not change does not re-render when a
// sibling query resolves.
// ============================================================================

export const Panel = memo(function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${PANEL_SURFACE} ${PANEL_ENTER} p-6 ${className}`}>{children}</div>;
});

export const PanelHeader = memo(function PanelHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
});

export const KpiCard = memo(function KpiCard({
  icon: Icon,
  label,
  value,
  accent = "indigo",
  hint,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  accent?: AccentColor;
  hint?: string;
}) {
  const a = ACCENT_MAP[accent];
  return (
    <div
      className={`${PANEL_SURFACE} ${PANEL_ENTER} p-5 transition-transform duration-200 will-change-transform motion-safe:hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.bg}`}>
          <Icon size={15} className={a.icon} />
        </div>
      </div>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${a.value}`}>{value.toLocaleString()}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-600">{hint}</p>}
    </div>
  );
});

export const EmptyState = memo(function EmptyState({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full min-h-[80px] items-center justify-center text-center text-xs text-slate-600 ${className}`}
    >
      {text}
    </div>
  );
});

/**
 * Skeleton block. Replaces the old full-page spinner: the page now renders its
 * real layout immediately and each region fills in, so nothing reflows when
 * data arrives.
 */
export const Skeleton = memo(function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`motion-safe:animate-pulse rounded-lg bg-slate-800/60 ${className}`}
      aria-hidden="true"
    />
  );
});

export const PanelSkeleton = memo(function PanelSkeleton({
  className = "",
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div className={`${PANEL_SURFACE} p-6 ${className}`} role="status" aria-busy="true">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3" />
        ))}
      </div>
    </div>
  );
});

/**
 * Credit balance ring. The balance used to be readable only by decoding a donut
 * legend; this puts the number and the remaining share in one glance.
 */
export const CreditRing = memo(function CreditRing({
  remaining,
  spent,
  size = 76,
}: {
  remaining: number;
  spent: number;
  size?: number;
}) {
  const total = Math.max(remaining + spent, 1);
  const share = Math.min(Math.max(remaining / total, 0), 1);
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${remaining} kredi kaldı`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.16)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#6366f1"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums text-slate-100">{remaining}</span>
        <span className="text-[9px] uppercase tracking-wider text-slate-500">kredi</span>
      </div>
    </div>
  );
});
