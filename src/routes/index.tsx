import { ArolessCover } from "@/components/velora-cover";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  Sparkles,
  LogOut,
  Coins,
  TrendingUp,
  Users,
  Megaphone,
  Zap,
  Loader2,
  Store,
  Wallet,
  Wand2,
  Film,
  Bookmark,
  Shield,
  GraduationCap,
  Target,
  ShieldCheck,
  AlertTriangle,
  Gamepad2,
  SlidersHorizontal,
  ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FinderIntroCard, NoResultsCard, SearchErrorCard, SearchProgress } from "@/components/search-states";
import { useAuth } from "@/hooks/use-auth";
import {
  getProfile,
  generateSeoKit,
  generateCreativeScripts,
  listFavorites,
  saveFavorite,
  deleteFavorite,
  PLATFORMS,
  BUDGETS,
  type WinningProduct,
  type Platform,
  type Budget,
  type ValidationReport,
} from "@/lib/gemini.functions";
import { validateProduct } from "@/lib/gemini.functions";
import {
  AcademyTab,
  AnalysisPipelineModal,
  ConsensusReportModal,
  DraggableCopilot,
  HotTicker,
  PredictiveTrendsTab,
  ProductDeepDiveModal,
  ReportModal,
  TrainingSection,
} from "@/components/lazy-panels";
import { checkIsAdmin } from "@/lib/admin.functions";
import { PricingModal } from "@/components/pricing-modal";
import { CountryInfoBox } from "@/components/country-info-box";
import { LanguageSwitcher } from "@/components/language-switcher";
import { enrichProduct } from "@/lib/recommendation";
import { CurrencyProvider } from "@/lib/currency";
import { PLATFORM_LOGO } from "@/lib/platform-logos";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Settings as SettingsIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LockedPanel } from "@/components/upgrade-gate";
import { CreditCost } from "@/components/credit-cost";
import { creditBalances, creditBreakdownLabel, type CreditProfile } from "@/lib/credits";
import { AdvancedFilters, DEFAULT_FILTERS, applyFilters, type FinderFilters } from "@/components/advanced-filters";
import { RejectedPanel, type RejectedCandidate } from "@/components/winner-score-panel";
import { TARGET_COUNTRIES, DEFAULT_TARGET_COUNTRY, countryName } from "@/lib/countries";
import { countryFit, fitLabel, commissionRange, shipDays, recommendedPlatforms } from "@/lib/platform-market";
import { CountryCurrencyBadge } from "@/components/country-flag";
import { DataSourcesButton } from "@/components/header-extras";
import { HYBRID_DEFAULT_MIN_SCORE } from "@/lib/consensus-types";
import { Globe, Gauge, Swords, Cpu, ChevronDown } from "lucide-react";
import { CompareTray, CompareModal } from "@/components/compare-tray";
import { AmbientBackdrop, GlobalRippleLayer, BiometricButton } from "@/components/premium-fx";
import { ENGINES, engineLabel, type EngineId, type MarketplaceId } from "@/lib/engines";
import { EtaBadge } from "@/components/eta-badge";
import { FinderMemoryBar, useRecentSearches, usePersistentState } from "@/components/finder-extras";
import { FinderInsights, FilterPresets } from "@/components/finder-insights";
import { DeepSearchPanel, DEFAULT_DEEP_SEARCH, type DeepSearchOptions } from "@/components/deep-search-panel";
import { X as XIcon } from "lucide-react";
import { MarketingLanding } from "@/components/marketing-landing";
import { OnboardingWizard, ActivationChecklist, useOnboarding, sanitizeOnboardingResult } from "@/components/onboarding-wizard";
import { claimReferral } from "@/lib/referral.functions";

