import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Loader2, Cpu, Users, X } from "lucide-react";

/**
 * AI Konsey rolleri — YALNIZCA GÖREV AÇIKLAMASI.
 *
 * Burada bilinçli olarak hiçbir SKOR tutulmaz. Eskiden her ajanın yanında sabit
 * bir puan (`base`) ve ağırlıklı, "hesaplanmış" görünen bir `Final Score` vardı;
 * bunlar gerçek çıktı olmadığı için kullanıcıya uydurma sonuç gösteriyordu.
 * Karneler yalnızca hat gerçekten koştuğunda ürün kartlarında (gerçek
 * `council.velora_score` ile) görünür.
 */
const COUNCIL_ROLES = [
  { name: "CFO Agent", task: "Birim ekonomisi, landed cost ve 3PL marjları." },
  { name: "CMO Agent", task: "Kitle uyumu, hedef ROAS ve CPC bandı." },
  { name: "CRO Agent", task: "Marka ve IP riski taraması." },
  { name: "Trend Hunter", task: "Sosyal medya etkileşim ve görüntüleme momentumu." },
  { name: "Competitor Intel", task: "Pazaryeri mağaza doygunluğu." },
  { name: "UX Specialist", task: "Müşteri yorumu duygu skorları." },
  { name: "Supply Chain Agent", task: "Tedarikçi stok istikrarı ve teslim SLA." },
  { name: "Pricing Strategist", task: "Markup merdiveni ve fiyat esnekliği." },
  { name: "Logistics Cost Agent", task: "Navlun/ciro oranı ve 3PL hat maliyeti." },
  { name: "Compliance Officer", task: "CE / FDA / SDS sertifika ve gümrük kapıları." },
  { name: "Retention & LTV Analyst", task: "Tekrar satın alma oranı, LTV/CAC." },
  { name: "Creative Director", task: "Kanca gücü, UGC açıları, 3 sn tutma." },
  { name: "Channel Fit Agent", task: "Pazaryeri komisyonu ve rekabet yoğunluğu." },
  { name: "Independent Data Auditor", task: "Konsey girdilerinin kanıt kapsamı." },
];

/**
 * Canlı analiz hattı göstergesi.
 *
 * Üç kural:
 *  1. HİÇBİR SAYI UYDURULMAZ. İlerleme çubuğu motorun ETA'sına göre TAHMİNİ'dir
 *     ve bu şekilde etiketlenir; ajan puanları / "Final Score" gösterilmez.
 *  2. KAPATILABİLİR. Uzun bir tarama kullanıcıyı ekrana kilitlemez; kapatınca
 *     arama arka planda sürer ve ürünler hazır olduğunda görünür.
 *  3. ÖN SONUÇ GELİNCE KENDİLİĞİNDEN KAPANIR: canlı doğrulanmış ürünler
 *     ekranda görünmeye başladığında bu modal artık engel değildir.
 */
