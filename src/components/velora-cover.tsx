import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import { VeloraMark } from "@/components/velora-mark";

const ROTATING = [
  "Kazanan ürünleri saniyeler içinde bulun.",
  "Trend radarıyla pazarı ilk siz görün.",
  "Viral reklamları tersine mühendislikle çözün.",
  "Rakip mağazaları tek tıkla analiz edin.",
];

const PERKS = [
  { icon: TrendingUp, label: "Canlı trend radarı", note: "20 platformdan veri" },
  { icon: Zap, label: "Hibrit AI puanlaması", note: "Paralel 3 model" },
  { icon: ShieldCheck, label: "Kâr simülasyonu", note: "ROI tahmini" },
];

const STATS = [
  { v: "12M+", l: "ürün tarandı" },
  { v: "20", l: "platform" },
  { v: "<25s", l: "arama süresi" },
];

/** Giriş ekranındaki premium "VELORA" kapağı — ana sayfada da kullanılır. */
export function VeloraCover({ className = "" }: { className?: string }) {
  const [rot, setRot] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setRot((i) => (i + 1) % ROTATING.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section
      className={`premium-card grain relative overflow-hidden rounded-3xl px-5 py-8 md:px-10 md:py-12 ${className}`}
    >
      {/* animated backdrop layers (same family as the sign-in cover) */}
      <div aria-hidden className="auth-aurora absolute inset-0 opacity-70" />
      <div aria-hidden className="auth-grid absolute inset-0 opacity-50" />
      <div aria-hidden className="auth-beam absolute inset-0" />
      <div aria-hidden className="auth-shimmer absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-20 h-80 w-80 rounded-full blur-3xl animate-float-slow"
        style={{ background: "radial-gradient(circle, var(--color-brand), transparent 65%)", opacity: 0.22 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full blur-3xl animate-float-slow"
        style={{
          background: "radial-gradient(circle, var(--color-brand-2), transparent 65%)",
          opacity: 0.18,
          animationDelay: "1.6s",
        }}
      />

      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="animate-rise-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 animate-pulse-soft" />
            Yapay zeka destekli ürün istihbaratı
          </div>

          <div className="mt-6 flex items-center gap-4">
            <VeloraMark size={56} />
            <h1 className="relative leading-none">
              <span aria-hidden className="velora-halo" />
              <span
                className="relative block text-[34px] font-extralight uppercase tracking-[0.3em] sm:text-[46px] sm:tracking-[0.34em]"
                aria-label="Velora"
              >
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
              <span className="velora-underline mt-3 block w-48 sm:w-56" />
              <span className="mt-3 block text-[10px] font-medium uppercase tracking-[0.4em] text-[var(--brand)]">
                AI Ticaret İşletim Sistemi
              </span>
            </h1>
          </div>

          <div className="mt-5 h-7 overflow-hidden">
            <p key={rot} className="animate-rise-in text-base text-muted-foreground sm:text-lg">
              {ROTATING[rot]}
            </p>
          </div>

          <div className="mt-8 flex items-center gap-6">
            {STATS.map((s) => (
              <div key={s.l}>
                <div className="text-2xl font-bold text-gradient">{s.v}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <ul className="space-y-3">
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
      </div>
    </section>
  );
}
