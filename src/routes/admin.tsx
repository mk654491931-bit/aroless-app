import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Users, DollarSign, Receipt, Coins, ArrowLeft, Shield, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  getAdminStats, listAdminUsers, listAdminTransactions, checkIsAdmin,
} from "@/lib/admin.functions";
import { AdminPromoCodes } from "@/components/admin-promo-codes";
import { AdminTickets } from "@/components/admin-tickets";
import { AdminFreeCredits } from "@/components/admin-free-credits";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Aroless" },
      { name: "description", content: "Platform metrics, users, and payment history." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const checkFn = useServerFn(checkIsAdmin);
  const statsFn = useServerFn(getAdminStats);
  const usersFn = useServerFn(listAdminUsers);
  const txFn = useServerFn(listAdminTransactions);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => checkFn(),
    enabled: !!user,
  });

  const isAdmin = !!adminQ.data?.isAdmin;

  const statsQ = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn(), enabled: isAdmin });
  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: () => usersFn(), enabled: isAdmin });
  const txQ = useQuery({ queryKey: ["admin-tx"], queryFn: () => txFn(), enabled: isAdmin });

  if (loading || !user || adminQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <Shield className="mx-auto mb-3 text-[oklch(0.75_0.18_265)]" />
          <h1 className="text-xl font-semibold">Access Restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">This area is only available to platform administrators.</p>
          <Link to="/" className="mt-5 inline-flex items-center gap-2 text-sm rounded-lg bg-white/5 border border-white/10 px-4 py-2 hover:bg-white/10">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const s = statsQ.data;
  const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold leading-tight flex items-center gap-2">
                Admin Dashboard <Shield size={14} className="text-[oklch(0.75_0.18_265)]" />
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">Aroless · Platform Ops</div>
            </div>
          </div>
          <Link to="/" className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5">
            <ArrowLeft size={14} /> Back to app
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* KPIs */}
        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Users} label="Total Users" value={s ? s.totalUsers.toLocaleString() : "—"} loading={statsQ.isLoading} />
          <KpiCard icon={DollarSign} label="Total Revenue" value={s ? money(s.totalRevenueCents) : "—"} sub={s ? `${money(s.monthRevenueCents)} this month` : undefined} loading={statsQ.isLoading} />
          <KpiCard icon={Receipt} label="Transactions" value={s ? s.totalTransactions.toLocaleString() : "—"} loading={statsQ.isLoading} />
          <KpiCard icon={Coins} label="Credits Spent" value={s ? s.totalCreditsSpent.toLocaleString() : "—"} loading={statsQ.isLoading} />
        </section>

        {/* Users */}
        <AdminPromoCodes />
        <AdminTickets />
        <AdminFreeCredits />

        <section className="glass rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Users size={16} /> Recent Users</h2>
            <span className="text-xs text-muted-foreground">{usersQ.data?.length ?? 0} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr>
                  <Th>Email</Th><Th className="text-right">Credits</Th><Th className="text-right">Spent</Th><Th>Tier</Th><Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {usersQ.isLoading && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground"><Loader2 className="inline animate-spin" /></td></tr>
                )}
                {!usersQ.isLoading && (usersQ.data ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <Td className="font-medium">{u.email ?? "—"}</Td>
                    <Td className="text-right">{u.credits}</Td>
                    <Td className="text-right text-muted-foreground">{u.credits_spent}</Td>
                    <Td><TierBadge tier={u.subscription_tier} /></Td>
                    <Td className="text-muted-foreground">{fmtDate(u.created_at)}</Td>
                  </tr>
                ))}
                {!usersQ.isLoading && (usersQ.data ?? []).length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No users yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transactions */}
        <section className="glass rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Receipt size={16} /> Payment History</h2>
            <span className="text-xs text-muted-foreground">{txQ.data?.length ?? 0} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr>
                  <Th>User</Th><Th>Tier</Th><Th className="text-right">Amount</Th><Th>Method</Th><Th>Timestamp</Th>
                </tr>
              </thead>
              <tbody>
                {txQ.isLoading && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground"><Loader2 className="inline animate-spin" /></td></tr>
                )}
                {!txQ.isLoading && (txQ.data ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <Td className="font-medium">{t.email ?? "—"}</Td>
                    <Td><TierBadge tier={t.tier ?? "—"} /></Td>
                    <Td className="text-right font-semibold">{money(t.amount_cents)} <span className="text-[10px] text-muted-foreground">{t.currency}</span></Td>
                    <Td className="capitalize text-muted-foreground">{t.payment_method ?? t.provider}</Td>
                    <Td className="text-muted-foreground">{fmtDateTime(t.created_at)}</Td>
                  </tr>
                ))}
                {!txQ.isLoading && (txQ.data ?? []).length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No transactions yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, loading }: { icon: any; label: string; value: string; sub?: string; loading?: boolean }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 flex items-center justify-center">
          <Icon size={14} className="text-[oklch(0.85_0.15_265)]" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold">
        {loading ? <Loader2 className="animate-spin" size={20} /> : value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const isPaid = tier === "Starter" || tier === "Pro" || tier === "Business";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isPaid ? "border-[oklch(0.68_0.20_265)]/50 bg-gradient-to-r from-[oklch(0.68_0.20_265)]/20 to-[oklch(0.66_0.24_305)]/20 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground"}`}>
      {tier}
    </span>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3 ${className}`}>{children}</td>;
}
