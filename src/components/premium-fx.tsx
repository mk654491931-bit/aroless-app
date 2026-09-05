import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, ScanFace, Lock, Sparkles } from "lucide-react";

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

    const count = Math.max(28, Math.min(70, Math.round((w * h) / 30000)));
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.5 + 0.6,
      p: Math.random() * Math.PI * 2,
    }));

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    };
    if (!coarse) window.addEventListener("mousemove", onMove);

    let t = 0;
    let lastFrame = 0;
    const draw = (ts: number) => {
      // Dekoratif ağ: 60fps yerine ~30fps ile sınırla — her karedeki tam ekran
      // clear+stroke düşük güçlü cihazlarda ana iş parçacığını yoruyordu.
      if (ts - lastFrame < 33) {
        if (!reduce && !coarse && !document.hidden) raf = requestAnimationFrame(draw);
        return;
      }
      lastFrame = ts;
      t += 0.005;
      ctx.clearRect(0, 0, w, h);
      const swayX = (mouse.current.x - 0.5) * 24;
      const swayY = (mouse.current.y - 0.5) * 20;

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
          if (d < 128) {
            ctx.strokeStyle = `rgba(96,175,255,${(1 - d / 128) * 0.22})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
        const pulse = 0.55 + 0.45 * Math.sin(t * 2 + a.p);
        ctx.fillStyle = `rgba(140,225,255,${0.22 + pulse * 0.3})`;
        ctx.beginPath();
        ctx.arc(ax, ay, a.r * (0.9 + pulse * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce && !coarse && !document.hidden) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduce && !coarse && !raf) {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (!coarse) window.removeEventListener("mousemove", onMove);
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
    const onMove = (e: MouseEvent) => {
      const el = halo.current;
      if (!el) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      el.style.transform = `translate(-50%, -50%) translate3d(${(x - 0.5) * 120}px, ${(y - 0.5) * 90}px, 0) scale(${1 + (0.5 - Math.abs(y - 0.5)) * 0.14})`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
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
