import type { ReactElement } from "react";
import { Activity, Check, Cpu, Flame, Gauge, Sparkles, TrendingUp, Users } from "lucide-react";
import type { PipelineOutput } from "@/lib/velora-pipeline.server";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Velora deep-analysis output: the ranked products from the 14-agent council
 * chain plus the run metrics that back the score.
 */
export function DeepAnalysisResults({ result }: { result: PipelineOutput }): ReactElement {
  const { topProducts, executiveSummary, metrics } = result;
  const providers = Object.entries(metrics.providerHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div className="space-y-5">
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[oklch(0.86_0.10_255)]" />
            <span className="text-sm font-bold">Derin Analiz Sonucu</span>
            {metrics.listed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                <Flame size={10} /> LISTED
              </span>
            ) : (
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                REVIEW
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{executiveSummary}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black">{metrics.finalScore}</div>
          <div className="text-[11px] text-muted-foreground">final score / 100</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Konsey ort." value={metrics.councilAverage} />
        <Metric label="Fingerprint" value={metrics.productFingerprint} />
        <Metric label="Ajan" value={metrics.agentCount} />
        <Metric
          label="Başarılı"
          value={`${metrics.succeeded}/${metrics.succeeded + metrics.failed}`}
        />
        <Metric label="Retriever" value={`${metrics.retrieverAttempts} tur`} />
        <Metric label="Süre" value={`${(metrics.totalLatencyMs / 1000).toFixed(1)}s`} />
      </div>

      {providers.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Cpu size={13} /> Sağlayıcı dağılımı
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {providers.map(([provider, hits]) => (
              <span
                key={provider}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]"
              >
                {provider} · {hits}
              </span>
            ))}
          </div>
        </div>
      )}

      {topProducts.length === 0 ? (
        <div className="glass rounded-2xl p-5 text-sm text-muted-foreground">
          Bu sorgu için konsey hiçbir ürünü listeleme eşiğini geçemedi. Sorguyu genişletip tekrar
          dene.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {topProducts.map((product, index) => (
            <div key={`${product.name}-${index}`} className="glass space-y-3 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[oklch(0.62_0.17_255)]/20 text-[11px] font-bold text-[oklch(0.86_0.10_255)]">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-bold">{product.name}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {product.category || "Kategori yok"} ·{" "}
                    {product.priceRange || "fiyat aralığı yok"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-black">{product.councilScore}</div>
                  <div className="text-[10px] text-muted-foreground">{product.councilDecision}</div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <ScoreBar label="Talep" value={product.demandScore} />
                <ScoreBar label="Rekabet" value={product.competitionScore} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-muted-foreground">Marj</div>
                  <div className="font-semibold">%{product.estimatedMarginPct}</div>
                </div>
                <div className="col-span-2 rounded-lg bg-white/5 p-2">
                  <div className="text-muted-foreground">Duygu</div>
                  <div className="truncate font-semibold">{product.sentiment || "—"}</div>
                </div>
              </div>

              {product.whyNow && (
                <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <TrendingUp size={13} className="mt-0.5 shrink-0 text-emerald-300" />
                  <span>{product.whyNow}</span>
                </p>
              )}

              {product.risks.length > 0 && (
                <ul className="space-y-1 text-[11px] text-amber-300/90">
                  {product.risks.slice(0, 3).map((risk, i) => (
                    <li key={i}>⚠ {risk}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Gauge size={12} /> Konsey {metrics.councilAverage} × 0.70
        </span>
        <span className="opacity-40">·</span>
        <span className="flex items-center gap-1.5">
          <Activity size={12} /> Fingerprint {metrics.productFingerprint} × 0.30
        </span>
        <span className="opacity-40">·</span>
        <span className="flex items-center gap-1.5">
          <Users size={12} /> {metrics.agentCount} ajan zinciri
        </span>
        {metrics.succeeded > 0 && (
          <span className="ml-auto flex items-center gap-1 text-emerald-300">
            <Check size={12} /> {metrics.succeeded} ajan yanıt verdi
          </span>
        )}
      </div>
    </div>
  );
}