// Finder feature modules
import { FINDER_EXAMPLE_NICHES, type Tab } from "@/features/finder/constants";
import { useFinderSearch } from "@/features/finder/hooks/use-finder-search";
import { TabSwitcher } from "@/features/finder/components/tab-switcher";
import { FxBadge } from "@/features/finder/components/fx-badge";
import { RotatingSlogan } from "@/features/finder/components/rotating-slogan";
import { ResultsToolbar } from "@/features/finder/components/results-toolbar";
import { ProductCard } from "@/features/finder/components/product-card";
import { SeoTab, CreativeTab, LibraryTab } from "@/features/finder/components/finder-tabs";
import { sortProducts, type SortKey } from "@/features/finder/utils/sorting";
import { requestRun } from "@/features/finder/utils/seo-creative-bridge";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Aroless — Winning Product Finder" },
      {
        name: "description",
        content: "Discover real trending e-commerce products with supplier prices, profit margins, viral scripts, and Shopify-ready exports.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const getProfileFn = useServerFn(getProfile);
  const seoFn = useServerFn(generateSeoKit);
  const scriptsFn = useServerFn(generateCreativeScripts);
  const listFavFn = useServerFn(listFavorites);
  const saveFavFn = useServerFn(saveFavorite);
  const delFavFn = useServerFn(deleteFavorite);

  const [tab, setTab] = useState<Tab>("finder");
  const [niche, setNiche] = useState("");
  const [nicheFocus, setNicheFocus] = useState(false);
  const [validatorFocus, setValidatorFocus] = useState(false);
  const [category, setCategory] = usePersistentState<string>("aroless.finder.category", "Any");
  const [audience, setAudience] = usePersistentState<string>("aroless.finder.audience", "");
  const [platforms, setPlatforms] = usePersistentState<Platform[]>("aroless.finder.platforms", ["Shopify", "TikTok Shop"]);
  const [budget, setBudget] = usePersistentState<Budget>("aroless.finder.budget", "$500 - $2,000");
  const marketplace: MarketplaceId = platforms.some((p) => p === "Trendyol" || p === "Hepsiburada") ? "turkey" : "global";
  const [targetCountry, setTargetCountry] = usePersistentState<string>("aroless.finder.country", DEFAULT_TARGET_COUNTRY);
  const effectiveCountry = marketplace === "turkey" ? "TR" : targetCountry;
  const blockedSelected = platforms.filter((p) => countryFit(p, effectiveCountry) === "unavailable");
  const [recoOpen, setRecoOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [minScore, setMinScore] = usePersistentState<number>("aroless.finder.min_score", HYBRID_DEFAULT_MIN_SCORE);
  const [engine, setEngine] = usePersistentState<EngineId>("aroless.finder.engine", "default");
  const [useGithubTrends, setUseGithubTrends] = usePersistentState<boolean>("aroless.finder.github_trends", true);
  const [deepSearch, setDeepSearch] = usePersistentState<DeepSearchOptions>("aroless.finder.deep_search", DEFAULT_DEEP_SEARCH);
  const advancedSelectionCount = [
    category !== "Any",
    audience.trim().length > 0,
    engine !== "default",
    platforms.length !== 2 || !platforms.includes("Shopify") || !platforms.includes("TikTok Shop"),
    minScore !== HYBRID_DEFAULT_MIN_SCORE,
    !useGithubTrends,
    JSON.stringify(deepSearch) !== JSON.stringify(DEFAULT_DEEP_SEARCH),
  ].filter(Boolean).length;

  const { recent, push: pushRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches();
  const nicheInputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<WinningProduct[]>([]);
  const [rejected, setRejected] = useState<RejectedCandidate[]>([]);
  const [sortBy, setSortBy] = usePersistentState<SortKey>("aroless.finder.sort", "winner");
  const [sortDesc, setSortDesc] = useState(true);
  const [resultQuery, setResultQuery] = useState("");
  const [onlyLaunch, setOnlyLaunch] = useState(false);
  const [band, setBand] = usePersistentState<
    "all" | "high" | "lowcomp" | "margin" | "saved" | "verified" | "rising" | "winner" | "shippable"
  >("aroless.finder.band", "all");
  const [filters, setFilters] = useState<FinderFilters>(DEFAULT_FILTERS);
  const [compareNames, setCompareNames] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const toggleCompare = (name: string) =>
    setCompareNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length >= 4 ? prev : [...prev, name]));
  const compareProducts = results.filter((p) => compareNames.includes(p.name));

  useEffect(() => {
    if (typeof document === "undefined") return;
    const active = document.querySelector<HTMLElement>('.chip-rail [data-active="true"]');
    const rail = active?.closest<HTMLElement>(".chip-rail");
    if (!active || !rail || rail.scrollWidth <= rail.clientWidth) return;
    const railRect = rail.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const toRight = itemRect.right - railRect.right;
    const toLeft = railRect.left - itemRect.left;
    if (toRight > 4) rail.scrollTo({ left: rail.scrollLeft + toRight + 16, behavior: "smooth" });
    else if (toLeft > 4) rail.scrollTo({ left: rail.scrollLeft - toLeft - 16, behavior: "smooth" });
  }, [band, sortBy, onlyLaunch, compareNames.length]);

  const [showJumpToSearch, setShowJumpToSearch] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const field = nicheInputRef.current;
      if (field) setShowJumpToSearch(field.getBoundingClientRect().bottom < 72);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jumpToSearch = useCallback(() => {
    const field = nicheInputRef.current;
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus({ preventScroll: true });
  }, []);

  const [showPricing, setShowPricing] = useState(false);
  const [reportProduct, setReportProduct] = useState<WinningProduct | null>(null);
  const [deepDiveProduct, setDeepDiveProduct] = useState<WinningProduct | null>(null);
  const [validatorQuery, setValidatorQuery] = useState("");
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const validateFn = useServerFn(validateProduct);
  const validateMut = useMutation({
    mutationFn: (query: string) => validateFn({ data: { query, platforms } }),
    onSuccess: (res) => {
      setValidationReport(res.report);
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("NO_CREDITS")) setShowPricing(true);
      else toast.error(e.message);
    },
  });

  const onboarding = useOnboarding();
  const claimReferralFn = useServerFn(claimReferral);

  useEffect(() => {
    if (!user) return;
    let code: string | null = null;
    try {
      code = window.localStorage.getItem("aroless.ref") ?? window.localStorage.getItem("velora.ref");
      if (code) {
        // dual-read migrasyon: yeniye taşı
        try { window.localStorage.setItem("aroless.ref", code); } catch {}
        try { window.localStorage.removeItem("velora.ref"); } catch {}
      }
    } catch {
      code = null;
    }
    if (!code) return;
    try {
      window.localStorage.removeItem("aroless.ref");
      window.localStorage.removeItem("velora.ref");
    } catch {
      /* yoksay */
    }
    claimReferralFn({ data: { code } })
      .then((res) => {
        if (res.ok) {
          toast.success(`Davet bonusu eklendi · +${res.credits} kredi`);
          qc.invalidateQueries({ queryKey: ["profile"] });
        }
      })
      .catch(() => {});
  }, [user, claimReferralFn, qc]);

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => getProfileFn(),
    enabled: !!user,
    // Jeton rozeti: harcama işçide (arka planda) olabildiği için bayat sayı
    // göstermemeliyiz — eskiden 2 dakika eski değer görünüyordu.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const favsQ = useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: () => listFavFn(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const checkAdminFn = useServerFn(checkIsAdmin);
  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => checkAdminFn(),
    enabled: !!user,
    staleTime: 10 * 60_000,
  });
  const isAdmin = !!adminQ.data?.isAdmin;
  /**
   * Harcanabilir jeton = finder_credits + credits (tek kaynak: `creditBalances`).
   * Eskiden yalnızca `credits` okunuyordu; ürün bulucu ise ÖNCE finder_credits'i
   * harcadığı için ücretsiz kullanıcının rozeti hiç eksilmiyor gibi görünüyor,
   * hatta arama "kredin bitti" diye engelleniyordu.
   */
  const balances = creditBalances(profileQ.data as CreditProfile | undefined);

  const togglePlatform = useCallback((p: Platform) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }, [setPlatforms]);

  const { searching, fallbackNotice, searchError, searchAttempt, stalled, runSearch } = useFinderSearch({
    platforms,
    effectiveCountry,
    engine,
    t,
    profileCredits: balances.total,
    profileIsSuccess: profileQ.isSuccess,
    niche,
    category,
    audience,
    budget,
    targetCountry,
    minScore,
    marketplace,
    lang: i18n.language ?? "en",
    useGithubTrends,
    deepSearch,
    pushRecent,
    onNeedUpgrade: () => setShowPricing(true),
    onResults: (products, rej, fallback) => {
      setResults(products);
      setRejected(rej);
      if (fallback) {
        // fallbackNotice handled inside hook as well; mirror here for UI
      }
    },
    onClearResults: () => {
      setResults([]);
      setRejected([]);
    },
  });

  // Keep fallbackNotice in sync — useFinderSearch owns it, mirror local if needed
  // Actually use the hook's fallbackNotice directly.

  const saveMut = useMutation({
    mutationFn: (p: WinningProduct) => saveFavFn({ data: { name: p.name, collection_name: "Default", product: p } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      toast.success("Saved to library");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFavFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      toast.success("Removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(niche, setResultQuery);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== "finder") return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (combo || (e.key === "/" && !typing)) {
        e.preventDefault();
        nicheInputRef.current?.focus();
        nicheInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!user) return <MarketingLanding />;

  const credits = balances.total;
  const creditBreakdown = creditBreakdownLabel(balances);
  const tier = profileQ.data?.subscription_tier ?? "Free";
  const isPaidTier = ["starter", "pro", "business", "enterprise"].includes(String(tier).toLowerCase());
  const locked = !isAdmin && !isPaidTier;
  const favorites = favsQ.data ?? [];
  const favoriteNames = new Set(favorites.map((f) => f.name));
  const tabDefs: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
    { id: "finder", label: t("ui.tab_finder"), icon: TrendingUp },
    { id: "trends", label: `🔮 ${t("ui.tab_trends")}`, icon: Sparkles },
    { id: "seo", label: t("ui.tab_seo"), icon: Wand2 },
    { id: "creative", label: t("ui.tab_creative"), icon: Film },
    { id: "library", label: t("ui.tab_library"), icon: Bookmark },
    { id: "training", label: t("ui.tab_training"), icon: Gamepad2 },
    { id: "academy", label: t("ui.tab_academy"), icon: GraduationCap },
  ];
  const etaMs = engineLabel(engine).etaMs;

  return (
    <CurrencyProvider country={targetCountry}>
      <div className="relative min-h-screen">
        <AmbientBackdrop />
        <GlobalRippleLayer />
        <HotTicker />
        <header className="relative z-40 border-b border-white/10 glass top-light sticky top-0 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px divider-glow opacity-70" />
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="shrink-0">
              <BrandLogo subtitle="Winning Product Intelligence" />
            </div>
            <div className="header-actions flex min-w-0 flex-1 items-center gap-2 overflow-x-auto md:flex-wrap md:justify-end md:overflow-visible">
              <span className="morph-pill rounded-lg inline-flex">
                <DataSourcesButton />
              </span>
              <span
                title={`Active engine: ${engineLabel(engine).model}`}
                className={`hidden lg:inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  engine === "default"
                    ? "border-white/15 bg-white/5 text-muted-foreground"
                    : "border-[oklch(0.62_0.17_255)]/50 bg-[oklch(0.62_0.17_255)]/15 text-[oklch(0.86_0.10_255)] glow"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${engine === "default" ? "bg-emerald-400" : "bg-[oklch(0.72_0.14_255)]"} animate-pulse-soft`} />
                <Cpu size={11} className="opacity-80" />
                {engineLabel(engine).label}
              </span>
              <FxBadge />
              <div
                className="morph-pill heartbeat hidden md:flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5"
                title={`Harcanabilir jeton: ${balances.total} — ${creditBreakdownLabel(balances)}`}
              >
                <Coins size={14} className="morph-icon text-[oklch(0.85_0.18_90)]" />
                <span className="text-sm font-semibold">{credits}</span>
                <span className="text-xs text-muted-foreground">{t("credits")}</span>
              </div>
              <div className="morph-pill heartbeat hidden md:inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
                <Zap size={12} className="morph-icon" /> {tier}
              </div>
              <span className="morph-pill heartbeat rounded-lg inline-flex">
                <LanguageSwitcher />
              </span>
              <Link
                to="/dashboard"
                className="morph-pill heartbeat inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs shrink-0"
                title={t("dashboard")}
              >
                <LayoutDashboard size={13} className="morph-icon" />
              </Link>
              <Link
                to="/settings"
                className="morph-pill heartbeat inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs shrink-0"
                title={t("settings")}
              >
                <SettingsIcon size={13} className="morph-icon" />
              </Link>
              <Link
                to="/competitor-analysis"
                search={{ q: undefined, country: targetCountry }}
                className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs shrink-0"
                title="Rakip Analizi"
              >
                <Swords size={13} className="morph-icon" />
              </Link>
              <Link
                to="/viral-ads"
                className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs shrink-0"
                title="Viral Ads"
              >
                <Megaphone size={13} className="morph-icon" />
              </Link>
              <button
                onClick={() => setShowPricing(true)}
                className="morph-pill shrink-0 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-1.5 text-xs font-semibold glow"
              >
                {t("upgrade")}
              </button>
              {isAdmin && (
                <Link
                  to="/admin"
                  className="morph-pill heartbeat hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[oklch(0.62_0.17_255)]/50 bg-[oklch(0.62_0.17_255)]/10 px-3 py-1.5 text-xs font-semibold shrink-0"
                  title="Admin Dashboard"
                >
                  <Shield size={13} className="morph-icon" /> {t("admin")}
                </Link>
              )}
              <button
                onClick={async () => {
                  await qc.cancelQueries();
                  qc.clear();
                  await supabase.auth.signOut();
                  nav({ to: "/auth", replace: true });
                }}
                className="morph-pill heartbeat p-2 rounded-lg"
                aria-label="Sign out"
              >
                <LogOut size={16} className="morph-icon" />
              </button>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent md:hidden" />
        </header>

        {onboarding.needsOnboarding && (
          <OnboardingWizard
            onSkip={onboarding.skip}
            onComplete={(raw) => {
              let r: { country: string; platform: string; category: string; budget: string };
              try {
                r = sanitizeOnboardingResult(raw);
              } catch (err) {
                console.error("Onboarding sonucu doğrulanamadı:", err);
                toast.error("Onboarding kaydedilemedi. Lütfen tekrar dene.");
                return;
              }
              try {
                setTargetCountry(r.country);
                setCategory(r.category);
                setBudget(r.budget as Budget);
                setPlatforms([r.platform as Platform]);
                onboarding.complete(r);
                setTab("finder");
                setTimeout(() => nicheInputRef.current?.focus(), 200);
                toast.success("Hazır! Nişini yaz ve motoru çalıştır.");
              } catch (err) {
                console.error("Onboarding tamamlanırken hata:", err);
                toast.error("Onboarding kaydedilemedi. Lütfen tekrar dene.");
              }
            }}
          />
        )}

        <main className="relative z-10 max-w-7xl mx-auto px-4 py-8">
          <ArolessCover className="mb-6" />
          <div className="mb-4">
            <ActivationChecklist
              items={[
                {
                  label: "İlk aramanı yap",
                  done: results.length > 0,
                  action: () => {
                    setTab("finder");
                    nicheInputRef.current?.focus();
                  },
                },
                {
                  label: "Bir ürünü favorilere ekle",
                  done: favorites.length > 0,
                  action: () => setTab("finder"),
                },
                {
                  label: "Simülatörde bir sezon oyna",
                  done: false,
                  action: () => setTab("training"),
                },
              ]}
            />
          </div>
          <div className="laptop-shell grain px-3 py-6 md:px-8 md:py-10">
            <TabSwitcher tabDefs={tabDefs} tab={tab} onTab={setTab} favoritesCount={favorites.length} />
            <div key={tab} className="surface-morph">
              {tab === "finder" && (
                <>
                  <div className="relative text-center mb-10">
                    <div className="finder-hero-halo pointer-events-none absolute inset-x-0 -top-16 mx-auto h-56 w-[min(680px,90%)] rounded-full bg-[radial-gradient(closest-side,oklch(0.68_0.20_265/0.28),transparent)] blur-2xl md:animate-float-slow motion-reduce:animate-none" />
                    <div className="relative animate-rise-in">
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
                        {t("ui.live_research")}
                      </span>
                      <h1 className="mt-5 text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
                        {t("hero_1")} <span className="text-aurora">{t("hero_2")}</span>
                      </h1>
                      <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">{t("ui.hero_sub2")}</p>
                      <RotatingSlogan />
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
                        {[t("ui.f1"), t("ui.f2"), t("ui.f3"), t("ui.f4")].map((f) => (
                          <span key={f} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur">
                            <ShieldCheck size={11} className="text-emerald-400" /> {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <form onSubmit={onSubmit} className="finder-form premium-card grain relative mx-auto max-w-5xl space-y-4 rounded-2xl p-5 md:p-7">
                    <div className="grid gap-3">
                      <div className="flex items-center gap-2">
                        <div className={`light-wave relative flex-1 ${nicheFocus ? "is-focused" : ""}`}>
                          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--accent-active)]" />
                          <input
                            ref={nicheInputRef}
                            value={niche}
                            onChange={(e) => setNiche(e.target.value)}
                            onFocus={() => setNicheFocus(true)}
                            onBlur={() => setNicheFocus(false)}
                            placeholder={t("niche_placeholder")}
                            className="relative z-10 w-full rounded-lg bg-white/5 pl-9 pr-16 py-2.5 text-sm outline-none border-0"
                          />
                          {niche ? (
                            <button
                              type="button"
                              aria-label="Temizle"
                              onClick={() => {
                                setNiche("");
                                nicheInputRef.current?.focus();
                              }}
                              className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                            >
                              <XIcon size={12} />
                            </button>
                          ) : (
                            <kbd className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">/</kbd>
                          )}
                          {nicheFocus && (
                            <span aria-hidden className="field-particles">
                              {[12, 28, 44, 60, 76, 90].map((l, i) => (
                                <i key={l} style={{ left: `${l}%`, animationDelay: `${i * 0.18}s` }} />
                              ))}
                            </span>
                          )}
                        </div>
                        <BiometricButton active={nicheFocus} />
                      </div>
                    </div>

                    <div className="finder-primary-grid grid gap-3 md:grid-cols-[1fr_1.35fr]">
                      <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                        <label className="mb-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Globe size={12} /> Target market
                          </span>
                          <CountryCurrencyBadge code={targetCountry} />
                        </label>
                        <select
                          value={targetCountry}
                          onChange={(e) => setTargetCountry(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-[oklch(0.62_0.17_255)]"
                        >
                          {TARGET_COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code} className="bg-[oklch(0.20_0.035_255)]">
                              {c.flag} {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                        <label className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                          <Wallet size={12} /> Starting capital
                        </label>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          {BUDGETS.map((b) => {
                            const on = budget === b;
                            return (
                              <button
                                type="button"
                                key={b}
                                onClick={() => setBudget(b)}
                                className={`rounded-lg border px-2.5 py-2 text-center text-xs transition ${
                                  on
                                    ? "border-[oklch(0.62_0.17_255)] bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 text-foreground shadow-[0_0_18px_-8px_color-mix(in_oklab,var(--brand)_80%,transparent)]"
                                    : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/25 hover:text-foreground"
                                }`}
                              >
                                {b}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="finder-advanced-toggle flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5">
                      <button
                        type="button"
                        aria-expanded={advancedOpen}
                        aria-controls="finder-advanced-filters"
                        onClick={() => setAdvancedOpen((open) => !open)}
                        className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-foreground transition hover:bg-white/10"
                      >
                        <SlidersHorizontal size={15} className="text-[var(--accent-active)]" />
                        Advanced filters
                        {advancedSelectionCount > 0 && (
                          <span className="rounded-full border border-[oklch(0.62_0.17_255)]/45 bg-[oklch(0.62_0.17_255)]/15 px-1.5 py-0.5 text-[10px] text-[oklch(0.86_0.10_255)]">
                            {advancedSelectionCount} active
                          </span>
                        )}
                        {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="text-[11px] text-muted-foreground">AI, platforms, audience and research depth</span>
                    </div>

                    {advancedOpen && (
                      <div
                        id="finder-advanced-filters"
                        className="finder-advanced-panel scroll-mt-24 animate-rise-in space-y-4 rounded-2xl border border-white/10 bg-black/10 p-3 sm:p-4 motion-reduce:animate-none"
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                              <Target size={12} /> Product category
                            </label>
                            <select
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-[oklch(0.62_0.17_255)]"
                            >
                              {["Any", "Beauty", "Fitness", "Home", "Tech", "Pets", "Fashion", "Kids", "Outdoor", "Kitchen"].map((c) => (
                                <option key={c} className="bg-[oklch(0.20_0.035_255)]">
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                              <Users size={12} /> Audience
                            </label>
                            <input
                              value={audience}
                              onChange={(e) => setAudience(e.target.value)}
                              placeholder={t("audience_placeholder")}
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-[oklch(0.62_0.17_255)]"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 backdrop-blur">
                          <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                            <Cpu size={12} className="text-[var(--accent-active)]" /> {t("ui.engine")}
                          </label>
                          <div role="group" aria-label={t("ui.engine")} className="flex flex-wrap items-center gap-1.5">
                            {ENGINES.map((e) => {
                              const on = engine === e.id;
                              return (
                                <button
                                  key={e.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => setEngine(e.id)}
                                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                    on
                                      ? "border-[oklch(0.62_0.17_255)] bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 text-foreground shadow-[0_0_14px_-4px_color-mix(in_oklab,var(--brand)_85%,transparent)]"
                                      : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                                  }`}
                                >
                                  {on && <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.72_0.14_255)] animate-pulse-soft" />}
                                  {e.label}
                                </button>
                              );
                            })}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{engineLabel(engine).hint}</span>
                          {engine !== "default" && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.62_0.17_255)]/45 bg-[oklch(0.62_0.17_255)]/12 px-2.5 py-1 text-[10px] font-semibold text-[oklch(0.86_0.10_255)] glow">
                              <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.72_0.14_255)] animate-pulse-soft" />
                              {engine === "hybrid" ? t("ui.hybrid_pill") : t("ui.hf_free")}
                            </span>
                          )}
                          <EtaBadge running={searching} etaMs={etaMs} />
                        </div>

                        <div>
                          <label className="flex items-center justify-between gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                            <span className="flex items-center gap-1.5">
                              <Store size={12} /> {t("sales_platforms")}
                            </span>
                            <span className="relative">
                              <button
                                type="button"
                                onClick={() => setRecoOpen((v) => !v)}
                                className="normal-case tracking-normal text-[11px] inline-flex items-center gap-1 rounded-full border border-[oklch(0.62_0.17_255)]/45 bg-[oklch(0.62_0.17_255)]/12 px-2.5 py-1 text-[oklch(0.86_0.10_255)] hover:bg-[oklch(0.62_0.17_255)]/22"
                              >
                                {countryName(effectiveCountry)} için öner
                                <ChevronDown size={11} className={recoOpen ? "rotate-180 transition" : "transition"} />
                              </button>
                              {recoOpen && (
                                <>
                                  <span className="fixed inset-0 z-30" onClick={() => setRecoOpen(false)} />
                                  <div className="absolute right-0 z-40 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-white/10 bg-[oklch(0.20_0.035_255)] p-1 shadow-2xl">
                                    {TARGET_COUNTRIES.map((c) => (
                                      <button
                                        key={c.code}
                                        type="button"
                                        onClick={() => {
                                          setTargetCountry(c.code);
                                          setPlatforms(recommendedPlatforms(c.code));
                                          setRecoOpen(false);
                                        }}
                                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs normal-case tracking-normal hover:bg-white/10 ${c.code === effectiveCountry ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
                                      >
                                        <span>{c.flag}</span>
                                        <span className="truncate">{c.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </span>
                          </label>
                          <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3 md:grid-cols-4">
                            {PLATFORMS.map((p) => {
                              const on = platforms.includes(p);
                              const fit = countryFit(p, effectiveCountry);
                              const blocked = fit === "unavailable";
                              const [c1, c2] = commissionRange(p, effectiveCountry);
                              const [d1, d2] = shipDays(p, effectiveCountry);
                              return (
                                <button
                                  type="button"
                                  key={p}
                                  onClick={() => togglePlatform(p)}
                                  title={`${fitLabel(fit)} · komisyon %${c1}-%${c2} · teslimat ${d1}-${d2} gün`}
                                  className={`w-full min-w-0 justify-center text-xs pl-1.5 pr-2.5 py-1.5 rounded-full border transition inline-flex items-center gap-1.5 ${
                                    on
                                      ? blocked
                                        ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                                        : "border-[oklch(0.62_0.17_255)] bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 text-foreground shadow-[0_0_18px_-6px_color-mix(in_oklab,var(--brand)_70%,transparent)]"
                                      : blocked
                                        ? "border-white/5 bg-white/[0.02] text-muted-foreground/50 line-through"
                                        : fit === "native"
                                          ? "border-emerald-400/30 bg-emerald-400/[0.07] text-muted-foreground hover:text-foreground hover:border-emerald-400/60"
                                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:border-white/25"
                                  }`}
                                >
                                  <img
                                    src={PLATFORM_LOGO[p]}
                                    alt=""
                                    loading="lazy"
                                    className="h-5 w-5 shrink-0 rounded-full bg-white/90 p-0.5 object-contain"
                                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                                  />
                                  <span className="min-w-0 truncate">{p}</span>
                                  {fit === "native" && <span className="chip-fit-badge border-emerald-400/25 bg-emerald-400/10 text-emerald-300">yerel</span>}
                                  {fit === "cross-border" && (
                                    <span className="chip-fit-badge border-sky-400/25 bg-sky-400/10 text-sky-300">sınır ötesi</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          {blockedSelected.length > 0 && (
                            <p className="mt-2 text-[11px] text-amber-300/90">
                              {blockedSelected.join(", ")} — {countryName(effectiveCountry)} pazarında satış yapılamıyor. Sonuçlar bu kanallara göre
                              optimize edilmez.
                            </p>
                          )}
                        </div>

                        <div className="grid gap-4">
                          <div>
                            <label className="flex items-center justify-between gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                              <span className="flex items-center gap-1.5">
                                <Gauge size={12} /> Minimum AI Skoru
                              </span>
                              <span className="text-foreground font-semibold normal-case tracking-normal">{minScore}</span>
                            </label>
                            <div className="range-shell relative mt-1.5">
                              <input
                                type="range"
                                min={50}
                                max={90}
                                step={5}
                                value={minScore}
                                onChange={(e) => setMinScore(Number(e.target.value))}
                                className="range-fill w-full"
                                style={{ "--range-pct": `${((minScore - 50) / (90 - 50)) * 100}%` } as React.CSSProperties}
                              />
                              <span aria-hidden className="range-tooltip">
                                {minScore}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">Hibrit skor = Pazar talebi (%55) + Kâr & lojistik (%45)</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <input
                            id="use-github-trends"
                            type="checkbox"
                            checked={useGithubTrends}
                            onChange={(e) => setUseGithubTrends(e.target.checked)}
                            className="h-4 w-4 accent-[oklch(0.62_0.17_255)]"
                          />
                          <label htmlFor="use-github-trends" className="flex-1 text-sm cursor-pointer">
                            <span className="font-medium">Include GitHub repo trends</span>
                            <p className="text-[11px] text-muted-foreground">Adds public open-source repository momentum as an extra signal (free, rate-limit safe).</p>
                          </label>
                        </div>

                        <DeepSearchPanel value={deepSearch} onChange={setDeepSearch} onReset={() => setDeepSearch(DEFAULT_DEEP_SEARCH)} />
                        <CountryInfoBox code={targetCountry} niche={niche} />
                      </div>
                    )}

                    <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CreditCost amount={1} />
                        Bu arama 1 kredi harcar · bakiyeniz <span className="font-semibold text-foreground">{credits}</span>{" "}
                        <span className="text-[11px] text-muted-foreground/70">
                          ({creditBreakdown})
                        </span>
                      </p>
                      <button
                        type="submit"
                        disabled={searching}
                        aria-busy={searching}
                        className="cta-sweep press relative flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_35px_-14px_color-mix(in_oklab,var(--brand)_90%,transparent)] glow transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-14px_color-mix(in_oklab,var(--brand)_95%,transparent)] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                      >
                        {searching ? (
                          <>
                            <Loader2 size={16} className="animate-spin" /> Analyzing…
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} /> Find Winners
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {showJumpToSearch && (
                    <button
                      type="button"
                      onClick={jumpToSearch}
                      aria-label="Arama alanına dön"
                      className={`jump-search press fixed z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-gradient-to-br from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] text-white shadow-[0_18px_40px_-14px_color-mix(in_oklab,var(--brand)_95%,transparent)] lg:hidden ${compareProducts.length > 0 ? "with-tray" : ""}`}
                    >
                      <Search size={18} />
                    </button>
                  )}

                  <FinderMemoryBar recent={recent} onPick={(q) => { setNiche(q); if (!searching) runSearch(q, setResultQuery); }} onRemove={removeRecent} onClear={clearRecent} />

                  <section className="mt-10">
                    <div className="premium-card grain rounded-2xl p-5 max-w-5xl mx-auto mb-8">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <ShieldCheck size={15} className="text-emerald-400" />
                        <h2 className="text-sm font-semibold">Validate My Product — “Will it sell?”</h2>
                        <CreditCost amount={1} />
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Paste a product link, product name or niche. Our 3-agent engine (Market Scan → Product Finder → Risk Audit) returns a
                        Dual-Gemini Consensus Report. Uses 1 credit.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const q = validatorQuery.trim();
                          if (q.length < 2) return toast.error("Enter a product link, name or niche.");
                          validateMut.mutate(q);
                        }}
                        className="flex flex-col sm:flex-row gap-2"
                      >
                        <div className="flex flex-1 items-center gap-2">
                          <div className={`light-wave relative flex-1 ${validatorFocus ? "is-focused" : ""}`}>
                            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--accent-active)]" />
                            <input
                              value={validatorQuery}
                              onChange={(e) => setValidatorQuery(e.target.value)}
                              onFocus={() => setValidatorFocus(true)}
                              onBlur={() => setValidatorFocus(false)}
                              placeholder={t("ui.validate_placeholder")}
                              className="relative z-10 w-full rounded-lg bg-white/5 pl-9 pr-24 py-2.5 text-sm outline-none border-0"
                            />
                            {validatorFocus && (
                              <span aria-hidden className="field-particles">
                                {[14, 32, 50, 68, 86].map((l, i) => (
                                  <i key={l} style={{ left: `${l}%`, animationDelay: `${i * 0.2}s` }} />
                                ))}
                              </span>
                            )}
                          </div>
                          <BiometricButton active={validatorFocus} />
                        </div>
                        <button
                          type="submit"
                          disabled={validateMut.isPending}
                          className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          {validateMut.isPending ? (
                            <>
                              <Loader2 size={16} className="animate-spin" /> Agents debating…
                            </>
                          ) : (
                            <>
                              <ShieldCheck size={16} /> Validate
                            </>
                          )}
                        </button>
                      </form>
                    </div>

                    {!searching && fallbackNotice && results.length > 0 && (
                      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>{fallbackNotice}</span>
                      </div>
                    )}
                    {searching && !stalled && <SearchProgress label="AI motorları analiz ediyor — bu 15-30 saniye sürebilir…" />}
                    {!searching && searchError && results.length === 0 && (
                      <SearchErrorCard error={searchError} onRetry={() => runSearch(searchError.niche ?? niche, setResultQuery)} onEdit={jumpToSearch} />
                    )}
                    {!searching && !searchError && searchAttempt && results.length === 0 && (
                      <NoResultsCard niche={searchAttempt} onRetry={() => runSearch(searchAttempt, setResultQuery)} onEdit={jumpToSearch} />
                    )}
                    {!searching && !searchError && !searchAttempt && results.length === 0 && (
                      <FinderIntroCard
                        examples={FINDER_EXAMPLE_NICHES as unknown as string[]}
                        onExample={(ex) => {
                          setNiche(ex);
                          runSearch(ex, setResultQuery);
                        }}
                      />
                    )}
                    {!searching &&
                      results.length > 0 &&
                      (() => {
                        const q = resultQuery.trim().toLowerCase();
                        const bandPass = (p: WinningProduct) => {
                          if (band === "winner") return (p.winner_score ?? 0) >= 70;
                          if (band === "high") return enrichProduct(p).ai_score >= 80;
                          if (band === "lowcomp") return p.competition_level === "Low";
                          if (band === "margin") return (p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0) >= 40;
                          if (band === "saved") return favoriteNames.has(p.name);
                          if (band === "verified") return p.evidence_level === "verified" || (p.realism_score ?? 0) >= 75;
                          if (band === "rising") return (p.market_evidence?.trend_momentum_pct ?? 0) > 0;
                          if (band === "shippable") return (p.score_breakdown?.components.find((c) => c.key === "logistics")?.score ?? 0) >= 70;
                          return true;
                        };
                        const filtered = applyFilters(results, filters)
                          .filter(bandPass)
                          .filter(
                            (p) =>
                              !q ||
                              [p.name, p.description, p.target_audience, ...(p.platform_fit ?? [])]
                                .filter(Boolean)
                                .some((v) => String(v).toLowerCase().includes(q)),
                          );
                        const shown = sortProducts(filtered, sortBy, onlyLaunch, sortDesc);
                        const bands = [
                          { id: "all", label: `Tümü (${results.length})` },
                          { id: "winner", label: `Winner 70+ (${results.filter((p) => (p.winner_score ?? 0) >= 70).length})` },
                          { id: "high", label: "80+ AI skoru" },
                          { id: "lowcomp", label: "Düşük rekabet" },
                          { id: "margin", label: "Marj %40+" },
                          { id: "saved", label: "Kaydedilenler" },
                          { id: "verified", label: `Doğrulanmış (${results.filter((p) => p.evidence_level === "verified" || (p.realism_score ?? 0) >= 75).length})` },
                          { id: "rising", label: "Canlı yükselişte" },
                          { id: "shippable", label: "Kargoya uygun" },
                        ] as const;
                        return (
                          <>
                            <FinderInsights products={filtered} />
                            <AdvancedFilters products={results} filters={filters} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} />
                            <FilterPresets
                              current={{ filters, band, sortBy, sortDesc, onlyLaunch }}
                              onApply={(s) => {
                                setFilters(s.filters);
                                setBand(s.band as typeof band);
                                setSortBy(s.sortBy as SortKey);
                                setSortDesc(s.sortDesc);
                                setOnlyLaunch(s.onlyLaunch);
                              }}
                            />
                            <div className="chip-rail mb-3 flex flex-wrap gap-1.5">
                              {bands.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => setBand(b.id as typeof band)}
                                  data-active={band === b.id}
                                  className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium transition sm:min-h-0 ${
                                    band === b.id
                                      ? "border-[oklch(0.62_0.17_255)]/60 bg-[oklch(0.62_0.17_255)]/15 text-[oklch(0.78_0.13_255)]"
                                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {b.label}
                                </button>
                              ))}
                            </div>
                            <ResultsToolbar
                              products={filtered}
                              sortBy={sortBy}
                              onSortBy={setSortBy}
                              onlyLaunch={onlyLaunch}
                              onToggleLaunch={() => setOnlyLaunch((v) => !v)}
                              sortDesc={sortDesc}
                              onToggleDir={() => setSortDesc((v) => !v)}
                              query={resultQuery}
                              onQuery={setResultQuery}
                              niche={niche}
                              country={targetCountry}
                            />
                            {shown.length === 0 && (
                              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                                <AlertTriangle size={14} className="shrink-0" />
                                <span>Analiz {results.length} ürün buldu ama aktif filtreler hepsini gizliyor.</span>
                                <button
                                  onClick={() => {
                                    setFilters(DEFAULT_FILTERS);
                                    setOnlyLaunch(false);
                                  }}
                                  className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-semibold hover:bg-amber-400/20"
                                >
                                  Filtreleri sıfırla
                                </button>
                              </div>
                            )}
                            <div className="grid grid-cols-1 min-[430px]:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                              {shown.map((p, i) => (
                                <ProductCard
                                  key={i}
                                  p={p}
                                  selected={compareNames.includes(p.name)}
                                  onToggleSelect={() => toggleCompare(p.name)}
                                  saved={favoriteNames.has(p.name)}
                                  onSave={() => saveMut.mutate(p)}
                                  onSeo={(name) => {
                                    setTab("seo");
                                    requestRun("seo", name);
                                  }}
                                  onCreative={(name) => {
                                    setTab("creative");
                                    requestRun("creative", name);
                                  }}
                                  onReport={() => setReportProduct(p)}
                                  onOpen={() => setDeepDiveProduct(p)}
                                  locked={false}
                                  onUpgrade={() => setShowPricing(true)}
                                />
                              ))}
                            </div>
                            <RejectedPanel items={rejected} />
                            {compareProducts.length > 0 && <div aria-hidden className="h-24 sm:h-20" />}
                            <CompareTray
                              products={compareProducts}
                              onRemove={(n) => setCompareNames((prev) => prev.filter((x) => x !== n))}
                              onClear={() => setCompareNames([])}
                              onOpen={() => setCompareOpen(true)}
                            />
                            {compareOpen && compareProducts.length >= 2 && (
                              <CompareModal
                                products={compareProducts}
                                onClose={() => setCompareOpen(false)}
                                onRemove={(n) => setCompareNames((prev) => prev.filter((x) => x !== n))}
                              />
                            )}
                          </>
                        );
                      })()}
                  </section>
                </>
              )}

              {tab === "trends" && (locked ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="Predictive Trends — Sadece abonelik alanlara özel" /> : <PredictiveTrendsTab country={targetCountry} />)}
              {tab === "seo" && (locked ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="SEO Kit — Sadece abonelik alanlara özel" /> : <SeoTab seoFn={seoFn} onOutOfCredits={() => setShowPricing(true)} qc={qc} />)}
              {tab === "creative" && (locked ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="Creative Studio — Sadece abonelik alanlara özel" /> : <CreativeTab scriptsFn={scriptsFn} onOutOfCredits={() => setShowPricing(true)} qc={qc} />)}
              {tab === "library" && (locked ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="Library — Sadece abonelik alanlara özel" /> : <LibraryTab favorites={favorites} loading={favsQ.isLoading} onDelete={(id) => delMut.mutate(id)} onSeo={(name) => { setTab("seo"); requestRun("seo", name); }} onCreative={(name) => { setTab("creative"); requestRun("creative", name); }} />)}

              {tab === "training" && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                    <CreditCost kind="free" />
                    Simülatör ve alıştırmalar her pakette açıktır. Yalnızca AI destekli tam simülasyon başlatma
                    <CreditCost kind="sim" amount={1} className="mx-1" /> kullanır; Quick Drill kredi harcamaz.
                  </div>
                  <TrainingSection onUpgrade={() => setShowPricing(true)} catalog={[...results, ...favorites.map((f) => f.product).filter((p) => !results.some((r) => r.name === p.name))]} />
                </>
              )}
              {tab === "academy" && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                    <CreditCost kind="free" /> 21 günlük eğitim programı her üyeliğe dahildir — kredi harcamaz.
                  </div>
                  <AcademyTab />
                </>
              )}
            </div>
          </div>
          <div className="laptop-base" />
        </main>

        <PricingModal open={showPricing} onClose={() => setShowPricing(false)} />
        <AnalysisPipelineModal open={searching} done={!searching} etaMs={etaMs} engine={engineLabel(engine).model} />
        <ReportModal product={reportProduct} onClose={() => setReportProduct(null)} />
        <ProductDeepDiveModal product={deepDiveProduct} onClose={() => setDeepDiveProduct(null)} onSendToSimulator={() => setTab("training")} />
        <DraggableCopilot context={`Dashboard · sekme: ${tab} · niş: ${niche} · ülke: ${targetCountry}`} />
        <ConsensusReportModal report={validationReport} onClose={() => setValidationReport(null)} />
      </div>
    </CurrencyProvider>
  );
}
