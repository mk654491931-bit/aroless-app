import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleDollarSign,
  FileText,
  Layers,
  Lock,
  Network,
  Rocket,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { AgentConsole } from "@/components/landing/agent-console";
import { CapabilitySimulator } from "@/components/landing/capability-simulator";
import { AgentTopology } from "@/components/landing/agent-topology";
import { CountUp } from "@/components/landing/count-up";

const ECOSYSTEMS = [
  "Amazon",
  "TikTok Shop",
  "Shopify",
  "Trendyol",
  "eBay",
  "Etsy",
  "Zalando",
  "Allegro",
  "Cdiscount",
  "Hepsiburada",
];

const BENTO = [
  {
    icon: Layers,
    title: "Automated Attribution",
    text: "Cross-network conversion mapping collapses into one auditable ROAS picture — no spreadsheet reconciliation, no black-box credit.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Security & Compliance",
    text: "Least-privilege agent roles, signed payloads, immutable event log and deterministic replays for every run.",
    span: "lg:col-span-2",
  },
  {
    icon: Workflow,
    title: "Multi-Agent Swarm Logic",
    text: "Specialized agents negotiate via a shared decision mesh — trend scan, deal engine, content dispatch and payout act as one system.",
    span: "lg:col-span-3",
  },
  {
    icon: CircleDollarSign,
    title: "Real-Time Payout Infrastructure",
    text: "Fee optimization, threshold rules and scheduled settlements run on an auditable ledger with per-agent reconciliation.",
    span: "lg:col-span-1",
  },
];

const METRICS = [
  { value: <CountUp end={99.9} decimals={1} suffix="%" />, label: "Attribution accuracy", sim: true },
  { value: <CountUp end={50} prefix="<" suffix="ms" />, label: "Median agent latency", sim: true },
  { value: <CountUp end={10} suffix="k+" />, label: "Simulated events processed", sim: true },
  { value: <CountUp end={312} prefix="+" suffix="%" />, label: "Median ROI uplift in sim pilots", sim: true },
];

/**
 * Aroless — enterprise dark landing page.
 * All interactive demos stream deterministic, pre-loaded local simulation
 * payloads: zero external API calls, zero network latency, no accounts needed.
 */
