import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Download, ListTree, Shield } from "lucide-react";
import { LEGAL_DOCS, type LegalDoc } from "@/lib/legal-content";
import { LegalDocBody } from "./legal-doc-body";

export function LegalLayout({ doc }: { doc: LegalDoc }) {
  const [active, setActive] = useState(doc.sections[0]?.id ?? "");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 },
    );
    doc.sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [doc]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
      <header className="print:hidden">
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Ana sayfa
          </Link>
          <span>/</span>
          <span className="text-foreground">Yasal & Uyum</span>
        </nav>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
              <Shield className="h-6 w-6 text-[var(--brand,var(--primary))]" />
              {doc.title}
            </h1>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
              <CalendarClock className="h-3.5 w-3.5" />
              Son Güncelleme: {doc.updated}
            </div>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card/70 px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
          >
            <Download className="h-4 w-4" />
            PDF Olarak İndir
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {LEGAL_DOCS.map((d) => (
            <Link
              key={d.slug}
              to="/legal/$slug"
              params={{ slug: d.slug }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                d.slug === doc.slug
                  ? "border-[var(--brand,var(--primary))]/40 bg-[var(--brand,var(--primary))]/10 text-foreground"
                  : "border-border bg-card/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.short}
            </Link>
          ))}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block print:hidden">
          <div className="sticky top-24 rounded-xl border border-border bg-card/40 p-4 backdrop-blur">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <ListTree className="h-3.5 w-3.5" /> İçindekiler
            </p>
            <ul className="mt-3 space-y-1">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs leading-snug transition-colors ${
                      active === s.id
                        ? "bg-accent/40 font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.heading}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="min-w-0 rounded-2xl border border-border bg-card/30 p-5 backdrop-blur md:p-8 print:border-0 print:bg-transparent print:p-0">
          <LegalDocBody doc={doc} />
          <p className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">
            Bu belge bilgilendirme amaçlıdır ve Aroless tarafından güncellenir. Sorularınız için
            mk65449191@gmail.com
          </p>
        </main>
      </div>
    </div>
  );
}
