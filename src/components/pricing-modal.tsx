import { useEffect, useState } from "react";
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
    let cancelled = false;
    (async () => {
      try {
        const res = await myPromoFn();
        if (cancelled || !res?.code || !res.discount_pct) return;
        setPromo(res.code);
        setDiscount(res.discount_pct);
        setAutoApplied(true);
      } catch { /* sessizce yoksay */ }
    })();
    return () => { cancelled = true; };
  }, [open, myPromoFn]);

  if (!open) return null;


  const applyPromo = async () => {
    if (!promo.trim()) return;
    setChecking(true);
    try {
      const res = await validateFn({ data: { code: promo } });
      if (res.valid) { setDiscount(res.discount_pct); toast.success(`%${res.discount_pct} indirim uygulandı`); }
      else { setDiscount(0); toast.error(res.reason ?? "Geçersiz kod"); }
    } catch (e) {
      setDiscount(0);
      toast.error(e instanceof Error ? e.message : "Kod doğrulanamadı");
    } finally { setChecking(false); }
  };

  const subscribe = async (plan: PlanId) => {
    setLoading(plan);
    try {
      const { url } = await checkout({ data: { plan } });
      const finalUrl = discount > 0 && promo.trim()
        ? `${url}${url.includes("?") ? "&" : "?"}checkout[discount_code]=${encodeURIComponent(promo.trim().toUpperCase())}`
        : url;
      // Lemon Squeezy overlay via their JS if available, else new tab
      const w = window as unknown as { LemonSqueezy?: { Url: { Open: (u: string) => void } }, createLemonSqueezy?: () => void };
      if (w.LemonSqueezy?.Url?.Open) {
        w.LemonSqueezy.Url.Open(finalUrl);
      } else {
        window.open(finalUrl, "_blank", "noopener");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally { setLoading(null); }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass rounded-2xl max-w-3xl w-full p-6 md:p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10"><X size={18} /></button>
        <div className="text-center mb-6">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-300">
            <Sparkles size={12} /> Lansmana özel · 1 hafta %50 indirim
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">Upgrade your <span className="text-gradient">edge</span></h2>
          <p className="text-sm text-muted-foreground mt-1">
            Paket büyüdükçe soldaki modül grupları açılır. Eğitim ve simülatör her pakete dahildir.
          </p>
          <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
              <Ticket size={13} className="text-[oklch(0.75_0.18_265)]" />
              <input
                value={promo}
                onChange={(e) => { setPromo(e.target.value.toUpperCase()); setDiscount(0); }}
                placeholder="Promosyon kodu"
                className="w-36 bg-transparent text-sm font-mono uppercase outline-none placeholder:font-sans placeholder:normal-case"
              />
              <button onClick={applyPromo} disabled={checking}
                className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/15 disabled:opacity-60">
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
            const launch = p.price * 0.5;
            const final = launch * (1 - discount / 100);
            return (
              <div key={p.id} className={`rounded-xl p-6 border ${p.highlight ? "border-[oklch(0.68_0.20_265)] glow bg-gradient-to-b from-white/5 to-transparent" : "border-white/10 bg-white/5"}`}>
                {p.highlight && <div className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] mb-2">Most popular</div>}
                <div className="flex items-center gap-2 mb-1"><Icon size={18} className="text-[oklch(0.75_0.18_265)]" /><h3 className="text-lg font-bold">{p.label}</h3></div>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-lg text-muted-foreground line-through">${p.price}</span>
                  <span className="text-4xl font-bold">${final.toFixed(discount > 0 ? 2 : 2)}</span>
                  <span className="text-sm text-muted-foreground">/ay</span>
                </div>
                <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                  Lansmana özel · %50 indirim · 1 hafta geçerli
                </div>
                {currency !== "USD" && (
                  <div className="mb-4 text-xs text-muted-foreground">≈ {fmt(final * rate, currency)} / ay · güncel kur ile</div>
                )}
                {currency === "USD" && <div className="mb-4" />}
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (<li key={f} className="text-sm flex gap-2"><Check size={16} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" /><span>{f}</span></li>))}
                </ul>
                <button onClick={() => subscribe(p.name)} disabled={loading !== null}
                  className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${p.highlight ? "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow" : "bg-white/10 hover:bg-white/15"} disabled:opacity-60`}>
                  {loading === p.id
                    ? "Ödeme sayfası açılıyor…"
                    : `Satın al — ${currency === "USD" ? `$${final.toFixed(2)}` : fmt(final * rate, currency)}/ay`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-center text-muted-foreground mt-4">Secure checkout by Lemon Squeezy. Cancel anytime.</p>
      </div>
    </div>
  );
}
