import { useEffect, useRef, useState } from "react";

/**
 * Site-wide animated ambience with pointer + scroll parallax.
 * Layers move at different depths for a soft 3D feel.
 */
export function AmbientBackground() {
  const [particles, setParticles] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduced || coarse) return setParticles(0);
    const apply = () => setParticles(window.innerWidth < 768 ? 8 : 24);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // Parallax: smooth (lerped) pointer + scroll offsets exposed as CSS vars.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    let raf = 0;
    const target = { x: 0, y: 0, s: 0 };
    const cur = { x: 0, y: 0, s: 0 };

    const onPointer = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onScroll = () => {
      target.s = Math.min(window.scrollY / 900, 1.6);
    };

    const tick = () => {
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      cur.s += (target.s - cur.s) * 0.08;
      el.style.setProperty("--px", cur.x.toFixed(4));
      el.style.setProperty("--py", cur.y.toFixed(4));
      el.style.setProperty("--sy", cur.s.toFixed(4));
      // Hareket durduysa döngüyü uyut; ilk etkileşimde yeniden başlar.
      const idle =
        Math.abs(target.x - cur.x) < 0.0005 &&
        Math.abs(target.y - cur.y) < 0.0005 &&
        Math.abs(target.s - cur.s) < 0.0005;
      raf = idle ? 0 : requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const onPointerWake = (e: PointerEvent) => {
      onPointer(e);
      wake();
    };
    const onScrollWake = () => {
      onScroll();
      wake();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    };

    onScroll();
    if (!coarse) window.addEventListener("pointermove", onPointerWake, { passive: true });
    window.addEventListener("scroll", onScrollWake, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerWake);
      window.removeEventListener("scroll", onScrollWake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="amb-root" aria-hidden="true" data-no-translate ref={rootRef}>
      <div className="amb-layer amb-swirl" />
      <div className="amb-layer amb-aurora" />
      <div className="amb-layer amb-blob amb-blob-1" />
      <div className="amb-layer amb-blob amb-blob-2" />
      <div className="amb-layer amb-rays" />
      <div className="amb-layer amb-grid" />
      <div className="amb-layer amb-beam" />
      <div className="amb-layer amb-scan" />
      <div className="amb-layer amb-particles">
        {Array.from({ length: particles }).map((_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 97) % 100}%`,
              animationDuration: `${16 + ((i * 7) % 18)}s`,
              animationDelay: `${-((i * 5) % 20)}s`,
              opacity: 0.22 + (i % 5) * 0.08,
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
