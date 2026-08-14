import { useEffect, useState } from "react";

/**
 * Site-wide animated atmosphere: aurora clouds, a slow data grid, drifting
 * light particles and an edge vignette. Rendered once from the root layout,
 * behind every page. Colors come from the active palette tokens, so switching
 * between Classic and Aurora restyles the whole backdrop.
 */
export function AmbientBackground() {
  const [particles, setParticles] = useState<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return setParticles(0);
    const apply = () => setParticles(window.innerWidth < 768 ? 7 : 16);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  return (
    <div className="amb-root" aria-hidden="true" data-no-translate>
      <div className="amb-aurora" />
      <div className="amb-grid" />
      <div className="amb-beam" />
      <div className="amb-particles">
        {Array.from({ length: particles }).map((_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 97) % 100}%`,
              animationDuration: `${16 + ((i * 7) % 18)}s`,
              animationDelay: `${-((i * 5) % 20)}s`,
              opacity: 0.18 + ((i % 5) * 0.06),
              width: i % 4 === 0 ? "3px" : "2px",
              height: i % 4 === 0 ? "3px" : "2px",
            }}
          />
        ))}
      </div>
      <div className="amb-vignette" />
    </div>
  );
}
