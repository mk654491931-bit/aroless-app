import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Megaphone, ShieldCheck, ShieldX } from "lucide-react";
import {
  adminListAffiliates,
  adminSetAffiliateStatus,
  type AdminAffiliateRow,
} from "@/lib/affiliate.functions";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "Bekliyor",
    cls: "border-[oklch(0.72_0.15_70)]/50 bg-[oklch(0.72_0.15_70)]/10 text-[oklch(0.82_0.15_70)]",
  },
  verified: {
    label: "Onaylı",
    cls: "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]",
  },
  revoked: {
    label: "Askıda",
    cls: "border-[oklch(0.68_0.20_25)]/50 bg-[oklch(0.68_0.20_25)]/10 text-[oklch(0.72_0.19_25)]",
  },
};

/** Admin: affiliate başvurularını onayla / askıya al (RBAC korumalı). */
export function AdminAffiliates() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliates);
  const setFn = useServerFn(adminSetAffiliateStatus);

  const q = useQuery({ queryKey: ["admin-affiliates"], queryFn: () => listFn() });

  const setStatus = useMutation({
    mutationFn: (v: { userId: string; status: "verified" | "revoked" }) =>
      setFn({ data: { userId: v.userId, status: v.status } }),
    onSuccess: (_res, v) => {
      toast.success(v.status === "verified" ? "Affiliate onaylandı" : "Affiliate askıya alındı");
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];
  const money = (c: number) =>
    `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Megaphone size={16} className="text-[oklch(0.62_0.17_255)]" /> Affiliate Programı
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.filter((r) => r.status === "verified").length} onaylı ·{" "}
          {rows.filter((r) => r.status === "pending").length} bekleyen
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Email</th>
              <th className="px-5 py-3 text-left font-medium">Durum</th>
              <th className="px-5 py-3 text-right font-medium">Oran</th>
              <th className="px-5 py-3 text-right font-medium">Kazanç</th>
              <th className="px-5 py-3 text-left font-medium">Başvuru</th>
              <th className="px-5 py-3 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline animate-spin" />
                </td>
              </tr>
            )}
            {!q.isLoading &&
              rows.map((r: AdminAffiliateRow) => {
                const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
                return (
                  <tr key={r.user_id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium">{r.email ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">%{r.commission_rate_pct}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="font-semibold">{money(r.earned_cents)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.paid_transactions} ödeme
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {r.status === "verified" ? (
                        <button
                          onClick={() => setStatus.mutate({ userId: r.user_id, status: "revoked" })}
                          disabled={setStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-lg border border-[oklch(0.68_0.20_25)]/40 bg-[oklch(0.68_0.20_25)]/10 px-2.5 py-1.5 text-xs font-medium hover:bg-[oklch(0.68_0.20_25)]/20 disabled:opacity-50"
                        >
                          <ShieldX size={12} /> Askıya al
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setStatus.mutate({ userId: r.user_id, status: "verified" })
                          }
                          disabled={setStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-lg border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-2.5 py-1.5 text-xs font-medium hover:bg-[oklch(0.75_0.19_150)]/20 disabled:opacity-50"
                        >
                          <ShieldCheck size={12} /> Onayla
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  Henüz affiliate başvurusu yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
