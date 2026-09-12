import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  CircleDollarSign,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Lock,
  Network,
  Rocket,
  Search,
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
import {
  FaqSection,
  Testimonials,
  type FaqItem,
  type ReviewItem,
} from "@/components/landing/sections";

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
  {
    value: <CountUp end={99.9} decimals={1} suffix="%" />,
    label: "Attribution accuracy",
    sim: true,
  },
  { value: <CountUp end={50} prefix="<" suffix="ms" />, label: "Median agent latency", sim: true },
  { value: <CountUp end={10} suffix="k+" />, label: "Simulated events processed", sim: true },
  {
    value: <CountUp end={312} prefix="+" suffix="%" />,
    label: "Median ROI uplift in sim pilots",
    sim: true,
  },
];

/* What we do — animated capability cards (hover-follow spotlight) */
const WHAT_WE_DO = [
  {
    icon: Search,
    step: "01",
    title: "Scan the market like an analyst",
    text: "Trend agents watch 20+ platforms and 20+ country economies in real time — demand surges, seasonal shifts and margin anomalies surface before they become obvious.",
    accent: "indigo",
  },
  {
    icon: Gauge,
    step: "02",
    title: "Score products on real economics",
    text: "Winner Scores combine demand signals with genuine unit economics — supplier cost, shipping, fees, VAT, returns and ad spend — so a +420% trend never hides a -12% margin.",
    accent: "emerald",
  },
  {
    icon: Workflow,
    step: "03",
    title: "Match merchants to the right creators",
    text: "Our deal engine pairs verified sellers with tier-1 creators by audience fit, fee structure and compliance — then drafts hooks, ad copy and campaign briefs automatically.",
    accent: "indigo",
  },
  {
    icon: LineChart,
    step: "04",
    title: "Attribute, pay out, and prove ROI",
    text: "Every conversion is mapped across networks on one auditable ledger. Creators get paid on time; you see exactly which dollar earned which return — no black boxes.",
    accent: "emerald",
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Is this a real multi-agent system or just a simulation on the landing page?",
    a: "The landing demos run deterministic, pre-loaded local payloads so you can feel the workflow instantly with zero setup. Inside the product, the same pipeline runs against live market data: trend scanning, scoring, matching and attribution agents orchestrate real workflows you can inspect step by step.",
  },
  {
    q: "Which platforms and countries does Aroless cover?",
    a: "Aroless models 20+ e-commerce platforms — Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando, Allegro and more — across 20+ country economies, each with its own commission, VAT, shipping and certification logic baked into the score.",
  },
  {
    q: "How is a product score calculated?",
    a: "Scores are a hybrid of demand momentum and real unit economics: historical and predicted demand, competition level, gross margin after supplier/shipping/fees/taxes, plus compliance and return-rate risk. Every score ships with the evidence behind it.",
  },
  {
    q: "Do you handle payouts to creators and affiliates?",
    a: "Yes — the payout infrastructure layer schedules settlements, negotiates fee overrides and keeps an immutable, auditable ledger per agent and merchant. You can run it end-to-end or plug Aroless into your existing stack via API.",
  },
  {
    q: "What about security and compliance?",
    a: "Agents run with least-privilege roles, all payloads are signed, every run is recorded on an immutable event log and replays are deterministic. Data can be region-pinned for EU/GDPR or Turkey/KVKK workflows.",
  },
  {
    q: "Can I try it before paying?",
    a: "Yes. Signing up starts you with welcome credits so you can run real analyses before choosing a plan — no credit card required to begin.",
  },
];

