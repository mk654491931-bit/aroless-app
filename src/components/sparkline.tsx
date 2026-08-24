/** Minimal inline sparkline for Google Trends interest series. */
export function Sparkline({
  values,
  width = 220,
  height = 40,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return null;
  const max = Math.max(...v, 1);
  const min = Math.min(...v);
  const span = Math.max(1, max - min);
  const pts = v.map((n, i) => {
    const x = (i / (v.length - 1)) * width;
    const y = height - ((n - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className}`}
      height={height}
      role="img"
      aria-label="Arama ilgisi trendi"
    >
      <defs>
        <linearGradient id="spark" x1="0" x2="1">
          <stop offset="0%" stopColor="oklch(0.68 0.20 265)" />
          <stop offset="100%" stopColor="oklch(0.66 0.24 305)" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${pts.join(" ")} ${width},${height}`}
        fill="url(#spark)"
        opacity="0.15"
        stroke="none"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="url(#spark)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
