import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowUpRight,
  Gauge,
  Infinity as InfinityIcon,
  Sparkles,
} from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { getUsageSnapshot } from "@/lib/usage.functions";
import {
  USAGE_FEATURES,
  isExhausted,
  normalizeUsageSnapshot,
  usageLabel,
  usagePercent,
  type UsageEntry,
} from "@/lib/usage";

function barClass(percent: number, exhausted: boolean): string {
  if (exhausted) return "bg-gradient-to-r from-[oklch(0.68_0.20_25)] to-[oklch(0.62_0.18_25)]";
  if (percent >= 80) return "bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.78_0.17_70)]";
  return "bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]";
}

function LimitRow({
  label,
  hint,
  entry,
  onUpgrade,
}: {
  label: string;
  hint: string;
  entry: UsageEntry;
  onUpgrade?: () => void;
}): ReactElement {
  const percent = usagePercent(entry);
  const exhausted = isExhausted(entry);

  return (
    <li
      className={`rounded-xl border p-3 transition ${
        exhausted
          ? "border-[oklch(0.68_0.20_25)]/45 bg-[oklch(0.68_0.20_25)]/10"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
        </div>

        {entry.unlimited ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <InfinityIcon size={10} /> Ücretsiz / Sınırsız
          </span>
        ) : (
          <span
            className={`shrink-0 text-[11px] font-semibold ${exhausted ? "text-[oklch(0.75_0.18_25)]" : "text-muted-foreground"}`}
            aria-label={`${label}: ${usageLabel(entry)}`}
          >
            {usageLabel(entry)}
          </span>
        )}
      </div>

      {!entry.unlimited && (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass(percent, exhausted)}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
            <span className="text-muted-foreground">{percent}% kullanıldı</span>
            {exhausted ? (
              <span className="flex items-center gap-1 font-semibold text-[oklch(0.75_0.18_25)]">
                <AlertTriangle size={10} /> Limit doldu — Paket Yükselt
              </span>
            ) : (
              <span className="text-muted-foreground">
                {Math.max(0, entry.limit - entry.used)} hak kaldı
              </span>
            )}
          </div>
        </>
      )}

      {exhausted && onUpgrade && (
        <button
          type="button"
          onClick={onUpgrade}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-1.5 text-[11px] font-semibold text-white"
        >
          <ArrowUpRight size={11} /> Paket Yükselt
        </button>
      )}
    </li>
  );
}

/**
 * "Abonelik ve Limit Durumu" paneli.
 *
 * Limitler sunucudan (`usage_snapshot`) gelir; RPC erişilemezse paket
 * konfigürasyonundaki değerlerle gösterilir. Akademi ve Simülasyon her pakette
 * ücretsiz/sınırsızdır.
 */
export function UsageLimitsCard({
  onUpgrade,
  className = "",
}: {
  onUpgrade?: () => void;
  className?: string;
}): ReactElement {
  const { tier, isAdmin } = useEntitlements();
  const snapshotFn = useServerFn(getUsageSnapshot);

  const snapshotQ = useQuery({
    queryKey: ["usage-snapshot"],
    queryFn: () => snapshotFn(),
    staleTime: 60_000,
  });

  const snapshot = normalizeUsageSnapshot(snapshotQ.data ?? null, tier, isAdmin);
  const hasExhausted = USAGE_FEATURES.some((f) => isExhausted(snapshot.features[f.key]));
  const periodEnd = snapshot.periodEnd
    ? new Date(snapshot.periodEnd).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <section className={`glass rounded-2xl p-5 ${className}`} aria-label="Abonelik ve limit durumu">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Gauge size={15} className="text-[oklch(0.86_0.10_255)]" />
            Abonelik ve Limit Durumu
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {snapshot.isAdmin ? "Admin" : snapshot.tier} paketi
            {periodEnd ? ` · dönem ${periodEnd}'de yenilenir` : ""}
            {snapshotQ.isLoading ? " · güncelleniyor…" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/12 px-2.5 py-1 text-[10px] font-bold text-[oklch(0.86_0.10_255)]">
            <Sparkles size={10} /> {snapshot.isAdmin ? "Admin · 250/özellik" : snapshot.tier}
          </span>
          {onUpgrade ? (
            <button
              type="button"
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold hover:bg-white/10"
            >
              Paket Yükselt <ArrowUpRight size={10} />
            </button>
          ) : (
            <Link
              to="/pricing"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold hover:bg-white/10"
            >
              Paket Yükselt <ArrowUpRight size={10} />
            </Link>
          )}
        </div>
      </div>

      {hasExhausted && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[oklch(0.68_0.20_25)]/45 bg-[oklch(0.68_0.20_25)]/10 p-2.5 text-[11px]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[oklch(0.75_0.18_25)]" />
          <span>
            Bazı limitlerin doldu. Bu modüllerin butonları kilitli; paketini yükselterek limitleri
            artırabilirsin.
          </span>
        </div>
      )}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {USAGE_FEATURES.map((feature) => (
          <LimitRow
            key={feature.key}
            label={feature.label}
            hint={feature.hint}
            entry={snapshot.features[feature.key]}
            {...(onUpgrade ? { onUpgrade } : {})}
          />
        ))}
      </ul>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Akademi ve Simülasyon modülleri tüm paketlerde ücretsiz ve sınırsızdır — jeton harcamaz.
      </p>
    </section>
  );
}
