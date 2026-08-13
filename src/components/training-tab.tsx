import { useEffect, useMemo, useRef, useState } from "react";
import {
  Store, Play, FastForward, RotateCcw, Plus, Package, Megaphone, BarChart3, ScrollText,
  Star, ShoppingCart, TrendingUp, TrendingDown, Wallet, Search, Truck, AlertTriangle,
  Trophy, Trash2, ShieldCheck, Coins, Target, Sparkles,
  Flag, Brain, Crown, Pause, Zap, Lightbulb, CheckCircle2, Circle,
} from "lucide-react";
import { toast } from "sonner";
import type { WinningProduct } from "@/lib/gemini.functions";
import {
  DIFFICULTIES, RUN_LENGTH, newRun, productFromWinner, restock, simulateDay,
  netMarginPct, unitProfit,
  type Difficulty, type SimState, type StoreProduct,
} from "@/lib/training-sim";
import {
  computeXp, levelFromXp, missionState, coachTips, loadHof, saveHof, type RunResult,
} from "@/lib/training-meta";


const KEY = "omni-training-run-v1";
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function load(): SimState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimState;
    return parsed?.version === 1 ? parsed : null;
  } catch { return null; }
}

export function TrainingTab({ catalog }: { catalog: WinningProduct[] }) {
  const [state, setState] = useState<SimState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"storefront" | "products" | "ads" | "analytics" | "log">("storefront");
  const [storeName, setStoreName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setState(load()); setHydrated(true); }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (state) window.localStorage.setItem(KEY, JSON.stringify(state));
    else window.localStorage.removeItem(KEY);
  }, [state, hydrated]);

  if (!hydrated) return <div className="h-40" />;

  if (!state) {
    return (
      <SetupScreen
        storeName={storeName} setStoreName={setStoreName}
        difficulty={difficulty} setDifficulty={setDifficulty}
        catalogCount={catalog.length}
        onStart={() => setState(newRun(storeName, difficulty))}
      />
    );
  }

  const cfg = DIFFICULTIES[state.difficulty];
  const over = state.status !== "running";

  const advance = (days: number) => {
    setBusy(true);
    setState((prev) => {
      if (!prev) return prev;
      let s = prev;
      for (let i = 0; i < days; i++) {
        if (s.status !== "running") break;
        s = simulateDay(s).state;
      }
      return s;
    });
    setTimeout(() => setBusy(false), 260);
  };

  const addProduct = (p: WinningProduct) => {
    setState((prev) => {
      if (!prev) return prev;
      if (prev.products.some((x) => x.name === p.name)) { toast.error("Already listed in your store"); return prev; }
      toast.success(`${p.name} listed. Order stock before you run ads.`);
      return { ...prev, products: [...prev.products, productFromWinner(p)] };
    });
  };

  const patch = (id: string, fields: Partial<StoreProduct>) =>
    setState((prev) => prev ? { ...prev, products: prev.products.map((p) => (p.id === id ? { ...p, ...fields } : p)) } : prev);

  const doRestock = (id: string, qty: number) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = restock(prev, id, qty);
      if (r.error) toast.error(r.error);
      else toast.success("Purchase order sent to supplier");
      return r.state;
    });

  const removeProduct = (id: string) =>
    setState((prev) => prev ? { ...prev, products: prev.products.filter((p) => p.id !== id) } : prev);

  const totalAds = state.products.reduce((a, p) => a + (p.listed ? p.adBudget : 0), 0);
  const inventoryValue = state.products.reduce((a, p) => a + p.stock * p.unitCost, 0);
  const progress = Math.max(0, Math.min(100, (state.totalProfit / cfg.targetProfit) * 100));

  const views: { id: typeof view; label: string; icon: typeof Store }[] = [
    { id: "storefront", label: "Storefront", icon: Store },
    { id: "products", label: "Catalog & Stock", icon: Package },
    { id: "ads", label: "Ads & Pricing", icon: Megaphone },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "log", label: "Activity", icon: ScrollText },
  ];

  return (
    <section className="space-y-5">
      {/* Command bar */}
      <div className="premium-card rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] p-1.5"><Store size={15} /></span>
              <h2 className="text-lg font-bold">{state.storeName}</h2>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{cfg.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Day {Math.min(state.day, RUN_LENGTH)} of {RUN_LENGTH} · Simulated store — no real money, real mechanics.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={over || busy} onClick={() => advance(1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3.5 py-2 text-xs font-semibold glow disabled:opacity-40">
              <Play size={13} /> Run 1 day
            </button>
            <button disabled={over || busy} onClick={() => advance(7)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40">
              <FastForward size={13} /> 7 days
            </button>
            <button onClick={() => { if (confirm("Reset this training run?")) setState(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-2">
          <Kpi icon={Wallet} label="Cash" value={money(state.cash)} tone={state.cash < 100 ? "bad" : "good"} />
          <Kpi icon={Coins} label="Revenue" value={compact(state.totalRevenue)} />
          <Kpi icon={state.totalProfit >= 0 ? TrendingUp : TrendingDown} label="Net profit" value={compact(state.totalProfit)} tone={state.totalProfit >= 0 ? "good" : "bad"} />
          <Kpi icon={ShoppingCart} label="Orders" value={String(state.totalOrders)} />
          <Kpi icon={Package} label="Stock value" value={compact(inventoryValue)} />
          <Kpi icon={Megaphone} label="Daily ads" value={money(totalAds)} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Target size={12} /> Profit target {compact(cfg.targetProfit)}</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {state.activeEvent && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <Sparkles size={14} className="mt-0.5 shrink-0" />
            <span>{state.activeEvent.text} <span className="opacity-70">({state.activeEvent.daysLeft} day(s) left)</span></span>
          </div>
        )}

        {over && (
          <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            state.status === "bankrupt" || state.totalProfit < cfg.targetProfit
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            {state.status === "bankrupt"
              ? <><AlertTriangle size={15} className="mt-0.5" /> Insolvent on day {state.day - 1}. Ad spend outran margin — restart and order stock before scaling budget.</>
              : <><Trophy size={15} className="mt-0.5" /> Run complete: {compact(state.totalRevenue)} revenue, {compact(state.totalProfit)} net profit, {state.totalOrders} orders.</>}
          </div>
        )}
      </div>

      {/* View switch */}
      <div className="flex justify-center">
        <div className="premium-card rounded-full p-1 inline-flex text-xs flex-wrap justify-center">
          {views.map((v) => {
            const Icon = v.icon; const on = view === v.id;
            return (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition ${on ? "bg-white/12 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon size={13} /> {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "storefront" && <Storefront state={state} />}
      {view === "products" && (
        <CatalogView state={state} catalog={catalog} onAdd={addProduct} onRestock={doRestock} onRemove={removeProduct} onPatch={patch} />
      )}
      {view === "ads" && <AdsView state={state} onPatch={patch} />}
      {view === "analytics" && <Analytics state={state} />}
      {view === "log" && <ActivityLog state={state} />}
    </section>
  );
}

/* ---------------- Setup ---------------- */

function SetupScreen(props: {
  storeName: string; setStoreName: (v: string) => void;
  difficulty: Difficulty; setDifficulty: (d: Difficulty) => void;
  catalogCount: number; onStart: () => void;
}) {
  return (
    <section className="max-w-3xl mx-auto space-y-6">
      <div className="text-center animate-rise-in">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" /> Risk-free practice
        </span>
        <h2 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight">Training Store</h2>
        <p className="mt-3 text-sm text-muted-foreground max-w-xl mx-auto">
          Run a real storefront loop: list products from your research, buy inventory, price them, spend on ads,
          then watch traffic, conversion, refunds and cash flow play out day by day.
        </p>
      </div>

      <div className="premium-card rounded-2xl p-5 space-y-5">
        <div>
          <label className="text-xs text-muted-foreground">Store name</label>
          <input value={props.storeName} onChange={(e) => props.setStoreName(e.target.value)}
            placeholder="Nova Home Goods"
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]/60" />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Difficulty</label>
          <div className="mt-2 grid md:grid-cols-3 gap-3">
            {(Object.values(DIFFICULTIES)).map((d) => {
              const on = props.difficulty === d.id;
              return (
                <button key={d.id} onClick={() => props.setDifficulty(d.id)}
                  className={`text-left rounded-xl border p-3.5 transition card-lift ${on ? "border-[oklch(0.68_0.20_265)]/60 bg-[oklch(0.68_0.20_265)]/12" : "border-white/10 bg-white/5 hover:bg-white/8"}`}>
                  <div className="font-semibold text-sm">{d.label}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{d.blurb}</p>
                  <dl className="mt-3 space-y-1 text-[11px]">
                    <Row k="Starting cash" v={compact(d.startCash)} />
                    <Row k="Avg CPC" v={money(d.cpc)} />
                    <Row k="Fees" v={`${(d.platformFeePct * 100).toFixed(1)}%`} />
                    <Row k="Refund rate" v={`${(d.refundBase * 100).toFixed(0)}%`} />
                    <Row k="Supplier lead" v={`${d.leadTimeDays} days`} />
                    <Row k="Profit target" v={compact(d.targetProfit)} />
                  </dl>
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={props.onStart}
          className="w-full rounded-xl bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-3 text-sm font-semibold glow">
          Open my training store
        </button>
        <p className="text-[11px] text-muted-foreground text-center">
          {props.catalogCount > 0
            ? `${props.catalogCount} researched product(s) ready to list.`
            : "Tip: run a product search or save favourites first — you'll list those products in the store."}
        </p>
      </div>
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
);

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Store; label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon size={11} /> {label}
      </div>
      <div className={`mt-1 text-sm font-bold ${tone === "bad" ? "text-rose-300" : tone === "good" ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}

/* ---------------- Storefront (customer view) ---------------- */

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={11} className={i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-white/20"} />
      ))}
    </span>
  );
}

function Storefront({ state }: { state: SimState }) {
  const live = state.products.filter((p) => p.listed);
  const [q, setQ] = useState("");
  const shown = live.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-[oklch(0.16_0.02_265)]">
      {/* fake shop chrome */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-3 py-2">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose-400/70" /><i className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        </span>
        <div className="mx-auto rounded-md bg-black/30 px-3 py-0.5 text-[10px] text-muted-foreground">
          {state.storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.myshop.com
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="font-extrabold tracking-tight">{state.storeName}</div>
        <div className="hidden md:flex flex-1 max-w-sm items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          <Search size={13} className="text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products"
            className="w-full bg-transparent text-xs outline-none" />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Shop</span><span className="hidden sm:inline">Support</span>
          <span className="inline-flex items-center gap-1"><ShoppingCart size={14} /> 0</span>
        </div>
      </div>

      <div className="border-b border-white/10 bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/15 px-4 py-5">
        <div className="text-lg font-bold">Free shipping over $50 · 30-day returns</div>
        <p className="text-xs text-muted-foreground mt-1">This is exactly what your customers would see. Stock, price and ratings update as you trade.</p>
      </div>

      {shown.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No products on the shelves yet. Go to <b>Catalog & Stock</b> and list something.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {shown.map((p) => {
            const soldOut = p.stock <= 0;
            return (
              <article key={p.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden card-lift">
                <div className="relative h-36 flex items-center justify-center bg-gradient-to-br from-white/10 to-transparent text-4xl">
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                    : <span>{p.emoji}</span>}
                  {soldOut && <span className="absolute inset-0 grid place-items-center bg-black/60 text-xs font-semibold">Sold out</span>}
                  {!soldOut && p.stock < 10 && (
                    <span className="absolute top-2 left-2 rounded-full bg-amber-500/85 px-2 py-0.5 text-[10px] font-semibold text-black">Only {p.stock} left</span>
                  )}
                </div>
                <div className="p-3">
                  <h4 className="text-sm font-semibold line-clamp-1">{p.name}</h4>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Stars rating={p.rating} /> {p.rating.toFixed(1)} ({p.reviews})
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <div className="text-lg font-bold">{money(p.price)}</div>
                      {p.price < p.recommendedPrice && (
                        <div className="text-[11px] text-muted-foreground line-through">{money(p.recommendedPrice)}</div>
                      )}
                    </div>
                    <button disabled className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium opacity-80">
                      {soldOut ? "Notify me" : "Add to cart"}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Truck size={11} /> {p.unitsSold} sold
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Catalog & stock ---------------- */

function CatalogView({ state, catalog, onAdd, onRestock, onRemove, onPatch }: {
  state: SimState; catalog: WinningProduct[];
  onAdd: (p: WinningProduct) => void;
  onRestock: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, f: Partial<StoreProduct>) => void;
}) {
  const cfg = DIFFICULTIES[state.difficulty];
  const listedNames = new Set(state.products.map((p) => p.name));
  const available = catalog.filter((p) => !listedNames.has(p.name));

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Package size={15} /> Your shelves</h3>
        {state.products.length === 0 && (
          <div className="premium-card rounded-xl p-6 text-sm text-muted-foreground text-center">Nothing listed yet.</div>
        )}
        {state.products.map((p) => {
          const up = unitProfit(p, cfg);
          const incoming = p.incoming.reduce((a, i) => a + i.qty, 0);
          return (
            <div key={p.id} className="premium-card rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/8 text-xl">{p.emoji}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Cost {money(p.unitCost)} · Base CVR {p.baseCvrPct.toFixed(1)}% · {p.competition} competition
                    </div>
                  </div>
                </div>
                <button onClick={() => onRemove(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-rose-300" aria-label="Delist">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <Stat label="In stock" value={String(p.stock)} tone={p.stock === 0 ? "bad" : undefined} />
                <Stat label="Incoming" value={incoming ? `${incoming} (d${p.incoming[0].arrivesDay})` : "—"} />
                <Stat label="Unit profit" value={money(up)} tone={up <= 0 ? "bad" : "good"} />
                <Stat label="Margin" value={`${netMarginPct(p, cfg).toFixed(0)}%`} tone={netMarginPct(p, cfg) < 15 ? "bad" : undefined} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Restock:</span>
                {[10, 25, 50, 100].map((q) => (
                  <button key={q} onClick={() => onRestock(p.id, q)}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10">
                    {q} · {money(p.unitCost * q * (q >= 100 ? 0.85 : q >= 50 ? 0.92 : 1))}
                  </button>
                ))}
                <span className="text-[10px] text-muted-foreground">arrives in {cfg.leadTimeDays}d · 50+ = 8% off, 100+ = 15% off</span>
              </div>

              <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={p.listed} onChange={(e) => onPatch(p.id, { listed: e.target.checked })} />
                Visible on storefront
              </label>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Plus size={15} /> Add from your research</h3>
        {available.length === 0 ? (
          <div className="premium-card rounded-xl p-6 text-sm text-muted-foreground text-center">
            No unlisted products. Run a search in Product Finder or save favourites first.
          </div>
        ) : (
          <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
            {available.map((p) => (
              <button key={p.name} onClick={() => onAdd(p)}
                className="w-full text-left premium-card rounded-xl p-3 hover:bg-white/8 card-lift">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/8 text-lg">{p.emoji || "📦"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {p.supplier_price_usd} → {p.selling_price_usd} · trend {p.trend_score}
                    </div>
                  </div>
                  <Plus size={15} className="text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) => (
  <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`font-semibold ${tone === "bad" ? "text-rose-300" : tone === "good" ? "text-emerald-300" : ""}`}>{value}</div>
  </div>
);

/* ---------------- Ads & pricing ---------------- */

function AdsView({ state, onPatch }: { state: SimState; onPatch: (id: string, f: Partial<StoreProduct>) => void }) {
  const cfg = DIFFICULTIES[state.difficulty];
  const total = state.products.reduce((a, p) => a + (p.listed ? p.adBudget : 0), 0);
  const runway = total > 0 ? state.cash / total : Infinity;

  if (state.products.length === 0) {
    return <div className="premium-card rounded-xl p-8 text-center text-sm text-muted-foreground">List a product first.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="premium-card rounded-xl p-4 flex flex-wrap items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5"><Megaphone size={13} /> Daily ad spend <b className="ml-1">{money(total)}</b></span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Wallet size={13} /> Cash runway ≈ {Number.isFinite(runway) ? `${runway.toFixed(1)} days` : "∞"}</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><ShieldCheck size={13} /> Avg CPC {money(cfg.cpc)} · fees {(cfg.platformFeePct * 100).toFixed(1)}% · ship {money(cfg.shippingPerUnit)}/order</span>
      </div>

      {state.products.map((p) => {
        const up = unitProfit(p, cfg);
        const clicks = p.adBudget / cfg.cpc;
        const expected = clicks * (p.baseCvrPct / 100) * Math.max(0.1, Math.min(2, 1.75 - 0.78 * (p.price / p.recommendedPrice)));
        const breakEvenRoas = p.price > 0 ? p.price / Math.max(0.01, up) : 0;
        return (
          <div key={p.id} className="premium-card rounded-xl p-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/8 text-lg">{p.emoji}</span>
              <div className="font-semibold text-sm">{p.name}</div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Selling price</span>
                  <b>{money(p.price)}</b>
                </div>
                <input type="range" min={Math.max(1, p.unitCost)} max={Math.max(p.unitCost * 2, p.recommendedPrice * 2)} step={0.5}
                  value={p.price} onChange={(e) => onPatch(p.id, { price: Number(e.target.value) })}
                  className="mt-2 w-full accent-[oklch(0.68_0.20_265)]" />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>cost {money(p.unitCost)}</span>
                  <span>AI price {money(p.recommendedPrice)}</span>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Unit profit <b className={up <= 0 ? "text-rose-300" : "text-emerald-300"}>{money(up)}</b> · break-even ROAS {breakEvenRoas > 0 ? breakEvenRoas.toFixed(2) : "—"}x
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Daily ad budget</span>
                  <b>{money(p.adBudget)}</b>
                </div>
                <input type="range" min={0} max={300} step={5}
                  value={p.adBudget} onChange={(e) => onPatch(p.id, { adBudget: Number(e.target.value) })}
                  className="mt-2 w-full accent-[oklch(0.66_0.24_305)]" />
                <div className="mt-2 text-[11px] text-muted-foreground">
                  ≈ {clicks.toFixed(0)} clicks/day → ≈ {expected.toFixed(1)} orders/day → est. daily profit{" "}
                  <b className={expected * up - p.adBudget >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {money(expected * up - p.adBudget)}
                  </b>
                </div>
                {p.stock === 0 && p.adBudget > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300">
                    <AlertTriangle size={12} /> You're paying for traffic with zero stock.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Analytics ---------------- */

function Analytics({ state }: { state: SimState }) {
  const h = state.history;
  const max = Math.max(1, ...h.map((d) => Math.max(d.revenue, Math.abs(d.profit))));
  const totals = useMemo(() => h.reduce((a, d) => ({
    visitors: a.visitors + d.visitors, orders: a.orders + d.orders, revenue: a.revenue + d.revenue,
    adSpend: a.adSpend + d.adSpend, fees: a.fees + d.fees, refunds: a.refunds + d.refunds, profit: a.profit + d.profit,
  }), { visitors: 0, orders: 0, revenue: 0, adSpend: 0, fees: 0, refunds: 0, profit: 0 }), [h]);

  if (h.length === 0) {
    return <div className="premium-card rounded-xl p-8 text-center text-sm text-muted-foreground">Run your first day to generate analytics.</div>;
  }
  const cvr = totals.visitors > 0 ? (totals.orders / totals.visitors) * 100 : 0;
  const roas = totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0;
  const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Visitors" value={totals.visitors.toLocaleString()} />
        <Stat label="Conversion" value={`${cvr.toFixed(2)}%`} tone={cvr >= 1.5 ? "good" : "bad"} />
        <Stat label="ROAS" value={`${roas.toFixed(2)}x`} tone={roas >= 2 ? "good" : "bad"} />
        <Stat label="AOV" value={money(aov)} />
        <Stat label="Refund loss" value={money(totals.refunds)} tone="bad" />
      </div>

      <div className="premium-card rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Daily revenue vs net profit</h3>
        <div className="flex items-end gap-1 h-40">
          {h.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col justify-end items-center gap-0.5 group relative">
              <div className="w-full rounded-t bg-[oklch(0.68_0.20_265)]/70" style={{ height: `${(d.revenue / max) * 100}%` }} />
              <div className={`w-full rounded-b ${d.profit >= 0 ? "bg-emerald-400/70" : "bg-rose-400/70"}`}
                style={{ height: `${(Math.abs(d.profit) / max) * 60}%` }} />
              <span className="absolute -top-6 hidden group-hover:block whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px]">
                D{d.day}: {money(d.revenue)} / {money(d.profit)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="premium-card rounded-xl p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>{["Day", "Visitors", "Orders", "Revenue", "Ads", "Fees", "Refunds", "Profit", "Cash"].map((c) => (
              <th key={c} className="text-left font-medium py-1.5 pr-3">{c}</th>))}</tr>
          </thead>
          <tbody>
            {[...h].reverse().map((d) => (
              <tr key={d.day} className="border-t border-white/8">
                <td className="py-1.5 pr-3">{d.day}</td>
                <td className="pr-3">{d.visitors}</td>
                <td className="pr-3">{d.orders}</td>
                <td className="pr-3">{money(d.revenue)}</td>
                <td className="pr-3">{money(d.adSpend)}</td>
                <td className="pr-3">{money(d.fees)}</td>
                <td className="pr-3">{money(d.refunds)}</td>
                <td className={`pr-3 font-semibold ${d.profit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(d.profit)}</td>
                <td className="pr-3">{money(d.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Activity ---------------- */

function ActivityLog({ state }: { state: SimState }) {
  return (
    <div className="premium-card rounded-xl p-4 space-y-2 max-h-[60vh] overflow-auto">
      {[...state.log].reverse().map((l, i) => (
        <div key={i} className="flex items-start gap-2 text-xs border-b border-white/6 pb-2 last:border-0">
          <span className="mt-0.5 w-10 shrink-0 text-muted-foreground">D{l.day}</span>
          <span className={l.kind === "good" ? "text-emerald-300" : l.kind === "bad" ? "text-rose-300" : ""}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}
