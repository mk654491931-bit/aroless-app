import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket,
  Store,
  Megaphone,
  Radio,
  Brain,
  Trophy,
  Loader2,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  Star,
  Wallet,
  Users,
  Gauge,
  RotateCcw,
  Play,
  Award,
  Sparkles,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { parseMoneyNum } from "@/lib/consistency";
import {
  SIM_PLATFORMS,
  PLATFORM_PRESETS,
  CAPITAL_OPTIONS,
  SHIPPING_MODES,
  AUDIENCES,
  ANGLES,
  BADGES,
  SIM_LENGTH,
  newSandbox,
  blankProduct,
  advanceDay,
  restockSandbox,
  applyCrisisChoice,
  unitEconomics,
  roiPct,
  type SandboxState,
  type SimPlatform,
  type Crisis,
  type BadgeId,
  type SandboxProduct,
  type Review,
} from "@/lib/sandbox-engine";
import {
  startSimulation,
  getSimCrisis,
  getSimReviews,
  getSimCoach,
  submitSimRun,
  getSimLeaderboard,
  getSimCredits,
} from "@/lib/sandbox.functions";
import type { CoachAdvice } from "@/lib/sandbox.server";
import { PostRunAnalytics } from "./post-run-analytics";
import { PlatformChrome, HardModeBar, HARD_SCENARIOS } from "./platform-chrome";

const KEY = "omni-sandbox-v2";
const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

type View = "store" | "ads" | "feed" | "coach" | "ranks";

