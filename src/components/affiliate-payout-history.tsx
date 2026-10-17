import { BadgeDollarSign, CalendarClock, Check, CircleAlert, History, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AffiliateSummary } from "@/lib/affiliate.functions";
import { MIN_PAYOUT_CENTS } from "@/lib/affiliate";
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
 * METİNLER ÇEVİRİDEN GELİR: karar (hangi engel) `payoutStatusView`ten, cümle
 * ise `t()`ten okunur. Böylece dil değişince panel yeniden çizilir; sabit
 * Türkçe metin gömülmez.
 */
export function AffiliatePayoutHistory({
  summary,
}: {
  summary: AffiliateSummary | null | undefined;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (!summary) return null;

  const locale = i18n.language || "en";
  // Tutar biçimi de dile bağlı: tr'de "$82,50", en'de "$82.50".
  const money = (cents: number | null | undefined) =>
    `$${((cents ?? 0) / 100).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" }) : "—";
  const methodLabel = (method: string) =>
    method === "wise"
      ? "Wise"
      : method === "iban"
        ? t("affiliate.method_iban")
        : t("affiliate.method_other");

  const payouts = summary.payouts ?? [];
  const paidCents = summary.paid_cents ?? 0;
  const pendingCents = summary.pending_cents ?? 0;
  const payableCents = summary.payable_cents ?? 0;
  const heldCents = summary.held_cents ?? 0;
  const minCents = Number.isFinite(summary.min_payout_cents)
    ? Math.max(0, Math.floor(summary.min_payout_cents as number))
    : MIN_PAYOUT_CENTS;
  const status = payoutStatusView({
    paidAny: summary.paid_any === true,
    paidCents,
    payableCents,
    heldCents,
    minPayoutCents: summary.min_payout_cents,
    profileReady: summary.payout?.ready === true,
    profileMissing: summary.payout?.missing ?? [],
    nextUnlockAt: summary.next_unlock_at ?? null,
  });

  const label =
    status.state === "paid" ? t("affiliate.status_paid") : t("affiliate.status_not_paid");

  // Cümle: engelin TÜRÜ lib'den, metni sözlükten. Sayı/tarih biçimi de dile bağlı.
  const detail = (() => {
    if (status.blocker === "details") {
      const missing = (summary.payout?.missing ?? []).filter(Boolean).join(", ");
      return missing
        ? t("affiliate.detail_missing", { missing })
        : t("affiliate.detail_missing_generic");
    }
    if (status.blocker === "hold") {
      const when = summary.next_unlock_at
        ? t("affiliate.detail_hold_when", { date: fmtDate(summary.next_unlock_at) })
        : "";
      return `${t("affiliate.detail_hold", { amount: money(heldCents) })}${when}`;
    }
    if (status.blocker === "threshold") {
      return t("affiliate.detail_threshold", {
        min: money(minCents),
        remaining: money(Math.max(0, minCents - payableCents)),
      });
    }
    return t("affiliate.detail_ready", { amount: money(payableCents) });
  })();

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
            <div className="text-sm font-semibold">{label}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
            {summary.last_payout && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("affiliate.last_payout")}{" "}
                <b className="text-foreground">{fmtDate(summary.last_payout.paidAt)}</b> ·{" "}
                {money(summary.last_payout.cents)}
                {summary.last_payout.ref
                  ? ` · ${t("affiliate.reference")} ${summary.last_payout.ref}`
                  : ""}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric
            icon={<BadgeDollarSign size={13} />}
            label={t("affiliate.total_earned")}
            value={money(summary.earned_cents ?? paidCents + pendingCents)}
          />
          <Metric
            icon={<BadgeDollarSign size={13} />}
            label={t("affiliate.transferred")}
            value={money(paidCents)}
            hint={t("affiliate.commissions", { count: summary.paid_transactions ?? 0 })}
          />
          <Metric
            icon={<Wallet size={13} />}
            label={t("affiliate.unpaid")}
            value={money(pendingCents)}
            hint={t("affiliate.payable_hint", { amount: money(payableCents) })}
          />
        </div>
      </div>

      {/* 2) TRANSFER GEÇMİŞİ — komisyon satırı değil, ÖDEME partisi listesi. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <History size={13} /> {t("affiliate.history_title", { count: payouts.length })}
        </div>

        {payouts.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("affiliate.history_empty")}
          </p>
        ) : (
          // Mobilde beş sütun sığmaz: tablo kendi kabında yatay kayar (sayfa değil).
          <div className="mt-2 -mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[30rem] text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pe-2 text-start font-medium">{t("affiliate.col_date")}</th>
                  <th className="py-2 pe-2 text-start font-medium">
                    {t("affiliate.col_reference")}
                  </th>
                  <th className="py-2 pe-2 text-start font-medium">{t("affiliate.col_method")}</th>
                  <th className="py-2 pe-2 text-end font-medium">
                    {t("affiliate.col_commissions")}
                  </th>
                  <th className="py-2 text-end font-medium">{t("affiliate.col_amount")}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((run) => (
                  <tr
                    key={`${run.ref || "no-ref"}-${run.paidAt ?? "no-date"}`}
                    className="border-t border-white/5"
                  >
                    <td className="whitespace-nowrap py-2 pe-2">{fmtDate(run.paidAt)}</td>
                    <td className="py-2 pe-2 font-mono text-[10px] text-muted-foreground">
                      {run.ref || t("affiliate.no_reference")}
                    </td>
                    <td className="py-2 pe-2">{run.method ? methodLabel(run.method) : "—"}</td>
                    <td className="py-2 pe-2 text-end tabular-nums">{run.count}</td>
                    <td className="whitespace-nowrap py-2 text-end font-semibold tabular-nums">
                      {money(run.cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.payouts_truncated && (
          <p className="mt-2 text-[11px] leading-relaxed text-[oklch(0.82_0.15_70)]">
            {t("affiliate.history_truncated")}
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
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
