import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, Search, TriangleAlert } from "lucide-react";
import { listAdminPromoUsers } from "@/lib/promo.functions";

/**
 * "Hangi kullanıcı hangi promosyon kodundan geldi, hangi planı aldı?" sorusunu
 * tek tek cevaplayan tablo. Kod bazlı özetle aynı veriden beslenir
 * (bkz. lib/promo-attribution.ts), bu yüzden iki ekran asla ayrışmaz.
 */
export function AdminPromoUsers() {
  const listFn = useServerFn(listAdminPromoUsers);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["admin-promo-users"], queryFn: () => listFn() });

  const rows = q.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        (r) =>
          r.email.toLowerCase().includes(needle) ||
          r.code.toLowerCase().includes(needle) ||
          r.plans.some((p) => p.toLowerCase().includes(needle)),
      )
    : rows;

  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";

  const converted = rows.filter((r) => r.converted).length;
  const revenue = rows.reduce((s, r) => s + r.revenue_cents, 0);
  const pending = rows.filter((r) => r.pending_activation).length;

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Link2 size={16} /> Kullanıcı Bazlı Promo &amp; Paket
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="E-posta, kod veya paket ara…"
              className="w-56 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-7 pr-3 text-xs outline-none focus:border-[oklch(0.62_0.17_255)]"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {visible.length}/{rows.length} kullanıcı
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-white/10 px-5 py-2 text-[11px] text-muted-foreground">
        <span>
          <b className="text-foreground">{rows.length}</b> promo kaydı
        </span>
        <span>
          <b className="text-foreground">{converted}</b> kullanıcı pakete döndü
        </span>
        <span>
          Ciro: <b className="text-foreground">{money(revenue)}</b>
        </span>
        {pending > 0 && (
          <span className="flex items-center gap-1 text-amber-300">
            <TriangleAlert size={12} /> {pending} kullanıcıda ödeme var, paket henüz tanımlı değil
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th>Kullanıcı</Th>
              <Th>Promo Kodu</Th>
              <Th>Kayıt</Th>
              <Th>Aldığı Paketler</Th>
              <Th>Mevcut Plan</Th>
              <Th className="text-right">Harcama</Th>
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
            {!q.isLoading && q.isError && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-rose-300">
                  Kullanıcı listesi yüklenemedi.{" "}
                  <button onClick={() => q.refetch()} className="underline">
                    Tekrar dene
                  </button>
                </td>
              </tr>
            )}
            {!q.isLoading &&
              !q.isError &&
              visible.map((r) => (
                <tr key={r.user_id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <Td className="font-medium">{r.email}</Td>
                  <Td>
                    <code className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-xs">
                      {r.code}
                    </code>
                  </Td>
                  <Td className="text-muted-foreground">{fmtDate(r.signed_up_at)}</Td>
                  <Td>
                    {r.plans.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="inline-flex flex-wrap gap-1">
                        {r.plans.map((plan) => (
                          <span
                            key={plan}
                            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]"
                          >
                            {plan}
                          </span>
                        ))}
                        {r.pending_activation && (
                          <span
                            title="Ödeme alındı ama profilde paket tanımlı değil"
                            className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300"
                          >
                            tanımsız
                          </span>
                        )}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        r.current_tier === "Free"
                          ? "border-white/10 bg-white/5 text-muted-foreground"
                          : "border-[oklch(0.62_0.17_255)]/50 bg-[oklch(0.62_0.17_255)]/15"
                      }`}
                      title={r.subscription_status}
                    >
                      {r.current_tier}
                    </span>
                  </Td>
                  <Td className="text-right font-semibold">
                    {r.revenue_cents > 0 ? money(r.revenue_cents) : "—"}
                  </Td>
                </tr>
              ))}
            {!q.isLoading && !q.isError && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  Henüz promosyon kodu kullanılmamış.
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && rows.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  Aramanla eşleşen kullanıcı yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3 ${className}`}>{children}</td>;
}
