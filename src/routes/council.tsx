import { withProGate } from "@/components/pro-route-gate";
import { getUiLang } from "@/lib/auto-i18n/lang";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  Search,
  ShieldCheck,
  TrendingUp,
  Coins,
  Megaphone,
  Gauge,
  Database,
  Loader2,
  Check,
  Truck,
  ShieldAlert,
  Palette,
} from "lucide-react";
import { HubShell } from "@/components/tools/hub-shell";
import { CreditCost } from "@/components/credit-cost";
import { getUsageSnapshot } from "@/lib/usage.functions";
import {
  USAGE_FEATURES,
  isExhausted,
  normalizeUsageSnapshot,
  type UsageFeature,
} from "@/lib/usage";
import {
  streamAgentRun,
  streamCouncilAnalysis,
  type AgentProgress,
} from "@/lib/agent-stream.client";
import { nextStageIndex, stageIndexForAgent, stageIndexForStage } from "@/lib/council-stage";
import { PIPELINE_STAGES, stageIndexForPipelineStage } from "@/lib/pipeline-stage";
import { DeepAnalysisResults } from "@/components/deep-analysis-results";
import type { PipelineOutput } from "@/lib/velora-pipeline.server";
import { TARGET_COUNTRIES } from "@/lib/countries";
import type { CouncilReport } from "@/lib/council.server";

const STAGES = [
  { icon: ShieldCheck, label: "Fingerprint & Turnstile doğrulanıyor…" },
  {
    icon: Database,
    label: "Veri hatları taranıyor (Google Trends · Reddit · TikTok · Amazon · GitHub)…",
  },
  { icon: TrendingUp, label: "Trend Ekibi veri topluyor…" },
  { icon: Coins, label: "Finans Ekibi maliyet hesaplıyor…" },
  { icon: Megaphone, label: "Pazarlama Ekibi reklam kancası üretiyor…" },
  { icon: Truck, label: "Operasyon Ekibi lojistik analizi yapıyor…" },
  { icon: ShieldAlert, label: "Uyum Ekibi risk & sertifikaları inceliyor…" },
  { icon: Palette, label: "Yaratıcı Ekibi viral kancaları değerlendiriyor…" },
  { icon: Gauge, label: "Müdür Aroless Skorunu oluşturuyor…" },
  { icon: ShieldCheck, label: "Bağımsız Denetçi final puanı teyit ediyor…" },
];

const TEAM_ICON = {
  market: TrendingUp,
  finance: Coins,
  marketing: Megaphone,
  operations: Truck,
  compliance: ShieldAlert,
  creative: Palette,
} as const;

type AnalysisMode = "council" | "pipeline";

/** The two analysis engines exposed on this page. */
const ANALYSIS_MODES: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  {
    id: "council",
    label: "14'lü Konsey",
    hint: "Altı üretici + altı hakem ekip, müdür sentezi ve bağımsız denetçi tek sayfalık icra raporu üretir.",
  },
  {
    id: "pipeline",
    label: "Derin Ürün Analizi",
    hint: "Product Retriever + 14 ajanlı konsey zinciri sıralı çalışır; ürünleri skorlayıp listeler.",
  },
];

