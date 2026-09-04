import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Check,
  Users,
  UserCheck,
  MousePointerClick,
  Percent,
  Clock,
  Wallet,
  Coins,
  TrendingUp,
  Loader2,
  Gift,
  ExternalLink,
  RefreshCw,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPartnerDashboard, type PartnerDashboardPayload } from "@/lib/partner.functions";
import { PageHero } from "@/components/page-hero";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/partner")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Partner Dashboard — Aroless" },
      {
        name: "description",
        content: "Aroless affiliate partner panel: commissions, referrals, revenue.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PartnerPage,
});

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  paid: "Ödendi",
  reversed: "İptal",
  referred: "Kayıt oldu",
  active: "Aktif abone",
  canceled: "İptal etti",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "paid" || status === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : status === "pending" || status === "referred"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-white/10 bg-white/5 text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function PartnerPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const qFn = useServerFn(getPartnerDashboard);
  const [copied, setCopied] = useState(false);
  const [metric, setMetric] = useState<"referrals" | "revenue" | "commission">("commission");
  const [days, setDays] = useState<30 | 90>(30);
  const [earnRange, setEarnRange] = useState<"all" | 30 | 90>("all");

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const q = useQuery({
    queryKey: ["partner-dashboard", user?.id],
    queryFn: () => qFn(),
    enabled: !!user,
  });

  const data = q.data as PartnerDashboardPayload | undefined;

  const visibleEarnings = useMemo(() => {
    if (!data) return [];
    if (earnRange === "all") return data.earnings;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - earnRange);
    return data.earnings.filter((e) => new Date(e.createdAt).getTime() >= cutoff.getTime());
  }, [data, earnRange]);

  const chart = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const bucket: Record<
      string,
      { date: string; referrals: number; revenue: number; commission: number }
    > = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      bucket[key] = {
        date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        referrals: 0,
        revenue: 0,
        commission: 0,
      };
    }
    const start = new Date(now);
    start.setDate(now.getDate() - (days - 1));
    for (const c of data.customers ?? []) {
      const t = new Date(c.referredAt).getTime();
      if (t >= start.getTime()) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (bucket[key]) bucket[key].referrals += 1;
      }
    }
    for (const e of data.earnings ?? []) {
      const t = new Date(e.createdAt).getTime();
      if (t >= start.getTime()) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (bucket[key]) {
          bucket[key].revenue += e.subscriptionAmountCents;
          bucket[key].commission += e.commissionAmountCents;
        }
      }
    }
    return Object.values(bucket);
  }, [data, days]);

  if (loading || !user)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );

  const s = data?.stats;
  const aff = data?.affiliate;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Kopyalandı");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Kopyalanamadı");
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <PageHero
          icon={<Megaphone size={18} />}
          title="Partner Dashboard"
          description="Aroless Affiliate programı: komisyonların, müşterilerinin ve gelirinin canlı paneli."
          actions={
            <>
              {aff && (
                <button
                  onClick={() => q.refetch()}
                  className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
                >
                  <RefreshCw size={13} /> Yenile
                </button>
              )}
              <Link
                to="/"
                className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
              >
                <ArrowLeft size={14} /> Ana sayfa
              </Link>
            </>
          }
        />

        {q.isLoading && (
          <div className="glass rounded-2xl p-14 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-3 animate-spin" /> Panel yükleniyor…
          </div>
        )}

        {q.isError && (
          <div className="glass rounded-2xl p-10 text-center">
            <div className="text-sm font-semibold text-red-300">Panel yüklenemedi</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {q.error instanceof Error ? q.error.message : "Bilinmeyen hata"}
            </p>
            <button
              onClick={() => q.refetch()}
              className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
            >
              Tekrar dene
            </button>
          </div>
        )}

        {q.isSuccess && !aff && (
          <div className="glass rounded-2xl p-8 sm:p-12 text-center max-w-2xl mx-auto">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25">
              <Gift size={26} className="text-[oklch(0.85_0.15_265)]" />
            </div>
            <h2 className="mt-5 text-xl font-bold">Henüz partner değilsiniz</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Partner programı davetiyelidir. Yönetici ekibimiz hesabınızı affiliate olarak
              tanımladığında bu panelde özel davet linkiniz, komisyon oranınız ve canlı
              kazançlarınız görünecek.
            </p>
            <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left text-xs text-muted-foreground sm:grid-cols-3">
              <li className="rounded-xl border border-white/10 bg-white/5 p-3">
                <b className="block text-foreground">%30</b> tekrarlayan komisyon
              </li>
              <li className="rounded-xl border border-white/10 bg-white/5 p-3">
                <b className="block text-foreground">12 ay</b> müşteri başına azami süre
              </li>
              <li className="rounded-xl border border-white/10 bg-white/5 p-3">
                <b className="block text-foreground">Otomatik</b> ödeme webhook'larından
              </li>
            </ul>
            <Link
              to="/pricing"
              className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Ürünü tanı <ExternalLink size={14} />
            </Link>
          </div>
        )}

        {q.isSuccess && aff && data && (
          <>
            {/* Referral link / kimlik kartı */}
            <section className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-[240px] flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Gift size={16} className="text-[oklch(0.75_0.18_265)]" /> Kişisel davet
                      linkin
                    </h2>
                    <StatusBadge status={aff.status === "active" ? "active" : "inactive"} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Kod: <b className="text-foreground">{aff.referralCode}</b> · %
                    {aff.commissionRatePct} tekrarlayan komisyon · {aff.commissionDurationMonths} ay
                    süre
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <code className="break-all rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs flex-1 min-w-[220px]">
                      {aff.link}
                    </code>
                    <button
                      onClick={() => copy(aff.link)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />} Kopyala
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <Mini label="Tıklama" icon={MousePointerClick} value={String(s?.clicks ?? 0)} />
                  <Mini label="Kayıt" icon={Users} value={String(s?.totalCustomers ?? 0)} />
                  <Mini
                    label="Ödeme yapan"
                    icon={UserCheck}
                    value={String(s?.paidCustomers ?? 0)}
                  />
                  <Mini
                    label="Dönüşüm"
                    icon={Percent}
                    value={typeof s?.conversionRate === "number" ? `%${s.conversionRate}` : "—"}
                  />
                </div>
              </div>
            </section>

            {/* Üst metrikler */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi
                icon={Wallet}
                label="Toplam Kazanç"
                value={usd(s?.totalEarnedCents ?? 0)}
                accent
              />
              <Kpi
                icon={Clock}
                label="Bekleyen"
                value={usd(s?.pendingCents ?? 0)}
                sub={`${data.earnings.filter((e) => e.status === "pending").length} kayıt`}
              />
              <Kpi icon={Coins} label="Ödenen" value={usd(s?.paidCents ?? 0)} sub="ödeme yapıldı" />
              <Kpi
                icon={UserCheck}
                label="Aktif Referans"
                value={String(s?.activeCustomers ?? 0)}
              />
              <Kpi icon={Users} label="Toplam Müşteri" value={String(s?.totalCustomers ?? 0)} />
              <Kpi
                icon={TrendingUp}
                label="MRR Üretilen"
                value={usd(s?.mrrCents ?? 0)}
                sub="aktif abonelerden / ay"
              />
            </section>

            {/* Grafik */}
            <section className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <TrendingUp size={16} /> Son {days} gün
                </h2>
                <div className="flex gap-2">
                  <Seg
                    options={[
                      { v: "referrals", l: "Referral" },
                      { v: "revenue", l: "Revenue" },
                      { v: "commission", l: "Komisyon" },
                    ]}
                    value={metric}
                    onChange={(v) => setMetric(v as typeof metric)}
                  />
                  <Seg
                    options={[
                      { v: 30, l: "30G" },
                      { v: 90, l: "90G" },
                    ]}
                    value={days}
                    onChange={(v) => setDays(v as 30 | 90)}
                  />
                </div>
              </div>
              <div className="mt-4 h-64">
                <ResponsiveContainer>
                  <AreaChart data={chart} margin={{ left: 8, right: 8 }}>
                    <defs>
                      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="oklch(0.72 0.2 265)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="oklch(0.72 0.2 265)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="oklch(0.72 0.03 260)"
                      fontSize={10}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={28}
                    />
                    <YAxis
                      stroke="oklch(0.72 0.03 260)"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(v: number) =>
                        metric === "referrals" ? String(v) : `$${Math.round(v / 100)}`
                      }
                    />
                    <Tooltip
                      formatter={(v) =>
                        metric === "referrals"
                          ? [`${v} yeni referral`, "Referral"]
                          : metric === "revenue"
                            ? [usd(Number(v)), "Revenue"]
                            : [usd(Number(v)), "Komisyon"]
                      }
                      contentStyle={{
                        background: "oklch(0.2 0.035 265)",
                        border: "1px solid oklch(1 0 0 / 0.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={metric}
                      stroke="oklch(0.72 0.2 265)"
                      strokeWidth={2}
                      fill="url(#chartFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Müşteriler */}
            <section className="glass rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Users size={16} /> Müşterilerin
                </h2>
                <span className="text-xs text-muted-foreground">
                  {data.customers.length} gösteriliyor
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                    <tr>
                      <Th>Müşteri</Th>
                      <Th>Plan</Th>
                      <Th>Abonelik</Th>
                      <Th className="text-right">Aylık gelir</Th>
                      <Th className="text-right">Oran</Th>
                      <Th className="text-right">Aylık komisyon</Th>
                      <Th>Komisyon aralığı</Th>
                      <Th className="text-right">Toplam</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          Henüz referans müşterin yok — linkini paylaşmaya başla!
                        </td>
                      </tr>
                    )}
                    {data.customers.map((c) => (
                      <tr
                        key={c.customerId}
                        className="border-t border-white/5 hover:bg-white/[0.02]"
                      >
                        <Td>{c.email}</Td>
                        <Td>{c.plan ?? "—"}</Td>
                        <Td>
                          <StatusBadge status={c.status} />
                        </Td>
                        <Td className="text-right font-medium">{usd(c.monthlyRevenueCents)}</Td>
                        <Td className="text-right">
                          {c.commissionRatePct !== null ? `%${c.commissionRatePct}` : "—"}
                        </Td>
                        <Td className="text-right font-semibold">
                          {usd(c.monthlyCommissionCents)}
                        </Td>
                        <Td className="text-muted-foreground text-xs">
                          {c.commissionStart && c.commissionEnd
                            ? `${fmtDate(c.commissionStart).split(",")[0]} → ${fmtDate(c.commissionEnd).split(",")[0]}`
                            : "ilk ödeme bekleniyor"}
                        </Td>
                        <Td className="text-right font-semibold text-emerald-300">
                          {usd(c.totalEarnedCents)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Kazançlar */}
            <section className="glass rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <Wallet size={16} /> Kazanç geçmişi
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {visibleEarnings.length}/{data.earnings.length} komisyon
                  </span>
                  <Seg
                    options={[
                      { v: "all", l: "Tümü" },
                      { v: 30, l: "30G" },
                      { v: 90, l: "90G" },
                    ]}
                    value={earnRange}
                    onChange={(v) => setEarnRange(v as typeof earnRange)}
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                    <tr>
                      <Th>Tarih</Th>
                      <Th>Müşteri</Th>
                      <Th>Plan</Th>
                      <Th className="text-right">Ödeme</Th>
                      <Th className="text-right">Komisyon</Th>
                      <Th>Dönem</Th>
                      <Th>Durum</Th>
                      <Th>Ödeme tarihi</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.earnings.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          Henüz komisyon yok. Referans müşterin abone olduğunda otomatik oluşur.
                        </td>
                      </tr>
                    )}
                    {data.earnings.length > 0 && visibleEarnings.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          Seçilen dönemde komisyon yok.
                        </td>
                      </tr>
                    )}
                    {visibleEarnings.map((e) => (
                      <tr key={e.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <Td className="text-muted-foreground">{fmtDate(e.createdAt)}</Td>
                        <Td>{e.customerEmail}</Td>
                        <Td>{e.plan}</Td>
                        <Td className="text-right">{usd(e.subscriptionAmountCents)}</Td>
                        <Td className="text-right font-semibold">
                          {e.status === "reversed" ? (
                            <span className="text-muted-foreground line-through">
                              {usd(e.commissionAmountCents)}
                            </span>
                          ) : (
                            usd(e.commissionAmountCents)
                          )}
                        </Td>
                        <Td className="text-xs text-muted-foreground">
                          {fmtDate(e.periodStart).split(",")[0]} →{" "}
                          {fmtDate(e.periodEnd).split(",")[0]}
                        </Td>
                        <Td>
                          <StatusBadge status={e.status} />
                        </Td>
                        <Td className="text-muted-foreground">
                          {e.paidAt ? fmtDate(e.paidAt) : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="text-center text-[11px] text-muted-foreground">
              Komisyonlar; abonelik ödemeleri <b>backend/webhook</b> üzerinden doğrulandıkça
              otomatik oluşur. İptal, iade ve süre sonu kuralları otomatik işler.{" "}
              <ShieldCheck size={11} className="inline text-emerald-300" />
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Mini({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
      <Icon className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
      <div className="mt-1 text-sm font-bold">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <div
          className={`grid h-7 w-7 place-items-center rounded-lg ${
            accent
              ? "bg-gradient-to-br from-[oklch(0.68_0.20_265)]/30 to-[oklch(0.66_0.24_305)]/30"
              : "bg-white/5"
          }`}
        >
          <Icon
            size={13}
            className={accent ? "text-[oklch(0.85_0.15_265)]" : "text-muted-foreground"}
          />
        </div>
      </div>
      <div className="mt-2 truncate text-lg font-bold sm:text-xl">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ v: T; l: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
            value === o.v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}
