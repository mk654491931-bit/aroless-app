// ============================================================================
// Dashboard design tokens.
//
// Previously duplicated inline in the route. Centralised so every panel shares
// one palette and one tooltip/axis treatment, and so a theme change is a
// single-file edit rather than a search-and-replace across chart definitions.
// ============================================================================

export const CHART_COLORS = [
  "#6366f1", // indigo-500
  "#818cf8", // indigo-400
  "#34d399", // emerald-400
  "#a78bfa", // violet-400
  "#f59e0b", // amber-400
  "#38bdf8", // sky-400
] as const;

export const TOOLTIP_STYLE = {
  background: "#0f172a",
  border: "1px solid rgba(99,102,241,0.25)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e2e8f0",
} as const;

export const AXIS_STYLE = { stroke: "#475569", fontSize: 11 } as const;

export const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

/** Shared surface treatment for every dashboard panel. */
export const PANEL_SURFACE =
  "rounded-2xl border border-slate-800/60 bg-slate-900/70 shadow-lg shadow-black/30 backdrop-blur-sm";

/**
 * Entrance animation. Transform/opacity only so the compositor can run it on
 * the GPU without layout or paint, and fully disabled for users who ask for
 * reduced motion.
 */
export const PANEL_ENTER =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-reduce:transition-none";

export type AccentColor = "indigo" | "emerald" | "violet" | "amber" | "sky";

export const ACCENT_MAP: Record<
  AccentColor,
  { bg: string; icon: string; value: string; ring: string }
> = {
  indigo: {
    bg: "bg-indigo-500/10",
    icon: "text-indigo-400",
    value: "text-indigo-100",
    ring: "#6366f1",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    icon: "text-emerald-400",
    value: "text-emerald-100",
    ring: "#34d399",
  },
  violet: {
    bg: "bg-violet-500/10",
    icon: "text-violet-400",
    value: "text-violet-100",
    ring: "#a78bfa",
  },
  amber: {
    bg: "bg-amber-500/10",
    icon: "text-amber-400",
    value: "text-amber-100",
    ring: "#f59e0b",
  },
  sky: {
    bg: "bg-sky-500/10",
    icon: "text-sky-400",
    value: "text-sky-100",
    ring: "#38bdf8",
  },
};
