import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ArrowDownLeft, ArrowUpRight, Loader2, RefreshCw, Search } from "lucide-react";
import { listAdminCreditUsage } from "@/lib/admin.functions";

const KIND_LABEL: Record<string, string> = {
  credits: "Bulucu",
  toolRuns: "AI araç",
  councilRuns: "Konsey",
  radarScans: "Radar",
  hydrogen10Runs: "Hidrojen10",
};

type Filter = "all" | "charge" | "refund";

/**
 * Jeton defteri — “harcama gerçekten düşüyor mu, iade sayaca yansıyor mu?”
 * sorusunu adminin tek ekranda yanıtlaması için son 120 kayıt.
 */
export function AdminCreditLedger() {
  const fn = useServerFn(listAdminCreditUsage);
  const q = useQuery({
    queryKey: ["admin-credit-usage"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "charge" && r.credits <= 0) return false;
      if (filter === "refund" && r.credits >= 0) return false;
      if (!needle) return true;
      return (
        (r.email ?? "").toLowerCase().includes(needle) ||
        r.tool.toLowerCase().includes(needle) ||
        r.user_id.toLowerCase().includes(needle)
      );
    });
  }, [rows, search, filter]);

  const charged = rows.reduce((sum, r) => (r.credits > 0 ? sum + r.credits : sum), 0);
  const refunded = rows.reduce((sum, r) => (r.credits < 0 ? sum + Math.abs(r.credits) : sum), 0);

  return (
    <section id="admin-credit-ledger" className="glass rounded-2xl overflow-hidden scroll-mt-24">
      <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2">
            <Activity size={16} className="text-[oklch(0.85_0.15_255)]" /> Jeton Defteri
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Son 120 AI işlemi · negatif satırlar iadeyi ve aylık sayaç düzeltmesini gösterir.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw size={13} className={q.isFetching ? "animate-spin" : ""} /> Yenile
        </button>
      </div>

      <div className="grid gap-3 border-b border-white/10 p-4 sm:grid-cols-3">
        <Summary
          label="Son kayıtlarda harcanan"
          value={`${charged.toLocaleString("tr-TR")} jeton`}
          tone="charge"
        />
        <Summary
          label="İade edilen"
          value={`${refunded.toLocaleString("tr-TR")} jeton`}
          tone="refund"
        />
        <Summary
          label="Net tüketim"
          value={`${(charged - refunded).toLocaleString("tr-TR")} jeton`}
          tone="net"
        />
      </div>

      <div className="flex flex-col gap-2 border-b border-white/10 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="E-posta, araç veya kullanıcı ID ara"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "Tümü"],
              ["charge", "Harcama"],
              ["refund", "İade"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                filter === value
                  ? "border-[oklch(0.62_0.17_255)]/50 bg-[oklch(0.62_0.17_255)]/20 text-foreground"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th>Tarih</Th>
              <Th>Kullanıcı</Th>
              <Th>İşlem</Th>
              <Th>Hak</Th>
              <Th className="text-right">Jeton</Th>
              <Th>Durum</Th>
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
            {q.isError && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-rose-300">
                  Jeton defteri okunamadı.
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                  Bu filtreye uyan jeton kaydı yok.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <Td className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("tr-TR")}
                </Td>
                <Td className="max-w-[240px] truncate">
                  {r.email ?? r.user_id.slice(0, 12) + "…"}
                </Td>
                <Td>
                  <code className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                    {r.tool}
                  </code>
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {r.kind ? (KIND_LABEL[r.kind] ?? r.kind) : "—"}
                </Td>
                <Td
                  className={`text-right font-semibold tabular-nums ${
                    r.credits < 0 ? "text-emerald-300" : "text-foreground"
                  }`}
                >
                  {r.credits > 0 ? "+" : ""}
                  {r.credits}
                </Td>
                <Td>
                  {r.credits < 0 || r.adjustment ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      <ArrowDownLeft size={10} /> İade
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <ArrowUpRight size={10} /> Harcama
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "charge" | "refund" | "net";
}) {
  const color =
    tone === "refund" ? "text-emerald-300" : tone === "charge" ? "text-foreground" : "text-sky-300";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 text-left font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3 ${className}`}>{children}</td>;
}
