import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, Copy, Check, Loader2, Megaphone, Coins, CalendarClock, ShieldCheck } from "lucide-react";
import {
  getMyAffiliateStatus,
  applyForAffiliate,
  type AffiliateSummary,
} from "@/lib/affiliate.functions";
import { DEFAULT_COMMISSION_RATE_PCT } from "@/lib/affiliate";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "İncelemede",
    cls: "border-[oklch(0.72_0.15_70)]/50 bg-[oklch(0.72_0.15_70)]/10 text-[oklch(0.82_0.15_70)]",
  },
  verified: {
    label: "Onaylı Affiliate",
    cls: "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]",
  },
  revoked: {
    label: "Askıya alındı",
    cls: "border-[oklch(0.68_0.20_25)]/50 bg-[oklch(0.68_0.20_25)]/10 text-[oklch(0.72_0.19_25)]",
  },
};

export function AffiliatePanel() {
  const qc = useQueryClient();
  const summaryFn = useServerFn(getMyAffiliateStatus);
  const applyFn = useServerFn(applyForAffiliate);
  const [copied, setCopied] = useState(false);

  const q = useQuery({ queryKey: ["affiliate"], queryFn: () => summaryFn() });

  const apply = useMutation({
    mutationFn: () => applyFn(),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Affiliate başvurun alındı — admin onayından sonra komisyon kazanmaya başlarsın.");
        qc.invalidateQueries({ queryKey: ["affiliate"] });
      } else toast.error("Başvuru kaydedilemedi, lütfen tekrar dene.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data: AffiliateSummary | undefined = q.data;
  const link =
    typeof window !== "undefined" && data?.referral_code
      ? `${window.location.origin}/auth?ref=${data.referral_code}`
      : "";
  const status = data?.status ?? null;
  const meta = status ? STATUS_META[status] : null;

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Affiliate linkin kopyalandı");
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="glass rounded-2xl p-5 border border-[oklch(0.62_0.17_255)]/20">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Megaphone size={18} className="text-[oklch(0.62_0.17_255)]" />
          <h2 className="font-semibold">Affiliate Programı · Mikro-influencer</h2>
        </div>
        {status && meta && (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.cls}`}>
            {status === "verified" ? <BadgeCheck size={12} /> : <CalendarClock size={12} />}
            {meta.label}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Davet ettiğin kullanıcıların her başarılı abonelik ödemesinde{" "}
        <b>%{data?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT} tekrarlayan komisyon</b>{" "}
        kazanırsın — iptal edilene kadar her fatura dönemi. Program yalnızca{" "}
        <b>admin tarafından onaylanmış</b> hesaplara açıktır; başvurun manuel olarak incelenir.
      </p>

      {q.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : (
        <>
          {!status && (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm">
                Kitle oluşturmuş bir içerik üreticisi veya mikro-influencer mısın? Davet
                linkinle abone olanların ödemelerinden komisyon kazanmaya başla.
              </p>
              <button
                onClick={() => apply.mutate()}
                disabled={apply.isPending}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {apply.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Başvuru yap
              </button>
            </div>
          )}

          {status === "pending" && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              Başvurun <b>inceleniyor</b>. Admin onayından sonra bu panelde komisyon linkin
              aktifleşir ve kazançların görünür olur.
            </p>
          )}

          {status === "revoked" && (
            <p className="mt-4 rounded-xl border border-[oklch(0.68_0.20_25)]/30 bg-[oklch(0.68_0.20_25)]/10 p-4 text-sm">
              Affiliate yetkin şu anda <b>askıda</b>. Soruların için destek ekibiyle iletişime geç.
            </p>
          )}

          {status === "verified" && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm break-all flex-1 min-w-[200px]">
                  {link || "—"}
                </code>
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} Kopyala
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Coins size={13} /> Birikmiş komisyon
                  </div>
                  <div className="text-2xl font-bold">
                    ${((data?.earned_cents ?? 0) / 100).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock size={13} /> Ödenen dönem
                  </div>
                  <div className="text-2xl font-bold">{data?.paid_transactions ?? 0}</div>
                </div>
              </div>

              {(data?.recent.length ?? 0) > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Son komisyonlar
                  </div>
                  <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
                    {data!.recent.slice(0, 5).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="truncate">
                          {c.tier ?? "Abonelik"} · ${(c.gross_amount_cents / 100).toFixed(2)} ödeme
                        </span>
                        <span className="font-semibold text-[oklch(0.75_0.19_150)]">
                          +${(c.commission_cents / 100).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}