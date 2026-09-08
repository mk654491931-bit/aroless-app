import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  ScanFace,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVisitorId } from "@/lib/fingerprint";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { isDisposableEmail } from "@/lib/disposable-email";
import { startEmailSignup, verifyEmailSignup } from "@/lib/signup.functions";
import { claimReferral } from "@/lib/referral.functions";
import { SignupLegalConsent, type LegalConsent } from "@/components/legal/signup-legal-consent";
import { oauthRedirectUrl } from "@/lib/runtime-env";
import { useRipples } from "@/components/auth/use-ripples";
import {
  initialAuthMode,
  passwordStrength,
  referralCodeFromSearch,
  safeRedirectPath,
  STRENGTH_LABELS,
  type AuthMode,
} from "@/lib/auth-redirect";

// ============================================================================
// Credential card: email/password sign-in, OTP-verified sign-up, Google OAuth.
//
// Extracted from src/routes/auth.tsx. Every field, validation rule, toast and
// server call is unchanged; the URL parsing and password meter now come from
// the tested helpers in src/lib/auth-redirect.ts.
// ============================================================================

const BIOMETRIC_SWAP_MS = 2400;

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export function AuthCard() {
  const nav = useNavigate();

  // /auth?mode=signup → kayıt sekmesi açık gelir ("Ücretsiz başla" CTA'ları).
  const [mode, setMode] = useState<AuthMode>(() => initialAuthMode(currentSearch()));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<null | "email" | "google">(null);
  const [bio, setBio] = useState<0 | 1>(0);
  const [focusField, setFocusField] = useState<null | "email" | "password" | "confirm">(null);
  const [consent, setConsent] = useState<LegalConsent>({
    terms: false,
    kvkk: false,
    marketing: false,
  });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [emailDeliveryFailed, setEmailDeliveryFailed] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [promoCode, setPromoCode] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [referralCode] = useState(() => referralCodeFromSearch(currentSearch()));

  const legalOk = consent.terms && consent.kvkk;
  const cardRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  const emailRipple = useRipples();
  const googleRipple = useRipples();
  const bioRipple = useRipples();

  const startSignupFn = useServerFn(startEmailSignup);
  const verifySignupFn = useServerFn(verifyEmailSignup);
  const claimReferralFn = useServerFn(claimReferral);

  const goToRedirect = () => nav({ to: safeRedirectPath(currentSearch()) });

  useEffect(() => {
    const timer = setInterval(() => setBio((v) => (v === 0 ? 1 : 0)), BIOMETRIC_SWAP_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const halo = haloRef.current;
      if (!halo) return;
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      halo.style.transform = `translate(-50%, 0) translate3d(${nx * 60}px, ${ny * 26}px, 0) scaleX(${1 + Math.abs(nx) * 0.25})`;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const strength = passwordStrength(password);

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
      if (mode === "signup" && otpStep) {
        setBusy("email");
        const visitorId = await getVisitorId();
        const res = await verifySignupFn({ data: { email, code: otpCode, visitorId } });
        if (res.creditsBlocked) {
          toast.warning(
            "Bu cihaz veya IP üzerinden daha önce kayıt yapıldığı için başlangıç kredisi verilmedi.",
          );
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (referralCode) {
          const referral = await claimReferralFn({ data: { code: referralCode } });
          if (referral.ok) toast.success(`Davet bonusu uygulandi · +${referral.credits} kredi`);
        }
        toast.success("E-posta doğrulandı. Hesabınız hazır.");
        goToRedirect();
        return;
      }

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
        const signupRes = await startSignupFn({
          data: {
            email,
            password,
            confirmPassword,
            visitorId,
            marketing: consent.marketing,
            legalAccepted: legalOk,
            turnstileToken,
            promoCode,
          },
        });

        setOtpStep(true);
        if (signupRes.emailSent) {
          toast.success("6 haneli doğrulama kodu e-posta adresinize gönderildi.");
        } else {
          setEmailDeliveryFailed(true);
          toast.warning("E-posta gönderilemedi. Kodu doğrudan alamıyorsanız support'a yazın.");
        }
        return;
      }

      // Doğrudan email + şifre girişi — OTP gerekmez
      setBusy("email");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setShakeKey((k) => k + 1);
        if (error.message.includes("Invalid login credentials")) {
          throw new Error("Invalid email or password.");
        }
        if (error.message.includes("Email not confirmed")) {
          // Must return: falling through here used to show a success toast and
          // navigate away on a login that had in fact failed.
          toast.error(
            "Your email is not verified yet. Check your inbox or resend the verification email below.",
            { duration: 6000 },
          );
          return;
        }
        throw new Error(error.message);
      }
      toast.success("Hoş geldiniz!");
      goToRedirect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  /** Doğrudan Supabase Google OAuth. */
  const google = async () => {
    setBusy("google");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectUrl(),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      toast.error(error.message);
      setBusy(null);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setOtpStep(false);
    setOtpCode("");
    setEmailDeliveryFailed(false);
    setPassword("");
    setConfirmPassword("");
  };

  const resetPassword = async () => {
    if (!email) {
      toast.error("Enter your email first.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password reset link sent. Check your inbox.", { duration: 5000 });
    }
  };

  return (
    <section className="relative mx-auto w-full max-w-md">
      <div className="auth-card-wrap relative">
        {/* Ambient light halo beneath the card */}
        <div ref={haloRef} aria-hidden className="ambient-halo" />
        <div
          ref={cardRef}
          onMouseMove={trackPointer}
          key={shakeKey}
          className={`matte-card premium-card grain refract animate-rise-in relative overflow-hidden p-7 sm:p-8 ${shakeKey > 0 ? "animate-error-shake" : ""}`}
        >
          {/* pointer spotlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60 transition-opacity"
            style={{
              background:
                "radial-gradient(320px circle at var(--mx, 50%) var(--my, 0%), color-mix(in oklab, var(--brand) 16%, transparent), transparent 70%)",
            }}
          />

          {/* Enterprise tier badge */}
          <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-foreground backdrop-blur elite-glow">
            <BadgeCheck className="h-3.5 w-3.5 text-[oklch(0.80_0.14_200)]" />
            AI ELITE · ENTERPRISE
          </div>

          <div className="relative">
            <div className="flex items-center gap-2.5">
              <img src="/logo-mark.png" alt="Aroless" className="h-9 w-9 object-contain" />
              <span className="text-base font-light uppercase tracking-[0.3em] text-foreground/95">
                Aroless
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
            <div className="relative mt-6 grid grid-cols-2 rounded-xl border border-border bg-card/40 p-1 text-sm">
              <span
                aria-hidden
                className="mercury absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)]"
                style={{
                  transform:
                    mode === "signin"
                      ? "translateX(0.125rem)"
                      : "translateX(calc(100% + 0.375rem))",
                }}
              />
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`relative z-10 rounded-lg py-2 font-medium transition-all ${
                    mode === m
                      ? "text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:drop-shadow-[0_0_10px_color-mix(in_oklab,var(--brand)_60%,transparent)]"
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
              className="card-lift liquid-surface group relative mt-5 flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-border px-4 py-3 text-sm font-medium hover:-translate-y-0.5 hover:border-[var(--brand)] disabled:opacity-60"
            >
              {googleRipple.layer}
              <svg
                width="18"
                height="18"
                viewBox="0 0 48 48"
                aria-hidden
                className="relative z-10 transition-transform duration-500 group-hover:rotate-[18deg] group-hover:scale-110"
              >
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.3 34.9 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.5l6.2 5.3C41 34.8 44 29.8 44 24c0-1.2-.1-2.3-.4-3.5z"
                />
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
              {mode === "signup" && otpStep && (
                <div className="space-y-2">
                  {emailDeliveryFailed && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      E-posta gönderilemedi. Destek ekibiyle iletişime geçin: destek@aroless.tech
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {email} adresine gönderilen 6 haneli kodu girin.
                  </p>
                  <div className="neon-field relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      className="inp w-full bg-transparent py-3 text-center text-lg tracking-[0.5em]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpStep(false);
                      setOtpCode("");
                    }}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    E-posta veya şifreyi değiştir
                  </button>
                </div>
              )}

              {!otpStep && (
                <div className="flex items-center gap-2">
                  <div
                    className={`neon-field relative flex-1 ${focusField === "email" ? "is-focused" : ""}`}
                  >
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
                          <i
                            key={i}
                            style={{
                              animationDelay: `${i * 0.18}s`,
                              left: `${12 + i * 18}%`,
                            }}
                          />
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
              )}

              {!otpStep && (
                <div
                  className={`neon-field relative ${focusField === "password" ? "is-focused" : ""}`}
                >
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
                        <i
                          key={i}
                          style={{ animationDelay: `${i * 0.18}s`, left: `${10 + i * 17}%` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              )}

              {!otpStep && mode === "signup" && password.length > 0 && (
                <div
                  className={`neon-field relative ${focusField === "confirm" ? "is-focused" : ""}`}
                >
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onFocus={() => setFocusField("confirm")}
                    onBlur={() => setFocusField(null)}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="inp w-full bg-transparent py-3 pr-4 text-sm"
                  />
                </div>
              )}

              {mode === "signup" && confirmPassword.length > 0 && confirmPassword !== password && (
                <p className="text-xs text-destructive">Passwords do not match.</p>
              )}

              {!otpStep && mode === "signup" && password.length > 0 && (
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                        strength >= i
                          ? "bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)]"
                          : "bg-border"
                      }`}
                    />
                  ))}
                  <span className="w-16 text-right text-[11px] text-muted-foreground">
                    {STRENGTH_LABELS[strength]}
                  </span>
                </div>
              )}

              {!otpStep && mode === "signup" && (
                <>
                  <div className="neon-field relative">
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      placeholder="Promosyon kodu (opsiyonel)"
                      value={promoCode}
                      onChange={(e) =>
                        setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))
                      }
                      maxLength={32}
                      className="inp w-full bg-transparent py-3 pr-4 text-sm font-mono uppercase placeholder:font-sans placeholder:normal-case"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Discount will be applied automatically at checkout.
                  </p>
                  <SignupLegalConsent value={consent} onChange={setConsent} />
                </>
              )}

              {/* Forgot password (signin only) */}
              {!otpStep && mode === "signin" && password.length > 0 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void resetPassword()}
                    className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {!otpStep && <TurnstileWidget key={mode} onToken={setTurnstileToken} />}

              <button
                type="submit"
                onClick={emailRipple.spawn}
                disabled={busy !== null || (mode === "signup" && !legalOk)}
                className="glow card-lift group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-4 py-3 text-sm font-semibold text-primary-foreground hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {emailRipple.layer}
                <span className="relative z-10 inline-flex items-center justify-center gap-2">
                  {busy === "email" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Please wait…
                    </>
                  ) : mode === "signin" ? (
                    <>
                      Sign in{" "}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  ) : otpStep ? (
                    <>
                      Verify email{" "}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  ) : (
                    <>
                      Create account{" "}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </span>
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              By continuing you accept the terms of use. Sign up and start with{" "}
              <span className="font-medium text-foreground">welcome credits</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
