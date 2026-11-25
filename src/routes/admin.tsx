import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Users,
  DollarSign,
  Receipt,
  Coins,
  ArrowLeft,
  Shield,
  Sparkles,
  Handshake,
  RefreshCw,
  Search,
  Download,
  Wallet,
  UserPlus,
  Mail,
  BadgeDollarSign,
  TrendingUp,
  Activity,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { daysLeft } from "@/lib/plans";
import {
  getAdminStats,
  listAdminUsers,
  listAdminTransactions,
  checkIsAdmin,
  type AdminUserRow,
} from "@/lib/admin.functions";
import { AdminPlanAssign } from "@/components/admin-plan-assign";
import { AdminPromoCodes } from "@/components/admin-promo-codes";
import { AdminPromoUsers } from "@/components/admin-promo-users";
import { AdminTickets } from "@/components/admin-tickets";
import { AdminFreeCredits } from "@/components/admin-free-credits";
import { AdminAbuseAlerts } from "@/components/admin-abuse-alerts";
import { AdminAffiliates } from "@/components/admin-affiliates";
import { AdminAffiliateCodeReport } from "@/components/admin-affiliate-code-report";
import { AdminAffiliatePayoutSummary } from "@/components/admin-affiliate-payout-summary";
import { AdminCreditLedger } from "@/components/admin-credit-ledger";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Yönetim Paneli — Aroless" },
      {
        name: "description",
        content: "Aroless platform metrikleri, kullanıcıları ve ödeme geçmişi.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

const PAID_TIERS = new Set(["Starter", "Pro", "Business"]);

type UserFilter = "all" | "paid" | "free" | "expired";
type UserSort = "newest" | "credits" | "spent" | "expiring";
type TxFilter = "all" | "Starter" | "Pro" | "Business" | "admin";

function isPaidTier(tier: string | null | undefined) {
  return PAID_TIERS.has(String(tier ?? ""));
}

function isActivePlan(user: AdminUserRow) {
  if (!isPaidTier(user.subscription_tier)) return false;
  if (user.subscription_status !== "active") return false;
  const left = daysLeft(user.current_period_end);
  return left === null || left > 0;
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null | undefined)[][],
) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function AdminPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const checkFn = useServerFn(checkIsAdmin);
  const statsFn = useServerFn(getAdminStats);
  const usersFn = useServerFn(listAdminUsers);
  const txFn = useServerFn(listAdminTransactions);

  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [userSort, setUserSort] = useState<UserSort>("newest");
  const [txSearch, setTxSearch] = useState("");
  const [txFilter, setTxFilter] = useState<TxFilter>("all");

  useEffect(() => {
    if (!loading && !user)
      nav({
        to: "/auth",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
  }, [user, loading, nav]);

  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => checkFn(),
    enabled: !!user,
  });

  const isAdmin = !!adminQ.data?.isAdmin;

  const statsQ = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => statsFn(),
    enabled: isAdmin,
  });
  const usersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => usersFn(),
    enabled: isAdmin,
  });
  const txQ = useQuery({ queryKey: ["admin-tx"], queryFn: () => txFn(), enabled: isAdmin });

  // Jeton defteri kendi bileşeninde sorgulanıyor; üstteki “Yenile” onu da
  // tazeler. Aynı veriyi iki kez çekmemek için burada ayrıca kullanılmaz.
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["admin-stats"] });
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["admin-tx"] });
    void qc.invalidateQueries({ queryKey: ["admin-credit-usage"] });
  };

  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    const list = (usersQ.data ?? []).filter((u) => {
      if (userFilter === "paid" && !isPaidTier(u.subscription_tier)) return false;
      if (userFilter === "free" && isPaidTier(u.subscription_tier)) return false;
      if (userFilter === "expired" && (!isPaidTier(u.subscription_tier) || isActivePlan(u)))
        return false;
      if (!needle) return true;
      return (
        (u.email ?? "").toLowerCase().includes(needle) ||
        u.id.toLowerCase().includes(needle) ||
        (u.promo_code ?? "").toLowerCase().includes(needle)
      );
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (userSort === "credits")
        return (
          b.credits +
          b.finder_credits +
          b.sim_credits -
          (a.credits + a.finder_credits + a.sim_credits)
        );
      if (userSort === "spent") return b.credits_spent - a.credits_spent;
      if (userSort === "expiring") {
        const leftA = daysLeft(a.current_period_end) ?? 9999;
        const leftB = daysLeft(b.current_period_end) ?? 9999;
        return leftA - leftB;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted;
  }, [usersQ.data, userSearch, userFilter, userSort]);

  const filteredTx = useMemo(() => {
    const needle = txSearch.trim().toLowerCase();
    return (txQ.data ?? []).filter((t) => {
      if (txFilter === "admin" && t.provider !== "admin" && t.payment_method !== "admin")
        return false;
      if (txFilter !== "all" && txFilter !== "admin" && t.tier !== txFilter) return false;
      if (!needle) return true;
      return (
        (t.email ?? "").toLowerCase().includes(needle) ||
        (t.tier ?? "").toLowerCase().includes(needle) ||
        t.provider.toLowerCase().includes(needle)
      );
    });
  }, [txQ.data, txSearch, txFilter]);

  if (loading || !user || adminQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <Shield className="mx-auto mb-3 text-[oklch(0.68_0.15_255)]" />
          <h1 className="text-xl font-semibold">Erişim kısıtlı</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bu alan yalnızca platform yöneticilerine açıktır.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-2 text-sm rounded-lg bg-white/5 border border-white/10 px-4 py-2 hover:bg-white/10"
          >
            <ArrowLeft size={14} /> Panele dön
          </Link>
        </div>
      </div>
    );
  }

  const s = statsQ.data;
  const money = (c: number) =>
    `$${(c / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("tr-TR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("tr-TR");
  const refreshing = statsQ.isFetching || usersQ.isFetching || txQ.isFetching;
  const paidShare =
    s && s.totalUsers > 0 ? Math.round((s.activePaidUsers / s.totalUsers) * 100) : 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold leading-tight flex items-center gap-2">
                Yönetim Paneli <Shield size={14} className="text-[oklch(0.68_0.15_255)]" />
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                Aroless · Platform operasyonları
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-60 sm:flex"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Yenile
            </button>
            {/* Affiliate ödemeleri: "kim ne kadar kazandı, parası ödendi mi?"
                sorusunu tek tıkla ölçülmüş sayılarla açan giriş. */}
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("admin-affiliates")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="flex items-center gap-1.5 rounded-lg border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-3 py-1.5 text-xs font-medium hover:bg-[oklch(0.75_0.19_150)]/20"
            >
              <Handshake size={14} /> Affiliate ödemeleri
            </button>
            <Link
              to="/"
              className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5"
            >
              <ArrowLeft size={14} /> Uygulamaya dön
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <section id="admin-overview" className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.78_0.12_255)]">
                Platform operasyonları
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">İşletme özeti</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Kullanıcı, abonelik ve jeton akışını tek ekrandan izleyin. Sayılar sunucudan canlı
                okunur; işlem yaptıktan sonra “Yenile” ile tazeleyin.
              </p>
            </div>
            <nav
              aria-label="Admin bölümleri"
              className="flex flex-wrap items-center gap-1.5 text-xs"
            >
              {[
                ["#admin-overview", "Genel bakış"],
                ["#admin-users", "Kullanıcılar"],
                ["#admin-payments", "Ödemeler"],
                ["#admin-credit-ledger", "Jeton defteri"],
                ["#admin-operations", "Operasyon"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Users}
              label="Toplam kullanıcı"
              value={s ? s.totalUsers.toLocaleString("tr-TR") : "—"}
              sub={s ? `${s.newUsersThisMonth.toLocaleString("tr-TR")} bu ay yeni` : undefined}
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={BadgeDollarSign}
              label="Aktif ücretli"
              value={s ? s.activePaidUsers.toLocaleString("tr-TR") : "—"}
              sub={
                s
                  ? `${paidShare}% dönüşüm · ${s.freeUsers.toLocaleString("tr-TR")} ücretsiz/pasif`
                  : undefined
              }
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={DollarSign}
              label="Toplam ciro"
              value={s ? money(s.totalRevenueCents) : "—"}
              sub={s ? `${money(s.monthRevenueCents)} bu ay` : undefined}
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={Receipt}
              label="İşlem sayısı"
              value={s ? s.totalTransactions.toLocaleString("tr-TR") : "—"}
              sub="Paddle + admin kayıtları"
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={Wallet}
              label="Kalan jeton"
              value={s ? s.totalCreditsRemaining.toLocaleString("tr-TR") : "—"}
              sub="Cüzdanlarda harcanmayı bekliyor"
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={Coins}
              label="Harcanan jeton"
              value={s ? s.totalCreditsSpent.toLocaleString("tr-TR") : "—"}
              sub="Ömür boyu · iadeler düşülmüş"
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={UserPlus}
              label="Bu ay yeni"
              value={s ? s.newUsersThisMonth.toLocaleString("tr-TR") : "—"}
              sub="Ay başından itibaren kayıt"
              loading={statsQ.isLoading}
            />
            <KpiCard
              icon={TrendingUp}
              label="Bu ay ciro"
              value={s ? money(s.monthRevenueCents) : "—"}
              sub="Ay başından itibaren tahsilat"
              loading={statsQ.isLoading}
            />
          </section>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Activity size={13} className="text-emerald-300" /> Jeton sağlığı
            </span>
            <span>
              {s ? s.totalCreditsRemaining.toLocaleString("tr-TR") : "—"} kullanılabilir jeton
            </span>
            <span>{s ? s.activePaidUsers.toLocaleString("tr-TR") : "—"} aktif ücretli hesap</span>
            <span>
              İade satırları negatif yazılır; aylık hak sayacından düşer. Ayrıntı: jeton defteri.
            </span>
          </div>
        </section>

        <section id="admin-users" className="glass rounded-2xl overflow-hidden scroll-mt-24">
          <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Users size={16} /> Kullanıcılar
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Son 50 kayıt · arama, paket filtresi ve sıralama
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {filteredUsers.length} / {usersQ.data?.length ?? 0}
              </span>
              <button
                type="button"
                disabled={filteredUsers.length === 0}
                onClick={() =>
                  downloadCsv(
                    `aroless-kullanicilar-${new Date().toISOString().slice(0, 10)}.csv`,
                    [
                      "E-posta",
                      "Paket",
                      "Durum",
                      "Genel jeton",
                      "Bulucu jetonu",
                      "Sim jetonu",
                      "Harcanan",
                      "Promosyon",
                      "Kayıt",
                    ],
                    filteredUsers.map((u) => [
                      u.email ?? "",
                      u.subscription_tier,
                      u.subscription_status,
                      u.credits,
                      u.finder_credits,
                      u.sim_credits,
                      u.credits_spent,
                      u.promo_code ?? "",
                      u.created_at,
                    ]),
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50"
              >
                <Download size={13} /> CSV
              </button>
            </div>
          </div>

          <div className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="E-posta, kullanıcı ID veya promosyon kodu ara"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
              />
            </div>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value as UserFilter)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            >
              <option value="all">Tüm paketler</option>
              <option value="paid">Ücretli</option>
              <option value="free">Ücretsiz</option>
              <option value="expired">Süresi dolmuş</option>
            </select>
            <select
              value={userSort}
              onChange={(e) => setUserSort(e.target.value as UserSort)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            >
              <option value="newest">En yeni kayıt</option>
              <option value="credits">En yüksek jeton</option>
              <option value="spent">En çok harcayan</option>
              <option value="expiring">Bitişi yakın</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr>
                  <Th>Kullanıcı</Th>
                  <Th>Promosyon</Th>
                  <Th className="text-right">Jeton</Th>
                  <Th className="text-right">Harcanan</Th>
                  <Th>Paket</Th>
                  <Th>Bitiş / durum</Th>
                  <Th>Katılım</Th>
                  <Th className="text-center">İletişim</Th>
                </tr>
              </thead>
              <tbody>
                {usersQ.isLoading && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="inline animate-spin" />
                    </td>
                  </tr>
                )}
                {!usersQ.isLoading &&
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <Td>
                        <div className="max-w-[240px] truncate font-medium">{u.email ?? "—"}</div>
                        <div className="mt-0.5 max-w-[240px] truncate font-mono text-[9px] text-muted-foreground">
                          {u.id}
                        </div>
                      </Td>
                      <Td>
                        {u.promo_code ? (
                          <code className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                            {u.promo_code}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="text-right">
                        <div className="font-semibold tabular-nums">
                          {(u.credits + u.finder_credits).toLocaleString("tr-TR")}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {u.finder_credits} bulucu · {u.credits} genel
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums text-muted-foreground">
                        {u.credits_spent.toLocaleString("tr-TR")}
                      </Td>
                      <Td>
                        <TierBadge tier={u.subscription_tier} />
                      </Td>
                      <Td>
                        <ExpiryCell end={u.current_period_end} status={u.subscription_status} />
                      </Td>
                      <Td className="text-muted-foreground">{fmtDate(u.created_at)}</Td>
                      <Td className="text-center">
                        {u.email ? (
                          <a
                            href={`mailto:${u.email}`}
                            aria-label={`${u.email} adresine e-posta gönder`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                          >
                            <Mail size={13} />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                {!usersQ.isLoading && filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      Bu filtreye uyan kullanıcı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-payments" className="glass rounded-2xl overflow-hidden scroll-mt-24">
          <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Receipt size={16} /> Ödeme geçmişi
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Paddle ve admin paket tanımlamaları · son 50 kayıt
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {filteredTx.length} / {txQ.data?.length ?? 0}
              </span>
              <button
                type="button"
                disabled={filteredTx.length === 0}
                onClick={() =>
                  downloadCsv(
                    `aroless-odemeler-${new Date().toISOString().slice(0, 10)}.csv`,
                    [
                      "E-posta",
                      "Paket",
                      "Tutar (cent)",
                      "Para birimi",
                      "Yöntem",
                      "Sağlayıcı",
                      "Tarih",
                    ],
                    filteredTx.map((t) => [
                      t.email ?? "",
                      t.tier ?? "",
                      t.amount_cents,
                      t.currency,
                      t.payment_method ?? "",
                      t.provider,
                      t.created_at,
                    ]),
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50"
              >
                <Download size={13} /> CSV
              </button>
            </div>
          </div>

          <div className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="E-posta veya sağlayıcı ara"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
              />
            </div>
            <select
              value={txFilter}
              onChange={(e) => setTxFilter(e.target.value as TxFilter)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
            >
              <option value="all">Tüm işlemler</option>
              <option value="Starter">Starter</option>
              <option value="Pro">Pro</option>
              <option value="Business">Business</option>
              <option value="admin">Admin tanımlaması</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr>
                  <Th>Kullanıcı</Th>
                  <Th>Paket</Th>
                  <Th className="text-right">Tutar</Th>
                  <Th>Yöntem</Th>
                  <Th>Sağlayıcı</Th>
                  <Th>Tarih</Th>
                </tr>
              </thead>
              <tbody>
                {txQ.isLoading && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="inline animate-spin" />
                    </td>
                  </tr>
                )}
                {!txQ.isLoading &&
                  filteredTx.map((t) => (
                    <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <Td className="max-w-[260px] truncate font-medium">{t.email ?? "—"}</Td>
                      <Td>
                        <TierBadge tier={t.tier ?? "—"} />
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">
                        {money(t.amount_cents)}{" "}
                        <span className="text-[10px] text-muted-foreground">{t.currency}</span>
                      </Td>
                      <Td className="capitalize text-muted-foreground">
                        {t.payment_method ?? "—"}
                      </Td>
                      <Td>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            t.provider === "admin"
                              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                              : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                          }`}
                        >
                          {t.provider}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-muted-foreground">
                        {fmtDateTime(t.created_at)}
                      </Td>
                    </tr>
                  ))}
                {!txQ.isLoading && filteredTx.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      Bu filtreye uyan ödeme yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="admin-operations" className="scroll-mt-24 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.78_0.12_255)]">
                Operasyon
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight">Yönetim araçları</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Paket tanımlama, jeton defteri, promosyon, destek, kötüye kullanım ve affiliate
                süreçleri.
              </p>
            </div>
          </div>

          <AdminPlanAssign />
          <AdminCreditLedger />
          <AdminPromoCodes />
          <AdminPromoUsers />
          <AdminTickets />
          <AdminAbuseAlerts />
          <AdminFreeCredits />
          <AdminAffiliatePayoutSummary />
          <AdminAffiliateCodeReport />
          <AdminAffiliates />
        </section>
      </main>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: ComponentType<{ className?: string; size?: number }>;
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 flex items-center justify-center">
          <Icon size={14} className="text-[oklch(0.85_0.15_255)]" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums">
        {loading ? <Loader2 className="animate-spin" size={20} /> : value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Paket bitiş tarihi + kalan gün; süresi dolmuşsa kırmızı vurgular. */
function ExpiryCell({ end, status }: { end: string | null; status: string }) {
  if (!end) return <span className="text-xs text-muted-foreground">—</span>;
  const left = daysLeft(end);
  const isActive = status === "active" && left !== null && left > 0;
  return (
    <div className="text-xs">
      <div className={isActive ? "text-foreground" : "text-rose-300"}>
        {new Date(end).toLocaleDateString("tr-TR", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {left === null ? status : left > 0 ? `${left} gün kaldı` : "süresi doldu"}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const isPaid = isPaidTier(tier);
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border ${isPaid ? "border-[oklch(0.62_0.17_255)]/50 bg-gradient-to-r from-[oklch(0.62_0.17_255)]/20 to-[oklch(0.52_0.15_262)]/20 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground"}`}
    >
      {tier}
    </span>
  );
}

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={`px-5 py-3 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-5 py-3 ${className}`}>{children}</td>;
}