export function MarketingLanding() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#050608] font-sans text-slate-200 antialiased">
      {/* Page atmosphere */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[52rem] overflow-hidden">
        <div className="ent-orb ent-orb-a" />
        <div className="ent-orb ent-orb-b" />
        <div className="ent-grid-bg" />
        <div className="absolute left-1/2 top-0 h-px w-[min(72rem,92%)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050608]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0">
            <BrandLogo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            <a href="#platform" className="transition hover:text-slate-100">Platform</a>
            <a href="#architecture" className="transition hover:text-slate-100">Architecture</a>
            <a href="#metrics" className="transition hover:text-slate-100">Metrics</a>
            <Link to="/pricing" className="transition hover:text-slate-100">Pricing</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:border-white/25 hover:text-white sm:block"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-[#050608] transition hover:bg-slate-200"
            >
              Get access
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 md:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
                <Sparkles size={12} /> Autonomous Multi-Agent Infrastructure
              </div>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl xl:text-6xl">
                Turn market signals into{" "}
                <span className="bg-gradient-to-r from-indigo-300 via-white to-emerald-300 bg-clip-text text-transparent">
                  orchestrated revenue
                </span>{" "}
                on autopilot.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Aroless coordinates specialized agents — trend scanning, merchant–creator matching,
                content dispatch, attribution and payout — into one deterministic pipeline for
                affiliate &amp; e-commerce teams.
              </p>

              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
                {["Deterministic, replayable runs", "SOC2-aligned data handling", "Simulation-first onboarding"].map(
                  (item) => (
                    <li key={item} className="inline-flex items-center gap-1.5">
                      <BadgeCheck size={15} className="text-emerald-400" /> {item}
                    </li>
                  ),
                )}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="sweep-frame group rounded-xl"
                >
                  <span className="relative z-[1] flex h-11 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-6 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Deploy Aroless Swarm
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
                <a
                  href="#architecture"
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
                >
                  View Architecture Docs
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Zap size={13} className="text-indigo-300" /> <CountUp end={99.99} decimals={2} suffix="%" /> uptime
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock size={13} className="text-emerald-400" /> No credit card to start
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Rocket size={13} className="text-slate-400" /> Provisioned in minutes
                </span>
              </div>
            </div>

            {/* Console */}
            <div className="console-log-in">
              <AgentConsole />
              <p className="mt-3 text-center text-[11px] text-slate-600">
                Deterministic local simulation — no live systems are touched.
              </p>
            </div>
          </div>

          {/* Ecosystem strip */}
          <div className="mt-16">
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
              Orchestrating across major affiliate &amp; commerce ecosystems
            </p>
            <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-2">
              {ECOSYSTEMS.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-400"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capabilities Simulator ────────────────────────────── */}
        <section id="platform" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <Zap size={12} /> Instant value engine
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Experience the swarm. No sign-up, no network.
            </h2>
            <p className="mt-3 text-slate-400">
              Select a vertical and run the multi-agent pipeline — every payload is pre-loaded
              locally, so the demo is instant and fully deterministic.
            </p>
          </div>
          <div className="mt-10">
            <CapabilitySimulator />
          </div>
        </section>

        {/* ── Architecture ───────────────────────────────────────── */}
        <section id="architecture" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
              <Network size={12} /> System architecture
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              A pipeline you can trace end to end
            </h2>
            <p className="mt-3 text-slate-400">
              Data ingestion → agent decision mesh → automated conversion. Every hop is
              deterministic and replayable.
            </p>
          </div>

          <div className="mt-10">
            <AgentTopology />
          </div>

          {/* Bento capability grid */}
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {BENTO.map((card) => (
              <div
                key={card.title}
                className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/70 p-6 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-white/20 ${
                  card.span ?? ""
                }`}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-indigo-500/0 blur-3xl transition duration-500 group-hover:bg-indigo-500/15"
                />
                <div className="grid size-10 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10">
                  <card.icon size={18} className="text-indigo-300" />
                </div>
                <h3 className="mt-4 font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{card.text}</p>
              </div>
            ))}
          </div>

          {/* Compliance banner */}
          <div className="mt-4 flex flex-col items-start gap-5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-[#0F1117] via-[#0F1117]/80 to-[#0F1117] p-6 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
                <FileText size={18} className="text-emerald-300" />
              </div>
              <div>
                <p className="font-semibold text-white">Enterprise-readiness checklist</p>
                <p className="mt-1 text-sm text-slate-400">
                  Signed payloads · immutable event log · role-scoped agents · region-pinned data · deterministic replays
                </p>
              </div>
            </div>
            <a
              href="#architecture"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              View Architecture Docs <ArrowRight size={13} />
            </a>
          </div>
        </section>

        {/* ── Metrics ────────────────────────────────────────────── */}
        <section id="metrics" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/70 backdrop-blur-xl">
            <div className="border-b border-white/10 px-6 py-5 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                Engineered for throughput, built for trust
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
                Deterministic agent execution keeps every run measurable, auditable and repeatable.
              </p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-white/5 lg:grid-cols-4 lg:divide-y-0">
              {METRICS.map((m) => (
                <div key={m.label} className="px-6 py-8 text-center">
                  <div className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                    {m.value}
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 px-6 py-3 text-center text-[10px] text-slate-600">
              * Simulation benchmarks — production figures depend on your traffic profile and data sources.
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/80 px-6 py-14 text-center backdrop-blur-xl sm:px-12">
            <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-0 h-48 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                Deploy your swarm in minutes, not quarters.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400 sm:text-base">
                Start with a guided simulation, then connect your first data sources. The rest of
                the pipeline provisions itself.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link to="/auth" search={{ mode: "signup" }} className="sweep-frame group rounded-xl">
                  <span className="relative z-[1] flex h-12 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-7 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Deploy Aroless Swarm
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
                <a
                  href="#architecture"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 px-6 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5"
                >
                  View Architecture Docs
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
                {["No credit card", "Simulation-first onboarding", "Cancel anytime"].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <Check size={13} className="text-emerald-400" /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <BrandLogo />
          <p className="text-center text-[11px] text-slate-600">
            © {new Date().getFullYear()} Aroless. All interactive demos run on deterministic local
            simulation payloads.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <Link to="/auth" className="hover:text-slate-200">Sign in</Link>
            <Link to="/pricing" className="hover:text-slate-200">Pricing</Link>
            <a href="#architecture" className="hover:text-slate-200">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
