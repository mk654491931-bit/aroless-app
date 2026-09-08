import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getVisitorId } from "@/lib/fingerprint";
import { registerDeviceFingerprint } from "@/lib/signup.functions";
import { AuthShowcase } from "@/components/auth-showcase";
import { Testimonials } from "@/components/landing/sections";
import { QuantumMesh } from "@/components/auth/quantum-mesh";
import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { AuthCard } from "@/components/auth/auth-card";
import { AUTH_REVIEWS } from "@/lib/auth-reviews";
import { safeRedirectPath } from "@/lib/auth-redirect";

// ============================================================================
// Auth route.
//
// Composition only. The credential flow lives in components/auth/auth-card,
// the canvas in components/auth/quantum-mesh, the value panel in
// components/auth/auth-brand-panel, and the URL/password helpers in
// lib/auth-redirect.
//
// Route options, ssr: false and the head meta are unchanged.
// ============================================================================

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Aroless" },
      {
        name: "description",
        content: "Sign in to Aroless to discover winning e-commerce products in seconds.",
      },
      { property: "og:title", content: "Sign in — Aroless" },
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

function AuthPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const registerFingerprintFn = useServerFn(registerDeviceFingerprint);

  // Already signed in: record the device, then honour ?redirect=.
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
      if (!cancelled) nav({ to: safeRedirectPath(window.location.search) });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, nav, registerFingerprintFn]);

  return (
    <div className="auth-stage relative min-h-screen overflow-x-clip">
      {/* Animated aurora / grid / beam backdrop — muted to a matte finish */}
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
        style={{
          background: "radial-gradient(circle, var(--color-brand), transparent 65%)",
          opacity: 0.26,
        }}
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

      <AuthShowcase />

      <div
        id="signin"
        className="relative mx-auto grid w-full max-w-6xl scroll-mt-6 items-center gap-8 px-4 pb-16 pt-10 sm:px-5 sm:gap-10 sm:pb-20 sm:pt-14 lg:min-h-screen lg:grid-cols-2 lg:gap-16 lg:py-12"
      >
        <AuthBrandPanel />
        <AuthCard />
      </div>

      {/* ---------- Reviews under the auth card ---------- */}
      <div className="relative pb-20">
        <div aria-hidden className="mx-auto h-px w-full max-w-3xl bg-border/60" />
        <Testimonials
          items={AUTH_REVIEWS}
          title="Onlarca satıcı veriyle büyüyor"
          subtitle="Giriş yapmadan önce — Aroless kullanıcılarının gerçek hikâyeleri."
        />
      </div>
    </div>
  );
}
