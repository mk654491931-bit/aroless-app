import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Sparkles,
  TrendingUp,
  Zap,
  ShieldCheck,
  ArrowRight,
  Fingerprint,
  ScanFace,
  BadgeCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { getVisitorId } from "@/lib/fingerprint";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { isDisposableEmail } from "@/lib/disposable-email";
import { startEmailSignup, registerDeviceFingerprint } from "@/lib/signup.functions";
import veloraV from "@/assets/velora-v.png.asset.json";
import { SignupLegalConsent, type LegalConsent } from "@/components/legal/signup-legal-consent";


export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Velora" },
      {
        name: "description",
        content: "Sign in to Velora to discover winning e-commerce products in seconds.",
      },
      { property: "og:title", content: "Sign in — Velora" },
      {
        property: "og:description",
        content: "AI-powered product research, trend radar and viral ad intelligence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const ROTATING = [
  "Find winning products in seconds.",
  "See the market first with the trend radar.",
  "Reverse-engineer viral ads.",
  "Analyze competitor stores in one click.",
];

const PERKS = [
  { icon: TrendingUp, label: "Live trend radar", note: "Data from 20 platforms" },
  { icon: Zap, label: "Hybrid AI scoring", note: "3 models in parallel" },
  { icon: ShieldCheck, label: "Profit simulation", note: "ROI forecasting" },
];

/* ---------------- Quantum node mesh canvas ---------------- */
function QuantumMesh() {
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

    const count = Math.max(34, Math.min(80, Math.round((w * h) / 22000)));
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
    window.addEventListener("mousemove", onMove);

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
          if (d < 132) {
            const alpha = (1 - d / 132) * 0.32;
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

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/* ---------------- Haptic ripple wrapper ---------------- */
type Ripple = { id: number; x: number; y: number };

function useRipples() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const spawn = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    window.setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 650);
  }, []);
  const layer = (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {ripples.map((r) => (
        <span key={r.id} className="energy-ripple" style={{ left: r.x, top: r.y }} />
      ))}
    </span>
  );
  return { spawn, layer };
}

function AuthPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  

  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<null | "email" | "google">(null);
  const [rotIndex, setRotIndex] = useState(0);
  const [bio, setBio] = useState<0 | 1>(0);
  const [focusField, setFocusField] = useState<null | "email" | "password" | "confirm">(null);
  const [consent, setConsent] = useState<LegalConsent>({ terms: false, kvkk: false, marketing: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [promoCode, setPromoCode] = useState("");

  const legalOk = consent.terms && consent.kvkk;
  const cardRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  const emailRipple = useRipples();
  const googleRipple = useRipples();
  const bioRipple = useRipples();

  const startSignupFn = useServerFn(startEmailSignup);
  const registerFingerprintFn = useServerFn(registerDeviceFingerprint);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const visitorId = await getVisitorId();
        if (visitorId && !cancelled) await registerFingerprintFn({ data: { visitorId } });
      } catch {
        /* parmak izi kaydı girişi engellemez */
      }
      if (!cancelled) nav({ to: "/" });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, nav, registerFingerprintFn]);

  useEffect(() => {
    const t = setInterval(() => setRotIndex((i) => (i + 1) % ROTATING.length), 3200);
    const b = setInterval(() => setBio((v) => (v === 0 ? 1 : 0)), 2400);
    return () => {
      clearInterval(t);
      clearInterval(b);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const halo = haloRef.current;
      if (!halo) return;
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      halo.style.transform = `translate(-50%, 0) translate3d(${nx * 60}px, ${ny * 26}px, 0) scaleX(${1 + Math.abs(nx) * 0.25})`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const strength = useMemo(() => {
    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);

  const trackPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === "signup") {
        if (!legalOk) {
          toast.error("Devam etmek için zorunlu yasal onayları işaretleyin.");
          return;
        }
        if (password !== confirmPassword) {
          toast.error("Şifreler birbiriyle eşleşmiyor.");
          return;
        }
        if (isDisposableEmail(email)) {
          toast.error("Geçici (temp-mail) e-posta adresleriyle kayıt yapılamaz.");
          return;
        }
        setBusy("email");
        const visitorId = await getVisitorId();
        const res = await startSignupFn({
          data: { email, password, confirmPassword, visitorId, marketing: consent.marketing, turnstileToken, promoCode },
        });

        if (res.creditsBlocked) {
          toast.warning("Bu cihazda başlangıç kredisi daha önce tanımlandığı için yeniden verilmedi.");
        }

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Hesabınız hazır. Aramıza hoş geldiniz.");
        nav({ to: "/" });
        return;
      } else {
        setBusy("email");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };



  const google = async () => {
    setBusy("google");
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) {
      toast.error(res.error.message);
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Animated aurora / grid / beam backdrop */}
      <div aria-hidden className="auth-aurora" />
      <div aria-hidden className="auth-grid" />
      <div aria-hidden className="auth-beam" />
      <div aria-hidden className="auth-orbits">
        <span />
        <span />
        <span />
      </div>
      <div aria-hidden className="auth-shimmer" />
      <div aria-hidden className="auth-vignette" />


      {/* Quantum data mesh */}
      <QuantumMesh />

      {/* Ambient aurora orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 h-96 w-96 rounded-full blur-3xl animate-float-slow"
        style={{ background: "radial-gradient(circle, var(--color-brand), transparent 65%)", opacity: 0.26 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full blur-3xl animate-float-slow"
        style={{
          background: "radial-gradient(circle, var(--color-brand-2), transparent 65%)",
          opacity: 0.22,
          animationDelay: "1.6s",
        }}
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-2 lg:gap-16">
        {/* ---------- Brand / value panel ---------- */}
        <section className="animate-rise-in hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 animate-pulse-soft" />
            AI-powered product intelligence
          </div>

          <div className="mt-6 flex items-center gap-5">
            <img
              src={veloraV.url}
              alt="Velora"
              className="h-16 w-16 object-contain drop-shadow-[0_6px_28px_oklch(0.62_0.19_250/0.5)]"
            />
            <h1 className="leading-none">
              <span className="block text-[42px] font-light uppercase tracking-[0.32em]" aria-label="Velora">
                {"VELORA".split("").map((ch, i) => (
                  <span
                    key={`${ch}-${i}`}
                    aria-hidden
                    className="velora-letter velora-shine"
                    style={{ animationDelay: `${i * 0.09}s` }}
                  >
                    {ch}
                  </span>
                ))}
              </span>
              <span className="mt-3 block text-[10px] font-medium uppercase tracking-[0.42em] text-[var(--brand)]">
                AI Commerce OS
              </span>
            </h1>
          </div>


          <div className="mt-4 h-7 overflow-hidden">
            <p key={rotIndex} className="animate-rise-in text-lg text-muted-foreground">
              {ROTATING[rotIndex]}
            </p>
          </div>

          <ul className="mt-9 space-y-3">
            {PERKS.map((p, i) => (
              <li
                key={p.label}
                className="premium-card card-lift group flex items-center gap-4 p-4 hover:-translate-y-0.5"
                style={{ animation: `rise-in 0.6s cubic-bezier(0.22,1,0.36,1) ${0.1 + i * 0.09}s both` }}
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card/60 text-foreground transition-transform group-hover:scale-110">
                  <p.icon className="h-5 w-5" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.note}</span>
                </span>
                <ArrowRight className="h-4 w-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </li>
            ))}
          </ul>

          <div className="mt-9 flex items-center gap-6">
            {[
              { v: "12M+", l: "products scanned" },
              { v: "20", l: "platforms" },
              { v: "<25s", l: "search time" },
            ].map((s) => (
              <div key={s.l}>
                <div className="text-2xl font-bold text-gradient">{s.v}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Auth card inside laptop frame ---------- */}
        <section className="relative mx-auto w-full max-w-md">
          {/* Ambient light halo beneath the card */}
          <div ref={haloRef} aria-hidden className="ambient-halo" />

          <div className="laptop-frame">
            <div
              ref={cardRef}
              onMouseMove={trackPointer}
              className="premium-card grain refract animate-rise-in relative overflow-hidden p-7 sm:p-8"
            >
              {/* pointer spotlight */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-60 transition-opacity"
                style={{
                  background:
                    "radial-gradient(320px circle at var(--mx, 50%) var(--my, 0%), oklch(0.68 0.20 265 / 0.16), transparent 70%)",
                }}
              />

              {/* Enterprise tier badge */}
              <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-foreground backdrop-blur elite-glow">
                <BadgeCheck className="h-3.5 w-3.5 text-[oklch(0.80_0.14_200)]" />
                AI ELITE · ENTERPRISE
              </div>

              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <img src={veloraV.url} alt="Velora" className="h-9 w-9 object-contain" />
                  <span className="text-base font-light uppercase tracking-[0.3em] text-foreground/95">
                    Velora
                  </span>
                </div>

                <h2 className="light-trace mt-5 text-2xl font-bold tracking-tight">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "signin"
                    ? "Jump back into the dashboard and pick up your analyses."
                    : "Set up your workspace and unlock the full intelligence suite."}
                </p>

                {/* liquid mercury tab switch */}
                <>

                <div className="relative mt-6 grid grid-cols-2 rounded-xl border border-border bg-card/40 p-1 text-sm">
                  <span
                    aria-hidden
                    className="mercury absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"
                    style={{
                      transform: mode === "signin" ? "translateX(0.125rem)" : "translateX(calc(100% + 0.375rem))",
                    }}
                  />
                  {(["signin", "signup"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`relative z-10 rounded-lg py-2 font-medium transition-all ${
                        mode === m
                          ? "text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:drop-shadow-[0_0_10px_oklch(0.68_0.20_265_/_0.6)]"
                      }`}
                    >
                      {m === "signin" ? "Sign in" : "Sign up"}
                    </button>
                  ))}
                </div>

                <button
                  onClick={(e) => {
                    googleRipple.spawn(e);
                    void google();
                  }}
                  disabled={busy !== null}
                  className="card-lift liquid-surface group relative mt-5 flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-border px-4 py-3 text-sm font-medium hover:-translate-y-0.5 hover:border-[oklch(0.68_0.20_265)] disabled:opacity-60"
                >
                  {googleRipple.layer}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 48 48"
                    aria-hidden
                    className="relative z-10 transition-transform duration-500 group-hover:rotate-[18deg] group-hover:scale-110"
                  >
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.3 34.9 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.5l6.2 5.3C41 34.8 44 29.8 44 24c0-1.2-.1-2.3-.4-3.5z" />
                  </svg>
                  <span className="relative z-10">
                    {busy === "google" ? "Redirecting to Google…" : "Continue with Google"}
                  </span>
                </button>

                <div className="relative my-5">
                  <div className="divider-glow h-px" />
                  <span className="absolute left-1/2 -top-2.5 -translate-x-1/2 bg-background px-2 text-xs text-muted-foreground">
                    or with email
                  </span>
                </div>

                <form onSubmit={submit} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`neon-field relative flex-1 ${focusField === "email" ? "is-focused" : ""}`}>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={email}
                        onFocus={() => setFocusField("email")}
                        onBlur={() => setFocusField(null)}
                        onChange={(e) => setEmail(e.target.value)}
                        className="inp w-full bg-transparent py-3 text-sm"
                      />
                      {focusField === "email" && (
                        <span aria-hidden className="field-particles">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <i key={i} style={{ animationDelay: `${i * 0.18}s`, left: `${12 + i * 18}%` }} />
                          ))}
                        </span>
                      )}
                    </div>

                    {/* Multi-biometric field */}
                    <button
                      type="button"
                      onClick={(e) => {
                        bioRipple.spawn(e);
                        toast.info("Biometric sign-in is coming to Enterprise tier.");
                      }}
                      aria-label="Biometric sign in (fingerprint / face)"
                      className="biometric relative grid h-[46px] w-[46px] shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card/50 text-foreground transition-all hover:-translate-y-0.5 hover:border-[oklch(0.80_0.14_200)]"
                    >
                      {bioRipple.layer}
                      <Fingerprint
                        className={`absolute h-5 w-5 transition-all duration-700 ${bio === 0 ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
                      />
                      <ScanFace
                        className={`absolute h-5 w-5 transition-all duration-700 ${bio === 1 ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
                      />
                    </button>
                  </div>

                  <div className={`neon-field relative ${focusField === "password" ? "is-focused" : ""}`}>
                    <input
                      type={showPw ? "text" : "password"}
                      required
                      minLength={6}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      placeholder="Password (min. 6 characters)"
                      value={password}
                      onFocus={() => setFocusField("password")}
                      onBlur={() => setFocusField(null)}
                      onChange={(e) => setPassword(e.target.value)}
                      className="inp w-full bg-transparent py-3 pr-24 text-sm"
                    />
                    <span
                      aria-hidden
                      className="holo-badge absolute right-11 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
                    >
                      PREMIUM
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <span className="relative inline-flex">
                          <Eye className="h-4 w-4" />
                          <span aria-hidden className="pupil" />
                        </span>
                      )}
                    </button>
                    {focusField === "password" && (
                      <span aria-hidden className="field-particles">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <i key={i} style={{ animationDelay: `${i * 0.18}s`, left: `${10 + i * 17}%` }} />
                        ))}
                      </span>
                    )}
                  </div>

                  {mode === "signup" && password.length > 0 && (
                    <div className={`neon-field relative ${focusField === "confirm" ? "is-focused" : ""}`}>
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        placeholder="Şifre tekrarı"
                        value={confirmPassword}
                        onFocus={() => setFocusField("confirm")}
                        onBlur={() => setFocusField(null)}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="inp w-full bg-transparent py-3 pr-4 text-sm"
                      />
                    </div>
                  )}

                  {mode === "signup" && confirmPassword.length > 0 && confirmPassword !== password && (
                    <p className="text-xs text-destructive">Şifreler birbiriyle eşleşmiyor.</p>
                  )}

                  {mode === "signup" && password.length > 0 && (
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                            strength >= i
                              ? "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"
                              : "bg-border"
                          }`}
                        />
                      ))}
                      <span className="w-16 text-right text-[11px] text-muted-foreground">
                        {["weak", "weak", "fair", "good", "strong"][strength]}
                      </span>
                    </div>
                  )}

                  {mode === "signup" && (
                    <>
                      <div className="neon-field relative">
                        <input
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          placeholder="Promosyon kodu (opsiyonel)"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
                          maxLength={32}
                          className="inp w-full bg-transparent py-3 pr-4 text-sm font-mono uppercase placeholder:font-sans placeholder:normal-case"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Kod geçerliyse indirim, paket satın alırken otomatik uygulanır.
                      </p>
                      <SignupLegalConsent value={consent} onChange={setConsent} />
                      <TurnstileWidget onToken={setTurnstileToken} />
                    </>
                  )}


                  <button
                    type="submit"
                    onClick={emailRipple.spawn}
                    disabled={busy !== null || (mode === "signup" && !legalOk)}
                    className="glow card-lift group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-3 text-sm font-semibold text-primary-foreground hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {emailRipple.layer}
                    <span className="relative z-10 inline-flex items-center justify-center gap-2">
                      {busy === "email" ? "Please wait…" : mode === "signin" ? "Sign in" : "Kayıt Ol"}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </button>
                </form>
                </>


                <p className="mt-5 text-center text-xs text-muted-foreground">
                  By continuing you accept the terms of use. Sign up and start with{" "}
                  <span className="font-medium text-foreground">welcome credits</span>.
                </p>

              </div>
            </div>
            <div aria-hidden className="laptop-base" />
          </div>
        </section>
      </div>
    </div>
  );
}
