import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, Download, Handshake, Loader2, ScrollText, Wallet } from "lucide-react";
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
 */
const money = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function AdminAffiliatePayoutSummary(): React.JSX.Element {
  const listFn = useServerFn(adminListAffiliatePayouts);
  const csvFn = useServerFn(adminExportAffiliatePayoutCsv);
  const q = useQuery({
    queryKey: ["admin-affiliate-payouts"],
    queryFn: () => listFn(),
  });

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Handshake size={16} className="text-[oklch(0.75_0.19_150)]" /> Affiliate Kazanç & Ödeme
          Durumu
        </h2>
        <span className="text-xs text-muted-foreground">
          {verified} onaylı hesap · {readyRows.length} ödemeye hazır
        </span>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <Kpi
          icon={<Wallet size={14} />}
          label="Ödenmemiş (borç)"
          value={q.isLoading ? "…" : money(owedCents)}
          hint={`${rows.reduce((s, r) => s + r.pending_count, 0)} komisyon`}
        />
        <Kpi
          icon={<Banknote size={14} />}
          label="Ödemeye hazır"
          value={q.isLoading ? "…" : money(readyCents)}
          hint={`eşik ${money(MIN_PAYOUT_CENTS)} · bekleme süresi dolmuş`}
          tone="ready"
        />
        <Kpi
          icon={<ScrollText size={14} />}
          label="Ödenen (toplam)"
          value={q.isLoading ? "…" : money(paidCents)}
          hint={`${rows.reduce((s, r) => s + r.paid_count, 0)} işaretli ödeme`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-white/[0.02] px-5 py-3">
        <button
          type="button"
          onClick={jumpToDetail}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white/90"
        >
          <Handshake size={13} /> Kim ne kadar kazandı / ödendi mi? (ödeme ekranı)
        </button>
        <button
          type="button"
          onClick={() => exportCsv.mutate()}
          disabled={exportCsv.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10 disabled:opacity-50"
        >
          {exportCsv.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          Ödeme listesini indir (CSV)
        </button>
        <span className="text-[11px] text-muted-foreground">
          Ödeme Wise/IBAN ile manuel yapılır; yaptıktan sonra satırdaki “Ödendi işaretle” ile
          kaydedilir ve affiliate kendi panelinde tarih + referansı görür.
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
      className={`rounded-xl border p-4 ${
        tone === "ready"
          ? "border-[oklch(0.75_0.19_150)]/30 bg-[oklch(0.75_0.19_150)]/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
