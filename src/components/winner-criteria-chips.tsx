import { useMemo } from "react";

import { winnerCriteria, type WinnerCriteriaInput } from "@/lib/winner-criteria";

/**
 * KAZANAN KRİTERİ ÇİPLERİ — "neden bu ürün?" sorusunun DENETLENEBİLİR cevabı.
 *
 * ÖLÇÜLEN SORUN: kart tek bir `winner_score` gösteriyordu; skorun hangi
 * ölçümlere dayandığı görünmüyordu ve ölçülmemiş alanlar da skora karışıyordu.
 * Burada 6 kriter ayrı ayrı gösterilir; ÖLÇÜLMEYEN kriter "—" ile işaretlenir ve
 * gerekçesi tooltip'te yazar (0 uydurulmaz).
 */
export function WinnerCriteriaChips({
  input,
  className,
}: {
  input: WinnerCriteriaInput;
  className?: string;
}) {
  const report = useMemo(() => winnerCriteria(input), [input]);
  const tone =
    report.verdict === "kanitli"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : report.verdict === "kismi"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
        : "border-white/10 bg-white/5 text-muted-foreground";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${tone}`}
          title={report.summary}
        >
          kanıt {report.measured}/{report.total}
        </span>
        {report.criteria.map((c) => (
          <span
            key={c.id}
            title={`${c.label}: ${c.value} — ${c.detail}`}
            className={`rounded-full border px-2 py-0.5 text-[9px] ${
              c.status === "measured"
                ? "border-white/15 bg-white/[0.06] text-foreground/90"
                : "border-dashed border-white/15 bg-transparent text-muted-foreground"
            }`}
          >
            {c.label}
            <span className="ml-1 opacity-70">{c.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
