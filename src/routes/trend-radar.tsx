import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity, Bot, Brain, ChevronRight, Globe, Loader2, RadioTower, Rss,
  Search, Settings2, Sparkles, TrendingUp, Zap,
} from "lucide-react";
import {
  Line, LineChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer,
  Tooltip as RTooltip, Legend, PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { HubShell } from "@/components/tools/hub-shell";
import { toast } from "sonner";

export const Route = createFileRoute("/trend-radar")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Velora Trend Radar — Çok Platformlu AI Trend Keşfi" },
      { name: "description", content: "Google, Amazon, TikTok ve Yandex açık verilerini kazıyan otomatik botlar + RSS akışları, Velora Deep AI ile tek bir talep skorunda birleşiyor." },
      { property: "og:title", content: "Velora Trend Radar — Çok Platformlu AI Trend Keşfi" },
      { property: "og:description", content: "Kazınmış web verisi ve RSS akışlarından hibrit AI trend sentezi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TrendRadar,
});

type TrendSource = "Google" | "Amazon" | "TikTok" | "Yandex" | "RSS" | "GitHub";
type ScrapedTrend = {
  id: string; source: TrendSource; kind: "scrape" | "rss" | "github";
  trend_name: string; category: string; region: string;
  metrics: { search_volume: number; growth_rate: number; rank: number };
  scraped_at: string; raw_payload: Record<string, unknown>;
};
type SourceStatus = { source: TrendSource; kind: "scrape" | "rss" | "github"; status: "active" | "error"; items: number; detail: string };
type Verdict = {
  trend_name: string; sources: TrendSource[]; ai_demand_score: number;
  signal: string; confidence: number; reasoning: string; sentiment: string;
  hooks: string[]; persona: string; positioning: string; ad_copy: string;
};
type Synthesis = {
  mode: string; engines: string[]; summary: string; breakouts: Verdict[];
  noise_filtered: string[]; correlations: { theme: string; platforms: string[]; note: string }[];
};

const SOURCES: { id: TrendSource; label: string; color: string }[] = [
  { id: "Google", label: "Google", color: "#38bdf8" },
  { id: "Amazon", label: "Amazon", color: "#f59e0b" },
  { id: "TikTok", label: "TikTok", color: "#f43f5e" },
  { id: "Yandex", label: "Yandex", color: "#a78bfa" },
  { id: "RSS", label: "RSS / Webhook", color: "#34d399" },
  { id: "GitHub", label: "GitHub Repos", color: "#a855f7" },
];
const REGIONS = ["GLOBAL", "US", "GB", "DE", "FR", "TR", "CA", "AU", "NL", "IT", "ES"];
const CATEGORIES = ["General", "Electronics", "Home", "Beauty", "Sports", "Toys", "Pet", "Fashion"];
const MODES = [
  { id: "fast", label: "Fast Synthesis (2 motor)" },
  { id: "deep", label: "Deep Market Research (4 motor)" },
  { id: "strategy", label: "E-Commerce Strategy Mode (4 motor)" },
];

