import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Coins,
  LayoutDashboard,
  Settings as SettingsIcon,
  Bell,
  Zap,
  LogOut,
  Radar,
  Users,
  Wrench,
  ChevronDown,
  Handshake,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PaletteToggle } from "@/components/palette-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { CursorToggle } from "@/components/cursor-toggle";
import { SettingsCluster } from "@/components/settings-cluster";
import { useEntitlements } from "@/hooks/use-entitlements";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import { usePlanSync } from "@/hooks/use-plan-sync";
import type { UsageKind } from "@/lib/plan-usage";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";
import { getMyAffiliateBadge } from "@/lib/affiliate.functions";
import { affiliateTopbarBadge } from "@/lib/affiliate";
import { creditBalances, creditBreakdownLabel, type CreditProfile } from "@/lib/credits";
import { supabase } from "@/integrations/supabase/client";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/command-center": "Command Center",
  "/compare": "Compare",
  "/news": "E-Com News",
  "/radar": "Winner Radar",
  "/roi": "Profit & ROI",
  "/audit": "Store Auditor",
  "/studio": "Creative Studio",
  "/council": "AI Council",
  "/trend-radar": "Trend Radar",
  "/competitor-analysis": "Competitor Analysis",
  "/viral-ads": "Viral Ads",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/admin": "Admin",
};

