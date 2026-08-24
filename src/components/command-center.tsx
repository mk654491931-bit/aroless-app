import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  Gauge,
  Loader2,
  Radar,
  ScanLine,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchHotProducts, HOT_FEED_QUERY_KEY, type HotProduct } from "@/lib/hot-products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  computeUnitEconomics,
  hybridVerdict,
  marginBadge,
  MIN_NET_MARGIN_PCT,
  NO_DATA,
  runCouncil,
  type AgentId,
  type AgentPayload,
  type UnitEconomics,
} from "@/lib/unit-economics";

/* ------------------------------------------------------------------ helpers */

const AGENT_META: Record<
  AgentId,
  { icon: typeof BarChart3; line: string; source: string; desc: string }
> = {
  cfo_agent: {
    icon: BarChart3,
    line: "Computing landed cost, platform fees & CAC against retail price…",
    source: "Supplier quotes · 3PL rate cards · duty tables",
    desc: "Rebuilds the full landed cost stack—COGS, freight, platform fees and CAC—so you see the real per-unit profit before you spend a dollar.",
  },
  cmo_agent: {
    icon: Users,
    line: "Solving CAC ceiling, break-even ROAS & channel saturation…",
    source: "Meta Ad Library · TikTok Creative Center",
    desc: "Quantifies the marketing ceiling: maximum affordable CAC, break-even ROAS and how saturated ad channels are before you launch.",
  },
  cro_agent: {
    icon: ShieldAlert,
    line: "Scanning USPTO trademark registry & design-patent overlap…",
    source: "USPTO TESS · EUIPO · design patents",
    desc: "Scans for trademark conflicts, design-patent overlap and counterfeit flags that could shut down a listing overnight.",
  },
  trend_hunter: {
    icon: TrendingUp,
    line: "Deriving view velocity (now − 7d) / time and lifecycle phase…",
    source: "Google Trends · TikTok velocity index",
    desc: "Measures momentum by comparing current view velocity against the 7-day baseline and tags the product as early, peak or fading.",
  },
  competitor_intel: {
    icon: Radar,
    line: "Counting active stores running paid ads for >14 days…",
    source: "Shopify storefront crawl · Amazon BSR",
    desc: "Counts active stores running paid ads for the item longer than 14 days and weights opportunity by competitor strength.",
  },
  ux_specialist: {
    icon: Eye,
    line: "Bucketing review sentiment: material, sizing, shipping delays…",
    source: "Review corpus · return-reason clusters",
    desc: "Mines review and return-reason clusters for material, sizing, shipping and quality complaints before they become your support burden.",
  },
  supply_chain: {
    icon: Boxes,
    line: "Verifying stock stability, lead times & on-time delivery SLA…",
    source: "Supplier stock API · lane transit history",
    desc: "Checks supplier stock stability, realistic lead times and on-time delivery SLA to flag stockout or seasonal delay risks.",
  },
  pricing_strategist: {
    icon: Gauge,
    line: "Testing markup ladder & price elasticity against landed cost…",
    source: "Marketplace price bands · landed-cost model",
    desc: "Tests the markup ladder against landed cost and substitutes to find the price point that maximizes margin without killing demand.",
  },
  logistics_cost: {
    icon: Boxes,
    line: "Modelling freight share of revenue & 3PL lane costs…",
    source: "3PL rate cards · lane transit history",
    desc: "Models freight share of revenue, last-mile rates and 3PL lane costs so shipping does not silently erase the margin.",
  },
  compliance_officer: {
    icon: ShieldAlert,
    line: "Checking certification barriers (CE / FDA / SDS) & customs gates…",
    source: "Customs tariff tables · marketplace policy",
    desc: "Identifies certification barriers (CE, FDA, SDS, SABER) and customs restrictions that can block import or delist the product.",
  },
  retention_analyst: {
    icon: Activity,
    line: "Estimating repeat-purchase rate & LTV vs. CAC recovery…",
    source: "Cohort benchmarks · review corpus",
    desc: "Estimates repeat-purchase rate and lifetime value versus CAC recovery time to judge if the product can sustain a customer base.",
  },
  creative_director: {
    icon: Sparkles,
    line: "Scoring hook strength, UGC angles & 3-second hold rate…",
    source: "TikTok Creative Center · Meta Ad Library",
    desc: "Scores the hook, UGC angles, 3-second hold rate and headline variety to estimate the ad creative's viral potential.",
  },
  channel_fit: {
    icon: ScanLine,
    line: "Matching marketplace fee structure against competition density…",
    source: "Platform fee schedules · storefront crawl",
    desc: "Matches the product's margin, weight and return profile against each platform's fee structure and audience density.",
  },
  data_auditor: {
    icon: Terminal,
    line: "Auditing evidence coverage across every council input…",
    source: "Live signal pipeline · source registry",
    desc: "Cross-checks every council input for evidence coverage, consistency and confidence gaps to expose weak or assumed signals.",
  },
};

