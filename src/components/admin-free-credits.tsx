import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Gift, ShieldAlert } from "lucide-react";
import { listFreeCreditAudit } from "@/lib/admin.functions";

const REASON_LABEL: Record<string, string> = {
  first_signup: "İlk kayıt — kredi verildi",
  duplicate_device: "Aynı cihaz — engellendi",
  duplicate_ip: "Aynı IP — engellendi",
};

/** Ücretsiz kredi denetim logu: kime, hangi cihaz/IP ile verildi. */
export function AdminFreeCredits() {
  const fn = useServerFn(listFreeCreditAudit);
  const q = useQuery({ queryKey: ["admin-free-credit-audit"], queryFn: () => fn() });

  const rows = q.data?.rows ?? [];
  const short = (v: string | null) => (v ? `${v.slice(0, 10)}…` : "—");

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="min-w-0 truncate font-semibold flex items-center gap-2">
          <Gift size={16} className="shrink-0" /> Ücretsiz Kredi Denetim Logu
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {q.data ? `${q.data.granted} verildi · ${q.data.blocked} engellendi` : "—"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Kullanıcı</th>
              <th className="text-left px-4 py-3 font-medium">Cihaz</th>
              <th className="text-left px-4 py-3 font-medium">IP (hash)</th>
              <th className="text-left px-4 py-3 font-medium">Durum</th>
              <th className="text-right px-4 py-3 font-medium">Kredi</th>
              <th className="text-left px-4 py-3 font-medium">Kaynak</th>
              <th className="text-left px-4 py-3 font-medium">Tarih</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={7} className="py-10 text-center text-muted-foreground"><Loader2 className="inline animate-spin" /></td></tr>
            )}
            {q.isError && (
              <tr><td colSpan={7} className="py-10 text-center text-rose-400 text-xs">
                <ShieldAlert size={14} className="inline mr-1" /> Log okunamadı.
              </td></tr>
            )}
            {!q.isLoading && !q.isError && rows.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-muted-foreground text-xs">Henüz kayıt yok.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-4 py-3 max-w-[220px] truncate">{r.email ?? r.user_id ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={r.visitor_id ?? ""}>{short(r.visitor_id)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={r.ip_hash ?? ""}>{short(r.ip_hash)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.granted ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                    {REASON_LABEL[r.reason] ?? r.reason}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.credits} / {r.sim_credits}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{r.source}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
