import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Cpu, Layers, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export function HubShell({
  emoji, title, subtitle, children,
}: { emoji: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="glass top-light sticky top-0 z-40 border-b border-white/10">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
          <BrandLogo subtitle={title} />
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10">
            <ArrowLeft size={13} /> Product Finder
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="animate-fade-in relative overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface)]/60 p-6 backdrop-blur">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
            style={{ background: "color-mix(in oklab, var(--accent-active) 22%, transparent)" }}
          />
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight md:text-3xl">
            <span>{emoji}</span> {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-active)]/25 bg-[var(--accent-active)]/10 px-2.5 py-1 text-[var(--accent-active)]">
              <Cpu size={11} /> 3 motor paralel + sentez katmanı
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--profit)]/25 bg-[var(--profit)]/10 px-2.5 py-1 text-[var(--profit)]">
              <Layers size={11} /> risk · aksiyon · varsayım çıktısı
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
              <ShieldCheck size={11} /> otomatik anahtar rotasyonu
            </span>
          </div>
        </section>

        <div className="mt-7 grid gap-4 lg:grid-cols-2">{children}</div>
      </main>
    </div>
  );
}
