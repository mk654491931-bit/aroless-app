import { getUiLang } from "@/lib/auto-i18n/lang";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, Search, ShieldCheck, TrendingUp, Coins, Megaphone, Gauge, Database, Loader2, Check } from "lucide-react";
import { HubShell } from "@/components/tools/hub-shell";
import { CreditCost } from "@/components/credit-cost";
import { runCouncilAnalysis } from "@/lib/council.functions";
import { TARGET_COUNTRIES } from "@/lib/countries";
import type { CouncilReport } from "@/lib/council.server";

const STAGES = [
  { icon: ShieldCheck, label: "Fingerprint & Turnstile doğrulanıyor…" },
  { icon: Database, label: "Veri hatları taranıyor (Google Trends · Reddit · TikTok · Amazon · GitHub)…" },
  { icon: TrendingUp, label: "Trend Ekibi veri topluyor…" },
  { icon: Coins, label: "Finans Ekibi maliyet hesaplıyor…" },
  { icon: Megaphone, label: "Pazarlama Ekibi reklam kancası üretiyor…" },
  { icon: Gauge, label: "Müdür Aroless Skorunu oluşturuyor…" },
];

const TEAM_ICON = { market: TrendingUp, finance: Coins, marketing: Megaphone } as const;

function StageList({ active }: { active: number }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        const done = i < active;
        return (
          <div key={s.label} className={`flex items-center gap-3 text-sm ${i > active ? "opacity-40" : ""}`}>
            <span className="h-7 w-7 shrink-0 rounded-lg bg-[oklch(0.68_0.20_265)]/15 flex items-center justify-center">
              {done ? <Check size={14} className="text-emerald-400" /> : i === active ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
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
      <div className="relative h-24 w-24 rounded-full grid place-items-center bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]">
        <div className="h-[86px] w-[86px] rounded-full bg-background grid place-items-center">
          <div className="text-center">
            <div className="text-2xl font-extrabold">{score}</div>
            <div className="text-[10px] text-muted-foreground">/ 100</div>
          </div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Aroless Score</div>
        <div className="text-sm text-muted-foreground">Pazar · Finans · Pazarlama ortalaması</div>
      </div>
    </div>
  );
}

function CouncilPage() {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("GLOBAL");
  const [stage, setStage] = useState(-1);
  const [report, setReport] = useState<CouncilReport | null>(null);
  const runFn = useServerFn(runCouncilAnalysis);

  const mutation = useMutation({
    mutationFn: async () => {
      setReport(null);
      setStage(0);
      const timer = window.setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 4500);
      try {
        return (await runFn({ data: { query, country, lang: getUiLang() } })) as CouncilReport;
      } finally {
        window.clearInterval(timer);
      }
    },
    onSuccess: (data) => {
      setStage(-1);
      setReport(data);
      if (data.cache_hit) toast.success("24 saatlik önbellekten getirildi — kredi harcanmadı.");
    },
    onError: (e: Error) => {
      setStage(-1);
      toast.error(e.message);
    },
  });

  return (
    <HubShell
      emoji="🧠"
      title="7'li AI Konsey"
      subtitle="Üç uzman ekip + hakem modeller + müdür sentezi. Çoklu sağlayıcı altyapısı, otomatik yedekleme ve 24 saatlik akıllı önbellek ile çalışır."
    >
      <div className="mx-auto w-full max-w-4xl space-y-6 py-6">
        <div className="flex items-center gap-2">
          <Brain className="text-[oklch(0.75_0.16_265)]" />
          <h1 className="text-xl font-extrabold">Konsey Analizi</h1>
          <CreditCost amount={1} />
        </div>

        <div className="glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 rounded-xl border border-border/60 px-3">
            <Search size={16} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && query.trim() && mutation.mutate()}
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
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || query.trim().length < 2}
            className="rounded-xl px-5 py-3 text-sm font-semibold text-white bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] disabled:opacity-50"
          >
            {mutation.isPending ? "Konsey çalışıyor…" : "Konseyi çalıştır"}
          </button>
        </div>

        {mutation.isPending && <StageList active={Math.max(0, stage)} />}

        {report && (
          <div className="space-y-5">
            <div className="glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <ScoreRing score={report.velora_score} />
              <div className="text-right space-y-1">
                <div className="font-bold">{report.verdict}</div>
                <div className="text-xs text-muted-foreground">Müdür: {report.director_engine}</div>
                <div className="flex flex-wrap justify-end gap-2 pt-1 text-[11px]">
                  <span className="rounded-full border border-border/60 px-2 py-0.5">Güven %{report.confidence}</span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5">Veri kapsamı %{report.data_coverage}</span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5">Görüş ayrılığı {report.disagreement} puan</span>
                  {report.opportunity_window && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                      Fırsat penceresi: {report.opportunity_window}
                    </span>
                  )}
                </div>
                {report.cache_hit && <div className="text-xs text-emerald-400">Önbellekten (24s) · kredi harcanmadı</div>}
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
                        className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]"
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
                      <span className="font-semibold">{t.reviewer_engine}</span> · ekip {t.raw_score} → hakem {t.review_score}
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
      { title: "7'li AI Konsey — Aroless AI Ürün Analizi" },
      {
        name: "description",
        content:
          "Aroless'nın 7 modelli AI konseyi: trend, finans ve pazarlama ekipleri canlı veri hatlarını analiz eder ve tek sayfalık icra raporu ile Aroless Score üretir.",
      },
      { property: "og:title", content: "7'li AI Konsey — Aroless AI" },
      { property: "og:description", content: "Trend, finans ve pazarlama ekipleri + müdür sentezi ile Aroless Score." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CouncilPage,
});