/** Kimlik doğrulanmış affiliate kazanç tutarını kısa biçimde yazar. */
function affiliateMoney(cents: number): string {
  const value = (cents ?? 0) / 100;
  return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value.toFixed(2)}`;
}

/**
 * Shared system chrome: brand, breadcrumb, credits and quick actions.
 * Rendered above every in-app page (except the finder home and auth).
 */
export function AppTopbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { tier, quota, isAdmin, loading: entLoading } = useEntitlements();
  const { user } = useAuth();
  /**
   * ÖDEME SONRASI TAZELEME: ödeme yapıldıysa bekleyen işareti görüp planı
   * Paddle'ın kendi kaydından yazdırır. Üst bar her uygulama sayfasında
   * çizildiği için tek bağlama noktası burasıdır.
   */
  usePlanSync(tier, entLoading);
  /** Bu ayın gerçek kullanımı — "limit" ile "kullanılan" aynı satırda. */
  const usage = usePlanUsage();
  const usageOf = (kind: UsageKind) => usage.rows.find((row) => row.kind === kind);
  const usageLabel = (kind: UsageKind): string => {
    const row = usageOf(kind);
    if (!row || row.disabled) return "—";
    return `${row.used}/${row.limit}`;
  };
  const profileFn = useServerFn(getFullProfile);
  /**
   * AFFILIATE ROZETİ — üst menüdeki panel butonu bu hesabın admin tarafından
   * affiliate olarak TANIMLANIP onaylandığını buradan öğrenir.
   *
   * NEDEN AYRI VE HAFİF UÇ: buton her sayfada çizilir; tam özet ucu beş sorgu
   * yapar. `getMyAffiliateBadge` yalnız durumu ve iki toplamı okur, onaylı
   * olmayan hesapta hiç okumaz. Sorgu kullanıcı yokken HİÇ çalışmaz.
   *
   * GÖRÜNÜRLÜK KURALI: buton yalnız `is_affiliate === true` (durum `verified`)
   * iken görünür — "başvuru bekliyor" durumunda çıkmaz. Böylece buton, admin'in
   * tanımladığı hesapların ayırt edici işareti olur.
   */
  const badgeFn = useServerFn(getMyAffiliateBadge);
  const affiliateQ = useQuery({
    queryKey: ["affiliate-badge", user?.id],
    queryFn: () => badgeFn(),
    enabled: !!user,
    staleTime: 60_000,
    gcTime: 600_000,
  });
  // Görünürlük kuralı TEK KAYNAKTAN gelir ve testlidir (`affiliateTopbarBadge`):
  // buton yalnız admin'in affiliate olarak tanımlayıp ONAYLADIĞI hesapta çizer.
  const affiliate = affiliateTopbarBadge(affiliateQ.data);
  const affiliateUnpaid = affiliate.unpaidCents;
  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileFn(),
    enabled: !!user,
    // Jeton rozeti her zaman taze olmalı: harcama işçide/başka sekmede olabilir.
    staleTime: 15_000,
    gcTime: 300_000,
    refetchOnWindowFocus: true,
  });
  /**
   * Harcanabilir jeton = finder_credits + credits.
   *
   * Eskiden yalnızca `credits` okunuyordu; ürün bulucu ise ÖNCE
   * `finder_credits`'i harcadığı için ücretsiz kullanıcının rozeti hiç
   * eksilmiyordu (hatta 0 görünüp aramayı engelliyordu).
   */
  const balances = useMemo(
    () => creditBalances(profileQ.data as CreditProfile | undefined),
    [profileQ.data],
  );
  const credits = balances.total;
  const breakdown = creditBreakdownLabel(balances);
  const publicId = useMemo(
    () => (profileQ.data as { public_id?: string | null } | undefined)?.public_id ?? null,
    [profileQ.data],
  );
  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/tools")
      ? "Tools"
      : pathname.startsWith("/hot/")
        ? "Product"
        : "Aroless");

  // Not: `data-no-translate` buradan kaldırıldı — aksi hâlde topbar'daki
  // Türkçe sabit metinler ("Kullanım Hakkın", "Paketleri gör", "Çıkış yap")
  // dil değişimine hiç tepki vermiyordu. Dil/tema kümesi kendi içinde
  // `data-no-translate` taşır ve etiketlerini t() ile alır.
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10" />
          <BrandLogo size="sm" subtitle="" />
          <span className="hidden shrink-0 text-white/25 sm:inline">/</span>
          <span className="hidden truncate text-xs font-semibold tracking-wide text-muted-foreground sm:inline">
            {title}
          </span>
          {/* Compact breadcrumb for very small screens: keep the app name clear */}
          <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground sm:hidden">
            {title}
          </span>
        </div>

        <div className="topbar-actions flex min-w-0 shrink-0 items-center gap-1.5">
          {publicId ? (
            <span
              className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-muted-foreground lg:inline-flex"
              title="Kullanıcı kimliğiniz"
            >
              ID {publicId}
            </span>
          ) : null}
          {/* Kalan Finder kredisi — tıklanabilir: popover'da 4'lü kota detayı (mobil uyumlu) */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs transition hover:bg-white/10 sm:inline-flex"
                title={`Harcanabilir jeton: ${credits} (${breakdown}) / Aylık kota: ${quota.credits} — detay için tıkla`}
              >
                <Coins size={13} className="text-[oklch(0.85_0.18_90)]" />
                <span className="font-semibold">{credits}</span>
                <span className="text-[10px] text-muted-foreground">/ {quota.credits}</span>
                <ChevronDown size={10} className="text-white/40" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[300px] border-white/10 bg-[#141a2a] p-0 text-white shadow-xl"
            >
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wide text-white/90">
                    Kullanım Hakkın
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
                    {tier}
                    {isAdmin ? " · admin 250" : ""}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70">
                      <Coins size={12} className="text-[oklch(0.85_0.18_90)]" /> Harcanabilir jeton
                    </span>
                    <span className="font-mono text-xs font-semibold">{balances.total}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-5">
                    <span className="text-[11px] text-white/50">Ürün bulucu jetonu</span>
                    <span className="font-mono text-[11px] text-white/70">{balances.finder}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-5">
                    <span className="text-[11px] text-white/50">Genel jetonlar</span>
                    <span className="font-mono text-[11px] text-white/70">{balances.general}</span>
                  </div>
                  {(
                    [
                      { kind: "credits" as const, label: "Bulucu", Icon: Coins, tone: "text-[oklch(0.85_0.18_90)]" },
                      { kind: "toolRuns" as const, label: "AI Araç", Icon: Wrench, tone: "text-sky-400" },
                      { kind: "councilRuns" as const, label: "Konsey", Icon: Users, tone: "text-violet-400" },
                      { kind: "radarScans" as const, label: "Radar", Icon: Radar, tone: "text-emerald-400" },
                    ] as const
                  ).map(({ kind, label, Icon, tone }) => (
                    <div key={kind} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-white/70">
                        <Icon size={12} className={tone} /> {label}
                      </span>
                      <span className="font-mono text-xs font-semibold">
                        {usageLabel(kind)}
                        <span className="font-normal text-white/40"> /ay</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/55">
                  {isAdmin
                    ? "Admin: her kalemde 250 jeton (test/limit yok)."
                    : "Kota ay başında yenilenir. Free planda Finder 2 jeton."}
                </div>
                <Link
                  to="/pricing"
                  className="flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                >
                  Paketleri gör
                </Link>
              </div>
            </PopoverContent>
          </Popover>
          {/* Mobil için de aynı tetik: sm altında ikon-only */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs sm:hidden"
                title={`Jeton ${credits} (${breakdown}) — detay için tıkla`}
              >
                <Coins size={12} className="text-[oklch(0.85_0.18_90)]" /> {credits}/{quota.credits}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[300px] border-white/10 bg-[#141a2a] p-0 text-white shadow-xl"
            >
              <div className="space-y-3 p-4">
                <p className="text-xs font-semibold tracking-wide text-white/90">
                  Kullanım Hakkın · {tier}
                </p>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/60">Harcanabilir jeton</span>
                    <span className="font-mono font-semibold">{balances.total}</span>
                  </div>
                  <div className="flex justify-between pl-3">
                    <span className="text-white/45">Ürün bulucu</span>
                    <span className="font-mono text-white/70">{balances.finder}</span>
                  </div>
                  <div className="flex justify-between pl-3">
                    <span className="text-white/45">Genel</span>
                    <span className="font-mono text-white/70">{balances.general}</span>
                  </div>
                  {(
                    [
                      { kind: "credits" as const, label: "Bulucu" },
                      { kind: "toolRuns" as const, label: "AI Araç" },
                      { kind: "councilRuns" as const, label: "Konsey" },
                      { kind: "radarScans" as const, label: "Radar" },
                    ] as const
                  ).map(({ kind, label }) => (
                    <div key={kind} className="flex justify-between">
                      <span className="text-white/60">{label}</span>
                      <span className="font-mono font-semibold">{usageLabel(kind)} /ay</span>
                    </div>
                  ))}
                </div>
                <Link
                  to="/pricing"
                  className="flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black"
                >
                  Paketleri gör
                </Link>
              </div>
            </PopoverContent>
          </Popover>
          {/* 4’lü kota — xl'de tek satır özet (desktop) */}
          <span
            className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1 py-1 text-[11px] xl:inline-flex"
            title={
              isAdmin
                ? "Admin: her kalemde 250 jeton"
                : `Bu ay kullanılan / limit — Bulucu ${usageLabel("credits")} · Araç ${usageLabel("toolRuns")} · Konsey ${usageLabel("councilRuns")} · Radar ${usageLabel("radarScans")}`
            }
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
              <Coins size={10} className="text-[oklch(0.85_0.18_90)]" />
              {usageLabel("credits")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
              <Wrench size={10} className="text-sky-400" />
              {usageLabel("toolRuns")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
              <Users size={10} className="text-violet-400" />
              {usageLabel("councilRuns")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
              <Radar size={10} className="text-emerald-400" />
              {usageLabel("radarScans")}
            </span>
          </span>
          <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] md:inline-flex">
            <Zap size={11} /> {tier}
            {isAdmin ? " · 250" : ""}
          </span>

          {/* AFFILIATE PANELİ — YALNIZ admin'in affiliate olarak tanımladığı
              hesaplarda görünür. Ödenmemiş tutar rozette yazar ki affiliate
              panele girmeden kazancını görsün. */}
          {affiliate.show ? (
            <Link
              to="/affiliate-panel"
              className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-2.5 py-1 text-[11px] font-medium text-[oklch(0.85_0.12_150)] transition hover:bg-[oklch(0.75_0.19_150)]/20"
              title={t("affiliate.badge_title", {
                unpaid: affiliateMoney(affiliateUnpaid),
                paid: affiliateMoney(affiliate.paidCents),
              })}
            >
              <Handshake size={13} />
              <span className="hidden sm:inline">{t("affiliate.badge")}</span>
              {affiliateUnpaid > 0 && (
                <span className="font-semibold tabular-nums">
                  {affiliateMoney(affiliateUnpaid)}
                </span>
              )}
            </Link>
          ) : null}
          <Link to="/notifications" className="topbar-btn" title="Notifications">
            <Bell size={14} />
          </Link>
          <Link to="/dashboard" className="topbar-btn" title="Dashboard">
            <LayoutDashboard size={14} />
          </Link>
          <Link to="/settings" className="topbar-btn" title="Settings">
            <SettingsIcon size={14} />
          </Link>
          {/* Dil / tema / palet / imleç tek kümede: açılır-kapanır, tercih kalıcı. */}
          <SettingsCluster defaultOpenMinWidth={1280}>
            <LanguageSwitcher />
            <PaletteToggle />
            <ThemeToggle />
            <CursorToggle />
          </SettingsCluster>
          <button
            type="button"
            onClick={async () => {
              await queryClient.cancelQueries();
              queryClient.clear();
              await supabase.auth.signOut();
              await navigate({ to: "/auth", replace: true });
            }}
            className="topbar-btn"
            title="Çıkış yap"
            aria-label="Çıkış yap"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
      <div className="topbar-line" />
    </div>
  );
}