export function AnalysisPipelineModal({
  open,
  done,
  etaMs = 6500,
  engine,
  onDismiss,
}: {
  open: boolean;
  done: boolean;
  etaMs?: number;
  engine?: string;
  /** "Arka planda devam et" — modalı kapatır, aramayı durdurmaz. */
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const steps = [
    t("pipeline.s1"),
    t("pipeline.s2"),
    t("pipeline.s3"),
    t("pipeline.s4"),
    t("pipeline.s5"),
    t("pipeline.s6"),
  ];
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setStepIdx(0);
      setElapsed(0);
      document.body.style.overflow = "";
      return;
    }
    startedAt.current = Date.now();
    document.body.style.overflow = "hidden";
    const target = Math.max(2000, etaMs);
    const id = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms / 1000);
      // Saturating curve: ~95% by the engine ETA, then a slow creep toward 99%
      // so a long real run never looks frozen at a flat percentage.
      const pct = done ? 100 : Math.min(99, Math.round(100 * (1 - Math.exp(-ms / (target / 3)))));
      setProgress(pct);
      setStepIdx(Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length)));
      if (done && pct >= 100) window.clearInterval(id);
    }, 100);
    return () => {
      window.clearInterval(id);
      document.body.style.overflow = "";
    };
  }, [open, done, etaMs, steps.length]);

  // Escape ile kapatma: uzun taramada kullanıcı ekrana kilitli kalmasın.
  useEffect(() => {
    if (!open || !onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  const remaining = Math.max(0, etaMs / 1000 - elapsed);

  return (
    <div
      className="fixed inset-0 z-50 flex p-2 sm:p-4 lg:p-6 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="false"
      aria-label={t("pipeline.title")}
    >
      <div className="m-auto w-full max-w-5xl grid gap-2.5 sm:gap-4 lg:grid-cols-2 lg:items-start">
        <div className="glass rounded-2xl flex flex-col overflow-hidden min-h-0 lg:max-h-[calc(100vh-2.5rem)] p-4 sm:p-6">
          <div className="flex flex-shrink-0 items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-lg glow bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] flex items-center justify-center">
              <Sparkles size={18} className="text-white animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{t("pipeline.title")}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                {/* Yalnızca TAHMİNİ ilerleme; gerçek ölçüm değil. */}
                <span>~{Math.floor(progress)}% tahmini</span>
                <span className="opacity-40">·</span>
                <span>{elapsed.toFixed(1)}s</span>
                <span className="opacity-40">·</span>
                {done ? (
                  <span className="text-emerald-300/90">tamamlandı</span>
                ) : remaining > 0 ? (
                  <span>~{remaining.toFixed(0)}s kaldı</span>
                ) : (
                  <span className="animate-pulse text-[oklch(0.88_0.10_255)]">son adımlar…</span>
                )}
              </div>
            </div>
            {engine && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.62_0.17_255)]/45 bg-[oklch(0.62_0.17_255)]/12 px-2.5 py-1 text-[10px] font-semibold text-[oklch(0.86_0.10_255)] max-w-[9rem] truncate">
                <Cpu size={10} /> {engine}
              </span>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Kapat"
                className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex-shrink-0 h-2 w-full rounded-full bg-white/5 overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mb-4 flex flex-shrink-0 items-center gap-2 text-xs text-[oklch(0.88_0.10_255)]">
            <Loader2 size={12} className="animate-spin" />
            <span className="truncate">{steps[stepIdx]}</span>
          </div>
          <ul className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {steps.map((s, i) => {
              const complete = i < stepIdx || (i === stepIdx && progress >= 100);
              const active = i === stepIdx && !complete;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-2.5 text-sm transition ${complete ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground/60"}`}
                >
                  <span
                    className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center border ${complete ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300" : active ? "border-[oklch(0.62_0.17_255)] bg-[oklch(0.62_0.17_255)]/20 animate-pulse-soft" : "border-white/10 bg-white/5"}`}
                  >
                    {complete ? (
                      <Check size={11} />
                    ) : active ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <span className="text-[10px]">{i + 1}</span>
                    )}
                  </span>
                  <span>{s}</span>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex-shrink-0 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-3 text-[11px] leading-snug text-emerald-200/90">
            Canlı piyasa doğrulaması (Google Trends · tedarik fiyatı · pazaryeri ilanları) ürünler
            hazır olur olmaz ekranda gösterilir. Bu ekran yalnızca bekleme göstergesidir; kapatmanız
            aramayı durdurmaz.
          </div>

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 flex-shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold transition hover:bg-white/10"
            >
              Arka planda devam et — sonuçlar hazır olunca göster
            </button>
          )}
        </div>

        {/* RIGHT — AI Konsey rolleri. Puan YOK: karneler gerçek çıktıdır ve
            yalnızca ürün kartlarında, hat gerçekten koştuktan sonra görünür. */}
        <div className="glass rounded-2xl flex flex-col overflow-hidden min-h-0 lg:max-h-[calc(100vh-2.5rem)] p-4 sm:p-6">
          <div className="flex flex-shrink-0 items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg glow bg-gradient-to-br from-emerald-500 to-[oklch(0.52_0.15_262)] flex items-center justify-center">
              <Users size={18} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold leading-tight">AI Konsey Rolleri</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                14 rol · karne en iyi 3 ürün için çalışır
              </div>
            </div>
          </div>

          <ul className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1.5">
            {COUNCIL_ROLES.map((a) => (
              <li
                key={a.name}
                className="rounded-xl border border-white/10 bg-white/5 p-2 flex items-start gap-2"
              >
                <span className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center border border-white/10">
                  <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold truncate">{a.name}</span>
                  <div className="text-[11px] text-muted-foreground leading-snug">{a.task}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex-shrink-0 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-snug text-muted-foreground">
            Skorlar yalnızca gerçek karne geldiğinde ürün kartlarında görünür. Bu ekranda gösterilen
            hiçbir sayı üretilmiş/temsili değildir.
          </div>
        </div>
      </div>
    </div>
  );
}
