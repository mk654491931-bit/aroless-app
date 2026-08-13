import { useEffect, useMemo, useRef, useState } from "react";
import {
  Store, Play, FastForward, RotateCcw, Plus, Package, Megaphone, BarChart3, ScrollText,
  Star, ShoppingCart, TrendingUp, TrendingDown, Wallet, Search, Truck, AlertTriangle,
  Trophy, Trash2, ShieldCheck, Coins, Target, Sparkles,
  Flag, Crown, Pause, Zap, Lightbulb, CheckCircle2, Circle, CalendarDays, Flame, RefreshCw,
  Rocket, Mail, Landmark, LineChart, Users, Swords, Headphones, FlaskConical, Gem, PieChart,
} from "lucide-react";
import { VeloraMark } from "@/components/velora-mark";
import { toast } from "sonner";
import type { WinningProduct } from "@/lib/gemini.functions";
import {
  DIFFICULTIES, RUN_LENGTH, newRun, productFromWinner, restock, simulateDay,
  netMarginPct, unitProfit, applyDecision, refreshCreative,
  CHANNELS, DECISIONS, CREATIVE_COST, WEEKDAYS, weekdayOf, weekdayDemand,
  UPGRADES, hasUpgrade, buyUpgrade, takeLoan, repayLoan, sendCampaign,
  LOAN_MAX, LOAN_DAILY_RATE, CAMPAIGN_COOLDOWN,
  CALENDAR, calendarFor, seasonDayOf, marketShare, SEGMENTS,
  startAbTest, setSupportBudget, continueSeason,
  AB_TEST_COST, AB_TEST_DAYS, SUPPORT_TICKET_COST,
  type AdChannel, type Difficulty, type SimState, type StoreProduct,
} from "@/lib/training-sim";
import {
  computeXp, levelFromXp, missionState, coachTips, loadHof, saveHof, type RunResult,
} from "@/lib/training-meta";

type ViewId = "storefront" | "products" | "ads" | "analytics" | "market" | "ops" | "growth" | "missions" | "coach" | "log";

