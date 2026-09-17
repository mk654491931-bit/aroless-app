import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, ScanFace, Lock, Sparkles } from "lucide-react";
import { isLiteMode, onLiteMode } from "@/lib/fluidity";

/* ---------------- Quantum node mesh canvas (drifting data nodes) ---------------- */
export function QuantumMesh({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Hafif modda canvas mesh hiç çizilmez (dekoratif; saydam kalır).
    if (isLiteMode()) return;
    let raf = 0;
    let frameTimeout: number | null = null;
    let scrollTimer: number | null = null;
    let scrolling = false;
    let lastFrame = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Keep the mesh deliberately small: this is atmosphere, not a data viz.
    const count = Math.max(22, Math.min(48, Math.round((w * h) / 42000)));
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
      r: Math.random() * 1.3 + 0.55,
      p: Math.random() * Math.PI * 2,
    }));

    let t = 0;
    const drawScene = (time: number) => {
      t = reduce ? 0 : time * 0.002;
      ctx.clearRect(0, 0, w, h);
      const swayX = (mouse.current.x - 0.5) * 18;
      const swayY = (mouse.current.y - 0.5) * 15;

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
        const a = nodes[i]!;
        const ax = a.x + swayX;
        const ay = a.y + swayY;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const bx = b.x + swayX;
          const by = b.y + swayY;
          const d = Math.hypot(ax - bx, ay - by);
          if (d < 112) {
            ctx.strokeStyle = `rgba(96,175,255,${(1 - d / 112) * 0.18})`;
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
        const pulse = 0.55 + 0.45 * Math.sin(t * 2 + a.p);
        ctx.fillStyle = `rgba(140,225,255,${0.2 + pulse * 0.25})`;
        ctx.beginPath();
        ctx.arc(ax, ay, a.r * (0.9 + pulse * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const cancelAnimation = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (frameTimeout !== null) {
        window.clearTimeout(frameTimeout);
        frameTimeout = null;
      }
    };

    const schedule = () => {
      if (reduce || coarse || scrolling || document.hidden || raf || frameTimeout !== null) return;
      raf = requestAnimationFrame(draw);
    };

    const draw = (time: number) => {
      raf = 0;
      if (scrolling || document.hidden) return;
      const elapsed = time - lastFrame;
      if (elapsed < 32) {
        frameTimeout = window.setTimeout(() => {
          frameTimeout = null;
          schedule();
        }, 32 - elapsed);
        return;
      }
      lastFrame = time;
      drawScene(time);
      schedule();
    };

    const onMove = (e: PointerEvent) => {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    };
    const onScroll = () => {
      if (reduce || coarse) return;
      scrolling = true;
      cancelAnimation();
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null;
        scrolling = false;
        schedule();
      }, 160);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimation();
      } else {
        scrolling = false;
        schedule();
      }
    };
    const onResize = () => {
      resize();
      drawScene(lastFrame);
    };

    drawScene(0);
    window.addEventListener("resize", onResize);
    if (!coarse) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    // Ölçüm sonrası hafif mod açılırsa döngü tamamen durur ve canvas temizlenir.
    const offLite = onLiteMode(() => {
      cancelAnimation();
      ctx.clearRect(0, 0, w, h);
    });
    schedule();

    return () => {
      offLite();
      cancelAnimation();
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      window.removeEventListener("resize", onResize);
      if (!coarse) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("scroll", onScroll);
      }
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
export function AmbientBackdrop() {
  const halo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduce || coarse || isLiteMode()) return;

    let raf = 0;
    const point = { x: 0.5, y: 0.5 };
    const onMove = (e: PointerEvent) => {
      point.x = e.clientX / window.innerWidth;
      point.y = e.clientY / window.innerHeight;
      if (!raf && !document.hidden) raf = requestAnimationFrame(apply);
    };
    const apply = () => {
      raf = 0;
      const el = halo.current;
      if (!el || document.hidden) return;
      el.style.transform = `translate(-50%, -50%) translate3d(${(point.x - 0.5) * 120}px, ${(point.y - 0.5) * 90}px, 0) scale(${1 + (0.5 - Math.abs(point.y - 0.5)) * 0.14})`;
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
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

export function useRipples() {
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
export function GlobalRippleLayer() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  useEffect(() => {
    // Hafif modda her tıklamada büyük blur'lu dalga üretilmez.
    if (isLiteMode()) return;
    let last = 0;
    const onDown = (e: MouseEvent) => {
      const now = performance.now();
      if (now - last < 120) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("button, a, [role='tab']")) return;
      last = now;
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
export function EnterpriseTierBadge({ className = "" }: { className?: string }) {
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
export function PremiumMicroBadge({ className = "" }: { className?: string }) {
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
export function BiometricButton({ active = false }: { active?: boolean }) {
  const [mode, setMode] = useState<0 | 1>(0);
  const ripple = useRipples();
  useEffect(() => {
    // Sekme görünmüyorken ikon değişimi için boşuna render tetikleme.
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setMode((m) => (m === 0 ? 1 : 0));
    }, 2400);
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