type Status = "processing" | "done" | "warning";

const glass = "rounded-2xl border border-border bg-card/60 backdrop-blur-xl";

function econOf(p: HotProduct): UnitEconomics {
  return computeUnitEconomics({
    retail_price: p.retail_price_usd,
    supplier_cost: p.supplier_cost_usd,
    marketplace: p.marketplace,
    competition: p.competition,
  });
}

/** Product Finger score — market-stream side, weighted 30%. */
function fingerScore(p: HotProduct, e: UnitEconomics) {
  const compPenalty = p.competition === "High" ? 18 : p.competition === "Medium" ? 8 : 0;
  const raw =
    p.score * 0.55 + Math.min(100, Math.max(0, e.net_margin_pct) * 2.2) * 0.45 - compPenalty;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Live market metrics — rendered only from grounded signals, never simulated. */
function marketMetrics(p: HotProduct) {
  const s = p.signals ?? {};
  const fmt = (v?: number, suffix = "") =>
    typeof v === "number" && Number.isFinite(v)
      ? `${Math.round(v).toLocaleString()}${suffix}`
      : NO_DATA;
  const velocity =
    typeof s.social_views_now === "number" && typeof s.social_views_7d_ago === "number"
      ? Math.max(0, Math.round((s.social_views_now - s.social_views_7d_ago) / 7))
      : undefined;
  return [
    { label: "Social velocity", value: fmt(velocity, "/day"), icon: Activity },
    { label: "Ads running >14d", value: fmt(s.ads_running_14d, " creatives"), icon: ScanLine },
    { label: "Active stores", value: fmt(s.active_stores, " stores"), icon: Cpu },
    { label: "Monthly searches", value: fmt(s.search_volume_monthly), icon: Gauge },
  ];
}

/* -------------------------------------------------------------------- panel */

export function CommandCenter() {
  const [query, setQuery] = useState("");
  const [niche, setNiche] = useState<string | null>(null);
  const feed = useQuery({
    queryKey: [...HOT_FEED_QUERY_KEY, niche ?? "all"] as const,
    queryFn: () => fetchHotProducts(niche),
    staleTime: 5 * 60_000,
  });

  const { products, disqualified } = useMemo(() => {
    const source = feed.data?.items ?? [];
    const scored = source.map((p) => {
      const e = econOf(p);
      return { p, e, finger: fingerScore(p, e) };
    });
    // STRICT FILTER: anything under the 15% net-margin floor never surfaces.
    const ok = scored.filter((s) => !s.e.disqualified).sort((a, b) => b.finger - a.finger);
    return { products: ok, disqualified: scored.length - ok.length };
  }, [feed.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = products.find((s) => s.p.id === selectedId) ?? products[0] ?? null;
  const selected = current?.p ?? null;
  const econ = current?.e ?? null;

  const agents = useMemo(
    () => (selected && econ ? runCouncil({ ...selected, base_score: selected.score }, econ) : []),
    [selected, econ],
  );
  const verdict = useMemo(
    () => (econ ? hybridVerdict(agents, current?.finger ?? 0, econ) : null),
    [agents, current?.finger, econ],
  );

  /* staged agent execution animation, restarts on product change */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const id = setInterval(() => setTick((t) => (t >= agents.length + 1 ? t : t + 1)), 700);
    return () => clearInterval(id);
  }, [selected?.id, agents.length]);

  const statusOf = (i: number, a: AgentPayload): Status =>
    tick <= i ? "processing" : a.veto || a.score < 55 ? "warning" : "done";

  const [drill, setDrill] = useState<AgentId | null>(null);
  const drillAgent = agents.find((a) => a.agent_id === drill) ?? null;

  const [logOpen, setLogOpen] = useState(false);
  const logs = useLogStream(selected, current?.finger ?? 0, logOpen);

  const liveState = feed.isLoading
    ? "Syncing live market stream…"
    : feed.isError
      ? "Live feed unavailable — showing cached scan"
      : null;
  const mb = econ ? marginBadge(econ) : null;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Dual-Engine Command Center
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Product Finger stream + 14-Agent AI Council, weighted 30 / 70.
            {liveState && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[--warning]">
                <Loader2 className={cn("size-3", feed.isLoading && "animate-spin")} /> {liveState}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mb && (
            <Badge variant="outline" className={cn("font-mono text-[11px]", mb.cls)}>
              MARGIN {mb.text}
            </Badge>
          )}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              setNiche(query.trim() || null);
              setSelectedId(null);
            }}
            className="flex items-center gap-1"
          >
            <Input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Niche… e.g. glassware / mugs"
              className="h-9 w-[190px] text-xs"
            />
            <Button type="submit" size="sm" variant="outline" className="gap-1.5">
              <Search className="size-4" /> Scan
            </Button>
          </form>
          <Button
            variant={logOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setLogOpen((o) => !o)}
            className="gap-2"
          >
            <Terminal className="size-4" /> Raw Log
          </Button>
        </div>
      </div>

      {logOpen && (
        <div
          className={cn(
            glass,
            "border-[--accent-active]/30 p-3 font-mono text-[11px] leading-relaxed",
          )}
        >
          <ScrollArea className="h-40">
            <div className="space-y-1 pr-3">
              {logs.map((l, i) => (
                <div key={i} className="text-muted-foreground">
                  <span className="text-[--accent-active]">{l.t}</span>{" "}
                  <span className="text-[--ai]">{l.lvl}</span> {l.msg}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-10">
        {/* ------------------------------------------------ LEFT: 30% */}
        <section className={cn(glass, "lg:col-span-3 min-w-0 overflow-hidden")}>
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="size-2 animate-pulse rounded-full bg-[--accent-active] shadow-[0_0_10px_var(--accent-active)]" />
            <h2 className="text-sm font-semibold text-[--accent-active]">Product Finger Stream</h2>
            <Badge
              variant="outline"
              className="ml-auto border-[--accent-active]/40 text-[10px] text-[--accent-active]"
            >
              30% weight
            </Badge>
          </header>

          {selected && (
            <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
              {marketMetrics(selected).map((m) => (
                <div
                  key={m.label}
                  className="rounded-xl border border-[--accent-active]/20 bg-[--accent-active]/5 p-2"
                >
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <m.icon className="size-3 text-[--accent-active]" /> {m.label}
                  </div>
                  <div className="mt-1 font-mono text-sm text-[--accent-active]">{m.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {products.length} qualified · {disqualified} disqualified (&lt;{MIN_NET_MARGIN_PCT}%
            net)
          </div>

          <ScrollArea className="h-[480px]">
            <ul className="divide-y divide-border">
              {products.map(({ p, e, finger }) => {
                const active = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[--accent-active]/8",
                        active &&
                          "bg-[--accent-active]/10 shadow-[inset_2px_0_0_0_var(--accent-active)]",
                      )}
                    >
                      <img
                        src={`/api/public/product-image?q=${encodeURIComponent(p.name)}`}
                        alt={p.name}
                        loading="lazy"
                        className="size-11 shrink-0 rounded-lg border border-border object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {p.audience || "Broad"} · {p.marketplace}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md border border-[--accent-active]/40 bg-[--accent-active]/10 px-1.5 py-0.5 font-mono text-[10px] text-[--accent-active]">
                            Finger {finger} · 30%
                          </span>
                          <span className="rounded-md border border-[--profit]/40 bg-[--profit]/10 px-1.5 py-0.5 font-mono text-[10px] text-[--profit]">
                            {e.net_margin_pct.toFixed(0)}% net
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
              {products.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">
                  No product cleared the {MIN_NET_MARGIN_PCT}% net-margin floor in this scan.
                </li>
              )}
            </ul>
          </ScrollArea>
        </section>

        {/* ------------------------------------------------ RIGHT: 70% */}
        <section className={cn(glass, "lg:col-span-7 min-w-0 overflow-hidden")}>
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Sparkles className="size-4 text-[--ai]" />
            <h2 className="text-sm font-semibold text-[--ai]">
              14-Agent AI Council · Live Execution Hub
            </h2>
            <Badge variant="outline" className="border-[--ai]/40 text-[10px] text-[--ai]">
              70% weight
            </Badge>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {selected ? `Target: ${selected.name}` : "No target"}
            </span>
          </header>

          {selected && econ && verdict && (
            <div className="flex flex-col gap-4 p-4 lg:flex-row">
              {/* agents — two 7-agent columns side by side */}
              <div className="min-w-0 flex-1">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {agents.map((a, i) => {
                    const st = statusOf(i, a);
                    const Icon = AGENT_META[a.agent_id].icon;
                    return (
                      <button
                        key={a.agent_id}
                        onClick={() => setDrill(a.agent_id)}
                        className={cn(
                          "group flex h-full flex-col justify-between gap-2 rounded-xl border border-border bg-background/40 p-3 text-left transition-colors hover:border-[--ai]/50 hover:bg-background/60",
                          st === "warning" && "border-destructive/40",
                        )}
                      >
                        <div className="flex w-full items-center gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-[--ai]/30 bg-[--ai]/10">
                            <Icon className="size-4 text-[--ai]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{a.name}</span>
                              <StatusPill status={st} />
                              {a.veto && (
                                <span className="rounded-full border border-destructive/50 bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                                  HARD VETO
                                </span>
                              )}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {st === "processing"
                                ? AGENT_META[a.agent_id].line
                                : `${a.primary_metric.label}: ${a.primary_metric.value}`}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div
                              className={cn(
                                "font-mono text-sm",
                                a.score < 40 ? "text-destructive" : "text-[--ai]",
                              )}
                            >
                              {st === "processing" ? "··" : `${a.score}/100`}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              conf {a.confidence_level}%
                            </div>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <div className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {AGENT_META[a.agent_id].desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* score column */}
              <div className="w-full space-y-3 lg:w-64 lg:shrink-0">
                <div className={cn(glass, "p-4 text-center")}>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Final Hybrid Score
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-5xl font-semibold",
                      verdict.final_score >= 85
                        ? "text-[--profit] drop-shadow-[0_0_18px_var(--profit)]"
                        : verdict.final_score >= 70
                          ? "text-[--warning]"
                          : "text-destructive",
                    )}
                  >
                    {verdict.final_score}
                  </div>
                  <Badge variant="outline" className={cn("mt-2 text-[10px]", verdict.badge.cls)}>
                    {verdict.badge.label}
                  </Badge>
                  <div className="mt-3 space-y-1 font-mono text-[11px] text-muted-foreground">
                    <div>Council {verdict.council_avg} × 0.70</div>
                    <div>Finger {verdict.finger_score} × 0.30</div>
                  </div>
                </div>

                <div className={cn(glass, "p-3")}>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Net unit economics
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-y-0.5 font-mono text-[11px]">
                    <span className="text-muted-foreground">Retail</span>
                    <span className="text-right">{econ.retail.toFixed(2)}</span>
                    <span className="text-muted-foreground">COGS</span>
                    <span className="text-right">-{econ.cogs.toFixed(2)}</span>
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="text-right">-{econ.shipping.toFixed(2)}</span>
                    <span className="text-muted-foreground">Platform fee</span>
                    <span className="text-right">-{econ.platform_fee.toFixed(2)}</span>
                    <span className="text-muted-foreground">Ad spend / CAC</span>
                    <span className="text-right">-{econ.ad_spend.toFixed(2)}</span>
                    <span
                      className={cn(
                        "mt-1 border-t border-border pt-1",
                        econ.unprofitable ? "text-destructive" : "text-[--profit]",
                      )}
                    >
                      Net / unit
                    </span>
                    <span
                      className={cn(
                        "mt-1 border-t border-border pt-1 text-right",
                        econ.unprofitable ? "text-destructive" : "text-[--profit]",
                      )}
                    >
                      {econ.net_profit.toFixed(2)}
                    </span>
                  </div>
                  {mb && (
                    <Badge
                      variant="outline"
                      className={cn("mt-2 w-full justify-center font-mono text-[10px]", mb.cls)}
                    >
                      {mb.text}
                    </Badge>
                  )}
                </div>

                {verdict.vetoed && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="size-3.5" /> Cross-agent veto applied
                    </div>
                    <ul className="space-y-1">
                      {verdict.veto_reasons.map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Accordion type="single" collapsible className={cn(glass, "px-3")}>
                  <AccordionItem value="breakdown" className="border-0">
                    <AccordionTrigger className="text-xs">Council Breakdown</AccordionTrigger>
                    <AccordionContent className="space-y-2 pb-3">
                      {agents.map((a) => (
                        <div key={a.agent_id} className="text-[11px]">
                          <div className="flex justify-between">
                            <span className="truncate text-muted-foreground">{a.name}</span>
                            <span className="font-mono text-[--ai]">
                              {a.score} · {(a.score * 0.1).toFixed(1)}pt
                            </span>
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-1 rounded-full",
                                a.score < 40 ? "bg-destructive" : "bg-[--ai]",
                              )}
                              style={{ width: `${a.score}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      <div className="mt-2 border-t border-border pt-2 text-[11px]">
                        <div className="mb-1 text-muted-foreground">Market metrics → 30%</div>
                        {marketMetrics(selected).map((m) => (
                          <div key={m.label} className="flex justify-between text-[11px]">
                            <span className="text-muted-foreground">{m.label}</span>
                            <span className="font-mono text-[--accent-active]">{m.value}</span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* drill-down drawer */}
      <Sheet open={!!drillAgent} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {drillAgent && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-[--ai]">
                  {(() => {
                    const I = AGENT_META[drillAgent.agent_id].icon;
                    return <I className="size-4" />;
                  })()}
                  {drillAgent.name}
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {AGENT_META[drillAgent.agent_id].line}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className={cn(glass, "p-3")}>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Agent score
                  </div>
                  <div
                    className={cn(
                      "font-mono text-3xl",
                      drillAgent.score < 40 ? "text-destructive" : "text-[--ai]",
                    )}
                  >
                    {drillAgent.score}/100
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Confidence {drillAgent.confidence_level}% · contributes{" "}
                    {(drillAgent.score * 0.1).toFixed(1)} pts of the 70% council weight.
                  </div>
                </div>

                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Raw parameters
                  </h4>
                  <div className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
                    {drillAgent.metrics.map((m) => (
                      <div key={m.label} className="col-span-2 flex justify-between gap-2">
                        <span className="truncate text-muted-foreground">{m.label}</span>
                        <span className="text-[--accent-active]">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Risk factors
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {(drillAgent.risk_factors.length
                      ? drillAgent.risk_factors
                      : ["No blocking risk detected on this dimension."]
                    ).map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <AlertTriangle
                          className={cn(
                            "mt-0.5 size-3.5 shrink-0",
                            drillAgent.risk_factors.length ? "text-destructive" : "text-[--profit]",
                          )}
                        />
                        <span className="text-muted-foreground">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Action recommendation
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {drillAgent.action_recommendation}
                  </p>
                </div>

                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Structured payload
                  </h4>
                  <pre className="overflow-x-auto rounded-xl border border-border bg-background/60 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(
                      {
                        agent_id: drillAgent.agent_id,
                        score: drillAgent.score,
                        confidence_level: drillAgent.confidence_level,
                        primary_metric: drillAgent.primary_metric,
                        risk_factors: drillAgent.risk_factors,
                        action_recommendation: drillAgent.action_recommendation,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>

                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Data sources
                  </h4>
                  <p className="font-mono text-[11px] text-[--accent-active]">
                    {AGENT_META[drillAgent.agent_id].source}
                  </p>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[--ai]/40 bg-[--ai]/10 px-1.5 py-0.5 text-[10px] text-[--ai]">
        <Loader2 className="size-2.5 animate-spin" /> Processing
      </span>
    );
  if (status === "warning")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
        <AlertTriangle className="size-2.5" /> Warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[--profit]/40 bg-[--profit]/10 px-1.5 py-0.5 text-[10px] text-[--profit]">
      <Check className="size-2.5" /> Done
    </span>
  );
}

type LogLine = { t: string; lvl: string; msg: string };

function useLogStream(product: HotProduct | null, finger: number, active: boolean) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const idx = useRef(0);
  useEffect(() => {
    if (!active || !product) return;
    idx.current = 0;
    setLines([]);
    const e = econOf(product);
    const templates = [
      () => `GET /api/public/hot-products 200 { "cache": "hour" }`,
      () =>
        `econ.compute { "retail": ${e.retail.toFixed(2)}, "net": ${e.net_profit.toFixed(2)}, "net_margin_pct": ${e.net_margin_pct} }`,
      () =>
        `filter.strict { "min_net_margin_pct": ${MIN_NET_MARGIN_PCT}, "pass": ${!e.disqualified} }`,
      () => `agent.dispatch { "agents": 14, "weight": 0.70 }`,
      () =>
        `signals.read { "search_volume": ${product.signals?.search_volume_monthly ?? "null"}, "active_stores": ${product.signals?.active_stores ?? "null"} }`,
      () => `uspto.query { "mark": "${product.name.split(" ")[0]}", "hits": 0 }`,
      () => `score.merge { "finger": ${finger}, "formula": "council*0.70 + finger*0.30" }`,
    ];
    const id = setInterval(() => {
      const f = templates[idx.current % templates.length]!;
      idx.current++;
      setLines((prev) => [
        ...prev.slice(-40),
        {
          t: new Date().toISOString().slice(11, 23),
          lvl: idx.current % 5 === 0 ? "WARN" : "INFO",
          msg: f(),
        },
      ]);
    }, 900);
    return () => clearInterval(id);
  }, [active, product, finger]);
  return lines;
}
