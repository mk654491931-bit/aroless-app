// ============================================================================
// PRODUCT DISCOVERY — İLERLEME PANELİ.
//
// Neden ayrı bileşen: hat 4 ayrı adımdan oluşur ve her adım `searches`
// satırına yazılır. Panel bu satırı olduğu gibi gösterir — yani "şu an ne
// oluyor" bilgisi TAHMİN değil, sunucunun kaydettiği gerçek durumdur.
//
// DÜRÜSTLÜK KURALI: Bir adım hatasıyla atlandıysa veya kaynak çalışmadıysa
// o notlar gizlenmez; panel "kaynak sağlığı" başlığı altında listeler. Kullanıcı
// "5 kaynaktan 2'si çalışmadı" bilgisini görebilmelidir — aksi halde sahte bir
// "kanıt topladık" izlenimi doğar.
// ============================================================================

import { AlertTriangle, CheckCircle2, Loader2, Search, Users } from "lucide-react";

import type { FilterStats, ProductDiscoveryStatus } from "@/lib/product-discovery.types";

/** Adım sırası ve kullanıcıya gösterilen adı. */
const STEPS: readonly { key: string; label: string }[] = [
  { key: "scrape_filter", label: "Kaynak taraması ve filtreleme" },
  { key: "gemini", label: "AI kısa liste" },
  { key: "deep", label: "14 ajan derin analiz" },
  { key: "final", label: "Nihai sıralama" },
];

/** Durum → adım eşlemesi. Adım adı durumdan türetilir. */
const STATUS_TO_STEP: Partial<Record<ProductDiscoveryStatus, string>> = {
  queued: "scrape_filter",
  scraping: "scrape_filter",
  filtering: "scrape_filter",
  gemini_shortlist: "gemini",
  deep_analysis: "deep",
  completed: "final",
};

function stepIndex(step: string | null): number {
  if (!step) return -1;
  return STEPS.findIndex((s) => s.key === step);
}

export function DiscoveryProgress({
  status,
  progress,
  step,
}: {
  status: ProductDiscoveryStatus;
  progress: number;
  step: string | null;
}): React.JSX.Element {
  const effectiveStep = step ?? STATUS_TO_STEP[status] ?? "scrape_filter";
  const current = stepIndex(effectiveStep);
  const failed = status === "failed";
  const done = status === "completed";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : failed ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <Loader2 className="size-4 animate-spin text-primary" />
        )}
        <span className="text-sm font-medium">
          {done ? "Arama tamamlandı" : failed ? "Arama başarısız" : "Kazananlar aranıyor…"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{progress}%</span>
      </div>

      {/* İlerleme çubuğu — yüzde sunucunun kendi kaydından gelir. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
        />
      </div>

      {/* Adımlar — tamamlananlar geriye dönük, sıradaki vurgulu. */}
      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const isDone = done || (current > i && current >= 0);
          const isCurrent = !done && !failed && current === i;
          return (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <span
                className={`size-1.5 rounded-full ${
                  isDone
                    ? "bg-emerald-500"
                    : isCurrent
                      ? "bg-primary animate-pulse"
                      : "bg-muted-foreground/30"
                }`}
              />
              <span className={isCurrent ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Filtre istatistikleri — "60'tan 5 kaldı, neden?" sorusunun cevabı. */
export function DiscoveryStats({ stats }: { stats: FilterStats }): React.JSX.Element {
  const rejected =
    stats.rejectedByRating +
    stats.rejectedByStock +
    stats.rejectedByPrice +
    stats.rejectedByDuplicate +
    stats.rejectedByCompleteness +
    stats.rejectedBySource;

  const healthy = stats.perSource.filter((s) => s.ok);
  const failedSources = stats.perSource.filter((s) => !s.ok);

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Search className="size-3.5" />
        <span>Tarama özeti</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 py-2">
          <div className="text-lg font-semibold tabular-nums">{stats.inputCount}</div>
          <div className="text-[10px] text-muted-foreground">ham kayıt</div>
        </div>
        <div className="rounded-lg bg-muted/50 py-2">
          <div className="text-lg font-semibold tabular-nums">{rejected}</div>
          <div className="text-[10px] text-muted-foreground">elendi</div>
        </div>
        <div className="rounded-lg bg-muted/50 py-2">
          <div className="text-lg font-semibold tabular-nums">{stats.survivors}</div>
          <div className="text-[10px] text-muted-foreground">kaldı</div>
        </div>
      </div>
      <div className="space-y-1 text-muted-foreground">
        {stats.rejectedByRating > 0 && <p>• {stats.rejectedByRating} düşük puanlı</p>}
        {stats.rejectedByDuplicate > 0 && <p>• {stats.rejectedByDuplicate} yinelenen ürün</p>}
        {stats.rejectedByCompleteness > 0 && <p>• {stats.rejectedByCompleteness} kanıtsız</p>}
      </div>
      {healthy.length > 0 && (
        <p className="text-muted-foreground">
          • Çalışan kaynak: {healthy.map((s) => s.name).join(", ")}
        </p>
      )}
      {failedSources.length > 0 && (
        <p className="text-amber-500/90">
          • Çalışmayan: {failedSources.map((s) => s.name).join(", ")}
        </p>
      )}
    </div>
  );
}

/** 14 ajan oyununun dürüstlük rozeti. */
export function DiscoveryAgentBadge({
  aiVotes,
  totalVotes,
  usedAi,
}: {
  aiVotes: number;
  totalVotes: number;
  usedAi: boolean;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
      <Users className="size-3" />
      {usedAi ? (
        <>
          {totalVotes} ajan oyu · {aiVotes} tanesi AI’dan
        </>
      ) : (
        <>14 ajan · ölçülmüş veriyle puanlandı (0 token)</>
      )}
    </span>
  );
}
