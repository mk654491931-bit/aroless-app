import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Cpu, Layers, ListTree, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export type HubSection = {
  /** ToolCard'ın DOM id'si; sidebar hash'i ile aynı olmalı. */
  id: string;
  label: string;
};

function currentHash(): string {
  if (typeof window === "undefined") return "";
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return window.location.hash.replace(/^#/, "");
  }
}

/**
 * MODÜL KABUĞU — her araç merkezinin ortak üst gezinmesi.
 *
 * `sections` verilirse sayfa içi "modül haritası" çıkar. Sidebar bağlantıları
 * aynı id'lere `#hash` ile gider; böylece "Landed Cost" tıklayan kullanıcı
 * modülün başına değil, doğrudan ilgili araca düşer.
 */
export function HubShell({
  emoji,
  title,
  subtitle,
  sections,
  children,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  sections?: readonly HubSection[];
  children: ReactNode;
}) {
  const routerHash = useRouterState({ select: (s) => s.location.hash });
  const [activeId, setActiveId] = useState(() => currentHash() || sections?.[0]?.id || "");

  useEffect(() => {
    if (!sections?.length) return;
    let id = routerHash.replace(/^#/, "");
    try {
      id = decodeURIComponent(id);
    } catch {
      /* bozuk yüzde kodlaması: ham kimliği kullan */
    }
    setActiveId(id || sections[0].id);
    // Router hash-only geçişlerde de doğru karta kaydır; ilk yüklemede
    // tarayıcı React'ten önce davrandığı için içerik sonrası bir kez daha.
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [routerHash, sections]);

  return (
    <div className="min-h-screen">
      <header className="glass top-light sticky top-0 z-40 border-b border-white/10">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
          <BrandLogo subtitle={title} />
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
          >
            <ArrowLeft size={13} /> Product Finder
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="animate-fade-in premium-card live-card relative overflow-hidden p-6">
          <div className="hero-halo" aria-hidden="true" />
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
            style={{ background: "color-mix(in oklab, var(--accent-active) 22%, transparent)" }}
          />
          <h1 className="relative flex items-center gap-2 text-2xl font-black tracking-tight md:text-3xl">
            <span>{emoji}</span> {title}
          </h1>
          <div className="flow-line relative mt-3 w-40 max-w-full" aria-hidden="true" />
          <p className="relative mt-3 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          <div className="relative mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-active)]/25 bg-[var(--accent-active)]/10 px-2.5 py-1 text-[var(--accent-active)] transition-transform duration-200 hover:-translate-y-0.5">
              <Cpu size={11} /> 3 motor paralel + sentez katmanı
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--profit)]/25 bg-[var(--profit)]/10 px-2.5 py-1 text-[var(--profit)] transition-transform duration-200 hover:-translate-y-0.5">
              <Layers size={11} /> risk · aksiyon · varsayım çıktısı
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground transition-transform duration-200 hover:-translate-y-0.5">
              <ShieldCheck size={11} /> otomatik anahtar rotasyonu
            </span>
          </div>
        </section>

        {sections && sections.length > 0 && (
          <nav
            aria-label="Modül araçları"
            className="sticky top-[57px] z-30 mt-4 rounded-xl border border-white/10 bg-background/85 p-1.5 shadow-lg shadow-black/20 backdrop-blur-md"
          >
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="ms-1 me-1 hidden shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:inline-flex">
                <ListTree size={12} /> Modül haritası
              </span>
              {sections.map((section, index) => {
                const active = activeId === section.id;
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    onClick={() => setActiveId(section.id)}
                    aria-current={active ? "true" : undefined}
                    className={`group inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                      active
                        ? "border-[var(--accent-active)]/40 bg-[var(--accent-active)]/15 text-[var(--accent-active)]"
                        : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`font-mono text-[10px] ${
                        active ? "opacity-80" : "opacity-45 group-hover:opacity-70"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.label}
                  </a>
                );
              })}
            </div>
          </nav>
        )}

        <div className="stagger-in mt-7 grid gap-4 lg:grid-cols-2">{children}</div>
      </main>
    </div>
  );
}
