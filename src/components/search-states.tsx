import { memo } from "react";
import {
  AlertTriangle,
  Clock3,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Loading skeleton
 * Mirrors the real ProductCard silhouette so results land without
 * any layout shift (image → header row → title → metrics → actions).
 * ------------------------------------------------------------------ */

const SHEEN = "rounded bg-white/[0.05]";

export const ProductCardSkeleton = memo(function ProductCardSkeleton({
  delay = 0,
}: {
  delay?: number;
}) {
  return (
    <div
      aria-hidden
      className="premium-card grain card-shimmer rounded-xl border border-white/10 p-3 sm:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="-mx-3 -mt-3 aspect-[16/10] rounded-t-xl border-b border-white/10 bg-white/[0.045] sm:-mx-5 sm:-mt-5 sm:aspect-[4/3]" />
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="h-9 w-9 rounded-lg bg-white/[0.06]" />
        <div className="flex gap-1.5">
          <div className="h-5 w-14 rounded-full bg-white/[0.06]" />
          <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
        </div>
      </div>
      <div className="mt-3 h-5 w-3/4 rounded bg-white/[0.07]" />
      <div className="mt-2 space-y-1.5">
        <div className={cn(SHEEN, "h-3 w-full")} />
        <div className={cn(SHEEN, "h-3 w-2/3")} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 rounded-lg bg-white/[0.05]" />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-white/[0.05]" />
        ))}
      </div>
      <div className="mt-3 h-11 rounded-xl bg-white/[0.05]" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="h-9 rounded-lg bg-white/[0.05]" />
        <div className="h-9 rounded-lg bg-white/[0.05]" />
      </div>
    </div>
  );
});

