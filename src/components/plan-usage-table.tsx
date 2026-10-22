import { usePlanUsage } from "@/hooks/use-plan-usage";
import { planLabelFor, UNKNOWN_USAGE_LABEL } from "@/lib/plan-usage";

/**
 * BU AYIN KULLANIM TABLOSU — paket haklarının görünen yüzü.
 *
 * NEDEN VAR (kullanıcı bildirimi: "tablo gözükmüyor"): aylık haklar dört ayrı
 * sayaçta tutuluyor, ama kullanıcı yalnız sol bardaki küçük şeritte görebiliyor
 * ve orada da "kalan" ya da "aylık hak" yazmıyordu. Ayarlar sayfasında hiç tablo
 * yoktu; kullanıcı ödediği paketin ne verdiğini ve ne kadarını kullandığını
 * okuyamıyordu.
 *
 * KURALLAR (uydurma yok):
 *   • Sayaç okunamazsa "0" YAZILMAZ; kullanılan tarafı "?" olur ve altta neden
 *     yazılır (0 "hiç kullanmadım" demek olurdu — yanlış beyan).
 *   • "Aylık hak" her zaman gösterilir: limit abonelikten gelir, ölçümden değil.
 *   • Jeton bakiyesi (cüzdan) ayrıca yazılır: tablo "kaç iş yaptım", bakiye
 *     "kaç jetonum kaldı" sorusunu yanıtlar.
 */
export function PlanUsageTable({
  tier,
  credits,
  finderCredits,
}: {
  tier?: string | null;
  /** Genel havuz (paket jetonları). */
  credits?: number | null;
  /** Ürün bulucunun ilk harcadığı havuz (hoş geldin jetonları). */
  finderCredits?: number | null;
}) {
  const usage = usePlanUsage();
  const wallet =
    Math.max(0, Math.floor(Number(credits ?? 0) || 0)) +
    Math.max(0, Math.floor(Number(finderCredits ?? 0) || 0));
  const label = usage.isAdmin ? "Admin" : planLabelFor(tier ?? usage.tier);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Bu ayın kullanımı</h3>
        <span className="text-[11px] text-muted-foreground">
          {label}
          {usage.period ? ` · ${usage.period}` : ""}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Hak</th>
              <th className="pb-2 px-2 text-center font-medium">Bu ay</th>
              <th className="pb-2 px-2 text-center font-medium">Aylık hak</th>
              <th className="pb-2 pl-2 text-right font-medium">Kalan</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((row) => (
              <tr key={row.kind} className="border-t border-white/10">
                <td className="py-2 pr-3">
                  <div className="font-medium">{row.label}</div>
                  <div className="text-[10px] text-muted-foreground">{row.hint}</div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={
                        row.exhausted
                          ? "h-full rounded-full bg-amber-400/80"
                          : "h-full rounded-full bg-(--accent-active)/80"
                      }
                      style={{ width: `${row.disabled ? 0 : row.pct}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 px-2 text-center font-mono">
                  {usage.loading
                    ? "…"
                    : row.disabled
                      ? "—"
                      : usage.measured
                        ? row.used
                        : UNKNOWN_USAGE_LABEL}
                </td>
                <td className="py-2 px-2 text-center font-mono text-muted-foreground">
                  {row.limit > 0 ? row.limit : "—"}
                </td>
                <td
                  className={`py-2 pl-2 text-right font-mono ${
                    row.exhausted ? "text-amber-300" : "text-muted-foreground"
                  }`}
                >
                  {usage.loading
                    ? "…"
                    : row.disabled
                      ? "—"
                      : usage.measured
                        ? row.remaining
                        : UNKNOWN_USAGE_LABEL}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Jeton bakiyesi: <span className="font-mono text-foreground">{wallet}</span>
        {` · Ürün Bulucu ${Math.max(0, Math.floor(Number(finderCredits ?? 0) || 0))} · Genel ${Math.max(
          0,
          Math.floor(Number(credits ?? 0) || 0),
        )}`}
      </p>
      {!usage.loading && !usage.measured && (
        <p className="mt-1 text-[11px] text-amber-300/80">
          Sayaç okunamadı — kullanım yerine aboneliğinin aylık hakkı gösteriliyor.
        </p>
      )}
    </div>
  );
}