/** Progress rows for the Velora deep-analysis run (retriever → council → synthesis). */
function PipelineStageList({ active }: { active: number }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      {PIPELINE_STAGES.map((label, i) => {
        const done = i < active;
        return (
          <div
            key={label}
            className={`flex items-center gap-3 text-sm ${i > active ? "opacity-40" : ""}`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.62_0.17_255)]/15">
              {done ? (
                <Check size={14} className="text-emerald-400" />
              ) : i === active ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <span className="text-[11px] text-muted-foreground">{i + 1}</span>
              )}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function StageList({ active }: { active: number }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        const done = i < active;
        return (
          <div
            key={s.label}
            className={`flex items-center gap-3 text-sm ${i > active ? "opacity-40" : ""}`}
          >
            <span className="h-7 w-7 shrink-0 rounded-lg bg-[oklch(0.62_0.17_255)]/15 flex items-center justify-center">
              {done ? (
                <Check size={14} className="text-emerald-400" />
              ) : i === active ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Icon size={14} />
              )}
            </span>
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 rounded-full grid place-items-center bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]">
        <div className="h-[86px] w-[86px] rounded-full bg-background grid place-items-center">
          <div className="text-center">
            <div className="text-2xl font-extrabold">{score}</div>
            <div className="text-[10px] text-muted-foreground">/ 100</div>
          </div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Aroless Score</div>
        <div className="text-sm text-muted-foreground">
          6 ekip · 12 model · müdür · denetçi ortalaması
        </div>
      </div>
    </div>
  );
}

/** Merges an incoming agent update into the live status list. */
function upsertAgent(list: AgentProgress[], update: AgentProgress): AgentProgress[] {
  const index = list.findIndex((a) => a.agent === update.agent);
  if (index < 0) return [...list, update];
  return list.map((a, i) => (i === index ? { ...a, ...update } : a));
}

function CouncilPage() {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("GLOBAL");
  const [mode, setMode] = useState<AnalysisMode>("council");
  const [stage, setStage] = useState(-1);
  const [report, setReport] = useState<CouncilReport | null>(null);
  const [depth, setDepth] = useState<PipelineOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [agents, setAgents] = useState<AgentProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Paket kotası: konsey ve derin analiz farklı aylık haklardan düşer.
  const usageFn = useServerFn(getUsageSnapshot);
  const usageQ = useQuery({
    queryKey: ["usage-snapshot"],
    queryFn: () => usageFn(),
    staleTime: 60_000,
  });
  const activeFeature: UsageFeature = mode === "council" ? "council" : "product_finder";
  const activeMeta = USAGE_FEATURES.find((f) => f.key === activeFeature);
  // Sunucu kotası okunamadıysa kilitleme yapma — yalnızca kesin veriyle uyar.
  const quota = usageQ.data ? normalizeUsageSnapshot(usageQ.data).features[activeFeature] : null;
  const outOfQuota = quota ? isExhausted(quota) : false;

  // Closing the tab mid-run aborts the stream (and the server-side council run).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const run = async (): Promise<void> => {
    if (running || query.trim().length < 2) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReport(null);
    setDepth(null);
    setAgents([]);
    setStage(0);
    setRunning(true);

    // Both modes share the same live progress wiring; only the payloads differ.
    const handlers = {
      onStage: (event: { stage: string }) => {
        const index =
          mode === "council"
            ? stageIndexForStage(event.stage)
            : stageIndexForPipelineStage(event.stage);
        if (index >= 0) setStage((prev) => nextStageIndex(prev, index));
      },
      onAgent: (agent: AgentProgress) => {
        setAgents((prev) => upsertAgent(prev, agent));
        if (mode !== "council") return;
        const index = stageIndexForAgent(agent.agent);
        if (index >= 0) setStage((prev) => nextStageIndex(prev, index));
      },
    };

    try {
      if (mode === "council") {
        const data = await streamCouncilAnalysis(
          { query, country, lang: getUiLang() },
          handlers,
          controller.signal,
        );
        setReport(data);
        if (data.cache_hit) toast.success("24 saatlik önbellekten getirildi — kredi harcanmadı.");
      } else {
        const data = await streamAgentRun<PipelineOutput>(
          { mode: "pipeline", userQuery: query, country, language: getUiLang() },
          handlers,
          controller.signal,
        );
        setDepth(data);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Analiz çalıştırılamadı.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) {
        setRunning(false);
        setStage(-1);
      }
    }
  };

  return (
    <HubShell
      emoji="🧠"
      title="14'lü AI Konsey"
      subtitle="İki motor: 14'lü konsey (ekip + hakem + müdür + denetçi icra raporu) ve derin ürün analizi (retriever + sıralı konsey zinciri ile skorlanmış ürünler). Çoklu sağlayıcı, otomatik yedekleme ve 24 saatlik önbellek."
    >
      <div className="mx-auto w-full max-w-4xl space-y-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Brain className="text-[oklch(0.75_0.16_255)]" />
          <h1 className="text-xl font-extrabold">
            {mode === "council" ? "Konsey Analizi" : "Derin Ürün Analizi"}
          </h1>
          <CreditCost amount={1} />
        </div>

        <div className="flex gap-2">
          {ANALYSIS_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={running}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                mode === m.id
                  ? "border-[oklch(0.62_0.17_255)]/60 bg-[oklch(0.62_0.17_255)]/15 text-foreground"
                  : "border-border/60 bg-transparent text-muted-foreground hover:bg-white/5"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 rounded-xl border border-border/60 px-3">
            <Search size={16} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && query.trim().length > 1 && void run()}
              placeholder="Ürün veya niş (örn. taşınabilir buz makinesi)"
              className="w-full bg-transparent py-3 text-sm outline-none"
            />
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-xl border border-border/60 bg-transparent px-3 py-3 text-sm"
          >
            {TARGET_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <button
            onClick={() => void run()}
            disabled={running || query.trim().length < 2 || outOfQuota}
            className="rounded-xl px-5 py-3 text-sm font-semibold text-white bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] disabled:opacity-50"
            {...(outOfQuota ? { title: `${activeMeta?.label} limitin doldu` } : {})}
          >
            {running
              ? mode === "council"
                ? "Konsey çalışıyor…"
                : "Derin analiz çalışıyor…"
              : mode === "council"
                ? "Konseyi çalıştır"
                : "Derin analizi başlat"}
          </button>
        </div>

        {outOfQuota && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[oklch(0.68_0.20_25)]/45 bg-[oklch(0.68_0.20_25)]/10 p-3 text-sm">
            <span className="flex items-center gap-2">
              <ShieldAlert size={15} className="shrink-0 text-[oklch(0.75_0.18_25)]" />
              {activeMeta?.label} limitin doldu ({quota?.used} / {quota?.limit}). Paketini
              yükselterek devam edebilirsin.
            </span>
            <Link
              to="/pricing"
              className="inline-flex items-center rounded-xl bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-xs font-bold text-white"
            >
              Paket Yükselt
            </Link>
          </div>
        )}

        {running && (
          <div className="glass rounded-2xl p-5 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Canlı ajan durumu · {agents.filter((a) => a.status === "complete").length} tamamlandı
            </div>
            {agents.length === 0 ? (
              <div className="text-sm text-muted-foreground">Ajanlar başlatılıyor…</div>
            ) : (
              <ul className="space-y-1.5">
                {agents.map((a) => (
                  <li key={a.agent} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {a.status === "complete" ? (
                        <Check size={13} className="shrink-0 text-emerald-400" />
                      ) : a.status === "error" ? (
                        <ShieldAlert size={13} className="shrink-0 text-red-400" />
                      ) : (
                        <Loader2 size={13} className="shrink-0 animate-spin" />
                      )}
                      <span className="truncate">{a.agent}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {a.status === "complete"
                        ? a.ms !== undefined
                          ? `${(a.ms / 1000).toFixed(1)}s`
                          : "tamamlandı"
                        : a.status === "error"
                          ? "hata (yedekle devam)"
                          : "çalışıyor"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {running &&
          (mode === "council" ? (
            <StageList active={Math.max(0, stage)} />
          ) : (
            <PipelineStageList active={Math.max(0, stage)} />
          ))}

        {depth && <DeepAnalysisResults result={depth} />}

        {mode === "council" && report && (
          <div className="space-y-5">
            <div className="glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <ScoreRing score={report.velora_score} />
              <div className="text-right space-y-1">
                <div className="font-bold">{report.verdict}</div>
                <div className="text-xs text-muted-foreground">Müdür: {report.director_engine}</div>
                <div className="flex flex-wrap justify-end gap-2 pt-1 text-[11px]">
                  <span className="rounded-full border border-border/60 px-2 py-0.5">
                    Güven %{report.confidence}
                  </span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5">
                    Veri kapsamı %{report.data_coverage}
                  </span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5">
                    Görüş ayrılığı {report.disagreement} puan
                  </span>
                  {report.opportunity_window && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                      Fırsat penceresi: {report.opportunity_window}
                    </span>
                  )}
                </div>
                {report.cache_hit && (
                  <div className="text-xs text-emerald-400">
                    Önbellekten (24s) · kredi harcanmadı
                  </div>
                )}
              </div>
            </div>

            {report.alt_market && (
              <div className="glass rounded-2xl p-4 text-sm">
                <span className="font-semibold">Alternatif pazar önerisi: </span>
                <span className="text-muted-foreground">{report.alt_market}</span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {report.teams.map((t) => {
                const Icon = TEAM_ICON[t.team];
                return (
                  <div key={t.team} className="glass rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <Icon size={15} /> {t.title}
                      </span>
                      <span className="text-lg font-extrabold">{t.score}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t.engine} · ağırlık %{t.weight} · güven %{t.confidence}
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]"
                        style={{ width: `${t.score}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t.summary}</p>
                    <ul className="space-y-1 text-xs">
                      {t.bullets.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                    {t.metrics.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {t.metrics.map((m, i) => (
                          <div key={i} className="rounded-lg bg-white/5 p-2">
                            <div className="text-[10px] text-muted-foreground">{m.label}</div>
                            <div className="text-xs font-semibold">{m.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="rounded-lg border border-border/50 p-2 text-[11px] text-muted-foreground">
                      <span className="font-semibold">{t.reviewer_engine}</span> · ekip{" "}
                      {t.raw_score} → hakem {t.review_score}
                      {t.review_note && <div className="mt-1">{t.review_note}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {report.executive_report && (
              <div className="glass rounded-2xl p-5">
                <h2 className="font-bold mb-3">İcra Raporu</h2>
                <div className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {report.executive_report}
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="glass rounded-2xl p-5">
                <h3 className="font-semibold mb-2">Aksiyon Planı</h3>
                <ol className="space-y-1 text-sm text-muted-foreground list-decimal pl-4">
                  {report.action_plan.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </div>
              <div className="glass rounded-2xl p-5">
                <h3 className="font-semibold mb-2">Riskler</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {report.risks.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            </div>

            {report.kill_criteria.length > 0 && (
              <div className="glass rounded-2xl p-5">
                <h3 className="font-semibold mb-2">Durdurma Kriterleri</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {report.kill_criteria.map((k, i) => (
                    <li key={i}>⛔ {k}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="glass rounded-2xl p-5">
              <h3 className="font-semibold mb-3">Veri Hatları</h3>
              <div className="flex flex-wrap gap-2">
                {report.signals.sources.map((s, i) => (
                  <span
                    key={i}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      s.status === "active"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500/30 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {s.name} · {s.items}
                  </span>
                ))}
              </div>
              {report.signals.reddit.length > 0 && (
                <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                  {report.signals.reddit.slice(0, 5).map((r, i) => (
                    <li key={i}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                        r/{r.subreddit} · {r.score}↑ — {r.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </HubShell>
  );
}

export const Route = createFileRoute("/council")({
  head: () => ({
    meta: [
      { title: "14'lü AI Konsey — Aroless AI Ürün Analizi" },
      {
        name: "description",
        content:
          "Aroless'nın 14 modeli AI konseyi: trend, finans, pazarlama, operasyon, uyum ve yaratıcı ekipleri canlı veri hatlarını analiz eder; müdür ve bağımsız denetçi tek sayfalık icra raporu ile Aroless Score üretir.",
      },
      { property: "og:title", content: "14'lü AI Konsey — Aroless AI" },
      {
        property: "og:description",
        content:
          "6 uzman ekip (üretici + hakem) + müdür + denetçi. Çoklu sağlayıcı, otomatik fallback, 24 saat cache.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: withProGate(CouncilPage),
});
