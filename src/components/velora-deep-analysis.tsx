import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, AlertTriangle, Layers, Loader2, Radar, Sparkles, Users } from "lucide-react";
import { runAgentPipeline } from "@/lib/velora-agents.functions";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  noteLabel,
  veloraPollInterval,
  veloraStatusLabel,
  verificationChip,
  type OrchestratedDispatch,
  type RunStatusPayload,
} from "@/lib/velora-run-view";

/**
 * VELORA 14 AJAN DERİN ANALİZİ — ürün bulucunun içinden çağrılan ikinci görüş.
 *
 * Neden ayrı bir panel: ürün bulucu hattı AI Konsey karnesini süre bütçesine
 * sığdırmaya çalışır ve sığmadığında bazı ajanları atlar. Bu panel Velora
 * hattını (retriever + 14 üyenin TAMAMI: kısıtlı şemalı sıralı zincir) ayrıca
 * koşturur; hat trend radarı kazımalarını ve canlı piyasa kanıtını bulucuyla
 * ORTAK kullanır.
 *
 * ORTAK EN İYİ 3: tek bir `runId` altında İKİ BAĞIMSIZ sıralama kurulur —
 * analiz hattı (ürünün kendi kanıtı) ve 14 ajanın ürün başına puanları. Panel
 * yalnızca bu iki sıralamanın GERÇEK kesişimini gösterir; kesişim 3'ten azsa
 * eksik sıra doldurulmaz, kaç ortak ürün bulunduğu dürüstçe yazılır.
 *
 * Dürüstlük kuralları:
 *  - Skorlar yalnızca hat GERÇEKTEN koştuktan sonra gösterilir.
 *  - POST yalnızca ilk adımı tetikler; nihai karne `runId` ile YOKLANIR.
 *  - Kaç ajanın koştuğu, kaç trendin kazındığı ve neyin doğrulanamadığı yazılır.
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
  const [runId, setRunId] = useState<string | null>(null);

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

  // ORKESTRE KOŞU: 14 ajan 4 fazda, her faz 8 sn tavanlı ve QStash ile kendine
  // yayınlanan stateless adımlar. Yanıt ilk adımdır; karne durum ucundan gelir.
  const orchestrate = useMutation({
    mutationFn: () =>
      apiPost<OrchestratedDispatch>("/api/public/agent", {
        orchestrated: true,
        userQuery: niche.trim(),
        country,
        platform: platforms[0] ?? "global",
        language: "tr",
      }),
    onSuccess: (data) => setRunId(data.runId ?? null),
    onError: (err: Error) => toast.error(err.message || "Orkestre koşu tamamlanamadı."),
  });

  // KOŞU YOKLAMASI: nihai karne hazır olana kadar 2 sn'de bir `runId` sorgulanır.
  const status = useQuery({
    queryKey: ["velora-run", runId],
    queryFn: () => apiGet<RunStatusPayload>(`/api/public/agent?runId=${encodeURIComponent(runId ?? "")}`),
    enabled: Boolean(runId),
    // Karne gelene kadar yokla, hazır/bayat olunca DUR (sonsuz yoklama yok).
    refetchInterval: (query) =>
      veloraPollInterval(query.state.data as RunStatusPayload | undefined),
  });

  const ready = niche.trim().length >= 2;
  const result = run.data;
  const dossier = status.data?.dossier ?? null;
  const payload = status.data;
  const finished = payload ? veloraPollInterval(payload) === false : false;
  const statusLabel = veloraStatusLabel(payload, orchestrate.isPending);

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
            kullanılır. Orkestre koşuda her ajan finalist ürünleri <strong>ürün başına</strong>{" "}
            puanlar; panel iki bağımsız sıralamanın ortak en iyi ürünlerini gösterir. Bu koşu jeton
            harcamaz.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || !ready || orchestrate.isPending}
          onClick={() => orchestrate.mutate()}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/12 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {orchestrate.isPending ? (
            <>
              <Loader2 size={13} className="animate-spin" /> 4 faz koşuyor…
            </>
          ) : (
            <>
              <Layers size={13} /> 14 ajanı 4 fazda orkestre et
            </>
          )}
        </button>
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
                <li key={`${p.rank}-${p.name}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
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
                    <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{p.whyNow}</div>
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

      {orchestrate.error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{(orchestrate.error as Error).message}</span>
        </div>
      )}

      {runId && (
        <div className="mt-4 space-y-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold">Orkestre koşu · 14 ajan / 4 faz</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                payload?.status === "completed"
                  ? "border-emerald-400/40 bg-emerald-500/12 text-emerald-200"
                  : payload?.status === "failed" || payload?.status === "unknown"
                    ? "border-red-400/40 bg-red-500/12 text-red-200"
                    : "border-sky-400/40 bg-sky-500/12 text-sky-200"
              }`}
            >
              {statusLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
              {payload ? `${payload.completedPhases}/${payload.totalPhases}` : "0/4"} faz ·{" "}
              {orchestrate.data?.dispatch?.mode === "qstash" ? "QStash fan-out" : "istek içi"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
              runId: {runId.slice(0, 18)}
            </span>
            {payload?.recovered && (
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
                kalıcı kazanan kaydından
              </span>
            )}
            {status.isFetching && !finished && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 size={11} className="animate-spin" /> yoklanıyor
              </span>
            )}
          </div>

          {orchestrate.data?.error && (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-[11px] text-red-200">
              {orchestrate.data.error}
            </p>
          )}

          {status.error && (
            <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
              Koşu durumu okunamadı: {(status.error as Error).message}
            </p>
          )}

          {payload && payload.phases.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <Activity size={12} /> Faz performansı (8 sn tavan)
              </div>
              <ul className="space-y-1">
                {payload.phases.map((phase) => (
                  <li key={phase.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-semibold">
                      Faz {phase.id} · {phase.key}
                    </span>
                    <span className="text-muted-foreground">{phase.agents} ajan</span>
                    <span className="text-muted-foreground">{phase.ms} ms</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        phase.withinCeiling
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {phase.withinCeiling ? "tavan içinde" : "tavan aşıldı"}
                    </span>
                    {phase.timedOut > 0 && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
                        {phase.timedOut} ajan zaman aşımı
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {payload.activePhase && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Faz {payload.activePhase} koşuyor; kalan adımlar sırayla kuyruğa alınır.
                </p>
              )}
            </div>
          )}

          {!dossier && !finished && (
            <p className="text-[11px] text-muted-foreground">
              14 ajan 4 fazda koşuyor; her faz 8 sn tavanlı ve adımlar arası durum ortak `runId` ile
              veritabanında taşınıyor. Karne hazır olduğunda bu panel otomatik güncellenir ve sonuç
              doğrulanır.
            </p>
          )}

          {!dossier && finished && (
            <p className="text-[11px] text-muted-foreground">
              Koşu bitti ama ortak karne üretilemedi
              {payload?.notes.length ? `: ${payload.notes.map(noteLabel).join(" · ")}` : "."}
            </p>
          )}

          {dossier && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Ortak kesişim"
                  value={`${dossier.intersection_count}/${dossier.requested_top}`}
                  hint={dossier.rank_source === "intersection" ? "iki hat örtüştü" : "yalnız analiz hattı"}
                />
                <Stat
                  label="İlk ürünün puanı"
                  value={`${dossier.products[0]?.winnerScore ?? 0}/100`}
                  hint={dossier.listed ? "listelendi" : "incelemeye"}
                />
                <Stat label="Konsey (run)" value={`${dossier.council_average}/100`} hint={`${dossier.evaluated} ürün oy aldı`} />
                <Stat
                  label="Kazınan trend"
                  value={`${dossier.evidence.scraped_trends}`}
                  hint={dossier.evidence.live ? "canlı piyasa var" : "canlı piyasa yok"}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span
                  className={`rounded-full border px-2 py-0.5 font-semibold ${
                    dossier.rank_source === "intersection"
                      ? "border-emerald-400/40 bg-emerald-500/12 text-emerald-200"
                      : "border-amber-400/40 bg-amber-500/12 text-amber-200"
                  }`}
                >
                  {dossier.rank_source === "intersection"
                    ? "ortak kesişim (analiz ⊕ 14 ajan)"
                    : "yalnız analiz hattı (ajan oyu yok)"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground">
                  {dossier.finalists} finalist değerlendirildi
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground">
                  {dossier.products.length} ortak ürün
                </span>
              </div>

              {dossier.notes.length > 0 && (
                <ul className="space-y-0.5 rounded-xl border border-amber-400/25 bg-amber-500/5 p-3 text-[11px] text-amber-200/90">
                  {dossier.notes.map((note) => (
                    <li key={note}>• {noteLabel(note)}</li>
                  ))}
                </ul>
              )}

              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                  <Users size={12} /> Ortak en iyi ürünler (iki hattın kesişimi)
                </div>
                {dossier.products.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-muted-foreground">
                    İki bağımsız hat hiçbir üründe ortak karar veremedi; uydurma sıra ile
                    doldurulmadı. Nişi daraltıp tekrar deneyin.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dossier.products.map((product) => {
                      const chip = verificationChip(product.verification);
                      return (
                        <li
                          key={`${product.rank}-${product.name}`}
                          className="rounded-xl border border-white/10 bg-white/5 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold">
                              {product.rank}
                            </span>
                            <span className="min-w-0 flex-1 text-xs font-semibold">{product.name}</span>
                            <span className="rounded-full border border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/12 px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.88_0.10_255)]">
                              {product.winnerScore}/100
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${chip.cls}`}>
                              {chip.label}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                            <span className="rounded-full border border-white/10 px-2 py-0.5">
                              analiz: {product.analysisScore ?? 0}/100
                            </span>
                            <span className="rounded-full border border-white/10 px-2 py-0.5">
                              {product.councilVotes
                                ? `ajanlar: ${product.councilScore}/100 · ${product.councilVotes}/14 oy`
                                : "ajan oyu yok"}
                            </span>
                            <span className="rounded-full border border-white/10 px-2 py-0.5">
                              {product.source === "ai"
                                ? "model ürünü"
                                : product.source === "trend-radar"
                                  ? "kazınmış trend"
                                  : "genel yedek"}
                            </span>
                          </div>
                          {product.agentEvidence && product.agentEvidence.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
                              {product.agentEvidence.slice(0, 3).map((line) => (
                                <li key={line}>• {line}</li>
                              ))}
                            </ul>
                          )}
                          {product.risks && product.risks.length > 0 && (
                            <div className="mt-1 text-[10px] text-amber-200/80">
                              Risk: {product.risks.join(" · ")}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {payload?.push && (
                <p className="text-[11px] text-muted-foreground">
                  Push: {payload.push.ok ? `${payload.push.ids.length} kayıt yazıldı` : "başarısız"}
                  {payload.push.error ? ` · ${payload.push.error}` : ""}
                  {payload.recovered ? " · kalıcı kayıttan geri kuruldu" : ""}
                </p>
              )}

              {payload?.selfTest && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold">
                    <Sparkles size={12} /> Otomatik self-test
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        payload.selfTest.verdict === "PASS"
                          ? "border-emerald-400/40 bg-emerald-500/12 text-emerald-200"
                          : "border-red-400/40 bg-red-500/12 text-red-200"
                      }`}
                    >
                      {payload.selfTest.verdict}
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    <li>
                      DB geri okuma: {payload.selfTest.dbFetchVerified ? "doğrulandı" : "başarısız"} · alan
                      bütünlüğü: {payload.selfTest.payloadIntegrity ? "tam" : "eksik"}
                    </li>
                    <li>
                      Ajan alt çıktıları: {payload.selfTest.agentsLogged}/{payload.selfTest.expectedAgents}
                    </li>
                    <li>
                      Durum: {payload.selfTest.status}
                      {payload.selfTest.notes.length > 0 ? ` · ${payload.selfTest.notes.join(", ")}` : ""}
                    </li>
                  </ul>
                </div>
              )}
            </>
          )}
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