const KEY = "omni-training-run-v1";
const VeloraIcon = ({ size = 14 }: { size?: number }) => <VeloraMark size={size} />;

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
  const [view, setView] = useState<ViewId>("storefront");
  const [storeName, setStoreName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [busy, setBusy] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [hof, setHof] = useState<RunResult[]>([]);
  const doneMissions = useRef<Set<string>>(new Set());
  const savedRun = useRef(false);

  useEffect(() => { setState(load()); setHof(loadHof()); setHydrated(true); }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (state) window.localStorage.setItem(KEY, JSON.stringify(state));
    else window.localStorage.removeItem(KEY);
  }, [state, hydrated]);

  // celebrate newly completed missions
  useEffect(() => {
    if (!state) return;
    const ms = missionState(state);
    const first = doneMissions.current.size === 0;
    for (const m of ms) {
      if (m.done && !doneMissions.current.has(m.id)) {
        doneMissions.current.add(m.id);
        if (!first) toast.success(`Görev tamam: ${m.title}`, { description: `+${m.reward} XP` });
      }
    }
  }, [state]);

  // autoplay the season day by day
  useEffect(() => {
    if (state?.pendingDecision && autoplay) { setAutoplay(false); return; }
    if (!autoplay || !state || state.status !== "running") { if (autoplay && state && state.status !== "running") setAutoplay(false); return; }
    const t = setTimeout(() => {
      setState((prev) => (prev && prev.status === "running" ? simulateDay(prev).state : prev));
    }, 550);
    return () => clearTimeout(t);
  }, [autoplay, state]);

  // archive finished runs into the hall of fame
  useEffect(() => {
    if (!state || state.status === "running" || savedRun.current) return;
    savedRun.current = true;
    const r: RunResult = {
      storeName: state.storeName, difficulty: DIFFICULTIES[state.difficulty].label,
      profit: Math.round(state.totalProfit), revenue: Math.round(state.totalRevenue),
      orders: state.totalOrders, days: state.history.length, xp: computeXp(state),
      status: state.status, at: Date.now(),
    };
    saveHof(r);
    setHof(loadHof());
  }, [state]);

  if (!hydrated) return <div className="h-40" />;


  if (!state) {
    return (
      <SetupScreen
        storeName={storeName} setStoreName={setStoreName}
        difficulty={difficulty} setDifficulty={setDifficulty}
        catalogCount={catalog.length}
        hof={hof}
        onStart={() => {
          doneMissions.current = new Set();
          savedRun.current = false;
          setState(newRun(storeName, difficulty));
        }}
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

  const doRefreshCreative = (id: string) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = refreshCreative(prev, id);
      if (r.error) toast.error(r.error);
      else toast.success("Yeni kreatif yayında — yorgunluk sıfırlandı.");
      return r.state;
    });

  const doUpgrade = (id: Parameters<typeof buyUpgrade>[1]) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = buyUpgrade(prev, id);
      if (r.error) toast.error(r.error); else toast.success("Yükseltme aktif!");
      return r.state;
    });

  const doLoan = (amount: number) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = takeLoan(prev, amount);
      if (r.error) toast.error(r.error); else toast.success("Kredi hesabına geçti — faiz her gün işler.");
      return r.state;
    });

  const doRepay = (amount: number) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = repayLoan(prev, amount);
      if (r.error) toast.error(r.error); else toast.success("Kredi ödemesi yapıldı.");
      return r.state;
    });

  const doCampaign = () =>
    setState((prev) => {
      if (!prev) return prev;
      const r = sendCampaign(prev);
      if (r.error) toast.error(r.error); else toast.success("Kampanya gönderildi!");
      return r.state;
    });

  const doAbTest = (id: string) =>
    setState((prev) => {
      if (!prev) return prev;
      const r = startAbTest(prev, id);
      if (r.error) toast.error(r.error); else toast.success(`A/B testi başladı — ${AB_TEST_DAYS} gün sonra kazanan uygulanacak.`);
      return r.state;
    });

  const doSupportBudget = (amount: number) =>
    setState((prev) => (prev ? setSupportBudget(prev, amount) : prev));

  const doContinueSeason = () =>
    setState((prev) => {
      if (!prev) return prev;
      savedRun.current = false;
      toast.success("Yeni sezon başladı — takvim baştan işliyor.");
      return continueSeason(prev);
    });

  const chooseDecision = (idx: number) =>
    setState((prev) => (prev ? applyDecision(prev, idx) : prev));

  const removeProduct = (id: string) =>
    setState((prev) => prev ? { ...prev, products: prev.products.filter((p) => p.id !== id) } : prev);

  const totalAds = state.products.reduce((a, p) => a + (p.listed ? p.adBudget : 0), 0);
  const inventoryValue = state.products.reduce((a, p) => a + p.stock * p.unitCost, 0);
  const season = state.season ?? 1;
  const seasonTarget = cfg.targetProfit * season;
  const progress = Math.max(0, Math.min(100, (state.totalProfit / seasonTarget) * 100));
  const sDay = seasonDayOf(Math.min(state.day, RUN_LENGTH * season));
  const cal = calendarFor(state.day);
  const share = marketShare(state);
  const brand = Math.round(state.brand ?? 0);

  const missions = missionState(state);
  const missionsDone = missions.filter((m) => m.done).length;
  const xp = computeXp(state) + missions.reduce((a, m) => a + (m.done ? m.reward : 0), 0);
  const lvl = levelFromXp(xp);
  const tips = coachTips(state);
  const alerts = tips.filter((t) => t.kind === "warn").length;
  const nextMission = missions.find((m) => !m.done);
  const queue = Math.round(state.supportQueue ?? 0);

  const views: { id: ViewId; label: string; icon: React.ComponentType<{ size?: number }>; badge?: string }[] = [
    { id: "storefront", label: "Vitrin", icon: Store },
    { id: "products", label: "Katalog & Stok", icon: Package },
    { id: "ads", label: "Reklam & Fiyat", icon: Megaphone },
    { id: "analytics", label: "Analitik", icon: BarChart3 },
    { id: "market", label: "Rakipler", icon: Swords, badge: `%${Math.round(share.you * 100)}` },
    { id: "ops", label: "Operasyon", icon: Headphones, badge: queue > 0 ? String(queue) : undefined },
    { id: "growth", label: "Büyüme", icon: Rocket, badge: (state.upgrades?.length ? String(state.upgrades.length) : undefined) },
    { id: "missions", label: "Görevler", icon: Flag, badge: `${missionsDone}/${missions.length}` },
    { id: "coach", label: "Koç", icon: VeloraIcon, badge: alerts ? String(alerts) : undefined },
    { id: "log", label: "Günlük", icon: ScrollText },
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
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Sezon {season}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Gün {sDay} / {RUN_LENGTH} · Gerçek mekanik, sıfır risk.
            </p>
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-muted-foreground">
              <CalendarDays size={11} /> {WEEKDAYS[weekdayOf(state.day)]} · talep ×{weekdayDemand(state.day).toFixed(2)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                (state.marketIndex ?? 1) < 0.95 ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                : (state.marketIndex ?? 1) > 1.05 ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : "border-white/10 bg-white/5 text-muted-foreground"}`}>
                <LineChart size={11} /> Rakip fiyat endeksi {(state.marketIndex ?? 1).toFixed(2)}
              </span>
              <button onClick={() => setView("market")}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground hover:bg-white/10">
                <Swords size={11} /> Pazar payın %{Math.round(share.you * 100)}
              </button>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
                <Gem size={11} className="text-[oklch(0.78_0.16_265)]" /> Marka {brand}/100
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
                <Users size={11} /> {Math.floor(state.subscribers ?? 0)} abone
              </span>
              {queue > 0 && (
                <button onClick={() => setView("ops")}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${queue > 12 ? "border-rose-400/30 bg-rose-500/10 text-rose-200" : "border-white/10 bg-white/5 text-muted-foreground"} hover:bg-white/10`}>
                  <Headphones size={11} /> {queue} destek bileti
                </button>
              )}
              {!!state.loan?.balance && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                  <Landmark size={11} /> Kredi borcu {money(state.loan.balance)}
                </span>
              )}
              {cal && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.68_0.20_265)]/40 bg-[oklch(0.68_0.20_265)]/12 px-2.5 py-1 text-foreground">
                  <Sparkles size={11} /> {cal.title}
                </span>
              )}
            </div>

          </div>
          <div className="flex items-center gap-2">
            <button disabled={over || busy || autoplay} onClick={() => advance(1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3.5 py-2 text-xs font-semibold glow disabled:opacity-40">
              <Play size={13} /> 1 gün
            </button>
            <button disabled={over || busy || autoplay} onClick={() => advance(7)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40">
              <FastForward size={13} /> 7 gün
            </button>
            <button disabled={over} onClick={() => setAutoplay((a) => !a)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition disabled:opacity-40 ${autoplay ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
              {autoplay ? <><Pause size={13} /> Duraklat</> : <><Zap size={13} /> Sezonu oynat</>}
            </button>
            <button onClick={() => { if (confirm("Bu eğitim koşusu sıfırlansın mı?")) { setAutoplay(false); doneMissions.current = new Set(); savedRun.current = false; setState(null); } }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              <RotateCcw size={13} /> Sıfırla
            </button>
          </div>

        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-2">
          <Kpi icon={Wallet} label="Nakit" value={money(state.cash)} tone={state.cash < 100 ? "bad" : "good"} />
          <Kpi icon={Coins} label="Ciro" value={compact(state.totalRevenue)} />
          <Kpi icon={state.totalProfit >= 0 ? TrendingUp : TrendingDown} label="Net kâr" value={compact(state.totalProfit)} tone={state.totalProfit >= 0 ? "good" : "bad"} />
          <Kpi icon={ShoppingCart} label="Sipariş" value={String(state.totalOrders)} />
          <Kpi icon={Package} label="Stok değeri" value={compact(inventoryValue)} />
          <Kpi icon={Megaphone} label="Günlük reklam" value={money(totalAds)} />
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Target size={12} /> Kâr hedefi {compact(seasonTarget)}</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Crown size={12} className="text-amber-300" /> Seviye {lvl.level} · {lvl.title}
              </span>
              <span>{lvl.into}/{lvl.need} XP</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] transition-all" style={{ width: `${lvl.pct}%` }} />
            </div>
          </div>
        </div>

        {nextMission && !over && (
          <button onClick={() => setView("missions")}
            className="mt-3 w-full text-left flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 transition">
            <Flag size={14} className="mt-0.5 shrink-0 text-[oklch(0.72_0.18_265)]" />
            <span><b>Sıradaki görev:</b> {nextMission.title} — <span className="text-muted-foreground">{nextMission.hint}</span></span>
          </button>
        )}

        {state.activeEvent && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <Sparkles size={14} className="mt-0.5 shrink-0" />
            <span>{state.activeEvent.text} <span className="opacity-70">({state.activeEvent.daysLeft} gün kaldı)</span></span>
          </div>
        )}

        {over && (
          <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            state.status === "bankrupt" || state.totalProfit < seasonTarget
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            {state.status === "bankrupt"
              ? <><AlertTriangle size={15} className="mt-0.5" /> {state.day - 1}. günde nakit bitti. Reklam harcaması marjı aştı — yeniden başla ve ölçeklemeden önce stok al.</>
              : <><Trophy size={15} className="mt-0.5" /> Sezon tamam: {compact(state.totalRevenue)} ciro, {compact(state.totalProfit)} net kâr, {state.totalOrders} sipariş, {missionsDone} görev.</>}
          </div>
        )}

        {state.status === "finished" && (
          <button onClick={doContinueSeason}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-2.5 text-xs font-semibold glow">
            <RefreshCw size={13} /> Sezon {season + 1}'e devam et — mağazan, markan ve stokun korunur
          </button>
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
                {v.badge && <span className="rounded-full bg-white/12 px-1.5 py-0.5 text-[9px] font-semibold">{v.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {view === "storefront" && <Storefront state={state} />}
      {view === "products" && (
        <CatalogView state={state} catalog={catalog} onAdd={addProduct} onRestock={doRestock} onRemove={removeProduct} onPatch={patch} />
      )}
      {view === "ads" && <AdsView state={state} onPatch={patch} onRefresh={doRefreshCreative} onAbTest={doAbTest} />}
      {view === "analytics" && <Analytics state={state} />}
      {view === "market" && <MarketView state={state} />}
      {view === "ops" && <OpsView state={state} onSupportBudget={doSupportBudget} />}

      {view === "growth" && (
        <GrowthView state={state} onUpgrade={doUpgrade} onLoan={doLoan} onRepay={doRepay} onCampaign={doCampaign} />
      )}
      {view === "missions" && <MissionsView missions={missions} lvl={lvl} />}
      {view === "coach" && <CoachView tips={tips} state={state} onGo={setView} />}
      {view === "log" && <ActivityLog state={state} />}

      {state.pendingDecision && <DecisionModal id={state.pendingDecision.id} onChoose={chooseDecision} />}

    </section>
  );
}

/* ---------------- Missions ---------------- */

function MissionsView({ missions, lvl }: { missions: ReturnType<typeof missionState>; lvl: ReturnType<typeof levelFromXp> }) {
  const tiers: { t: 1 | 2 | 3; label: string }[] = [
    { t: 1, label: "Temel operasyon" },
    { t: 2, label: "Kârlılık" },
    { t: 3, label: "Ölçekleme" },
  ];
  return (
    <div className="space-y-4">
      <div className="premium-card rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] font-bold">{lvl.level}</span>
          <div>
            <div className="text-sm font-semibold">{lvl.title}</div>
            <div className="text-[11px] text-muted-foreground">{lvl.xp.toLocaleString("tr-TR")} XP toplandı</div>
          </div>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {missions.filter((m) => m.done).length}/{missions.length} görev tamamlandı
        </div>
      </div>

      {tiers.map(({ t, label }) => (
        <div key={t} className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{label}</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {missions.filter((m) => m.tier === t).map((m) => (
              <div key={m.id} className={`premium-card rounded-xl p-4 transition ${m.done ? "border-emerald-400/30 bg-emerald-500/8" : ""}`}>
                <div className="flex items-start gap-2.5">
                  {m.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" /> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{m.title}</div>
                      <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-amber-200">+{m.reward} XP</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{m.hint}</p>
                    <div className="mt-2.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${m.done ? "bg-emerald-400" : "bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"}`} style={{ width: `${m.pct}%` }} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {m.value < 10 ? m.value.toFixed(1).replace(/\.0$/, "") : Math.round(m.value)} / {m.goal}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Coach ---------------- */

function CoachView({ tips, state, onGo }: {
  tips: ReturnType<typeof coachTips>;
  state: SimState;
  onGo: (v: "storefront" | "products" | "ads" | "analytics" | "missions" | "coach" | "log") => void;
}) {
  const cfg = DIFFICULTIES[state.difficulty];
  const week = state.history.slice(-7);
  const sum = week.reduce((a, d) => ({
    revenue: a.revenue + d.revenue, adSpend: a.adSpend + d.adSpend, profit: a.profit + d.profit,
    orders: a.orders + d.orders, visitors: a.visitors + d.visitors,
  }), { revenue: 0, adSpend: 0, profit: 0, orders: 0, visitors: 0 });

  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><VeloraMark size={17} className="text-[oklch(0.78_0.16_265)]" /> Velora Koçu</h3>
        {tips.map((t, i) => (
          <div key={i} className={`premium-card rounded-xl p-4 border ${
            t.kind === "warn" ? "border-rose-500/30 bg-rose-500/8"
              : t.kind === "good" ? "border-emerald-500/30 bg-emerald-500/8" : "border-white/10"}`}>
            <div className="flex items-start gap-2.5">
              {t.kind === "warn" ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
                : t.kind === "good" ? <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300" />
                : <Lightbulb size={15} className="mt-0.5 shrink-0 text-amber-300" />}
              <div>
                <div className="text-sm font-semibold">{t.title}</div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{t.body}</p>
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onGo("ads")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Reklam & fiyatı düzenle</button>
          <button onClick={() => onGo("products")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Stok siparişi ver</button>
          <button onClick={() => onGo("analytics")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Analitiği aç</button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 size={15} /> Son 7 gün</h3>
        <div className="premium-card rounded-xl p-4 grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Ciro" value={compact(sum.revenue)} />
          <Stat label="Reklam" value={compact(sum.adSpend)} />
          <Stat label="Net kâr" value={compact(sum.profit)} tone={sum.profit >= 0 ? "good" : "bad"} />
          <Stat label="ROAS" value={sum.adSpend > 0 ? `${(sum.revenue / sum.adSpend).toFixed(2)}x` : "—"} />
          <Stat label="Sipariş" value={String(sum.orders)} />
          <Stat label="Dönüşüm" value={sum.visitors > 0 ? `${((sum.orders / sum.visitors) * 100).toFixed(2)}%` : "—"} />
        </div>
        <div className="premium-card rounded-xl p-4 text-[11px] text-muted-foreground space-y-2">
          <div className="text-xs font-semibold text-foreground">Bu zorlukta oyunun kuralları</div>
          <Row k="Ortalama TBM" v={money(cfg.cpc)} />
          <Row k="Platform komisyonu" v={`${(cfg.platformFeePct * 100).toFixed(1)}%`} />
          <Row k="Kargo / sipariş" v={money(cfg.shippingPerUnit)} />
          <Row k="Baz iade oranı" v={`${(cfg.refundBase * 100).toFixed(0)}%`} />
          <Row k="Tedarik süresi" v={`${cfg.leadTimeDays} gün`} />
          <Row k="Sabit gider / gün" v={money(cfg.dailyFixedCost)} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Setup ---------------- */

function SetupScreen(props: {
  storeName: string; setStoreName: (v: string) => void;
  difficulty: Difficulty; setDifficulty: (d: Difficulty) => void;
  catalogCount: number; onStart: () => void; hof: RunResult[];
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
          Eğitim mağazamı aç
        </button>
        <p className="text-[11px] text-muted-foreground text-center">
          {props.catalogCount > 0
            ? `${props.catalogCount} araştırılmış ürün listelenmeye hazır.`
            : "İpucu: önce Ürün Bulucu'da arama yap veya favori kaydet — mağazada o ürünleri satacaksın."}
        </p>
      </div>

      {props.hof.length > 0 && (
        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Trophy size={15} className="text-amber-300" /> Şeref listesi</h3>
          <div className="mt-3 space-y-2">
            {props.hof.map((r, i) => (
              <div key={r.at} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i === 0 ? "bg-amber-400/20 text-amber-200" : "bg-white/8 text-muted-foreground"}`}>{i + 1}</span>
                <span className="font-medium truncate">{r.storeName}</span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">{r.difficulty}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{r.days} gün · {r.orders} sipariş</span>
                <b className={r.profit >= 0 ? "text-emerald-300" : "text-rose-300"}>{compact(r.profit)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
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

function AdsView({ state, onPatch, onRefresh, onAbTest }: {
  state: SimState;
  onPatch: (id: string, f: Partial<StoreProduct>) => void;
  onRefresh: (id: string) => void;
  onAbTest: (id: string) => void;
}) {

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
        const ch = CHANNELS[p.channel ?? "meta"];
        const fatigue = p.fatigue ?? 0;
        const effCpc = cfg.cpc * ch.cpcMult * (1 + fatigue * 0.65);
        const clicks = p.adBudget / effCpc;
        const expected = clicks * (p.baseCvrPct / 100) * ch.cvrMult * (1 - fatigue * 0.5) *
          Math.max(0.1, Math.min(2, 1.75 - 0.78 * (p.price / p.recommendedPrice)));
        const breakEvenRoas = p.price > 0 ? p.price / Math.max(0.01, up) : 0;
        return (
          <div key={p.id} className="premium-card rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/8 text-lg">{p.emoji}</span>
              <div className="font-semibold text-sm">{p.name}</div>
              <div className="ml-auto inline-flex rounded-full border border-white/10 bg-white/5 p-0.5 text-[11px]">
                {(Object.keys(CHANNELS) as AdChannel[]).map((c) => (
                  <button key={c} title={CHANNELS[c].blurb}
                    onClick={() => onPatch(p.id, { channel: c })}
                    className={`rounded-full px-2.5 py-1 transition ${(p.channel ?? "meta") === c ? "bg-white/14 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {CHANNELS[c].label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">{ch.blurb} · efektif TBM {money(effCpc)}</p>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Flame size={12} className={fatigue > 0.6 ? "text-rose-300" : fatigue > 0.3 ? "text-amber-300" : "text-emerald-300"} />
                  Kreatif yorgunluğu
                </span>
                <span className={fatigue > 0.6 ? "text-rose-300" : ""}>{Math.round(fatigue * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${fatigue > 0.6 ? "bg-rose-400" : fatigue > 0.3 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${fatigue * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>Yorulan kreatif TBM'yi artırır, dönüşümü düşürür. Reklamı durdurursan yavaşça soğur.</span>
                <button onClick={() => onRefresh(p.id)} disabled={fatigue < 0.02}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40">
                  <RefreshCw size={11} /> Yeni kreatif · {money(CREATIVE_COST)}
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <FlaskConical size={12} className="text-[oklch(0.72_0.18_265)]" /> Kreatif A/B testi
                  {!!(p.cvrBonus ?? 0) && <b className="text-emerald-300">+{Math.round((p.cvrBonus ?? 0) * 100)}% kalıcı dönüşüm</b>}
                </span>
                {p.abTest ? (
                  <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1">
                    Test yayında · {Math.max(0, p.abTest.startDay + AB_TEST_DAYS - state.day)} gün kaldı
                  </span>
                ) : (
                  <button onClick={() => onAbTest(p.id)} disabled={p.adBudget <= 0 || state.cash < AB_TEST_COST}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 hover:bg-white/10 disabled:opacity-40">
                    <FlaskConical size={11} /> Test başlat · {money(AB_TEST_COST)}
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                İki varyant {AB_TEST_DAYS} gün yarışır; trafiğin bir kısmı teste gider. Kazanan varyant kalıcı dönüşüm artışı olarak kalır.
              </p>
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


/* ---------------- Strategic decision card ---------------- */

function DecisionModal({ id, onChoose }: { id: string; onChoose: (i: number) => void }) {
  const card = DECISIONS.find((d) => d.id === id);
  if (!card) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <div className="premium-card w-full max-w-lg rounded-2xl p-5 animate-rise-in">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Zap size={12} className="text-amber-300" /> Stratejik karar
        </div>
        <h3 className="mt-2 text-lg font-bold">{card.title}</h3>
        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{card.body}</p>
        <div className="mt-4 space-y-2">
          {card.options.map((o, i) => (
            <button key={i} onClick={() => onChoose(i)}
              className="w-full text-left rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 hover:bg-white/10 hover:border-[oklch(0.68_0.20_265)]/50 transition card-lift">
              <div className="text-sm font-semibold">{o.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{o.detail}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground text-center">Kararın anında mağazanı etkiler — gün ilerlemeden seçmelisin.</p>
      </div>
    </div>
  );
}

/* ---------------- Growth: upgrades, financing, CRM ---------------- */

function GrowthView({ state, onUpgrade, onLoan, onRepay, onCampaign }: {
  state: SimState;
  onUpgrade: (id: (typeof UPGRADES)[number]["id"]) => void;
  onLoan: (n: number) => void;
  onRepay: (n: number) => void;
  onCampaign: () => void;
}) {
  const owed = state.loan?.balance ?? 0;
  const room = Math.max(0, LOAN_MAX - owed);
  const subs = Math.floor(state.subscribers ?? 0);
  const cd = Math.max(0, CAMPAIGN_COOLDOWN - (state.day - (state.lastCampaignDay ?? -99)));
  const canCampaign = subs >= 25 && cd === 0 && state.status === "running";

  return (
    <div className="space-y-4">
      <div className="premium-card rounded-2xl p-4 md:p-5">
        <div className="flex items-center gap-2">
          <Rocket size={15} className="text-[oklch(0.72_0.18_265)]" />
          <h3 className="text-sm font-bold">Mağaza yükseltmeleri</h3>
          <span className="text-[11px] text-muted-foreground">Kalıcı etki — bir kez alınır, sezon boyunca çalışır.</span>
        </div>
        <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {UPGRADES.map((u) => {
            const owned = hasUpgrade(state, u.id);
            const afford = state.cash >= u.cost;
            return (
              <div key={u.id} className={`rounded-xl border p-3 transition ${owned ? "border-emerald-400/35 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{u.icon}</span>
                    <span className="text-xs font-semibold">{u.title}</span>
                  </div>
                  {owned && <CheckCircle2 size={14} className="shrink-0 text-emerald-300" />}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{u.blurb}</p>
                <button
                  disabled={owned || !afford || state.status !== "running"}
                  onClick={() => onUpgrade(u.id)}
                  className="mt-2.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-40"
                >
                  {owned ? "Aktif" : `Satın al · ${money(u.cost)}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="premium-card rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2">
            <Landmark size={15} className="text-amber-300" />
            <h3 className="text-sm font-bold">İşletme kredisi</h3>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Stok almak için nakit sıkışırsan kredi çekebilirsin. Günlük %{(LOAN_DAILY_RATE * 100).toFixed(1)} faiz
            her gün kârından düşer — hızlı kapatmak marjını korur.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-[10px] text-muted-foreground">Borç</div>
              <div className="text-sm font-bold">{money(owed)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-[10px] text-muted-foreground">Limit kalan</div>
              <div className="text-sm font-bold">{money(room)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-[10px] text-muted-foreground">Ödenen faiz</div>
              <div className="text-sm font-bold text-rose-300">{money(state.loan?.paidInterest ?? 0)}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[250, 500, 1000].map((n) => (
              <button key={n} disabled={room < n || state.status !== "running"} onClick={() => onLoan(n)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-40">
                +{money(n)} çek
              </button>
            ))}
            <button disabled={owed <= 0 || state.cash <= 0} onClick={() => onRepay(Math.min(owed, state.cash))}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/12 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40">
              Elden geldiğince öde
            </button>
          </div>
        </div>

        <div className="premium-card rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-[oklch(0.72_0.18_265)]" />
            <h3 className="text-sm font-bold">E-posta listesi & kampanya</h3>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Her sipariş listeni büyütür. Kampanya reklam maliyeti olmadan sipariş getirir ama listeyi yorar —
            {CAMPAIGN_COOLDOWN} günde birden sık gönderemezsin.
          </p>
          <div className="mt-3 flex items-end gap-3">
            <div>
              <div className="text-[10px] text-muted-foreground">Abone</div>
              <div className="text-2xl font-bold tabular-nums">{subs}</div>
            </div>
            <div className="flex-1">
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"
                  style={{ width: `${Math.min(100, (subs / 400) * 100)}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">Tahmini sipariş: ~{Math.round(subs * 0.06)}</div>
            </div>
          </div>
          <button disabled={!canCampaign} onClick={onCampaign}
            className="mt-3 w-full rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-2 text-xs font-semibold glow disabled:opacity-40">
            {cd > 0 ? `${cd} gün sonra gönderilebilir` : subs < 25 ? "Liste çok küçük" : "Kampanyayı gönder"}
          </button>
        </div>
      </div>
    </div>
  );
}
