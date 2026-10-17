import { BadgeDollarSign, CalendarClock, Check, CircleAlert, History, Wallet } from "lucide-react";
import type { AffiliateSummary } from "@/lib/affiliate.functions";
import { payoutStatusView } from "@/lib/affiliate-payout";

/**
 * AFFILIATE'E "PARA ATILDI MI?" CEVABI — durum başlığı + TRANSFER geçmişi.
 *
 * NEDEN VAR: panel yalnız toplamları gösteriyordu ("Ödenen toplam $82,50");
 * affiliate "param hesabıma gerçekten gönderildi mi, ne zaman?" sorusunu
 * yanıtlayamıyordu. Bu bileşen ölçülen veriden üç şeyi söyler:
 *   1. Durum: para gönderildi mi / neden bekliyor (saf `payoutStatusView`).
 *   2. Transfer listesi: tarih · referans · yöntem · komisyon sayısı · tutar.
 *   3. Sınır dürüstlüğü: okuma sınırına takıldıysa liste EKSİK denir.
 *
 * Hiç ödeme yoksa tablo yerine sebebi yazan bir bilgi kutusu görünür; 0
 * satırlık boş bir tablo, "kayıt kayboldu" izlenimi verirdi.
 */
const METHOD_LABEL: Record<string, string> = {
  wise: "Wise",
  iban: "IBAN / havale",
  other: "Diğer",
};

const money = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { dateStyle: "medium" }) : "—";

export function AffiliatePayoutHistory({
  summary,
}: {
  summary: AffiliateSummary | null | undefined;
}): React.JSX.Element | null {
  if (!summary) return null;

  const payouts = summary.payouts ?? [];
  const paidCents = summary.paid_cents ?? 0;
  const pendingCents = summary.pending_cents ?? 0;
  const status = payoutStatusView({
    paidAny: summary.paid_any === true,
    paidCents,
    payableCents: summary.payable_cents ?? 0,
    heldCents: summary.held_cents ?? 0,
    minPayoutCents: summary.min_payout_cents,
    profileReady: summary.payout?.ready === true,
    profileMissing: summary.payout?.missing ?? [],
    nextUnlockAt: summary.next_unlock_at ?? null,
  });

  const tone =
    status.state === "paid"
      ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10"
      : "border-white/10 bg-white/[0.03]";
  const icon =
    status.state === "paid" ? (
      <Check size={16} className="text-[oklch(0.8_0.15_150)]" />
    ) : status.blocker === "details" ? (
      <CircleAlert size={16} className="text-[oklch(0.82_0.15_70)]" />
    ) : (
      <CalendarClock size={16} className="text-muted-foreground" />
    );

  return (
    <section className="mt-4 space-y-3" data-testid="affiliate-payout-history">
      {/* 1) DURUM: "para atıldı mı?" — tek cümlelik dürüst cevap. */}
      <div className={`rounded-xl border p-4 ${tone}`}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5">{icon}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{status.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status.detail}</p>
            {summary.last_payout && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                En son ödeme:{" "}
                <b className="text-foreground">{fmtDate(summary.last_payout.paidAt)}</b> ·{" "}
                {money(summary.last_payout.cents)}
                {summary.last_payout.ref ? ` · referans ${summary.last_payout.ref}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric
            icon={<BadgeDollarSign size={13} />}
            label="Toplam kazanç"
            value={money(summary.earned_cents ?? paidCents + pendingCents)}
          />
          <Metric
            icon={<BadgeDollarSign size={13} />}
            label="Hesabına aktarılan"
            value={money(paidCents)}
            hint={`${summary.paid_transactions ?? 0} komisyon`}
          />
          <Metric
            icon={<Wallet size={13} />}
            label="Henüz ödenmedi"
            value={money(pendingCents)}
            hint={`ödenebilir ${money(summary.payable_cents ?? 0)}`}
          />
        </div>
      </div>

      {/* 2) TRANSFER GEÇMİŞİ — komisyon satırı değil, ÖDEME partisi listesi. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <History size={13} /> Ödeme geçmişi ({payouts.length})
        </div>

        {payouts.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Henüz hesabına para gönderilmedi. Kazandığın komisyonlar birikiyor; ödeme eşiği ve
            bekleme süresi dolduğunda yönetici transferi yapar ve burada tarih + tutar olarak
            görünür.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 text-left font-medium">Tarih</th>
                  <th className="py-2 text-left font-medium">Referans</th>
                  <th className="py-2 text-left font-medium">Yöntem</th>
                  <th className="py-2 text-right font-medium">Komisyon</th>
                  <th className="py-2 text-right font-medium">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((run) => (
                  <tr
                    key={`${run.ref || "no-ref"}-${run.paidAt ?? "no-date"}`}
                    className="border-t border-white/5"
                  >
                    <td className="py-2">{fmtDate(run.paidAt)}</td>
                    <td className="py-2 font-mono text-[10px] text-muted-foreground">
                      {run.ref || "referans yok"}
                    </td>
                    <td className="py-2">
                      {run.method ? (METHOD_LABEL[run.method] ?? run.method) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{run.count}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {money(run.cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.payouts_truncated && (
          <p className="mt-2 text-[11px] text-[oklch(0.82_0.15_70)]">
            Not: ödeme geçmişin çok uzun olduğu için liste son 200 komisyonla sınırlı — toplam
            rakamlar etkilenmez, eksik satırlar için yöneticiye başvurabilirsin.
          </p>
        )}
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