async function api(body: Record<string, unknown>) {
  const r = await fetch("/api/public/trend-radar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(String(j?.error ?? r.status));
  return j;
}

const srcColor = (s: string) => SOURCES.find((x) => x.id === s)?.color ?? "#94a3b8";

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${ok ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />;
}

function ScoreRing({ value }: { value: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const tone = value >= 75 ? "#34d399" : value >= 55 ? "#38bdf8" : "#f59e0b";
  return (
    <svg viewBox="0 0 60 60" className="size-14 -rotate-90">
      <circle cx="30" cy="30" r={r} fill="none" stroke="currentColor" className="text-white/10" strokeWidth="6" />
      <circle cx="30" cy="30" r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (c * Math.min(100, value)) / 100} />
      <text x="30" y="34" textAnchor="middle" className="rotate-90 origin-center fill-current text-[15px] font-black" style={{ transformBox: "fill-box" }}>
        {value}
      </text>
    </svg>
  );
}

function TrendRadar() {
  const [region, setRegion] = useState("US");
  const [category, setCategory] = useState("General");
  const [mode, setMode] = useState("fast");
  const [feedKind, setFeedKind] = useState<"all" | "scrape" | "rss" | "github">("all");
  const [active, setActive] = useState<TrendSource[]>(["Google", "Amazon", "TikTok", "Yandex", "RSS", "GitHub"]);
  const [rssText, setRssText] = useState("");
  const [webhookPayload, setWebhookPayload] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [trends, setTrends] = useState<ScrapedTrend[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [synth, setSynth] = useState<Synthesis | null>(null);
  const [scraping, setScraping] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [brief, setBrief] = useState<{ trend: string; data: Record<string, unknown> | null } | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const toggle = (s: TrendSource) =>
    setActive((a) => (a.includes(s) ? a.filter((x) => x !== s) : [...a, s]));

  const visible = useMemo(
    () => trends
      .filter((t) => active.includes(t.source))
      .filter((t) => feedKind === "all" || t.kind === feedKind)
      .sort((a, b) => (scoreOf(b) - scoreOf(a))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trends, active, feedKind, synth],
  );

  function scoreOf(t: ScrapedTrend): number {
    const hit = synth?.breakouts.find((b) =>
      b.trend_name.toLowerCase().includes(t.trend_name.toLowerCase().slice(0, 14)) ||
      t.trend_name.toLowerCase().includes(b.trend_name.toLowerCase().slice(0, 14)));
    if (hit) return hit.ai_demand_score;
    return Math.min(94, Math.round(t.metrics.growth_rate / 3 + Math.min(40, t.metrics.search_volume / 5000)));
  }

  async function runScrape() {
    setScraping(true);
    try {
      const feeds = rssText.split(/\s|\n|,/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
      const j = await api({ action: "scrape", region, category, sources: active, rss_feeds: feeds, niche: category });
      setTrends(j.trends ?? []);
      setStatuses(j.statuses ?? []);
      setSynth(null);
      const ok = (j.statuses ?? []).filter((s: SourceStatus) => s.status === "active").length;
      toast.success(`Otomatik kazıma tamam — ${j.trends?.length ?? 0} sinyal, ${ok} kaynak aktif`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScraping(false);
    }
  }

  async function runAnalysis() {
    if (!trends.length) return toast.error("Önce otomatik kazıma işini çalıştır.");
    setAnalyzing(true);
    try {
      const j = await api({ action: "analyze", region, category, mode, trends: trends.slice(0, 70) });
      setSynth(j);
      toast.success(`Velora Deep AI hazır — ${j.engines?.length ?? 0} motor birleştirildi`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function openBrief(trend: string) {
    setBrief({ trend, data: null });
    setBriefLoading(true);
    try {
      setBrief({ trend, data: await api({ action: "brief", region, category, trend }) });
    } catch (e) {
      toast.error((e as Error).message);
      setBrief(null);
    } finally {
      setBriefLoading(false);
    }
  }

  async function sendWebhook() {
    try {
      const payload = JSON.parse(webhookPayload || "[]");
      const j = await api({ action: "webhook", region, payload });
      setTrends((t) => [...(j.trends ?? []), ...t]);
      toast.success(`${j.ingested} webhook kaydı alındı`);
    } catch (e) {
      toast.error("Geçersiz JSON veya ingest hatası: " + (e as Error).message);
    }
  }

  /* ------------------------------------------------------------ chart data */
  const growthChart = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => i);
    return buckets.map((i) => {
      const row: Record<string, number | string> = { rank: `#${i + 1}` };
      SOURCES.forEach((s) => {
        const t = trends.filter((x) => x.source === s.id)[i];
        if (t) row[s.id] = t.metrics.growth_rate;
      });
      return row;
    });
  }, [trends]);

  const distribution = useMemo(
    () => SOURCES.map((s) => {
      const rows = trends.filter((t) => t.source === s.id);
      const velocity = rows.length ? Math.round(rows.reduce((a, b) => a + b.metrics.growth_rate, 0) / rows.length) : 0;
      return { name: s.label, id: s.id, value: rows.length, velocity, color: s.color };
    }).filter((d) => d.value > 0),
    [trends],
  );

  const statusOf = (s: TrendSource) => statuses.find((x) => x.source === s);

  return (
    <HubShell
      emoji="📡"
      title="Velora Trend Radar"
      subtitle="Google, Amazon, TikTok ve Yandex'in halka açık sayfalarını kazıyan otomatik botlar + açık RSS/webhook akışları, Velora Deep AI Intelligence ile tek bir talep skorunda birleşiyor."
    >
      {/* ------------------------------------------------ live control panel */}
      <Card className="lg:col-span-2 border-white/10 bg-slate-950/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower size={16} className="text-cyan-400" /> Live Automated Sync & AI Control
          </CardTitle>
          <CardDescription>Kazıma botları, açık akışlar ve AI motoru tek panelden yönetilir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {SOURCES.map((s) => {
              const st = statusOf(s.id);
              const ok = !st || st.status === "active";
              return (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                  <StatusDot ok={!!st && ok} />
                  {s.id === "RSS" ? <Rss size={12} /> : <Bot size={12} />}
                  {s.label} {s.id === "RSS" ? "RSS" : "Scraper"}:{" "}
                  <b className={st ? (ok ? "text-emerald-400" : "text-rose-400") : "text-slate-400"}>
                    {st ? (ok ? `Active (${st.items})` : "Error") : "Idle"}
                  </b>
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
              <StatusDot ok /> <Brain size={12} /> AI Engine: <b className="text-emerald-400">Ready</b>
              {synth?.engines?.length ? <span className="text-slate-400">({synth.engines.join(" + ")})</span> : null}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={feedKind} onValueChange={(v) => setFeedKind(v as typeof feedKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm veri kaynakları</SelectItem>
                <SelectItem value="scrape">Scraped Web Data</SelectItem>
                <SelectItem value="rss">RSS / Webhook Feeds</SelectItem>
                <SelectItem value="github">GitHub Repos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <button key={s.id} onClick={() => toggle(s.id)}
                className={`rounded-full border px-3 py-1 text-xs transition ${active.includes(s.id) ? "border-white/25 bg-white/10" : "border-white/10 bg-transparent text-slate-500"}`}>
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runScrape} disabled={scraping} variant="secondary">
              {scraping ? <Loader2 className="animate-spin" size={15} /> : <Bot size={15} />} Trigger Automated Scraping Job
            </Button>
            <Button onClick={runAnalysis} disabled={analyzing} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
              {analyzing ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />} Run Deep AI Analysis
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} /> Ayarlar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* -------------------------------------------------- AI synthesis hero */}
      <Card className="lg:col-span-2 border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-950/60 to-slate-950/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain size={16} className="text-cyan-400" /> AI Cross-Platform Synthesis
          </CardTitle>
          <CardDescription>
            {synth?.summary || "Deep AI Analysis çalıştırıldığında en güçlü 3 breakout niş ürün, gerekçesi ve güven skoruyla burada belirir."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!synth ? (
            <p className="text-sm text-slate-500">Henüz analiz yok.</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {synth.breakouts.slice(0, 3).map((b) => (
                  <div key={b.trend_name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold leading-tight">{b.trend_name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {b.sources.map((s) => (
                            <span key={s} className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{ background: `${srcColor(s)}22`, color: srcColor(s) }}>{s}</span>
                          ))}
                        </div>
                      </div>
                      <ScoreRing value={b.ai_demand_score} />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">{b.reasoning}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <Badge variant="outline" className={b.sentiment === "positive" ? "border-emerald-500/40 text-emerald-300" : b.sentiment === "negative" ? "border-rose-500/40 text-rose-300" : "border-white/20"}>
                        {b.sentiment}
                      </Badge>
                      <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">güven %{b.confidence}</Badge>
                      <Badge variant="outline" className={b.signal === "verified" ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}>
                        {b.signal}
                      </Badge>
                    </div>
                    <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs text-cyan-300"
                      onClick={() => openBrief(b.trend_name)}>
                      AI Ürün Brifingi <ChevronRight size={13} />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                    <Activity size={13} /> Cross-Platform Korelasyon
                  </p>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {synth.correlations.map((c) => (
                      <li key={c.theme}>
                        <b>{c.theme}</b>{" "}
                        {c.platforms.map((p) => (
                          <span key={p} className="mx-0.5 rounded px-1 py-0.5 text-[10px]" style={{ background: `${srcColor(p)}22`, color: srcColor(p) }}>{p}</span>
                        ))}
                        <span className="text-slate-400"> — {c.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Zap size={13} /> Gürültü Filtresi (elenen sinyaller)
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-xs text-slate-400">
                    {synth.noise_filtered.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ charts */}
      <Card className="border-white/10 bg-slate-950/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><TrendingUp size={16} className="text-emerald-400" /> Multi-Source Growth Comparison</CardTitle>
          <CardDescription>Kazınan/RSS metriklerinin sıralamaya göre büyüme eğrisi (%).</CardDescription>
        </CardHeader>
        <CardContent className="h-[260px]">
          {trends.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" />
                <XAxis dataKey="rank" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SOURCES.filter((s) => active.includes(s.id)).map((s) => (
                  <Line key={s.id} type="monotone" dataKey={s.id} stroke={s.color} strokeWidth={2} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="pt-16 text-center text-sm text-slate-500">Kazıma işini çalıştır.</p>}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-slate-950/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Globe size={16} className="text-violet-400" /> Platform Distribution Matrix</CardTitle>
          <CardDescription>Hangi platform daha çok ve daha hızlı sinyal üretiyor.</CardDescription>
        </CardHeader>
        <CardContent className="h-[260px]">
          {distribution.length ? (
            <div className="grid h-full grid-cols-2 gap-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={32} outerRadius={58} paddingAngle={3}>
                    {distribution.map((d) => <Cell key={d.id} fill={d.color} />)}
                  </Pie>
                  <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" />
                  <XAxis dataKey="id" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <RTooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="velocity" radius={[6, 6, 0, 0]}>
                    {distribution.map((d) => <Cell key={d.id} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="pt-16 text-center text-sm text-slate-500">Veri yok.</p>}
        </CardContent>
      </Card>

      {/* --------------------------------------------------------- trend feed */}
      <Card className="lg:col-span-2 border-white/10 bg-slate-950/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Search size={16} className="text-cyan-400" /> Trend Feed & AI Strategy</CardTitle>
          <CardDescription>{visible.length} sinyal — kaynak, hız, AI talep skoru ve ilk tespit zamanı.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trend</TableHead>
                <TableHead>Kaynak</TableHead>
                <TableHead className="text-right">Hacim</TableHead>
                <TableHead className="text-right">Hız</TableHead>
                <TableHead className="text-right">AI Skor</TableHead>
                <TableHead>Tespit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.slice(0, 40).map((t) => {
                const score = scoreOf(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[280px] truncate font-medium">{t.trend_name}</TableCell>
                    <TableCell>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: `${srcColor(t.source)}22`, color: srcColor(t.source) }}>
                        {t.source}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.metrics.search_volume.toLocaleString()}</TableCell>
                    <TableCell className={`text-right tabular-nums ${t.metrics.growth_rate >= 100 ? "text-emerald-400" : t.metrics.growth_rate >= 40 ? "text-cyan-300" : "text-amber-300"}`}>
                      +{t.metrics.growth_rate}%
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{score}</TableCell>
                    <TableCell className="text-xs text-slate-400">{new Date(t.scraped_at).toLocaleTimeString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-cyan-300" onClick={() => openBrief(t.trend_name)}>
                        Generate AI Product Brief
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!visible.length && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  Henüz sinyal yok — "Trigger Automated Scraping Job" ile başla.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------- modals */}
      <Dialog open={!!brief} onOpenChange={(o) => !o && setBrief(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">AI Ürün Brifingi — {brief?.trend}</DialogTitle></DialogHeader>
          {briefLoading || !brief?.data ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="animate-spin" size={16} /> Velora Deep AI brifingi hazırlıyor…
            </div>
          ) : <BriefBody data={brief.data} />}
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-base">Kaynak & AI Ayarları</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-300">Açık RSS uç noktaları (satır başına bir URL)</p>
              <Textarea rows={4} value={rssText} onChange={(e) => setRssText(e.target.value)}
                placeholder="https://www.retaildive.com/feeds/news/" />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-300">Scraping webhook ingest (JSON dizi veya {"{items:[…]}"})</p>
              <Textarea rows={4} value={webhookPayload} onChange={(e) => setWebhookPayload(e.target.value)}
                placeholder='[{"trend_name":"portable blender","metrics":{"search_volume":42000,"growth_rate":180}}]' />
              <Button size="sm" className="mt-2" onClick={sendWebhook}><Rss size={14} /> Payload gönder</Button>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-300">Webhook URL</p>
              <Input readOnly value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/public/trend-radar`} />
              <p className="mt-1 text-[11px] text-slate-500">POST {"{ action: \"webhook\", payload: […] }"}</p>
            </div>
            <p className="rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] text-slate-400">
              AI anahtarları (Gemini ×3, Groq, OpenRouter, Lovable AI) sunucu tarafında güvenli şekilde saklanır — panelde girilmez.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </HubShell>
  );
}

function BriefBody({ data }: { data: Record<string, unknown> }) {
  const arr = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]) : []);
  const pricing = (data["pricing"] ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-base font-bold">{String(data["headline"] ?? "")}</p>
      <p className="text-slate-300">{String(data["opportunity"] ?? "")}</p>

      <Section title="🎯 Hedef Kitle">
        {arr("audience").map((a, i) => {
          const o = a as Record<string, unknown>;
          return (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs">
              <b>{String(o["persona"] ?? "")}</b>
              <p className="text-slate-400">Acı: {String(o["pain"] ?? "")}</p>
              <p className="text-slate-400">Tetikleyici: {String(o["trigger"] ?? "")}</p>
            </div>
          );
        })}
      </Section>

      <Section title="📐 Konumlandırma Açıları">
        <ul className="list-inside list-disc space-y-1 text-xs text-slate-300">
          {arr("angles").map((a, i) => <li key={i}>{String(a)}</li>)}
        </ul>
      </Section>

      <Section title="🪝 Reklam Kancaları">
        <ul className="list-inside list-disc space-y-1 text-xs text-slate-300">
          {arr("hooks").map((a, i) => <li key={i}>{String(a)}</li>)}
        </ul>
      </Section>

      <Section title="✍️ Hazır Reklam Metinleri">
        {arr("ad_copy").map((a, i) => {
          const o = a as Record<string, unknown>;
          return (
            <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs">
              <Badge variant="outline" className="mb-1 border-cyan-500/40 text-cyan-300">{String(o["channel"] ?? "")}</Badge>
              <p className="text-slate-300">{String(o["copy"] ?? "")}</p>
            </div>
          );
        })}
      </Section>

      {!!Object.keys(pricing).length && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="Önerilen fiyat" value={`$${Number(pricing["suggested_retail_usd"] ?? 0)}`} tone="text-emerald-400" />
          <Stat label="Maliyet" value={`$${Number(pricing["landed_cost_usd"] ?? 0)}`} tone="text-amber-300" />
          <Stat label="Marj" value={`%${Number(pricing["margin_pct"] ?? 0)}`} tone="text-cyan-300" />
        </div>
      )}

      <Section title="⚠️ Riskler">
        <ul className="list-inside list-disc space-y-1 text-xs text-amber-300/90">
          {arr("risks").map((a, i) => <li key={i}>{String(a)}</li>)}
        </ul>
      </Section>
      <Section title="✅ Sonraki Adımlar">
        <ol className="list-inside list-decimal space-y-1 text-xs text-slate-300">
          {arr("next_steps").map((a, i) => <li key={i}>{String(a)}</li>)}
        </ol>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className={`text-sm font-black ${tone}`}>{value}</p>
    </div>
  );
}
