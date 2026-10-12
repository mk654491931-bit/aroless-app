import { sparklinePath } from "@/lib/radar-series";

/**
 * RADAR SPARKLINE — gün gün kazanan skoru (bağımlılıksız SVG).
 *
 * NEDEN: `radar_items` günlük seri saklıyor ama arayüz yalnız bugünü gösteriyordu;
 * "trend" iddiası grafikle görünür olmalı. Çizim saf `sparklinePath` ile yapılır
 * (test edilmiş, NaN üretmez); 2 noktadan azsa çizgi yerine "—" yazılır.
 */
export function RadarSparkline({
  values,
  width = 76,
  height = 22,
  stroke = "var(--brand)",
  className,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  stroke?: string;
  className?: string;
}) {
  const path = sparklinePath(values, width, height, 2);
  if (!path) {
    return (
      <span className={className} aria-hidden>
        —
      </span>
    );
  }
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Kazanan skoru serisi: ${values.length} gün, ${first} → ${last}`}
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
