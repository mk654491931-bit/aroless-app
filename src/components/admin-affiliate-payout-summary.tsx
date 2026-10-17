import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, Download, Handshake, Loader2, ScrollText, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  adminExportAffiliatePayoutCsv,
  adminListAffiliatePayouts,
} from "@/lib/affiliate.functions";
import { MIN_PAYOUT_CENTS } from "@/lib/affiliate";

/**
 * ADMIN — AFFILIATE ÖDEME ÖZETİ VE GİRİŞİ.
 *
 * NEDEN VAR: affiliate kazançları admin panelinde zaten bir tabloda vardı ama
 * "şu an kime ne kadar borçluyuz, kaç kişiye ödeme yapılabilir?" sorusu ancak
 * 500 satırlık tabloyu elle toplayarak yanıtlanıyordu. Bu blok, aynı ölçümü
 * (affiliate_payout_summary → payable/pending/paid) tek satırda özetler ve
 * detaylı ödeme tablosuna + CSV indirmeye doğrudan buton verir.
 *
 * DÜRÜSTLÜK: hiçbir sayı tahmin edilmez; hepsi ölçülmüş toplamlardır. Ödeme
 * eşiğinin altındaki bakiyeler "ödemeye hazır" SAYILMAZ (devreder).
 * METİNLER ÇEVİRİDEN GELİR: dil değişince özet de yeni dilde çizilir.
 */
export function AdminAffiliatePayoutSummary(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const listFn = useServerFn(adminListAffiliatePayouts);
  const csvFn = useServerFn(adminExportAffiliatePayoutCsv);
  const q = useQuery({
    queryKey: ["admin-affiliate-payouts"],
    queryFn: () => listFn(),
  });

  const money = (cents: number | null | undefined) =>
    `$${((cents ?? 0) / 100).toLocaleString(i18n.language || "en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const exportCsv = useMutation({
    mutationFn: () => csvFn(),
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `affiliate-payouts-${res.generatedAt.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const rows = q.data ?? [];
  const owedCents = rows.reduce((sum, r) => sum + r.pending_cents, 0);
  const readyCents = rows.reduce((sum, r) => sum + r.payable_cents, 0);
  const paidCents = rows.reduce((sum, r) => sum + r.paid_cents, 0);
  const readyRows = rows.filter((r) => r.eligible);
  const verified = rows.filter((r) => r.status === "verified").length;

  const jumpToDetail = () => {
    const el = document.getElementById("admin-affiliates");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold sm:text-base">
          <Handshake size={16} className="shrink-0 text-[oklch(0.75_0.19_150)]" />
          <span className="min-w-0">{t("affiliate.admin_title")}</span>
        </h2>
        <span className="text-[11px] text-muted-foreground sm:text-xs">
          {t("affiliate.admin_counts", { verified, ready: readyRows.length })}
        </span>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
        <Kpi
          icon={<Wallet size={14} />}
          label={t("affiliate.admin_owed")}
          value={q.isLoading ? "…" : money(owedCents)}
          hint={t("affiliate.commissions", {
            count: rows.reduce((s, r) => s + r.pending_count, 0),
          })}
        />
        <Kpi
          icon={<Banknote size={14} />}
          label={t("affiliate.admin_ready")}
          value={q.isLoading ? "…" : money(readyCents)}
          hint={t("affiliate.admin_ready_hint", { min: money(MIN_PAYOUT_CENTS) })}
          tone="ready"
        />
        <Kpi
          icon={<ScrollText size={14} />}
          label={t("affiliate.admin_paid")}
          value={q.isLoading ? "…" : money(paidCents)}
          hint={t("affiliate.admin_paid_hint", {
            count: rows.reduce((s, r) => s + r.paid_count, 0),
          })}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 bg-white/[0.02] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
        <button
          type="button"
          onClick={jumpToDetail}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90 sm:w-auto sm:py-1.5"
        >
          <Handshake size={13} className="shrink-0" /> {t("affiliate.admin_jump")}
        </button>
        <button
          type="button"
          onClick={() => exportCsv.mutate()}
          disabled={exportCsv.isPending}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium hover:bg-white/10 disabled:opacity-50 sm:w-auto sm:py-1.5"
        >
          {exportCsv.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          {t("affiliate.admin_csv")}
        </button>
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          {t("affiliate.admin_note")}
        </span>
      </div>
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "ready";
}): React.JSX.Element {
  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${
        tone === "ready"
          ? "border-[oklch(0.75_0.19_150)]/30 bg-[oklch(0.75_0.19_150)]/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}
