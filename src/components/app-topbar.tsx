import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useRouterState } from "@tanstack/react-router";
import { Coins, LayoutDashboard, Settings as SettingsIcon, Bell, Zap } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PaletteToggle } from "@/components/palette-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAuth } from "@/hooks/use-auth";
import { getFullProfile } from "@/lib/analysis.functions";


const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/command-center": "Command Center",
  "/compare": "Compare",
  "/news": "E-Com News",
  "/council": "AI Council",
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { tier } = useEntitlements();
  const { user } = useAuth();
  const profileFn = useServerFn(getFullProfile);
  const profileQ = useQuery({ queryKey: ["profile", user?.id], queryFn: () => profileFn(), enabled: !!user });
  const credits = (profileQ.data as { credits?: number } | undefined)?.credits ?? 0;
  const title = TITLES[pathname] ?? (pathname.startsWith("/tools") ? "Tools" : "Velora");

  return (
    <div className="topbar" data-no-translate>
      <div className="topbar-inner">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10" />
          <BrandLogo size="sm" subtitle="" />
          <span className="hidden shrink-0 text-white/25 sm:inline">/</span>
          <span className="hidden truncate text-xs font-semibold tracking-wide text-muted-foreground sm:inline">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs sm:inline-flex">
            <Coins size={13} className="text-[oklch(0.85_0.18_90)]" />
            <span className="font-semibold">{credits}</span>
          </span>
          <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] md:inline-flex">
            <Zap size={11} /> {tier}
          </span>
          <Link to="/notifications" className="topbar-btn" title="Notifications"><Bell size={14} /></Link>
          <Link to="/dashboard" className="topbar-btn" title="Dashboard"><LayoutDashboard size={14} /></Link>
          <Link to="/settings" className="topbar-btn" title="Settings"><SettingsIcon size={14} /></Link>
          <LanguageSwitcher />
          <PaletteToggle />
          <ThemeToggle />
        </div>
      </div>
      <div className="topbar-line" />
    </div>
  );
}
