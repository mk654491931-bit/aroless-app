import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import { ArolessMark } from "@/components/velora-mark";

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

/** Giriş ekranındaki premium "AROLESS" kapağı — ana sayfada da kullanılır. */
export function ArolessCover({ className = "" }: { className?: string }) {
  const [rot, setRot] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setRot((i) => (i + 1) % ROTATING.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section
      className={`premium-card grain relative w-full max-w-full overflow-hidden rounded-2xl px-4 py-7 sm:rounded-3xl sm:px-6 sm:py-9 md:px-10 md:py-12 ${className}`}
    >
      {/* animated backdrop layers (same family as the sign-in cover) */}
      <div aria-hidden className="auth-aurora absolute inset-0 opacity-70" />
      <div aria-hidden className="auth-grid absolute inset-0 opacity-50" />
      <div aria-hidden className="auth-beam absolute inset-0" />
      <div aria-hidden className="auth-shimmer absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-20 h-56 w-56 rounded-full blur-3xl animate-float-slow sm:h-80 sm:w-80"
        style={{ background: "radial-gradient(circle, var(--color-brand), transparent 65%)", opacity: 0.22 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-16 h-64 w-64 rounded-full blur-3xl animate-float-slow sm:h-96 sm:w-96"
        style={{
          background: "radial-gradient(circle, var(--color-brand-2), transparent 65%)",
          opacity: 0.18,
          animationDelay: "1.6s",
        }}
      />

      <div className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="min-w-0 animate-rise-in">
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur sm:text-xs">
            <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse-soft" />
            <span className="truncate">Yapay zeka destekli ürün istihbaratı</span>
          </div>

          <div className="mt-6 flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="shrink-0">
              <ArolessMark size={40} className="sm:hidden" />
              <ArolessMark size={56} className="hidden sm:block" />
            </span>
            <h1 className="relative min-w-0 flex-1 leading-none">
              <span aria-hidden className="velora-halo" />
              <span
                className="relative block font-extralight uppercase"
                style={{
                  fontSize: "clamp(22px, 7vw, 46px)",
                  letterSpacing: "clamp(0.12em, 2.2vw, 0.32em)",
                }}
                aria-label="Aroless"
              >
                {"AROLESS".split("").map((ch, i) => (
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
              <span className="velora-underline mt-3 block w-full max-w-[14rem] sm:max-w-[16rem]" />
              <span
                className="mt-3 block font-medium uppercase text-[var(--brand)]"
                style={{ fontSize: "clamp(9px, 1.6vw, 10px)", letterSpacing: "clamp(0.18em, 1.4vw, 0.4em)" }}
              >
                AI Ticaret İşletim Sistemi
              </span>
            </h1>
          </div>

          <div className="mt-5 min-h-[3.25rem] sm:min-h-[1.75rem]">
            <p key={rot} className="animate-rise-in text-sm text-muted-foreground sm:text-base lg:text-lg">
              {ROTATING[rot]}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            {STATS.map((s) => (
              <div key={s.l} className="min-w-0">
                <div className="text-xl font-bold text-gradient sm:text-2xl">{s.v}</div>
                <div className="text-[11px] text-muted-foreground sm:text-xs">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <ul className="min-w-0 space-y-3">
          {PERKS.map((p, i) => (
            <li
              key={p.label}
              className="premium-card card-lift group flex min-w-0 items-center gap-3 p-3 hover:-translate-y-0.5 sm:gap-4 sm:p-4"
              style={{ animation: `rise-in 0.6s cubic-bezier(0.22,1,0.36,1) ${0.1 + i * 0.09}s both` }}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/60 text-foreground transition-transform group-hover:scale-110">
                <p.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.note}</span>
              </span>
              <ArrowRight className="hidden h-4 w-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 sm:block" />
            </li>
          ))}
        </ul>
      </div>
    </section>

  );
}
