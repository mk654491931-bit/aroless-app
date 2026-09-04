import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { useEntitlements, FREE_ITEMS } from "@/hooks/use-entitlements";
import {
  Package,
  Coins,
  Rocket,
  Newspaper,
  Handshake,
  FileSearch,
  ShieldQuestion,
  ClipboardList,
  Calculator,
  Ship,
  Wallet,
  Boxes,
  ShieldCheck,
  Gauge,
  PackagePlus,
  CalendarClock,
  Globe2,
  Megaphone,
  Tags,
  ImagePlus,
  MessageSquareHeart,
  LineChart,
  Target,
  Radar,
  LayoutDashboard,
  Scale,
  Bell,
  FileText,
  Lock,
} from "lucide-react";

type Item = {
  key: string;
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
};

const GROUPS: {
  id: string;
  key: string;
  label: string;
  emoji: string;
  icon: typeof Package;
  items: Item[];
}[] = [
  {
    id: "library",
    key: "g_library",
    label: "Library",
    emoji: "📚",
    icon: LayoutDashboard,
    items: [
      { key: "product_finder", title: "Ürün Bulucu", url: "/", icon: Target },
      { key: "dashboard", title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { key: "command_center", title: "Command Center", url: "/command-center", icon: Radar },

      { key: "compare", title: "Compare Products", url: "/compare", icon: Scale },
      { key: "notifications", title: "Notifications", url: "/notifications", icon: Bell },
    ],
  },
  {
    id: "sourcing",
    key: "g_sourcing",
    label: "Sourcing & Factory Hub",
    emoji: "📦",
    icon: Package,
    items: [
      {
        key: "negotiator",
        title: "AI Supplier Negotiator",
        url: "/tools/sourcing",
        icon: Handshake,
      },
      {
        key: "offer_analyzer",
        title: "Supplier Offer Analyzer",
        url: "/tools/sourcing",
        icon: FileSearch,
      },
      {
        key: "legitimacy",
        title: "Legitimacy Detector",
        url: "/tools/sourcing",
        icon: ShieldQuestion,
      },
      {
        key: "spec_sheet",
        title: "Review ➔ Spec Sheet",
        url: "/tools/sourcing",
        icon: ClipboardList,
      },
    ],
  },
  {
    id: "finance",
    key: "g_finance",
    label: "Financial & Cost Engine",
    emoji: "💰",
    icon: Coins,
    items: [
      {
        key: "reverse_cost",
        title: "Reverse Cost Engineer",
        url: "/tools/finance",
        icon: Calculator,
      },
      { key: "landed_cost", title: "Landed Cost Calculator", url: "/tools/finance", icon: Ship },
      {
        key: "capital_planner",
        title: "Minimum Capital Planner",
        url: "/tools/finance",
        icon: Wallet,
      },
      { key: "desi", title: "Packaging & Desi Optimizer", url: "/tools/finance", icon: Boxes },
      { key: "milestone", title: "Milestone Shield", url: "/tools/finance", icon: ShieldCheck },
    ],
  },
  {
    id: "growth",
    key: "g_growth",
    label: "Growth & Market AI",
    emoji: "🚀",
    icon: Rocket,
    items: [
      { key: "consensus", title: "Multi-AI Consensus Score", url: "/tools/growth", icon: Gauge },
      { key: "bundle", title: "Bundle & AOV Booster", url: "/tools/growth", icon: PackagePlus },
      { key: "lead_time", title: "Lead-Time Countdown", url: "/tools/growth", icon: CalendarClock },
      { key: "arbitrage", title: "Arbitrage Matrix", url: "/tools/growth", icon: Globe2 },
      { key: "ad_hooks", title: "Ad Hook Extractor", url: "/tools/growth", icon: Megaphone },
    ],
  },
  {
    id: "listing",
    key: "g_listing",
    label: "Listing & Conversion Studio",
    emoji: "📝",
    icon: FileText,
    items: [
      { key: "listing_seo", title: "Listing SEO Optimizer", url: "/tools/listing", icon: Tags },
      { key: "listing_visual", title: "Görsel & A+ Brief", url: "/tools/listing", icon: ImagePlus },
      {
        key: "review_sentiment",
        title: "Yorum Sentiment Radarı",
        url: "/tools/listing",
        icon: MessageSquareHeart,
      },
      {
        key: "price_strategy",
        title: "Fiyat & Buy Box Stratejisi",
        url: "/tools/listing",
        icon: LineChart,
      },
    ],
  },
  {
    id: "council",
    key: "g_council",
    label: "AI Konsey",
    emoji: "🧠",
    icon: Gauge,
    items: [{ key: "council", title: "14'lü AI Konsey", url: "/council", icon: Gauge }],
  },
  {
    id: "radar",
    key: "g_radar",
    label: "Trend Radar",
    emoji: "📡",
    icon: Radar,
    items: [
      { key: "trend_radar", title: "Multi-Platform Trend Radar", url: "/trend-radar", icon: Radar },
    ],
  },
  {
    id: "growth_suite",
    key: "g_growth_suite",
    label: "Büyüme Suite",
    emoji: "📈",
    icon: Rocket,
    items: [
      { key: "win_radar", title: "Kazanan Ürün Radarı", url: "/radar", icon: Radar },
      { key: "roi_panel", title: "Kâr / ROI Paneli", url: "/roi", icon: Wallet },
      { key: "store_audit", title: "AI Mağaza Denetçisi", url: "/audit", icon: ShieldCheck },
      { key: "creative_studio", title: "Reklam Kreatif Stüdyosu", url: "/studio", icon: Megaphone },
    ],
  },
  {
    id: "news",
    key: "g_news",
    label: "E-Com News Explainer",
    emoji: "📰",
    icon: Newspaper,
    items: [{ key: "news", title: "News & AI Explainer", url: "/news", icon: Target }],
  },
  {
    id: "partner",
    key: "g_partner",
    label: "Affiliate Programı",
    emoji: "🤝",
    icon: Handshake,
    items: [
      {
        key: "partner_dashboard",
        title: "Partner Dashboard",
        url: "/partner",
        icon: Handshake,
      },
    ],
  },
];

export function AppSidebar({ onUpgrade }: { onUpgrade: () => void }) {
  const { t } = useTranslation();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const iconOnly = collapsed && !isMobile;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isPaid, isAdmin, quota } = useEntitlements();

  const unlocked = isPaid || isAdmin;
  const itemLocked = (item: Item) => !unlocked && !FREE_ITEMS.includes(item.key);

  const renderItem = (item: Item, tooltip: string, iconOnly: boolean, isActive: boolean) => {
    if (itemLocked(item)) {
      return (
        <SidebarMenuButton
          tooltip={`${tooltip} — PRO`}
          onClick={() => {
            setOpenMobile(false);
            onUpgrade();
          }}
          className="opacity-60 hover:opacity-100"
        >
          <item.icon className="h-4 w-4 text-muted-foreground" />
          {!iconOnly && (
            <span className="flex w-full items-center justify-between gap-2 text-xs">
              <span className="truncate">{tooltip}</span>
              <Lock className="h-3 w-3 shrink-0 text-amber-300" />
            </span>
          )}
        </SidebarMenuButton>
      );
    }
    return (
      <SidebarMenuButton asChild tooltip={tooltip} isActive={isActive}>
        <Link to={item.url} className="hover:bg-white/5">
          <item.icon className="h-4 w-4 text-accent-active" />
          {!iconOnly && <span className="text-xs">{tooltip}</span>}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-white/10">
      <SidebarContent className="pt-4">
        <Link to="/" className="mx-3 mb-3 flex items-center gap-2">
          <img
            src="/logo-mark.png"
            alt="Aroless"
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 object-contain"
          />
          {!iconOnly && (
            <span className="text-[13px] font-light uppercase tracking-[0.3em] text-foreground">
              Aroless
            </span>
          )}
        </Link>
        {!iconOnly && !isPaid && !isAdmin && (
          <button
            onClick={() => {
              setOpenMobile(false);
              onUpgrade();
            }}
            className="mx-3 mb-2 rounded-xl border border-(--accent-active)/30 bg-(--accent-active)/10 px-3 py-2 text-left text-[10px] font-semibold text-accent-active"
          >
            🔒 Ücretsiz plan: tek seferlik 2 hoş geldin kredisi · sadece Ürün Bulucu · PRO ile 14'lü
            AI Konsey ve tüm modüller
          </button>
        )}
        {!iconOnly && (isPaid || isAdmin) && (
          <div className="px-3 pb-1 text-[10px] text-emerald-300">
            🔓 Tüm modüller açık{isAdmin ? " · Admin" : ` · ${quota.toolRuns} araç çalıştırma / ay`}
          </div>
        )}
        {GROUPS.map((g) => (
          <SidebarGroup key={g.id}>
            {!iconOnly && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                {g.emoji} {t(`nav.${g.key}`, { defaultValue: g.label })}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {iconOnly ? (
                  <SidebarMenuItem>
                    {renderItem(
                      { ...g.items[0], icon: g.icon },
                      t(`nav.${g.key}`, { defaultValue: g.label }),
                      true,
                      pathname === g.items[0].url,
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
                      )}
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