export function SandboxTab({
  catalog,
  onUpgrade,
}: {
  catalog: WinningProduct[];
  onUpgrade: () => void;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<SandboxState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("store");
  const [crisis, setCrisis] = useState<Crisis | null>(null);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const [busy, setBusy] = useState(false);
  const [hardMode, setHardMode] = useState("none");
  const [celebrate, setCelebrate] = useState<BadgeId[]>([]);
  const submitted = useRef(false);

  const startFn = useServerFn(startSimulation);
  const crisisFn = useServerFn(getSimCrisis);
  const reviewsFn = useServerFn(getSimReviews);
  const coachFn = useServerFn(getSimCoach);
  const submitFn = useServerFn(submitSimRun);
  const creditsFn = useServerFn(getSimCredits);

  const creditsQ = useQuery({ queryKey: ["sim-credits"], queryFn: () => creditsFn() });
  const simCredits = creditsQ.data?.simCredits ?? 0;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SandboxState;
        if (parsed?.version === 2) setState(parsed);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (state) localStorage.setItem(KEY, JSON.stringify(state));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  // push finished runs to the leaderboard once
  useEffect(() => {
    if (!state || state.status === "running" || state.submitted || submitted.current) return;
    submitted.current = true;
    submitFn({
      data: {
        store_name: state.storeName,
        platform: state.platform,
        starting_capital: state.startingCapital,
        final_capital: Math.round(state.capital),
        net_profit: Math.round(state.totalProfit),
        roi_pct: roiPct(state),
        orders: state.totalOrders,
        store_rating: Math.round(state.rating),
        days: Math.min(SIM_LENGTH, state.day - 1),
        badges: state.badges,
      },
    })
      .then(() => {
        setState((s) => (s ? { ...s, submitted: true } : s));
        qc.invalidateQueries({ queryKey: ["sim-leaderboard"] });
      })
      .catch(() => {
        submitted.current = false;
      });
  }, [state, submitFn, qc]);

  const start = useMutation({
    mutationFn: async (cfg: {
      platform: SimPlatform;
      capital: number;
      storeName: string;
      product: WinningProduct | null;
      name: string;
      cogs: number;
      price: number;
    }) => {
      const res = await startFn({
        data: {
          platform: cfg.platform,
          capital: cfg.capital,
          product: cfg.name,
          price: cfg.price,
          cogs: cfg.cogs,
        },
      });
      return { res, cfg };
    },
    onSuccess: ({ res, cfg }) => {
      const p = blankProduct(
        cfg.name,
        cfg.cogs,
        cfg.price,
        res.baseline.avg_market_price_usd,
        cfg.product?.emoji ?? "📦",
        cfg.product?.image_url,
      );
      setState(
        newSandbox({
          storeName: cfg.storeName,
          platform: cfg.platform,
          capital: cfg.capital,
          baseline: res.baseline,
          product: p,
        }),
      );
      setView("store");
      setAdvice(null);
      submitted.current = false;
      qc.invalidateQueries({ queryKey: ["sim-credits"] });
      toast.success("Simulation started — real market baseline loaded.");
    },
    onError: (e: Error) => {
      if (e.message.includes("NO_SIM_CREDITS")) {
        onUpgrade();
        toast.error("Out of simulation credits.");
      } else toast.error(e.message);
    },
  });

  const nextDay = async () => {
    if (!state || state.status !== "running" || busy) return;
    setBusy(true);
    const { state: next, record, newBadges } = advanceDay(state);
    setState(next);
    if (newBadges.length) {
      setCelebrate(newBadges);
      setTimeout(() => setCelebrate([]), 4200);
    }

    const prod = next.products[0];
    const hardHint = HARD_SCENARIOS.find((h) => h.id === hardMode)?.hint ?? "";
    const recent = `${hardHint ? `ZOR MOD: ${hardHint} | ` : ""}${next.feed
      .slice(-4)
      .map((f) => f.text)
      .join(" | ")}`.slice(0, 580);

    // reviews from real order behaviour
    if (prod && record.orders > 0) {
      reviewsFn({
        data: {
          platform: next.platform,
          product: prod.name,
          price: prod.price,
          marketPrice: next.rivalPrice,
          shippingDays: SHIPPING_MODES[prod.shipping].days,
          rating: next.rating,
          orders: record.orders,
        },
      })
        .then(({ reviews }) => {
          if (!reviews.length) return;
          setState((s) =>
            s
              ? {
                  ...s,
                  reviews: [
                    ...reviews.map((r) => ({ ...r, day: record.day, product: prod.name })),
                    ...s.reviews,
                  ].slice(0, 40) as Review[],
                  rating: Math.max(
                    0,
                    Math.min(
                      100,
                      s.rating + reviews.reduce((a, r) => a + (r.stars - 3.5) * 0.8, 0),
                    ),
                  ),
                }
              : s,
          );
        })
        .catch(() => {});
    }

    // coach
    coachFn({
      data: {
        platform: next.platform,
        product: prod?.name ?? "store",
        day: record.day,
        summary: `${record.visitors} visitors, ${record.orders} orders, CVR ${record.cvr}%, revenue ${money(record.revenue)}, ad spend ${money(record.adSpend)}, fees ${money(record.fees)}, refunds ${money(record.refunds)}, profit ${money(record.profit)}`,
        state: `capital ${money(next.capital)} (start ${money(next.startingCapital)}), rating ${next.rating.toFixed(0)}/100, price ${money(prod?.price ?? 0)} vs rival ${money(next.rivalPrice)}, stock ${prod?.stock ?? 0}, daily ad budget ${money(prod?.adBudget ?? 0)}, shipping ${prod ? SHIPPING_MODES[prod.shipping].label : "-"}`,
      },
    })
      .then(({ advice: a }) => a && setAdvice(a))
      .catch(() => {});

    // crisis roll
    if (next.status === "running" && record.day >= 2 && Math.random() < 0.34) {
      crisisFn({
        data: {
          platform: next.platform,
          product: prod?.name ?? "store",
          day: next.day,
          capital: next.capital,
          rating: next.rating,
          price: prod?.price ?? 0,
          adBudget: prod?.adBudget ?? 0,
          recent,
        },
      })
        .then(({ crisis: c }) => c && setCrisis(c))
        .catch(() => {});
    }
    setBusy(false);
  };

  if (!hydrated)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin" />
      </div>
    );

  if (!state) {
    return (
      <SetupView
        catalog={catalog}
        simCredits={simCredits}
        loading={start.isPending}
        onUpgrade={onUpgrade}
        onStart={(cfg) => start.mutate(cfg)}
      />
    );
  }

  const preset = PLATFORM_PRESETS[state.platform];
  const last = state.history[state.history.length - 1];

  return (
    <div className="space-y-5">
      <PlatformChrome
        platform={state.platform}
        storeName={state.storeName}
        day={Math.min(state.day, SIM_LENGTH)}
      />

      <HardModeBar value={hardMode} onChange={setHardMode} />

      <MetricsBar
        state={state}
        preset={preset}
        last={last}
        busy={busy}
        onNext={nextDay}
        onReset={() => {
          setState(null);
          setAdvice(null);
          setCrisis(null);
        }}
      />

      {state.status !== "running" && (
        <PostRunAnalytics
          state={state}
          onRestart={() => {
            setState(null);
            setAdvice(null);
            setCrisis(null);
            submitted.current = false;
          }}
        />
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(
          [
            { id: "store", label: "Store & Inventory", icon: Store },
            { id: "ads", label: "Ad Manager", icon: Megaphone },
            { id: "feed", label: "Rival & Market Feed", icon: Radio },
            { id: "coach", label: "AI Coach", icon: Brain },
            { id: "ranks", label: "Achievements & Ranks", icon: Trophy },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${view === id ? "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow" : "bg-white/5 hover:bg-white/10 text-muted-foreground"}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {view === "store" && <StoreView state={state} setState={setState} />}
      {view === "ads" && <AdsView state={state} setState={setState} />}
      {view === "feed" && <FeedView state={state} />}
      {view === "coach" && <CoachView state={state} advice={advice} />}
      {view === "ranks" && <RanksView state={state} />}

      {crisis && (
        <CrisisModal
          crisis={crisis}
          onChoose={(i) => {
            setState((s) => (s ? applyCrisisChoice(s, crisis, i) : s));
            setCrisis(null);
          }}
        />
      )}

      {celebrate.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 space-y-2">
          {celebrate.map((id) => {
            const b = BADGES.find((x) => x.id === id)!;
            return (
              <div
                key={id}
                className="glass rounded-xl px-4 py-3 flex items-center gap-3 border border-[oklch(0.68_0.20_265)]/50 glow animate-in slide-in-from-right"
              >
                <Award size={20} className="text-[oklch(0.8_0.17_85)]" />
                <div>
                  <div className="text-sm font-bold">{b.label}</div>
                  <div className="text-xs text-muted-foreground">{b.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Setup ---------------- */

function SetupView({
  catalog,
  simCredits,
  loading,
  onStart,
  onUpgrade,
}: {
  catalog: WinningProduct[];
  simCredits: number;
  loading: boolean;
  onUpgrade: () => void;
  onStart: (cfg: {
    platform: SimPlatform;
    capital: number;
    storeName: string;
    product: WinningProduct | null;
    name: string;
    cogs: number;
    price: number;
  }) => void;
}) {
  const [platform, setPlatform] = useState<SimPlatform>("Shopify");
  const [capital, setCapital] = useState<number>(2000);
  const [storeName, setStoreName] = useState("");
  const [pick, setPick] = useState<string>(catalog[0]?.name ?? "__blank");
  const [blankName, setBlankName] = useState("");
  const [blankCogs, setBlankCogs] = useState("6");
  const [blankPrice, setBlankPrice] = useState("29.99");

  const product = catalog.find((c) => c.name === pick) ?? null;
  const cogs = product
    ? Math.max(0.5, parseMoneyNum(product.supplier_price_usd))
    : Number(blankCogs) || 0;
  const price = product
    ? Math.max(cogs * 1.5, parseMoneyNum(product.selling_price_usd))
    : Number(blankPrice) || 0;
  const name = product ? product.name : blankName.trim();
  const ready = !!name && cogs > 0 && price > cogs;

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-[oklch(0.68_0.20_265)]/20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 mb-3">
            <Sparkles size={12} /> Flight simulator for e-commerce
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">
            E-Commerce <span className="text-gradient">Simulator</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Run a real store for 30 days on live market benchmarks — real CVR, CPC, fees and
            logistics pulled per platform. Every decision moves capital. Nothing costs real money.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-5 md:p-6 space-y-6">
        <Section title="1 · Select platform">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {SIM_PLATFORMS.map((p) => {
              const pr = PLATFORM_PRESETS[p];
              const on = platform === p;
              return (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`text-left rounded-xl p-3 border transition ${on ? "border-[oklch(0.68_0.20_265)] bg-white/10 glow" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{p}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10">
                      {(pr.feePct * 100).toFixed(1)}% fee
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{pr.blurb}</p>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="2 · Starting capital">
          <div className="flex flex-wrap gap-2">
            {CAPITAL_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => setCapital(c)}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition ${capital === c ? "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow" : "bg-white/5 hover:bg-white/10"}`}
              >
                {c >= 10000 ? "$10,000+" : `$${c.toLocaleString()}`}
              </button>
            ))}
          </div>
        </Section>

        <Section title="3 · Product">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
          >
            {catalog.map((c) => (
              <option key={c.name} value={c.name} className="bg-[#0b0d16]">
                {c.emoji || "📦"} {c.name} — {c.selling_price_usd}
              </option>
            ))}
            <option value="__blank" className="bg-[#0b0d16]">
              Start with a blank store (custom product)
            </option>
          </select>
          {!product && (
            <div className="grid md:grid-cols-3 gap-2 mt-3">
              <Field label="Product name">
                <input
                  value={blankName}
                  onChange={(e) => setBlankName(e.target.value)}
                  placeholder="e.g. Mini ice maker"
                  className="inp"
                />
              </Field>
              <Field label="COGS ($)">
                <input
                  value={blankCogs}
                  onChange={(e) => setBlankCogs(e.target.value)}
                  inputMode="decimal"
                  className="inp"
                />
              </Field>
              <Field label="Selling price ($)">
                <input
                  value={blankPrice}
                  onChange={(e) => setBlankPrice(e.target.value)}
                  inputMode="decimal"
                  className="inp"
                />
              </Field>
            </div>
          )}
          {product && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-2xl">{product.emoji || "📦"}</div>
              <div className="text-xs text-muted-foreground">
                Imported defaults · COGS <b className="text-foreground">{money(cogs)}</b> · price{" "}
                <b className="text-foreground">{money(price)}</b> · margin{" "}
                <b className="text-foreground">{product.profit_margin_pct}%</b>
              </div>
            </div>
          )}
        </Section>

        <Section title="4 · Store name">
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="My Practice Store"
            className="inp w-full"
          />
        </Section>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/10">
          <button
            disabled={!ready || loading}
            onClick={() => {
              if (simCredits <= 0) {
                onUpgrade();
                return;
              }
              onStart({ platform, capital, storeName, product, name, cogs, price });
            }}
            className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
            {loading ? "Loading live market data…" : "Start simulation — 1 credit"}
          </button>
          <span className="text-xs text-muted-foreground">
            {simCredits} simulation credit{simCredits === 1 ? "" : "s"} left
          </span>
        </div>
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {title}
    </h3>
    {children}
  </div>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    {children}
  </label>
);

/* ---------------- Dashboard chrome ---------------- */

function MetricsBar({
  state,
  preset,
  last,
  busy,
  onNext,
  onReset,
}: {
  state: SandboxState;
  preset: (typeof PLATFORM_PRESETS)[SimPlatform];
  last?: { profit: number; cvr: number; orders: number };
  busy: boolean;
  onNext: () => void;
  onReset: () => void;
}) {
  const roi = roiPct(state);
  return (
    <div className="glass rounded-2xl p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl grid place-items-center font-bold text-xs"
            style={{
              background: `color-mix(in oklab, ${preset.accent} 25%, transparent)`,
              color: preset.accent,
            }}
          >
            {preset.short}
          </div>
          <div>
            <div className="font-bold leading-tight">{state.storeName}</div>
            <div className="text-xs text-muted-foreground">
              {state.platform} · Day {Math.min(state.day, SIM_LENGTH)} / {SIM_LENGTH}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs bg-white/5 hover:bg-white/10"
          >
            <RotateCcw size={13} />
            New run
          </button>
          {state.status === "running" ? (
            <button
              onClick={onNext}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] text-white glow disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Advance
              to day {state.day}
            </button>
          ) : (
            <span
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${state.status === "bankrupt" ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}`}
            >
              {state.status === "bankrupt" ? "Insolvent" : "Run complete"}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Metric
          icon={Wallet}
          label="Capital"
          value={money(state.capital)}
          sub={`start ${money(state.startingCapital)}`}
        />
        <Metric icon={TrendingUp} label="Revenue" value={money(state.totalRevenue)} />
        <Metric
          icon={roi >= 0 ? TrendingUp : TrendingDown}
          label="Net profit / ROI"
          value={money(state.totalProfit)}
          sub={`${roi}% ROI`}
          tone={state.totalProfit >= 0 ? "good" : "bad"}
        />
        <Metric
          icon={Package}
          label="Orders"
          value={String(state.totalOrders)}
          sub={last ? `CVR ${last.cvr}%` : undefined}
        />
        <Metric
          icon={Gauge}
          label="Store health"
          value={`${state.rating.toFixed(0)}/100`}
          tone={state.rating >= 80 ? "good" : state.rating >= 55 ? undefined : "bad"}
        />
        <Metric
          icon={Users}
          label="Yesterday"
          value={last ? money(last.profit) : "—"}
          sub={last ? `${last.orders} orders` : "no data yet"}
          tone={last ? (last.profit >= 0 ? "good" : "bad") : undefined}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        <Icon size={12} />
        {label}
      </div>
      <div
        className={`text-lg font-bold ${tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ---------------- Store & inventory ---------------- */

function StoreView({
  state,
  setState,
}: {
  state: SandboxState;
  setState: React.Dispatch<React.SetStateAction<SandboxState | null>>;
}) {
  const preset = PLATFORM_PRESETS[state.platform];
  const [qty, setQty] = useState<Record<string, string>>({});
  const update = (id: string, patch: Partial<SandboxProduct>) =>
    setState((s) =>
      s ? { ...s, products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : s,
    );

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {state.products.map((p) => {
          const ue = unitEconomics(p, preset);
          return (
            <div key={p.id} className="glass rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-4">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="w-16 h-16 rounded-xl object-cover border border-white/10"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-white/5 grid place-items-center text-3xl">
                    {p.emoji}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold truncate">{p.name}</h3>
                  <div className="text-xs text-muted-foreground">
                    In stock <b className="text-foreground">{p.stock}</b> · sold {p.unitsSold} ·
                    refunds {p.unitsRefunded}
                    {p.incoming.length > 0 && (
                      <> · {p.incoming.reduce((a, i) => a + i.qty, 0)} in transit</>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => update(p.id, { listed: !p.listed })}
                  className={`text-xs px-2.5 py-1 rounded-lg ${p.listed ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-muted-foreground"}`}
                >
                  {p.listed ? "Listed" : "Paused"}
                </button>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <Field label={`Selling price (rival ${money(state.rivalPrice)})`}>
                  <input
                    className="inp w-full"
                    inputMode="decimal"
                    value={p.price}
                    onChange={(e) =>
                      update(p.id, { price: Math.max(0.5, Number(e.target.value) || 0) })
                    }
                  />
                </Field>
                <Field label="Shipping option">
                  <select
                    className="inp w-full"
                    value={p.shipping}
                    onChange={(e) =>
                      update(p.id, { shipping: e.target.value as SandboxProduct["shipping"] })
                    }
                  >
                    {Object.entries(SHIPPING_MODES).map(([k, v]) => (
                      <option key={k} value={k} className="bg-[#0b0d16]">
                        {v.label} · {v.days}d · ${v.cost.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Restock quantity">
                  <div className="flex gap-2">
                    <input
                      className="inp w-full"
                      inputMode="numeric"
                      placeholder="50"
                      value={qty[p.id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })}
                    />
                    <button
                      onClick={() => {
                        const n = parseInt(qty[p.id] || "0", 10);
                        setState((s) => {
                          if (!s) return s;
                          const r = restockSandbox(s, p.id, n);
                          if (r.error) toast.error(r.error);
                          else {
                            toast.success(`Ordered ${n} units`);
                            setQty({ ...qty, [p.id]: "" });
                          }
                          return r.state;
                        });
                      }}
                      className="rounded-lg px-3 text-xs font-semibold bg-white/10 hover:bg-white/15 whitespace-nowrap"
                    >
                      Buy
                    </button>
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
                <Chip label="Platform fee" value={money(ue.fee)} />
                <Chip label="Fulfilment" value={money(ue.ship)} />
                <Chip
                  label="Profit / unit"
                  value={money(ue.net)}
                  tone={ue.net > 0 ? "good" : "bad"}
                />
                <Chip
                  label="Net margin"
                  value={`${ue.marginPct}%`}
                  tone={ue.marginPct >= 25 ? "good" : ue.marginPct > 0 ? undefined : "bad"}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Bulk pricing: 50+ units −6%, 100+ −12%, 200+ −18%. Lead time scales with the live
                sourcing benchmark ({state.baseline.shipping_days} days).
              </p>
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-3">Live market baseline</h3>
          <ul className="space-y-1.5 text-xs">
            <Row k="Benchmark CVR" v={`${state.baseline.cvr_pct}%`} />
            <Row k="Ad CTR" v={`${state.baseline.ctr_pct}%`} />
            <Row k="CPC" v={money(state.baseline.cpc_usd)} />
            <Row k="Benchmark CAC" v={money(state.baseline.cac_usd)} />
            <Row k="Market price" v={money(state.baseline.avg_market_price_usd)} />
            <Row k="Refund rate" v={`${state.baseline.refund_rate_pct}%`} />
            <Row k="Delivery" v={`${state.baseline.shipping_days} days`} />
          </ul>
          <p className="text-[11px] text-muted-foreground mt-3">{state.baseline.benchmark_note}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{state.baseline.seasonality}</p>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Star size={14} className="text-[oklch(0.8_0.17_85)]" />
            Customer reviews
          </h3>
          {state.reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No reviews yet — reviews appear after your first orders ship.
            </p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {state.reviews.map((r, i) => (
                <div key={i} className="rounded-lg bg-white/5 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{r.author}</span>
                    <span className="text-[11px] text-[oklch(0.8_0.17_85)]">
                      {"★".repeat(r.stars)}
                      {"☆".repeat(5 - r.stars)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.text}</p>
                  <span className="text-[10px] text-muted-foreground/70">Day {r.day}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <li className="flex justify-between">
    <span className="text-muted-foreground">{k}</span>
    <b>{v}</b>
  </li>
);
const Chip = ({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) => (
  <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
    <div className="text-[10px] text-muted-foreground">{label}</div>
    <div
      className={`font-semibold ${tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : ""}`}
    >
      {value}
    </div>
  </div>
);

/* ---------------- Ad manager ---------------- */

function AdsView({
  state,
  setState,
}: {
  state: SandboxState;
  setState: React.Dispatch<React.SetStateAction<SandboxState | null>>;
}) {
  const preset = PLATFORM_PRESETS[state.platform];
  const update = (id: string, patch: Partial<SandboxProduct>) =>
    setState((s) =>
      s ? { ...s, products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : s,
    );

  return (
    <div className="space-y-4">
      {state.products.map((p) => {
        const aud = AUDIENCES.find((a) => a.id === p.audience)!;
        const ang = ANGLES.find((a) => a.id === p.angle)!;
        const ue = unitEconomics(p, preset);
        const cpc =
          (state.baseline.cpc_usd * aud.cpcMult) / preset.adEfficiency / Math.max(0.6, ang.ctrMult);
        const clicks = p.adBudget / Math.max(0.05, cpc);
        const cvr =
          (state.baseline.cvr_pct / 100) *
          aud.cvrMult *
          ang.cvrMult *
          SHIPPING_MODES[p.shipping].cvrMult;
        const projOrders = clicks * cvr;
        const projProfit = projOrders * ue.net - p.adBudget;
        return (
          <div key={p.id} className="glass rounded-2xl p-5">
            <h3 className="font-bold mb-4">
              {p.emoji} {p.name} — campaign
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <Field label={`Daily ad budget (${money(p.adBudget)})`}>
                <input
                  type="range"
                  min={0}
                  max={Math.max(50, Math.round(state.capital / 3))}
                  step={5}
                  value={p.adBudget}
                  onChange={(e) => update(p.id, { adBudget: Number(e.target.value) })}
                  className="w-full accent-[oklch(0.68_0.20_265)]"
                />
              </Field>
              <Field label="Target audience">
                <select
                  className="inp w-full"
                  value={p.audience}
                  onChange={(e) =>
                    update(p.id, { audience: e.target.value as SandboxProduct["audience"] })
                  }
                >
                  {AUDIENCES.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#0b0d16]">
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Creative angle">
                <select
                  className="inp w-full"
                  value={p.angle}
                  onChange={(e) =>
                    update(p.id, { angle: e.target.value as SandboxProduct["angle"] })
                  }
                >
                  {ANGLES.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#0b0d16]">
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4 text-xs">
              <Chip label="Est. CPC" value={money(Math.round(cpc * 100) / 100)} />
              <Chip label="Est. clicks/day" value={clicks.toFixed(0)} />
              <Chip label="Est. CVR" value={`${(cvr * 100).toFixed(2)}%`} />
              <Chip label="Est. orders/day" value={projOrders.toFixed(1)} />
              <Chip
                label="Projected daily profit"
                value={money(Math.round(projProfit * 100) / 100)}
                tone={projProfit >= 0 ? "good" : "bad"}
              />
            </div>
            {p.stock === 0 && (
              <p className="mt-3 text-xs text-red-300 flex items-center gap-1.5">
                <AlertTriangle size={13} />
                No stock — every dollar of ad spend is wasted until inventory arrives.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Feed ---------------- */

function FeedView({ state }: { state: SandboxState }) {
  const items = [...state.feed].reverse();
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3">AI rival & market feed</h3>
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {items.map((f, i) => (
            <div key={i} className="flex gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-[10px] text-muted-foreground w-12 shrink-0 pt-0.5">
                Day {f.day}
              </span>
              <span
                className={`text-xs ${f.kind === "good" ? "text-emerald-300" : f.kind === "bad" ? "text-red-300" : f.kind === "rival" ? "text-[oklch(0.78_0.16_75)]" : ""}`}
              >
                {f.text}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3">Daily P&L</h3>
        <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1 text-xs">
          {[...state.history].reverse().map((h) => (
            <div
              key={h.day}
              className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
            >
              <span className="text-muted-foreground">Day {h.day}</span>
              <span>{h.orders} ord</span>
              <span
                className={
                  h.profit >= 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"
                }
              >
                {money(h.profit)}
              </span>
            </div>
          ))}
          {state.history.length === 0 && (
            <p className="text-muted-foreground">Advance a day to see results.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Coach ---------------- */

function CoachView({ state, advice }: { state: SandboxState; advice: CoachAdvice | null }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Brain size={15} className="text-[oklch(0.75_0.18_265)]" />
          AI coach & mentor
        </h3>
        {!advice ? (
          <p className="text-sm text-muted-foreground">
            Advance a day and your mentor will break down exactly why the numbers moved.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-base font-semibold text-gradient">{advice.verdict}</p>
            <p className="text-sm text-muted-foreground">{advice.why}</p>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Do this tomorrow
              </h4>
              <ul className="space-y-2">
                {advice.actions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <ChevronRight
                      size={16}
                      className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5"
                    />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
            {advice.watch_out && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm flex gap-2">
                <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />
                {advice.watch_out}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3">Known market risks</h3>
        <ul className="space-y-2 text-xs text-muted-foreground">
          {state.baseline.risks.map((r, i) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle size={13} className="text-amber-300 shrink-0 mt-0.5" />
              {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Achievements & leaderboard ---------------- */

function RanksView({ state }: { state: SandboxState }) {
  const lbFn = useServerFn(getSimLeaderboard);
  const lb = useQuery({ queryKey: ["sim-leaderboard"], queryFn: () => lbFn() });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Award size={15} className="text-[oklch(0.8_0.17_85)]" />
          Badges
        </h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {BADGES.map((b) => {
            const on = state.badges.includes(b.id);
            return (
              <div
                key={b.id}
                className={`rounded-xl p-3 border ${on ? "border-[oklch(0.68_0.20_265)]/60 bg-white/10" : "border-white/10 bg-white/5 opacity-55"}`}
              >
                <div className="text-sm font-semibold">{b.label}</div>
                <div className="text-[11px] text-muted-foreground">{b.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Trophy size={15} className="text-[oklch(0.8_0.17_85)]" />
          Leaderboard · ROI
        </h3>
        {lb.isLoading ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <div className="space-y-1.5">
            {(lb.data?.rows ?? []).map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${r.is_me ? "bg-[oklch(0.68_0.20_265)]/20 border border-[oklch(0.68_0.20_265)]/40" : "bg-white/5"}`}
              >
                <span className="w-5 text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate font-semibold">{r.store_name}</span>
                <span className="text-muted-foreground">{r.platform}</span>
                <span
                  className={
                    Number(r.roi_pct) >= 0 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"
                  }
                >
                  {Number(r.roi_pct).toFixed(0)}%
                </span>
              </div>
            ))}
            {(lb.data?.rows ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">
                No finished runs yet — complete a 30-day run to rank.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Crisis ---------------- */

function CrisisModal({ crisis, onChoose }: { crisis: Crisis; onChoose: (i: number) => void }) {
  const tone =
    crisis.severity === "high"
      ? "border-red-400/50"
      : crisis.severity === "medium"
        ? "border-amber-400/50"
        : "border-white/20";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`glass rounded-2xl max-w-lg w-full p-6 border ${tone}`}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-amber-300" />
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/10">
            {crisis.severity} severity
          </span>
        </div>
        <h3 className="text-lg font-bold">{crisis.title}</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">{crisis.body}</p>
        <div className="space-y-2">
          {crisis.choices.map((c, i) => (
            <button
              key={i}
              onClick={() => onChoose(i)}
              className="w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-3 transition"
            >
              <div className="text-sm font-semibold">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.detail}</div>
              <div className="text-[11px] mt-1 flex gap-3">
                <span className={c.capital >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {c.capital >= 0 ? "+" : ""}
                  {money(c.capital)}
                </span>
                <span className={c.ratingDelta >= 0 ? "text-emerald-400" : "text-red-400"}>
                  rating {c.ratingDelta >= 0 ? "+" : ""}
                  {c.ratingDelta}
                </span>
                <span className={c.cvrDelta >= 0 ? "text-emerald-400" : "text-red-400"}>
                  CVR {c.cvrDelta >= 0 ? "+" : ""}
                  {c.cvrDelta}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
