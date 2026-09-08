import { memo, useEffect, useRef } from "react";

// ============================================================================
// Quantum node mesh canvas.
//
// Moved out of src/routes/auth.tsx unchanged in behaviour: same node density
// (one per ~22000 px², clamped to 34-80), same 132px link distance, same
// colours, same parallax sway, same reduced-motion handling (nodes stop
// drifting, the pulse remains).
//
// The mousemove listener is now passive, so it cannot delay scrolling on the
// auth page.
// ============================================================================

const MAX_NODES = 80;
const MIN_NODES = 34;
const PX_PER_NODE = 22000;
const LINK_DISTANCE = 132;

export const QuantumMesh = memo(function QuantumMesh() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const count = Math.max(MIN_NODES, Math.min(MAX_NODES, Math.round((w * h) / PX_PER_NODE)));
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.6 + 0.7,
      p: Math.random() * Math.PI * 2,
    }));

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    let t = 0;
    const draw = () => {
      t += 0.006;
      ctx.clearRect(0, 0, w, h);
      const swayX = (mouse.current.x - 0.5) * 26;
      const swayY = (mouse.current.y - 0.5) * 22;

      for (const n of nodes) {
        if (!reduce) {
          n.x += n.vx;
          n.y += n.vy;
        }
        if (n.x < 0) n.x = w;
        if (n.x > w) n.x = 0;
        if (n.y < 0) n.y = h;
        if (n.y > h) n.y = 0;
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ax = a.x + swayX;
        const ay = a.y + swayY;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const bx = b.x + swayX;
          const by = b.y + swayY;
          const d = Math.hypot(ax - bx, ay - by);
          if (d < LINK_DISTANCE) {
            const alpha = (1 - d / LINK_DISTANCE) * 0.32;
            ctx.strokeStyle = `rgba(96,175,255,${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
        const pulse = 0.55 + 0.45 * Math.sin(t * 2 + a.p);
        ctx.fillStyle = `rgba(140,225,255,${0.35 + pulse * 0.4})`;
        ctx.beginPath();
        ctx.arc(ax, ay, a.r * (0.9 + pulse * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
  );
});
