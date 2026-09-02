import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createCheckout } from "@/lib/lemon.functions";
import { validatePromoCode, getMyPromoCode } from "@/lib/promo.functions";
import { useMoney } from "@/lib/currency";
import { X, Check, Sparkles, Zap, Crown, Ticket, Loader2 } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/plans";

const ICONS = { Starter: Sparkles, Pro: Zap, Business: Crown } as const;

export function PricingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const checkout = useServerFn(createCheckout);
  const validateFn = useServerFn(validatePromoCode);
  const myPromoFn = useServerFn(getMyPromoCode);
  const { currency, rate, fmt, isLive } = useMoney();
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [promo, setPromo] = useState("");
  const [checking, setChecking] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [autoApplied, setAutoApplied] = useState(false);

  // Kayıt sırasında girilen promosyon kodunu otomatik uygula.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    let cancelled = false;
    (async () => {
      try {
        const res = await myPromoFn();
        if (cancelled || !res?.code || !res.discount_pct) return;
        setPromo(res.code);
        setDiscount(res.discount_pct);
        setAutoApplied(true);
      } catch {
        /* sessizce yoksay */
      }
    })();
    return () => {
      cancelled = true;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, myPromoFn, onClose]);

  if (!open) return null;

  const applyPromo = async () => {
    if (!promo.trim()) return;
    setChecking(true);
    try {
      const res = await validateFn({ data: { code: promo } });
      if (res.valid) {
        setDiscount(res.discount_pct);
        toast.success(`%${res.discount_pct} indirim uygulandı`);
      } else {
        setDiscount(0);
        toast.error(res.reason ?? "Geçersiz kod");
      }
    } catch (e) {
      setDiscount(0);
      toast.error(e instanceof Error ? e.message : "Kod doğrulanamadı");
    } finally {
      setChecking(false);
    }
  };

  const subscribe = async (plan: PlanId) => {
    setLoading(plan);
    try {
      const promoCode = discount > 0 && promo.trim() ? promo.trim().toUpperCase() : undefined;
      const { url } = await checkout({ data: { plan, promoCode } });
      const w = window as unknown as {
        Paddle?: { Checkout: { open: (opts: { transactionId: string }) => void } };
      };
      if (w.Paddle?.Checkout) {
        // Paddle overlay checkout (client-side SDK varsa)
        w.Paddle.Checkout.open({ transactionId: url });
      } else {
        // Paddle S2S checkout URL redirect
        window.location.href = url;
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(null);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-modal-title"
      className="fixed inset-0 z-100 flex min-h-dvh items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass relative h-full max-h-dvh w-full overflow-y-auto rounded-none p-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-6xl sm:rounded-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10"
        >
          <X size={18} />
        </button>
        <div className="text-center mb-6">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
            <Sparkles size={12} /> Lansmana özel · 1 hafta %50 indirim
          </div>
          <h2 id="pricing-modal-title" className="text-2xl md:text-3xl font-bold">
            Upgrade your <span className="text-gradient">edge</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tüm modüller her pakette açık. Paket büyüdükçe aylık kullanım hakkın artar.
          </p>
          <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
              <Ticket size={13} className="text-[oklch(0.75_0.18_265)]" />
              <input
                value={promo}
                onChange={(e) => {
                  setPromo(e.target.value.toUpperCase());
                  setDiscount(0);
                }}
                placeholder="Promosyon kodu"
                className="w-36 bg-transparent text-sm font-mono uppercase outline-none placeholder:font-sans placeholder:normal-case"
              />
              <button
                onClick={applyPromo}
                disabled={checking}
                className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/15 disabled:opacity-60"
              >
                {checking ? <Loader2 size={12} className="animate-spin" /> : "Uygula"}
              </button>
            </div>
            {discount > 0 && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                %{discount} indirim aktif{autoApplied ? " · kayıt kodunuzdan otomatik" : ""}
              </span>
            )}
            {currency !== "USD" && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                {isLive ? "Canlı kur" : "Yedek kur"}: 1 USD = {fmt(rate, currency)}
              </span>
            )}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const Icon = ICONS[p.id];
            const final = p.usd * (1 - discount / 100);
            return (
              <div
                key={p.id}
                className={`rounded-xl p-6 border ${p.highlight ? "border-[oklch(0.68_0.20_265)] glow bg-linear-to-b from-white/5 to-transparent" : "border-white/10 bg-white/5"}`}
              >
                {p.highlight && (
                  <div className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-linear-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] mb-2">
                    Most popular
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={18} className="text-[oklch(0.75_0.18_265)]" />
                  <h3 className="text-lg font-bold">{p.label}</h3>
                </div>
                <div className="mb-1 flex items-baseline gap-2">
                  {discount > 0 && (
                    <span className="text-lg text-muted-foreground line-through">${p.usd}</span>
                  )}
                  <span className="text-4xl font-bold">${final.toFixed(0)}</span>
                  <span className="text-sm text-muted-foreground">/ay</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    {p.credits} kredi / ay
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold">
                    Tüm modüller açık
                  </span>
                </div>
                {currency !== "USD" && (
                  <div className="mb-4 text-xs text-muted-foreground">
                    ≈ {fmt(final * rate, currency)} / ay · güncel kur ile
                  </div>
                )}
                {currency === "USD" && <div className="mb-4" />}
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (
                    <li key={f} className="text-sm flex gap-2">
                      <Check size={16} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => subscribe(p.id)}
                  disabled={loading !== null}

                  className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${p.highlight ? "bg-linear-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow" : "bg-white/10 hover:bg-white/15"} disabled:opacity-60`}
                >
                  {loading === p.id
                    ? "Ödeme sayfası açılıyor…"
                    : `Satın al — ${currency === "USD" ? `$${final.toFixed(2)}` : fmt(final * rate, currency)}/ay`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-center text-muted-foreground mt-4">
          Secure checkout by Paddle. Cancel anytime.
        </p>
      </div>
    </div>,
    document.body,
  );
}