const REVIEWS: ReviewItem[] = [
  {
    name: "Elif Kaya",
    role: "E-commerce operator · Istanbul",
    market: "TR",
    initials: "EK",
    quote:
      "We launched three products based on the radar before the trend peaked. The margin table caught a fee structure that would have silently killed our second best-seller.",
  },
  {
    name: "Jonas Weber",
    role: "FBA seller · Berlin",
    market: "DE",
    initials: "JW",
    quote:
      "The attribution mesh is the first thing that survived an audit by our finance team. Payouts and creator fees are provable, and renewals land without chasing anyone.",
  },
  {
    name: "Marta Silva",
    role: "DTC brand lead · Lisbon",
    market: "EU",
    initials: "MS",
    quote:
      "Our creators matched through Aroless convert 3x better than the lists we were buying. The hooks are genuinely good — we ship most of them as-is.",
  },
  {
    name: "Ahmet Demir",
    role: "Wholesale exporter · Gaziantep",
    market: "TR",
    initials: "AD",
    quote:
      "I export to six countries and used to keep the economics in spreadsheets. Now I see landed cost per country in seconds. It paid for itself in the first week.",
  },
  {
    name: "Sarah Mitchell",
    role: "Dropshipping operator · Manchester",
    market: "UK",
    initials: "SM",
    quote:
      "The simulator let me test the whole pipeline before committing. What I learned there stopped me from repeating a mistake that cost me money twice last year.",
  },
];

/**
 * Aroless — enterprise dark landing page.
 * All interactive demos stream deterministic, pre-loaded local simulation
 * payloads: zero external API calls, zero network latency, no accounts needed.
 */
