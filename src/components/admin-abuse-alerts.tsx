import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { listAbuseAlerts } from "@/lib/admin.functions";

/** Ücretsiz kredi kötüye kullanımı için otomatik admin uyarıları. */
export function AdminAbuseAlerts() {
  const fn = useServerFn(listAbuseAlerts);
  const q = useQuery({
    queryKey: ["admin-abuse-alerts"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  const rows = q.data?.rows ?? [];
  const short = (v: string | null) => (v ? `${v.slice(0, 10)}…` : "—");

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="min-w-0 truncate font-semibold flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0 text-amber-400" /> Kötüye Kullanım Uyarıları
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {q.data ? `${rows.length} uyarı · ${q.data.high} kritik` : "—"}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {q.isLoading && (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="inline animate-spin" />
          </div>
        )}
        {q.isError && (
          <div className="py-8 text-center text-rose-400 text-xs">
            <ShieldAlert size={14} className="inline mr-1" /> Uyarılar okunamadı.
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Şüpheli ücretsiz kredi hareketi yok. Kural: aynı cihazdan 2+, aynı IP'den 3+ hesap veya
            60 dakikada tekrarlanan kayıt.
          </p>
        )}
        {rows.map((r) => (
          <article
            key={r.id}
            className={`rounded-xl border p-3 ${
              r.severity === "high"
                ? "border-rose-500/30 bg-rose-500/[0.06]"
                : "border-amber-500/25 bg-amber-500/[0.05]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  r.severity === "high"
                    ? "bg-rose-500/20 text-rose-300"
                    : "bg-amber-500/20 text-amber-300"
                }`}
              >
                {r.severity === "high" ? "Kritik" : "Şüpheli"}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">
                {r.suspect_email ?? r.title}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(r.reasons.length ? r.reasons : [r.body ?? ""]).map((reason, i) => (
                <li key={i}>• {reason}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
              <span title={r.visitor_id ?? ""}>cihaz: {short(r.visitor_id)}</span>
              <span title={r.ip_hash ?? ""}>ip: {short(r.ip_hash)}</span>
              <span className={r.blocked ? "text-emerald-300" : "text-rose-300"}>
                {r.blocked ? "kredi engellendi" : "kredi verildi"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