/** Skeleton grid that matches the results grid exactly. */
export const ResultGridSkeleton = memo(function ResultGridSkeleton({
  count = 6,
}: {
  count?: number;
}) {
  return (
    <div className="grid grid-cols-1 min-[430px]:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} delay={i * 110} />
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Failure classification
 * ------------------------------------------------------------------ */

export type FailureKind = "auth" | "timeout" | "busy" | "server" | "offline" | "unknown";

export type SearchFailure = {
  kind: FailureKind;
  title: string;
  body: string;
  /** Short, concrete next step shown under the body. */
  hint?: string;
};

const FAILURE_ICONS: Record<FailureKind, typeof AlertTriangle> = {
  auth: KeyRound,
  timeout: Clock3,
  busy: Clock3,
  server: AlertTriangle,
  offline: WifiOff,
  unknown: AlertTriangle,
};

/** Maps a raw server/network error into something a user can act on. */
export function describeSearchFailure(raw: string | undefined | null): SearchFailure {
  const msg = (raw ?? "").trim();
  const m = msg.toLowerCase();

  if (/40[13]|unauthor|forbidden|invalid signature|missing secret|no auth/.test(m)) {
    return {
      kind: "auth",
      title: "Motor isteği reddedildi (401)",
      body: "Analiz motoru isteği yetkilendiremedi. Bu geçici bir yapılandırma sorunudur ve birkaç dakika içinde kendiliğinden düzelir.",
      hint: "Tekrar dene; sürerse bu hatayı bize bildir.",
    };
  }
  // 2) Kota / hız sınırı — timeout'tan önce, çünkü 429 timeout kelimesi içermez ama net hata kodudur.
  if (/429|rate.?limit|too many requests|quota/.test(m)) {
    return {
      kind: "busy",
      title: "Şu an çok yoğunuz (429)",
      body: "Kısa süre içinde çok fazla analiz istendi. Sınır birkaç saniye sonra açılıyor.",
      hint: "Kısa bir mola verip tekrar dene.",
    };
  }
  // 3) Zaman aşımı — çıplak "gateway" kelimesi buradan kaldırıldı; aksi halde
  //    "502 Bad Gateway" bu dala yakalanıp yanlış sınıflanıyordu.
  if (/\b504\b|timed? ?out|deadline exceeded|timeout/.test(m)) {
    return {
      kind: "timeout",
      title: "Motor zaman aşımına uğradı (504)",
      body: "Analiz 60 saniyelik sınır içinde tamamlanamadı. Sunucular yoğun olduğunda bu hata oluşur.",
      hint: "Birkaç saniye bekleyip tekrar dene — genelde ikinci denemede tamamlanır.",
    };
  }
  if (/\b5\d\d\b|internal (server )?error|bad gateway|upstream (connect|error|failure)/.test(m)) {
    return {
      kind: "server",
      title: "Motordan geçersiz yanıt geldi (5xx)",
      body: "Analiz motoru geçici olarak yanıt veremedi; sağlayıcı tarafında bir kesinti olabilir.",
      hint: "Tekrar dene; sorun sürerse farklı bir motor seç.",
    };
  }
  if (/failed to fetch|network|load failed|offline|err_|socket hang up|econnreset/.test(m)) {
    return {
      kind: "offline",
      title: "Bağlantı kurulamadı",
      body: "Cihazın ağ bağlantısı kesilmiş veya istek yolda düştü.",
      hint: "Bağlantını kontrol edip tekrar dene.",
    };
  }
  return {
    kind: "unknown",
    title: "Arama tamamlanamadı",
    body: msg || "Analiz motoru beklenmedik bir yanıt döndürdü.",
    hint: "Tekrar dene; sorun sürerse nişini biraz değiştir.",
  };
}

/* ------------------------------------------------------------------ *
 * Error card — persistent replacement for the transient toast
 * ------------------------------------------------------------------ */

export type SearchErrorState = SearchFailure & { niche?: string; raw?: string };

export function SearchErrorCard({
  error,
  onRetry,
  onEdit,
}: {
  error: SearchErrorState;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const Icon = FAILURE_ICONS[error.kind] ?? AlertTriangle;
  return (
    <div
      role="alert"
      className="premium-card grain rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-rose-400/30 bg-rose-500/10">
          <Icon size={20} className="text-rose-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{error.title}</h3>
          {error.niche && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Arama: <span className="text-foreground/80">{error.niche}</span>
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error.body}</p>
          {error.hint && <p className="mt-1 text-xs text-muted-foreground/90">{error.hint}</p>}

          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            <ShieldCheck size={13} className="shrink-0" />
            Kredin harcanmadı — başarısız analizlerde kredi otomatik iade edilir.
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="press inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            >
              <RefreshCw size={15} /> Tekrar dene
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="press inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-4 text-sm font-medium text-foreground transition hover:bg-white/10"
            >
              <Sliders size={15} /> Ayarları değiştir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Zero-result card — the search worked, it just found nothing
 * ------------------------------------------------------------------ */

export function NoResultsCard({
  niche,
  onRetry,
  onEdit,
}: {
  niche?: string;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const tips = [
    'Nişi tek bir ürüne indir ("evcil hayvan" değil, "kedi tırmalama tahtası").',
    "Filtreleri gevşet: minimum skoru düşür veya hedef ülkeyi değiştir.",
    "Platform seçimini artır — tek pazara bağlı kalma.",
  ];
  return (
    <div className="premium-card grain rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-400/30 bg-amber-500/10">
          <Search size={20} className="text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">
            Bu kriterlerde kazanan ürün bulunamadı
          </h3>
          {niche && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Arama: <span className="text-foreground/80">{niche}</span>
            </p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Analiz sorunsuz çalıştı ama mevcut filtrelerin hiçbir ürünü geçmedi. Kredi harcanmadı.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            {tips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="press inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            >
              <RefreshCw size={15} /> Aynı nişle tekrar dene
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="press inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-4 text-sm font-medium text-foreground transition hover:bg-white/10"
            >
              <Sliders size={15} /> Aramayı daralt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cold-start hero (nothing searched yet) — now actionable
 * ------------------------------------------------------------------ */

export function FinderIntroCard({
  examples,
  onExample,
}: {
  examples: string[];
  onExample: (niche: string) => void;
}) {
  return (
    <div className="text-center py-12 sm:py-16 space-y-4">
      <div className="relative inline-flex">
        <div className="absolute inset-0 rounded-full bg-[var(--brand)]/20 blur-2xl animate-pulse-soft" />
        <div className="relative grid h-20 w-20 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--brand)]/10 to-[var(--brand-2)]/10">
          <Sparkles size={32} className="text-[oklch(0.68_0.15_255)]" />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-bold text-foreground">Kazanan ürününü keşfet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
          Nişini, platformunu ve bütçeni seç — yapay zeka motorlarımız gerçek zamanlı verilerle en
          kârlı ürünleri bulacak.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
          <Clock3 size={10} className="text-amber-400" /> 15-30 saniye
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
          <ShieldCheck size={10} className="text-emerald-400" /> 1 kredi
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
          <Sparkles size={10} className="text-blue-400" /> AI Konsey onaylı
        </span>
      </div>

      {examples.length > 0 && (
        <div className="mx-auto max-w-2xl pt-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Hazır nişlerle başla
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => onExample(ex)}
                className="press rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-foreground/90 transition hover:border-[var(--brand)]/40 hover:bg-white/10"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Live progress strip (also the screen-reader announcement)
 * ------------------------------------------------------------------ */

export function SearchProgress({ label }: { label: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3 py-2" role="status" aria-live="polite">
        <Loader2 size={18} className="animate-spin text-[var(--brand)]" />
        <span className="text-sm text-muted-foreground animate-pulse">{label}</span>
      </div>
      <ResultGridSkeleton count={6} />
    </div>
  );
}
