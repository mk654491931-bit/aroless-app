import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight,
  ChevronDown,
  MessageSquareQuote,
  Sparkles,
  Star,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Shared landing building blocks (landing + auth pages)               */
/* ------------------------------------------------------------------ */

export type ReviewItem = {
  name: string;
  role: string;
  market: string;
  quote: string;
  initials: string;
};

/* ---------------- Testimonials / reviews ---------------- */

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-muted-foreground">{subtitle}</p>
    </>
  );
}

export function StarRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`} aria-label="5 yıldız">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={14} className="fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

export function Testimonials({
  items,
  title = "Kullanıcılar ne diyor?",
  subtitle = "Gerçek satıcıların Aroless ile deneyimleri.",
}: {
  items: ReviewItem[];
  title?: string;
  subtitle?: string;
}) {
  const [active, setActive] = useState(0);
  const t = items[active] ?? items[0]!;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6" aria-label="Yorumlar">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          <MessageSquareQuote size={12} /> Yorumlar
        </span>
        <Heading title={title} subtitle={subtitle} />
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1fr_1.15fr]">
        {/* Highlighted quote (keyed so it re-animates on switch) */}
        <div
          key={active}
          className="console-log-in ls-darkglass relative overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/85 p-7 backdrop-blur-xl"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-amber-400/10 blur-3xl"
          />
          <StarRow />
          <blockquote className="mt-4 text-lg font-medium leading-relaxed text-white">
            “{t.quote}”
          </blockquote>
          <div className="mt-6 flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-300 text-sm font-bold text-[#050608]">
              {t.initials}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{t.name}</p>
              <p className="text-xs text-white/60">{t.role}</p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" /> {t.market}
            </span>
          </div>
        </div>

        {/* Reviewer list */}
        <div className="grid content-center gap-2.5">
          {items.map((r, i) => (
            <button
              key={r.name}
              type="button"
              onClick={() => setActive(i)}
              className={`group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-300 ${
                active === i
                  ? "border-indigo-400/50 bg-indigo-400/15 shadow-[0_0_24px_-8px_rgba(99,102,241,0.5)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
              }`}
            >
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                  active === i
                    ? "bg-gradient-to-br from-indigo-500 to-indigo-300 text-[#050608]"
                    : "bg-white/10 text-slate-300"
                }`}
              >
                {r.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{r.name}</span>
                <span className="block truncate text-xs text-white/60">{r.role}</span>
              </span>
              <StarRow className="shrink-0" />
              <ArrowRight
                size={15}
                className={`shrink-0 text-slate-500 transition-transform ${
                  active === i ? "translate-x-0 text-indigo-300" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <StarRow />
        </span>
        <span>4.9/5 ortalama memnuniyet</span>
        <span>·</span>
        <span>2.400+ doğrulanmış satıcı</span>
        <span>·</span>
        <span>22 ülkede aktif</span>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */

export type FaqItem = { q: string; a: string };

export function FaqSection({
  items,
  title = "Sıkça sorulan sorular",
  subtitle = "Aradığın cevabı bulamadıysan destek ekibine yaz.",
}: {
  items: FaqItem[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6" aria-label="SSS">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
          <Sparkles size={12} /> SSS
        </span>
        <Heading title={title} subtitle={subtitle} />
      </div>

      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        <Accordion type="single" collapsible className="space-y-3">
          {items.map((item, i) => (
            <AccordionItem
              key={item.q}
              value={`item-${i}`}
              className="ls-darkglass group overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/75 backdrop-blur-xl transition duration-300 hover:border-white/20 data-[state=open]:border-indigo-400/40"
            >
              <AccordionTrigger className="px-5 py-4 text-left text-sm font-semibold text-white hover:no-underline hover:text-white">
                <span className="pr-2">{item.q}</span>
                <span className="ls-chip grid size-6 shrink-0 place-items-center rounded-full transition group-hover:border-indigo-400/50 group-hover:text-indigo-300">
                  <ChevronDown size={13} />
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5 text-sm leading-relaxed text-white/65">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
