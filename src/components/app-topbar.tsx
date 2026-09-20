import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Coins, LayoutDashboard, Settings as SettingsIcon, Bell, Zap, LogOut, Radar, Users, Wrench, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PaletteToggle } from "@/components/palette-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { CursorToggle } from "@/components/cursor-toggle";
import { SettingsCluster } from "@/components/settings-cluster";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";
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

/**
 * Shared system chrome: brand, breadcrumb, credits and quick actions.
 * Rendered above every in-app page (except the finder home and auth).
 */
export function AppTopbar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { tier, quota, isAdmin } = useEntitlements();
  const { user } = useAuth();
  const profileFn = useServerFn(getFullProfile);
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
  const publicId = useMemo(() => (profileQ.data as { public_id?: string | null } | undefined)?.public_id ?? null, [profileQ.data]);
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
            <PopoverContent align="end" sideOffset={8} className="w-[300px] border-white/10 bg-[#141a2a] p-0 text-white shadow-xl">
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wide text-white/90">Kullanım Hakkın</p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">{tier}{isAdmin ? " · admin 250" : ""}</span>
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
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70"><Coins size={12} className="text-[oklch(0.85_0.18_90)]" /> Finder</span>
                    <span className="font-mono text-xs font-semibold">{quota.credits}<span className="font-normal text-white/40"> /ay</span></span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70"><Wrench size={12} className="text-sky-400" /> AI Araç</span>
                    <span className="font-mono text-xs font-semibold">{quota.toolRuns}<span className="font-normal text-white/40"> /ay</span></span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70"><Users size={12} className="text-violet-400" /> Konsey</span>
                    <span className="font-mono text-xs font-semibold">{quota.councilRuns}<span className="font-normal text-white/40"> /ay</span></span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70"><Radar size={12} className="text-emerald-400" /> Radar</span>
                    <span className="font-mono text-xs font-semibold">{quota.radarScans}<span className="font-normal text-white/40"> /ay</span></span>
                  </div>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/55">
                  {isAdmin ? "Admin: her kalemde 250 jeton (test/limit yok)." : "Kota ay başında yenilenir. Free planda Finder 2 jeton."}
                </div>
                <Link to="/pricing" className="flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90">Paketleri gör</Link>
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
            <PopoverContent align="end" sideOffset={8} className="w-[300px] border-white/10 bg-[#141a2a] p-0 text-white shadow-xl">
              <div className="space-y-3 p-4">
                <p className="text-xs font-semibold tracking-wide text-white/90">Kullanım Hakkın · {tier}</p>
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
                  <div className="flex justify-between">
                    <span className="text-white/60">Finder kotası</span>
                    <span className="font-mono font-semibold">{quota.credits} /ay</span>
                  </div>

                  <div className="flex justify-between"><span className="text-white/60">AI Araç</span><span className="font-mono font-semibold">{quota.toolRuns} /ay</span></div>
                  <div className="flex justify-between"><span className="text-white/60">Konsey</span><span className="font-mono font-semibold">{quota.councilRuns} /ay</span></div>
                  <div className="flex justify-between"><span className="text-white/60">Radar</span><span className="font-mono font-semibold">{quota.radarScans} /ay</span></div>
                </div>
                <Link to="/pricing" className="flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black">Paketleri gör</Link>
              </div>
            </PopoverContent>
          </Popover>
          {/* 4’lü kota — xl'de tek satır özet (desktop) */}
          <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1 py-1 text-[11px] xl:inline-flex" title={isAdmin ? "Admin: her kalemde 250 jeton" : `Free: Finder 2 jeton · Tool ${quota.toolRuns} · Konsey ${quota.councilRuns} · Radar ${quota.radarScans}`}>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5"><Coins size={10} className="text-[oklch(0.85_0.18_90)]" />{quota.credits}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5"><Wrench size={10} className="text-sky-400" />{quota.toolRuns}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5"><Users size={10} className="text-violet-400" />{quota.councilRuns}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5"><Radar size={10} className="text-emerald-400" />{quota.radarScans}</span>
          </span>
          <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] md:inline-flex">
            <Zap size={11} /> {tier}{isAdmin ? " · 250" : ""}
          </span>

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
