import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  ChartColumnBig,
  Loader2,
  TicketPercent,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { adminAffiliateCodeReport } from "@/lib/affiliate.functions";
import { MIN_PAYOUT_CENTS } from "@/lib/affiliate";

const money = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * KOD BAZLI GETİRİ RAPORU — "hangi affiliate kodu kaç abonelik getirdi ve
 * ödenebilir bakiye ne kadar?" sorusunun TEK ekrandaki yanıtı.
 *
 * NEDEN AYRI BÖLÜM: `AdminPromoUsers` yalnız kod performansını, `AdminAffiliates`
 * yalnız ödeme bakiyesini gösteriyordu; ikisini karşılaştırmak iki tabloyu elle
 * eşleştirmeyi gerektiriyordu ve "kodu çok çalışan ama ödeme bilgisi eksik"
 * durumu fark edilmeden kalabiliyordu.
 *
 * ÖNEMLİ: bakiye HESAP bazlıdır (komisyon tek hesaba yazılır). Aynı affiliate'in
 * ikinci kodu bakiyeyi tekrar yazmaz — o satır "aynı hesapta" diye işaretlenir,
 * böylece toplam ödenecek tutar iki kez sayılmaz.
 */
export function AdminAffiliateCodeReport() {
  const reportFn = useServerFn(adminAffiliateCodeReport);
  const q = useQuery({ queryKey: ["admin-affiliate-code-report"], queryFn: () => reportFn() });

  const rows = q.data?.rows ?? [];
  const totals = q.data?.totals;

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <ChartColumnBig size={16} className="text-[oklch(0.62_0.17_255)]" /> Kod Bazlı Getiri
          Raporu
        </h2>
        <span className="text-xs text-muted-foreground">
          {totals ? (
            <>
              {totals.codes} kod · {totals.affiliates} affiliate · {totals.subscriptions} abonelik
            </>
          ) : (
            "yükleniyor…"
          )}
        </span>
      </div>

      {/* ÖZET: para ve hacim aynı şeritte — tek ekranda karar verilebilsin. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-white/10 bg-white/[0.02] px-5 py-3 text-xs sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Getirilen abonelik
          </div>
          <div className="text-lg font-bold">{totals?.subscriptions ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground">
            {totals ? `${totals.signups} kayıt · ciro ${money(totals.revenue_cents)}` : ""}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            <Wallet size={11} /> Ödenebilir toplam
          </div>
          <div className="text-lg font-bold text-[oklch(0.8_0.15_150)]">
            {money(totals?.payable_cents ?? 0)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            eşik {money(MIN_PAYOUT_CENTS)} · {totals?.payable_affiliates ?? 0} hesap hazır
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Beklemede (30 gün)
          </div>
          <div className="text-lg font-bold">{money(totals?.held_cents ?? 0)}</div>
          <div className="text-[10px] text-muted-foreground">
            şimdi ödenmez, süre dolunca ödenebilir olur
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Şimdiye kadar ödenen
          </div>
          <div className="text-lg font-bold">{money(totals?.paid_cents ?? 0)}</div>
          {totals && (totals.unlinked_codes > 0 || totals.shared_balance_codes > 0) ? (
            <div className="text-[10px] text-muted-foreground">
              {totals.unlinked_codes > 0 ? `${totals.unlinked_codes} kod affiliate'siz` : ""}
              {totals.unlinked_codes > 0 && totals.shared_balance_codes > 0 ? " · " : ""}
              {totals.shared_balance_codes > 0
                ? `${totals.shared_balance_codes} kodda bakiye aynı hesapta`
                : ""}
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th>Affiliate Kodu</Th>
              <Th>Affiliate</Th>
              <Th className="text-right">Kayıt</Th>
              <Th className="text-right">Abonelik</Th>
              <Th className="text-right">Ödenebilir</Th>
              <Th className="text-right">Beklemede</Th>
              <Th className="text-right">Ödenmiş</Th>
              <Th>Ödeme Durumu</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline animate-spin" />
                </td>
              </tr>
            )}
            {!q.isLoading && q.isError && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-rose-300">
                  Rapor yüklenemedi.{" "}
                  <button onClick={() => q.refetch()} className="underline">
                    Tekrar dene
                  </button>
                </td>
              </tr>
            )}
            {!q.isLoading &&
              !q.isError &&
              rows.map((r) => (
                <tr
                  key={`${r.affiliate_id ?? "code"}:${r.code ?? "none"}`}
                  className="border-t border-white/5 align-top hover:bg-white/[0.02]"
                >
                  <Td>
                    {r.code ? (
                      <code className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                        {r.code}
                      </code>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[oklch(0.82_0.15_70)]">
                        <TriangleAlert size={11} /> kod verilmemiş
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="font-medium">{r.affiliate_email ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.affiliate_id
                        ? `%${r.commission_rate_pct ?? 0} komisyon · ${r.affiliate_status ?? "—"}`
                        : "affiliate'e bağlı değil (komisyon doğmaz)"}
                    </div>
                  </Td>
                  <Td className="text-right text-muted-foreground">{r.signups}</Td>
                  <Td className="text-right">
                    <div className="font-semibold">{r.subscriptions}</div>
                    <div className="text-[10px] text-muted-foreground">%{r.conversion_pct}</div>
                    {r.by_tier.length > 0 && (
                      <div className="mt-1 flex flex-wrap justify-end gap-1">
                        {r.by_tier.map((t) => (
                          <span
                            key={t.tier}
                            className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {t.tier} ×{t.users}
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="font-semibold text-[oklch(0.8_0.15_150)]">
                      {money(r.payable_cents)}
                    </div>
                    {!r.balance_owned && r.affiliate_id ? (
                      <div className="text-[10px] text-muted-foreground">aynı hesapta</div>
                    ) : null}
                  </Td>
                  <Td className="text-right text-muted-foreground">{money(r.held_cents)}</Td>
                  <Td className="text-right text-muted-foreground">{money(r.paid_cents)}</Td>
                  <Td>
                    {!r.affiliate_id ? (
                      <span className="text-[10px] text-muted-foreground">
                        Kod sahibi yok — komisyon hesaplanmaz
                      </span>
                    ) : !r.balance_owned ? (
                      <span className="text-[10px] text-muted-foreground">
                        Bakiye {r.affiliate_email ?? "aynı affiliate"} satırında
                      </span>
                    ) : r.payout_missing.length > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.82_0.15_70)]/40 bg-[oklch(0.82_0.15_70)]/10 px-2 py-0.5 text-[10px] text-[oklch(0.82_0.15_70)]">
                        <TriangleAlert size={10} /> Ödeme bilgisi eksik:{" "}
                        {r.payout_missing.join(", ")}
                      </span>
                    ) : r.eligible ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-2 py-0.5 text-[10px] text-[oklch(0.75_0.19_150)]">
                        <Banknote size={10} /> Ödemeye hazır
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {money(r.remaining_cents)} daha birikmeli
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            {!q.isLoading && !q.isError && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-muted-foreground">
                  <TicketPercent className="mx-auto mb-2 opacity-60" size={18} />
                  Henüz raporlanacak kod ya da affiliate yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-white/10 px-5 py-2 text-[10px] text-muted-foreground">
        Abonelik = kodla gelen ve ödeme yapan kullanıcı. Bakiye HESAP bazlıdır; aynı affiliate'in
        ikinci kodunda tekrar yazılmaz (toplam çift sayılmaz). Ödeme bilgisi eksikse eşik geçilse
        bile ödeme yapılamaz.
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
