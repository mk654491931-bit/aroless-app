import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChevronDown, MessageSquareQuote, Sparkles } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Shared landing building blocks (landing + auth pages)               */
/* ------------------------------------------------------------------ */

/*
 * ÖNEMLİ — yorum duvarı hakkında:
 * Bu bölümdeki metinler GERÇEK müşteri yorumu DEĞİLDİR. Ürünün hangi
 * sorunlara cevap verdiğini göstermek için yazılmış temsilî örneklerdir ve
 * arayüzde bu açıkça belirtilir:
 *   • bölüm başlığının altında kalıcı bir uyarı satırı,
 *   • her kartın üstünde "ÖRNEK" etiketi.
 * Ayrıca eskiden burada gösterilen "4.9/5 ortalama · 2.400+ doğrulanmış
 * satıcı · 22 ülke" gibi toplam istatistikler kaldırıldı: ölçülmüş bir veri
 * olmadan bu sayıları yayınlamak yanıltıcı olurdu.
 */

export type ExampleReview = {
  name: string;
  role: string;
  market: string;
  quote: string;
  initials: string;
};

const DEFAULT_NOTICE =
  "Bu yorumlar gerçek müşteri yorumu değildir; ürünün hangi sorunlara cevap verdiğini " +
  "göstermek için yazılmış temsilî örneklerdir.";

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

/* ---------------- Example review wall ---------------- */

/**
 * Temsilî yorum duvarı. Her kart örnek olduğu için hem bölüm seviyesinde hem
 * kart seviyesinde etiketlenir.
 */
export function ExampleReviews({
  items,
  title,
  subtitle = "Aşağıdakiler temsilî senaryolardır.",
  notice = DEFAULT_NOTICE,
}: {
  items: ExampleReview[];
  title: string;
  subtitle?: string;
  notice?: string;
}) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6" aria-label="Örnek yorumlar">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          <MessageSquareQuote size={12} /> Örnek yorumlar
        </span>
        <Heading title={title} subtitle={subtitle} />
        <p
          role="note"
          className="mx-auto mt-4 max-w-xl rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          {notice}
        </p>
      </div>

      <ul className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((r) => (
          <li
            key={`${r.name}-${r.role}`}
            className="relative flex flex-col rounded-2xl border border-white/10 bg-[#0F1117]/75 p-5 backdrop-blur-xl transition hover:border-white/20"
          >
            <span className="absolute right-3 top-3 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
              Örnek
            </span>
            <blockquote className="text-sm leading-relaxed text-white/85">“{r.quote}”</blockquote>
            <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-slate-300">
                {r.initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{r.name}</p>
                <p className="truncate text-xs text-white/60">{r.role}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                {r.market}
              </span>
            </div>
          </li>
        ))}
      </ul>
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
