import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar,
} from "@/components/ui/sidebar";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PricingModal } from "@/components/pricing-modal";
import { requiredPlanFor } from "@/lib/plans";
import {
  Package, Coins, Rocket, ShieldHalf, Newspaper,
  Handshake, FileSearch, ShieldQuestion, ClipboardList,
  Calculator, Ship, Wallet, Boxes, ShieldCheck,
  Gauge, PackagePlus, CalendarClock, Globe2, Megaphone,
  Gavel, QrCode, Barcode, FlaskConical, Target, Radar,
  LayoutDashboard, Scale, Bell, Lock,
} from "lucide-react";


type Item = { key: string; title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const GROUPS: { id: string; key: string; label: string; emoji: string; icon: typeof Package; items: Item[] }[] = [
  {
    id: "library", key: "g_library", label: "Library", emoji: "📚", icon: LayoutDashboard,
    items: [
      { key: "dashboard", title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { key: "command_center", title: "Command Center", url: "/command-center", icon: Radar },

      { key: "compare", title: "Compare Products", url: "/compare", icon: Scale },
      { key: "notifications", title: "Notifications", url: "/notifications", icon: Bell },
    ],
  },
  {
    id: "sourcing", key: "g_sourcing", label: "Sourcing & Factory Hub", emoji: "📦", icon: Package,
    items: [
      { key: "negotiator", title: "AI Supplier Negotiator", url: "/tools/sourcing", icon: Handshake },
      { key: "offer_analyzer", title: "Supplier Offer Analyzer", url: "/tools/sourcing", icon: FileSearch },
      { key: "legitimacy", title: "Legitimacy Detector", url: "/tools/sourcing", icon: ShieldQuestion },
      { key: "spec_sheet", title: "Review ➔ Spec Sheet", url: "/tools/sourcing", icon: ClipboardList },
    ],
  },
  {
    id: "finance", key: "g_finance", label: "Financial & Cost Engine", emoji: "💰", icon: Coins,
    items: [
      { key: "reverse_cost", title: "Reverse Cost Engineer", url: "/tools/finance", icon: Calculator },
      { key: "landed_cost", title: "Landed Cost Calculator", url: "/tools/finance", icon: Ship },
      { key: "capital_planner", title: "Minimum Capital Planner", url: "/tools/finance", icon: Wallet },
      { key: "desi", title: "Packaging & Desi Optimizer", url: "/tools/finance", icon: Boxes },
      { key: "milestone", title: "Milestone Shield", url: "/tools/finance", icon: ShieldCheck },
    ],
  },
  {
    id: "growth", key: "g_growth", label: "Growth & Market AI", emoji: "🚀", icon: Rocket,
    items: [
      { key: "consensus", title: "Multi-AI Consensus Score", url: "/tools/growth", icon: Gauge },
      { key: "bundle", title: "Bundle & AOV Booster", url: "/tools/growth", icon: PackagePlus },
      { key: "lead_time", title: "Lead-Time Countdown", url: "/tools/growth", icon: CalendarClock },
      { key: "arbitrage", title: "Arbitrage Matrix", url: "/tools/growth", icon: Globe2 },
      { key: "ad_hooks", title: "Ad Hook Extractor", url: "/tools/growth", icon: Megaphone },
    ],
  },
  {
    id: "compliance", key: "g_compliance", label: "Compliance & Legal Guard", emoji: "🛡️", icon: ShieldHalf,
    items: [
      { key: "cease_desist", title: "Hijacker Cease & Desist", url: "/tools/compliance", icon: Gavel },
      { key: "returns", title: "Return Mitigation Card", url: "/tools/compliance", icon: QrCode },
      { key: "hs_code", title: "HS Code & Tariff Radar", url: "/tools/compliance", icon: Barcode },
      { key: "lab_test", title: "Lab Test Budgeter", url: "/tools/compliance", icon: FlaskConical },
    ],
  },
  {
    id: "council", key: "g_council", label: "AI Konsey", emoji: "🧠", icon: Gauge,
    items: [{ key: "council", title: "14'lü AI Konsey", url: "/council", icon: Gauge }],
  },
  {
    id: "radar", key: "g_radar", label: "Trend Radar", emoji: "📡", icon: Radar,
    items: [{ key: "trend_radar", title: "Multi-Platform Trend Radar", url: "/trend-radar", icon: Radar }],
  },
  {
    id: "growth_suite", key: "g_growth_suite", label: "Büyüme Suite", emoji: "📈", icon: Rocket,
    items: [
      { key: "win_radar", title: "Kazanan Ürün Radarı", url: "/radar", icon: Radar },
      { key: "roi_panel", title: "Kâr / ROI Paneli", url: "/roi", icon: Wallet },
      { key: "store_audit", title: "AI Mağaza Denetçisi", url: "/audit", icon: ShieldCheck },
      { key: "creative_studio", title: "Reklam Kreatif Stüdyosu", url: "/studio", icon: Megaphone },
    ],
  },
  {
    id: "news", key: "g_news", label: "E-Com News Explainer", emoji: "📰", icon: Newspaper,
    items: [{ key: "news", title: "News & AI Explainer", url: "/news", icon: Target }],
  },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { locked, isPaid, isAdmin, canUse, level } = useEntitlements();
  const [showPricing, setShowPricing] = useState(false);

  const renderItem = (item: Item, tooltip: string, iconOnly: boolean, isActive: boolean, groupId: string) => {
    const need = requiredPlanFor(groupId);
    const isLocked = locked || !canUse(groupId);
    if (isLocked) {
      return (
        <SidebarMenuButton tooltip={`${tooltip} — ${need.label} paketi gerekli`} isActive={false} onClick={() => setShowPricing(true)}>
          <item.icon className="h-4 w-4 text-muted-foreground/60" />
          {!iconOnly && (
            <span className="flex flex-1 items-center justify-between gap-2 text-xs text-muted-foreground/70">
              {tooltip}
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
                <Lock className="h-2.5 w-2.5" /> {need.label}
              </span>
            </span>
          )}
        </SidebarMenuButton>
      );
    }
    return (
      <SidebarMenuButton asChild tooltip={tooltip} isActive={isActive}>
        <Link to={item.url} className="hover:bg-white/5">
          <item.icon className="h-4 w-4 text-[var(--accent-active)]" />
          {!iconOnly && <span className="text-xs">{tooltip}</span>}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-white/10">
      <SidebarContent className="pt-4">
        {!collapsed && (isPaid || isAdmin) && (
          <div className="px-3 pb-1 text-[10px] text-emerald-300">
            🔓 {isAdmin ? "Admin — tüm modüller açık" : level >= 3 ? "Business — tüm modüller açık" : level === 2 ? "Pro — 6 modül açık" : "Starter — 3 modül açık"}
          </div>
        )}
        {GROUPS.map((g) => (
          <SidebarGroup key={g.id}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                {g.emoji} {t(`nav.${g.key}`, { defaultValue: g.label })}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {collapsed ? (
                  <SidebarMenuItem>
                    {renderItem(
                      { ...g.items[0], icon: g.icon },
                      t(`nav.${g.key}`, { defaultValue: g.label }),
                      true,
                      pathname === g.items[0].url,
                      g.id,
                    )}
                  </SidebarMenuItem>
                ) : (
                  g.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      {renderItem(
                        item,
                        t(`nav.${item.key}`, { defaultValue: item.title }),
                        false,
                        pathname === item.url,
                        g.id,
                      )}
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <PricingModal open={showPricing} onClose={() => setShowPricing(false)} />
    </Sidebar>
  );
}

