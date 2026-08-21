/**
 * Aroless mark — bespoke animated sigil used instead of the generic robot/sparkle
 * "AI" icon. A rotating orbital ring, a breathing core and three neural nodes.
 */
export function ArolessMark({ size = 22, className = "", animated = true }: { size?: number; className?: string; animated?: boolean }) {
  const id = `vm-${size}-${animated ? "a" : "s"}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${id}-c`}>
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="70%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* outer hex shield */}
      <path
        d="M24 3.2 41.5 13v22L24 44.8 6.5 35V13Z"
        stroke={`url(#${id}-g)`}
        strokeWidth="2.2"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />

      {/* orbital ring */}
      <g style={animated ? { transformOrigin: "24px 24px", animation: "vm-spin 7s linear infinite" } : undefined}>
        <ellipse cx="24" cy="24" rx="14" ry="6.4" stroke="currentColor" strokeWidth="1.6" opacity="0.55" fill="none" />
        <circle cx="38" cy="24" r="2.1" fill="currentColor" />
      </g>

      {/* neural nodes + links */}
      <path d="M24 24 17 15M24 24l9-4M24 24l-3 12" stroke="currentColor" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
      <circle cx="17" cy="15" r="2.3" fill="currentColor" opacity="0.85" />
      <circle cx="33" cy="20" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="21" cy="36" r="1.9" fill="currentColor" opacity="0.7" />

      {/* core */}
      <circle cx="24" cy="24" r="8" fill={`url(#${id}-c)`} style={animated ? { transformOrigin: "24px 24px", animation: "vm-pulse 2.6s ease-in-out infinite" } : undefined} />
      <circle cx="24" cy="24" r="3.4" fill="currentColor" />
    </svg>
  );
}
