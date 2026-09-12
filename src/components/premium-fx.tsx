import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Fingerprint, ScanFace, Lock, Sparkles } from "lucide-react";
import {
  MESH_LINK_BUCKETS,
  createFrameGate,
  meshDpr,
  meshLinkBucket,
  meshLinkStrength,
  meshNodeCount,
} from "@/lib/premium-mesh";

/* ---------------- Quantum node mesh canvas (drifting data nodes) ---------------- */
export function QuantumMesh({ className = "" }: { className?: string }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Touch devices get a single static frame: a full-screen rAF mesh is pure
    // CPU/battery cost there and does not add to the experience.
    const animate = !reduce && !coarse;
    let raf = 0;
    let w = 0;
    let h = 0;
    let onScreen = true;
    // DPR 2 quadruples the pixels this canvas clears/fills every frame.
    const dpr = meshDpr(window.devicePixelRatio || 1);

    // Links are collected per opacity bucket so a frame strokes a handful of
    // paths instead of ~1.1k individual `stroke()` calls that each built their
    // own `rgba(...)` string — the real cost of the original loop was that
    // allocation and the per-link draw call, not the distance maths.
    const linkColors = Array.from(
      { length: MESH_LINK_BUCKETS },
      (_, bucket) => `rgba(96,175,255,${(((bucket + 1) / MESH_LINK_BUCKETS) * 0.22).toFixed(3)})`,
    );
    const segments: number[][] = Array.from({ length: MESH_LINK_BUCKETS }, () => []);
    let nodes: { x: number; y: number; vx: number; vy: number; r: number; p: number }[] = [];

    // ~30fps: indistinguishable for slow drifting nodes, half the work.
    const gate = createFrameGate();
    let t = 0;

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    // Only paint while the canvas is actually visible and the tab is in front.
    const running = () => animate && onScreen && !document.hidden;

    const draw = (now: number) => {
      raf = 0;
      if (animate && (!gate(now) || !running())) {
        if (running()) raf = requestAnimationFrame(draw);
        return;
      }
      t += 0.01;
      ctx.clearRect(0, 0, w, h);
      const swayX = (mouse.current.x - 0.5) * 24;
      const swayY = (mouse.current.y - 0.5) * 20;

      for (const n of nodes) {
        if (animate) {
          n.x += n.vx;
          n.y += n.vy;
        }
        if (n.x < 0) n.x = w;
        if (n.x > w) n.x = 0;
        if (n.y < 0) n.y = h;
        if (n.y > h) n.y = 0;
      }

      for (const segment of segments) segment.length = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (!a) continue;
        const ax = a.x + swayX;
        const ay = a.y + swayY;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          if (!b) continue;
          const bx = b.x + swayX;
          const by = b.y + swayY;
          // Squared-distance compare + a single sqrt, instead of Math.hypot
          // (this predicate runs ~1.1k times per frame).
          const strength = meshLinkStrength(ax - bx, ay - by);
          if (strength <= 0) continue;
          segments[meshLinkBucket(strength)].push(ax, ay, bx, by);
        }
      }

      ctx.lineWidth = 0.6;
      for (let bucket = 0; bucket < segments.length; bucket++) {
        const segment = segments[bucket];
        if (!segment || segment.length === 0) continue;
        ctx.strokeStyle = linkColors[bucket];
        ctx.beginPath();
        for (let k = 0; k < segment.length; k += 4) {
          ctx.moveTo(segment[k], segment[k + 1]);
          ctx.lineTo(segment[k + 2], segment[k + 3]);
        }
        ctx.stroke();
      }

      // Nodes paint on top of the link mesh.
      for (const a of nodes) {
        const ax = a.x + swayX;
        const ay = a.y + swayY;
        const pulse = 0.55 + 0.45 * Math.sin(t * 2 + a.p);
        ctx.fillStyle = `rgba(140,225,255,${(0.22 + pulse * 0.3).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ax, ay, a.r * (0.9 + pulse * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      if (running()) raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing clears the bitmap, and without an animation loop (touch or
      // reduced motion) nothing would ever repaint it.
      if (!animate) wake();
    };
    resize();
    window.addEventListener("resize", resize);

    nodes = Array.from({ length: meshNodeCount(w, h) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.6,
      p: Math.random() * Math.PI * 2,
    }));

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    };
    if (animate) window.addEventListener("mousemove", onMove);

    // The hero mesh is tall: without this it keeps burning frames while the user
    // scrolls through the rest of the page.
    let observer: IntersectionObserver | undefined;
    if (animate && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) wake();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      });
      observer.observe(canvas);
    }

    wake();

    const onVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (running()) {
        wake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      if (animate) window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}

/* ---------------- Mouse-tracked breathing ambient halo ---------------- */
export function AmbientBackdrop(): ReactElement {
  const halo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = halo.current;
    if (!el) return;
    // No pointer parallax on touch devices, and none when motion is reduced.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let raf = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      raf = 0;
      el.style.transform = `translate(-50%, -50%) translate3d(${x * 120}px, ${y * 90}px, 0) scale(${1 + (0.5 - Math.abs(y)) * 0.14})`;
    };
    const onMove = (e: MouseEvent) => {
      x = e.clientX / window.innerWidth - 0.5;
      y = e.clientY / window.innerHeight - 0.5;
      // Coalesce to one style write per frame: a high-poll-rate mouse used to
      // force a transform write (and style recalc) on every single event.
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <QuantumMesh />
      <div ref={halo} className="ambient-drift" />
    </div>
  );
}

/* ---------------- Haptic energy ripples ---------------- */
type Ripple = { id: number; x: number; y: number };

export function useRipples(): {
  spawn: (e: React.MouseEvent<HTMLElement>) => void;
  layer: ReactElement;
} {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const spawn = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    window.setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 650);
  }, []);
  const layer = (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {ripples.map((r) => (
        <span key={r.id} className="energy-ripple" style={{ left: r.x, top: r.y }} />
      ))}
    </span>
  );
  return { spawn, layer };
}

/** Global click ripple — applies the energy wave to every button press. */
export function GlobalRippleLayer(): ReactElement {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("button, a, [role='tab']")) return;
      const id = Date.now() + Math.random();
      setRipples((rs) => [...rs.slice(-4), { id, x: e.clientX, y: e.clientY }]);
      window.setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 650);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {ripples.map((r) => (
        <span
          key={r.id}
          className="energy-ripple !h-40 !w-40"
          style={{ position: "fixed", left: r.x, top: r.y }}
        />
      ))}
    </div>
  );
}

/* ---------------- Enterprise tier badge ---------------- */
export function EnterpriseTierBadge({ className = "" }: { className?: string }): ReactElement {
  return (
    <span
      title="Enterprise Tier — AI Elite"
      className={`holo-badge elite-glow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${className}`}
    >
      <Lock size={10} className="opacity-90" />
      Enterprise Tier
      <Sparkles size={10} className="opacity-90" />
    </span>
  );
}

/* ---------------- Tiny holographic PREMIUM badge with micro-pupil ---------------- */
export function PremiumMicroBadge({ className = "" }: { className?: string }): ReactElement {
  return (
    <span
      title="Premium access"
      className={`holo-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] ${className}`}
    >
      <span className="relative inline-block h-2.5 w-2.5 rounded-full border border-white/40">
        <span className="pupil" />
      </span>
      Premium
    </span>
  );
}

/* ---------------- Multi-biometric (fingerprint ⇄ face) button ---------------- */
export function BiometricButton({ active = false }: { active?: boolean }): ReactElement {
  const [mode, setMode] = useState<0 | 1>(0);
  const ripple = useRipples();
  useEffect(() => {
    const id = window.setInterval(() => setMode((m) => (m === 0 ? 1 : 0)), 2400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <button
      type="button"
      onClick={ripple.spawn}
      title="Biometric access — fingerprint / face"
      aria-label="Biometric access"
      className={`relative overflow-hidden shrink-0 grid h-9 w-9 place-items-center rounded-lg border border-white/12 bg-white/5 transition ${active ? "elite-glow border-[var(--accent-active)]/50" : "heartbeat"} hover:bg-white/10`}
    >
      {ripple.layer}
      <Fingerprint
        size={15}
        className={`absolute transition-all duration-500 ${mode === 0 ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90"} text-[var(--accent-active)]`}
      />
      <ScanFace
        size={15}
        className={`absolute transition-all duration-500 ${mode === 1 ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"} text-[var(--accent-active)]`}
      />
    </button>
  );
}