export function MarketingLanding(): ReactElement {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#050608] font-sans text-slate-200 antialiased">
      {/* Page atmosphere */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[52rem] overflow-hidden"
      >
        <div className="ent-orb ent-orb-a" />
        <div className="ent-orb ent-orb-b" />
        <div className="ent-grid-bg" />
        <div className="absolute left-1/2 top-0 h-px w-[min(72rem,92%)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* `backdrop-blur` is deliberately avoided on the panels below: they sit on
          the continuously animated ambient layers, so every blurred surface had to
          be re-blurred each frame while scrolling. A slightly more opaque surface
          keeps the identical glass look at no recurring paint cost. */}
      {/* ── Header ─────────────────────────────────────────────── */}
      {/* No `backdrop-blur` here: a blurred backdrop on a sticky element has to be
          recomputed on every scroll frame, which was the worst source of scroll
          jank on this page (it sits on top of the animated ambient layers). The
          slightly stronger background keeps the exact same look. */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050608]/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0">
            <BrandLogo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            <a href="#platform" className="transition hover:text-slate-100">
              Platform
            </a>
            <a href="#architecture" className="transition hover:text-slate-100">
              Architecture
            </a>
            <a href="#metrics" className="transition hover:text-slate-100">
              Metrics
            </a>
            <a href="#faq" className="transition hover:text-slate-100">
              FAQ
            </a>
            <Link to="/pricing" className="transition hover:text-slate-100">
              Pricing
            </Link>
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
                {[
                  "Deterministic, replayable runs",
                  "SOC2-aligned data handling",
                  "Simulation-first onboarding",
                ].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <BadgeCheck size={15} className="text-emerald-400" /> {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="sweep-frame group rounded-xl"
                >
                  <span className="relative z-[1] flex h-11 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-6 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Deploy Aroless Swarm
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
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
                  <Zap size={13} className="text-indigo-300" />{" "}
                  <CountUp end={99.99} decimals={2} suffix="%" /> uptime
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

        {/* ── What we do ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <Bot size={12} /> What we do
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Four agents. One outcome: revenue you can trace.
            </h2>
            <p className="mt-3 text-slate-400">
              Aroless turns the affiliate &amp; e-commerce loop into a deterministic pipeline —
              hover a card to see how each stage works.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WHAT_WE_DO.map((card, i) => (
              <div
                key={card.title}
                onMouseMove={(e) => {
                  const el = e.currentTarget;
                  const r = el.getBoundingClientRect();
                  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
                  el.style.setProperty("--my", `${e.clientY - r.top}px`);
                }}
                className={`wwd-card group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/90 p-6 transition duration-300 hover:-translate-y-1.5 ${
                  card.accent === "emerald"
                    ? "hover:border-emerald-400/40"
                    : "hover:border-indigo-400/40"
                }`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {/* hover-follow spotlight + glow wash */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${
                    card.accent === "emerald"
                      ? "bg-[radial-gradient(240px_circle_at_var(--mx,50%)_var(--my,50%),rgba(16,185,129,0.14),transparent_70%)]"
                      : "bg-[radial-gradient(240px_circle_at_var(--mx,50%)_var(--my,50%),rgba(99,102,241,0.16),transparent_70%)]"
                  }`}
                />
                <span
                  aria-hidden
                  className={`pointer-events-none absolute -right-14 -top-14 size-36 rounded-full blur-3xl transition duration-500 group-hover:opacity-90 ${
                    card.accent === "emerald" ? "bg-emerald-500/10" : "bg-indigo-500/15"
                  }`}
                />

                <div className="relative flex items-start justify-between">
                  <span
                    className={`grid size-11 place-items-center rounded-xl border transition duration-300 group-hover:scale-110 ${
                      card.accent === "emerald"
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : "border-indigo-400/25 bg-indigo-400/10 text-indigo-300"
                    }`}
                  >
                    <card.icon size={20} />
                  </span>
                  <span className="font-mono text-xs font-semibold tracking-widest text-slate-600 transition group-hover:text-slate-400">
                    {card.step}
                  </span>
                </div>
                <h3 className="relative mt-5 text-lg font-bold leading-snug text-white">
                  {card.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-slate-400">{card.text}</p>
              </div>
            ))}
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
                className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0F1117]/90 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 ${
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
          <div className="mt-4 flex flex-col items-start gap-5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-[#0F1117] via-[#0F1117]/92 to-[#0F1117] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
                <FileText size={18} className="text-emerald-300" />
              </div>
              <div>
                <p className="font-semibold text-white">Enterprise-readiness checklist</p>
                <p className="mt-1 text-sm text-slate-400">
                  Signed payloads · immutable event log · role-scoped agents · region-pinned data ·
                  deterministic replays
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
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/90">
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
                  <div className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 px-6 py-3 text-center text-[10px] text-slate-600">
              * Simulation benchmarks — production figures depend on your traffic profile and data
              sources.
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <div id="faq" className="scroll-mt-24">
          <FaqSection
            items={FAQ_ITEMS}
            title="Questions, answered"
            subtitle="Everything teams ask before deploying Aroless — and how it actually works."
          />
        </div>

        {/* ── Final CTA ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/92 px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 right-0 h-48 w-96 rounded-full bg-emerald-500/10 blur-3xl"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                Deploy your swarm in minutes, not quarters.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400 sm:text-base">
                Start with a guided simulation, then connect your first data sources. The rest of
                the pipeline provisions itself.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  className="sweep-frame group rounded-xl"
                >
                  <span className="relative z-[1] flex h-12 items-center gap-2 rounded-[11px] bg-gradient-to-r from-indigo-500 to-indigo-400 px-7 text-sm font-semibold text-white transition group-hover:brightness-110">
                    Deploy Aroless Swarm
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
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

        {/* ── Reviews ────────────────────────────────────────────── */}
        <div id="reviews" className="scroll-mt-24">
          <Testimonials
            items={REVIEWS}
            title="Loved by merchants and creator teams"
            subtitle="Market operators across Europe and Turkey on running their loop with Aroless."
          />
        </div>
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
            <Link to="/auth" className="hover:text-slate-200">
              Sign in
            </Link>
            <Link to="/pricing" className="hover:text-slate-200">
              Pricing
            </Link>
            <a href="#faq" className="hover:text-slate-200">
              FAQ
            </a>
            <a href="#reviews" className="hover:text-slate-200">
              Reviews
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
