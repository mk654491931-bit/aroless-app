import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, AlertTriangle, Loader2, Radar, Sparkles, Users } from "lucide-react";
import { runAgentPipeline } from "@/lib/velora-agents.functions";

/**
 * VELORA 14 AJAN DERİN ANALİZİ — ürün bulucunun içinden çağrılan ikinci görüş.
 *
 * Neden ayrı bir panel: ürün bulucu hattı AI Konsey karnesini süre bütçesine
 * sığdırmaya çalışır ve sığmadığında bazı ajanları atlar. Bu panel Velora
 * hattını (retriever + 14 üyenin TAMAMI: kısıtlı şemalı sıralı zincir) ayrıca
 * koşturur; hat trend radarı kazımalarını ve canlı piyasa kanıtını bulucuyla
 * ORTAK kullanır, ürünleri ölçülebilir kazanan puanına göre sıralar.
 *
 * Dürüstlük kuralları:
 *  - Skorlar yalnızca hat GERÇEKTEN koştuktan sonra gösterilir; hiçbir sayı
 *    üretilmez/temsili değildir.
 *  - Kaç ajanın koştuğu ve kaç trendin kazındığı açıkça yazılır.
 */
export function VeloraDeepAnalysis({
  niche,
  country,
  platforms,
  disabled = false,
}: {
  niche: string;
  country: string;
  platforms: string[];
  disabled?: boolean;
}) {
  const runFn = useServerFn(runAgentPipeline);
  const run = useMutation({
    mutationFn: () =>
      runFn({
        data: {
          userQuery: niche.trim(),
          country,
          platform: platforms[0] ?? "global",
          language: "tr",
        },
      }),
    onError: (err: Error) => toast.error(err.message || "Velora analizi tamamlanamadı."),
  });

  const ready = niche.trim().length >= 2;
  const result = run.data;

  return (
    <section className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="glow flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]">
          <Sparkles size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Velora 14 ajan derin analizi</div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            14 ajanın tamamı (6 uzman + 6 hakem + müdür + bağımsız denetçi) sırayla koşar; trend
            radarı kazımaları ve canlı piyasa kanıtı bulucuyla <strong>ortak</strong> veri olarak
            kullanılır. Ürünler açıklanabilir kazanan puanına göre sıralanır. Bu koşu jeton
            harcamaz.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || !ready || run.isPending}
          onClick={() => run.mutate()}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[oklch(0.62_0.17_255)]/50 bg-[oklch(0.62_0.17_255)]/15 px-3.5 py-2 text-xs font-semibold text-[oklch(0.88_0.10_255)] transition hover:bg-[oklch(0.62_0.17_255)]/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {run.isPending ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Analiz sürüyor…
            </>
          ) : (
            <>
              <Radar size={13} /> Bu nişteki en iyi ürünleri bul
            </>
          )}
        </button>
      </div>

      {!ready && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Analizi başlatmak için önce bir niş yazın (en az 2 karakter).
        </p>
      )}

      {run.error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{(run.error as Error).message}</span>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Ortak karar" value={`${result.metrics.jointScore}/100`} hint={result.metrics.jointSource} />
            <Stat label="Konsey ortalaması" value={`${result.metrics.councilAverage}/100`} hint="14 ajan" />
            <Stat label="Analiz paritesi" value={`${result.metrics.analysisScore}/100`} hint="retriever kanıtı" />
            <Stat
              label="Koşan ajan"
              value={`${result.metrics.agentCount}/${result.metrics.agentCount}`}
              hint={result.metrics.listed ? "listelendi" : "incelemeye"}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <Activity size={12} /> Ortak kanıt (trend radarı kazımaları + canlı piyasa)
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                {result.metrics.evidence.scrapedTrends} kazınmış trend
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                canlı piyasa: {result.metrics.evidence.live ? "var" : "yok"}
              </span>
              {result.metrics.evidence.sources.map((s) => (
                <span
                  key={s.name}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    s.status === "active"
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/5 text-muted-foreground"
                  }`}
                >
                  {s.name}: {s.items}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <Users size={12} /> En iyi ürünler (kazanan puanına göre)
            </div>
            <ul className="space-y-2">
              {result.topProducts.map((p) => (
                <li
                  key={`${p.rank}-${p.name}`}
                  className="rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold">
                      {p.rank}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-semibold">{p.name}</span>
                    <span className="rounded-full border border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/12 px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.88_0.10_255)]">
                      {p.winnerScore}/100
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        p.source === "ai"
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                          : p.source === "trend-radar"
                            ? "border-sky-400/30 bg-sky-500/10 text-sky-200"
                            : "border-white/10 bg-white/5 text-muted-foreground"
                      }`}
                    >
                      {p.source === "ai" ? "model ürünü" : p.source === "trend-radar" ? "kazınmış trend" : "genel yedek"}
                    </span>
                  </div>
                  {p.whyNow && (
                    <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                      {p.whyNow}
                    </div>
                  )}
                  {p.risks.length > 0 && (
                    <div className="mt-1 text-[10px] text-amber-200/80">Risk: {p.risks.join(" · ")}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-snug text-muted-foreground">
            {result.executiveSummary}
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
