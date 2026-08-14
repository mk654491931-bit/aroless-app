import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search, Sparkles, LogOut, Coins, TrendingUp, Users, Megaphone, DollarSign, Zap, Loader2,
  Store, Wallet, ExternalLink, Percent, Package, Wand2, Copy, Check, Film, Heart, HeartOff,
  Download, Bookmark, Truck, Receipt, Shield, Flame, Activity, GraduationCap,
  Target, ShieldCheck, AlertTriangle, Gamepad2, Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeUnitEconomics, parseMoney, MIN_NET_MARGIN_PCT } from "@/lib/unit-economics";

import { useAuth } from "@/hooks/use-auth";
import {
  generateProducts, getProfile, generateSeoKit, generateCreativeScripts,
  listFavorites, saveFavorite, deleteFavorite,
  PLATFORMS, BUDGETS,
  type WinningProduct, type Platform, type Budget, type SeoKit,
  type CreativeScript, type FavoriteRow, type ValidationReport,
} from "@/lib/gemini.functions";
import { validateProduct } from "@/lib/gemini.functions";
import { ConsensusBadge, ConsensusReportModal } from "@/components/consensus-report";
import { checkIsAdmin } from "@/lib/admin.functions";
import { PricingModal } from "@/components/pricing-modal";
import { AnalysisPipelineModal } from "@/components/analysis-pipeline-modal";
import { ReportModal } from "@/components/report-modal";
import { ProductDeepDive } from "@/components/product-deep-dive";
import { ProductDeepDiveModal } from "@/components/product-deep-dive-modal";
import { CountryInfoBox } from "@/components/country-info-box";
import { DraggableCopilot } from "@/components/draggable-copilot";
import { BuyerSimulation } from "@/components/buyer-simulation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { enrichProduct, recommendationStyle, formatCurrency, reliabilityStyle } from "@/lib/recommendation";
import { CurrencyProvider, useMoney } from "@/lib/currency";
import { checkConsistency, buyersPer1000, conversionTone, type Issue } from "@/lib/consistency";
import { PLATFORM_LOGO, logoForStore } from "@/lib/platform-logos";
import { saveAnalysis } from "@/lib/analysis.functions";
import { insertProductsFromAnalysis } from "@/lib/products.functions";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Settings as SettingsIcon, FileText } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { AcademyTab } from "@/components/academy-tab";
import { LockedPanel, UnlockedBadge } from "@/components/upgrade-gate";
import { CreditCost } from "@/components/credit-cost";

import { TrainingSection } from "@/components/training-section";
import { AdvancedFilters, DEFAULT_FILTERS, applyFilters, type FinderFilters } from "@/components/advanced-filters";
import { RejectedPanel, WinnerBadge, WinnerScorePanel, type RejectedCandidate } from "@/components/winner-score-panel";
import { attachWinnerScores } from "@/lib/winner-score";

import { HotTicker } from "@/components/hot-ticker";
import { PredictiveTrendsTab } from "@/components/predictive-trends-tab";
import { ApiKeyBadge, DataSourcesButton } from "@/components/header-extras";
import { TARGET_COUNTRIES, DEFAULT_TARGET_COUNTRY, countryName } from "@/lib/countries";
import { CountryFlag, CountryCurrencyBadge } from "@/components/country-flag";
import { HYBRID_DEFAULT_MIN_SCORE, hybridBadge } from "@/lib/consensus-types";
import { Globe, Gauge, Swords, Radar, Cpu } from "lucide-react";
import {
  AmbientBackdrop, GlobalRippleLayer, BiometricButton,
} from "@/components/premium-fx";
import { huggingFaceSearch } from "@/lib/hf.functions";
import { ENGINES, engineLabel, storedHfToken, type EngineId, type MarketplaceId } from "@/lib/engines";
import { EtaBadge } from "@/components/eta-badge";
import { FinderMemoryBar, useRecentSearches, usePersistentState } from "@/components/finder-extras";
import { DeepSearchPanel, DEFAULT_DEEP_SEARCH, type DeepSearchOptions } from "@/components/deep-search-panel";
import { MarketEvidencePanel, RealismBadge } from "@/components/market-evidence-panel";

import { ArrowDownWideNarrow, ArrowUpWideNarrow, FileJson, X as XIcon } from "lucide-react";



export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Velora — Winning Product Finder" },
      { name: "description", content: "Discover real trending e-commerce products with supplier prices, profit margins, viral scripts, and Shopify-ready exports." },
    ],
  }),
  component: Dashboard,
});

type Tab = "finder" | "trends" | "seo" | "creative" | "library" | "training" | "academy";

function Dashboard() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const getProfileFn = useServerFn(getProfile);
  const generateFn = useServerFn(generateProducts);
  const seoFn = useServerFn(generateSeoKit);
  const scriptsFn = useServerFn(generateCreativeScripts);
  const listFavFn = useServerFn(listFavorites);
  const saveFavFn = useServerFn(saveFavorite);
  const delFavFn = useServerFn(deleteFavorite);
  const saveAnalysisFn = useServerFn(saveAnalysis);

  const [tab, setTab] = useState<Tab>("finder");
  const [niche, setNiche] = useState("");
  const [nicheFocus, setNicheFocus] = useState(false);
  const [validatorFocus, setValidatorFocus] = useState(false);
  const [category, setCategory] = usePersistentState<string>("velora.finder.category", "Any");
  const [audience, setAudience] = usePersistentState<string>("velora.finder.audience", "");
  const [platforms, setPlatforms] = usePersistentState<Platform[]>("velora.finder.platforms", ["Shopify", "TikTok Shop"]);
  const [budget, setBudget] = usePersistentState<Budget>("velora.finder.budget", "$500 - $2,000");
  const marketplace: MarketplaceId = platforms.some((p) => p === "Trendyol" || p === "Hepsiburada") ? "turkey" : "global";
  const [targetCountry, setTargetCountry] = usePersistentState<string>("velora.finder.country", DEFAULT_TARGET_COUNTRY);
  const [minScore, setMinScore] = usePersistentState<number>("velora.finder.min_score", HYBRID_DEFAULT_MIN_SCORE);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [engine, setEngine] = usePersistentState<EngineId>("velora.finder.engine", "default");
  const [useGithubTrends, setUseGithubTrends] = usePersistentState<boolean>("velora.finder.github_trends", true);
  const [deepSearch, setDeepSearch] = usePersistentState<DeepSearchOptions>("velora.finder.deep_search", DEFAULT_DEEP_SEARCH);
  const { recent, push: pushRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches();
  const nicheInputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<WinningProduct[]>([]);
  const [rejected, setRejected] = useState<RejectedCandidate[]>([]);
  const [sortBy, setSortBy] = usePersistentState<SortKey>("velora.finder.sort", "winner");
  const [sortDesc, setSortDesc] = useState(true);
  const [resultQuery, setResultQuery] = useState("");
  const [onlyLaunch, setOnlyLaunch] = useState(false);
  const [band, setBand] = usePersistentState<"all" | "high" | "lowcomp" | "margin" | "saved" | "verified" | "rising" | "winner" | "shippable">("velora.finder.band", "all");


  const [filters, setFilters] = useState<FinderFilters>(DEFAULT_FILTERS);

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

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const profileQ = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => getProfileFn(),
    enabled: !!user,
  });

  const favsQ = useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: () => listFavFn(),
    enabled: !!user,
  });

  const checkAdminFn = useServerFn(checkIsAdmin);
  const adminQ = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: () => checkAdminFn(),
    enabled: !!user,
  });
  const isAdmin = !!adminQ.data?.isAdmin || (user?.email?.toLowerCase() === "omnic.111111@gmail.com");

  const insertProductsFn = useServerFn(insertProductsFromAnalysis);

  const gen = useMutation({
    mutationFn: (vars: { niche: string; category: string; audience: string; platforms: Platform[]; budget: Budget; target_country: string; min_score: number; marketplace: MarketplaceId; lang: string; use_github_trends: boolean } & DeepSearchOptions) =>
      generateFn({ data: vars }),
    onSuccess: (res, vars) => {
      const scored = attachWinnerScores(res.products);
      setResults(scored);
      setRejected((res as { rejected?: RejectedCandidate[] }).rejected ?? []);
      setFallbackNotice(res.fallback?.message ?? null);
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(`${res.products.length} winning products generated!`);

      // fire-and-forget history save
      saveAnalysisFn({ data: { search_query: `${vars.niche} · ${vars.category} · ${vars.budget}`, results: res.products } }).catch(() => {});
      // persist products for reliability tracking & viral scoring
      insertProductsFn({ data: { products: res.products, target_country: vars.target_country } }).catch(() => {});
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits — upgrade to keep going.");
        setShowPricing(true);
      } else toast.error(err.message);
    },
  });

  const hfFn = useServerFn(huggingFaceSearch);
  const hfGen = useMutation({
    mutationFn: (vars: { engine: "qwen" | "llama" | "hybrid" }) =>
      hfFn({
        data: {
          niche, category, audience, platforms, budget,
          target_country: marketplace === "turkey" ? "TR" : targetCountry,
          marketplace,
          lang: (i18n.language?.slice(0, 2) ?? "en") as "en" | "tr",
          engine: vars.engine,
          token: storedHfToken(),
        },
      }),
    onSuccess: (res) => {
      setResults(res.products);
      setFallbackNotice(null);
      qc.invalidateQueries({ queryKey: ["profile"] });
      if (res.products.length === 0) toast.error("Hugging Face returned no products — try another niche.");
      else toast.success(`${res.products.length} products from ${res.model}`);
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) { toast.error("Out of credits — upgrade to keep going."); setShowPricing(true); return; }
      toast.error(
        err.message.includes("HF_TOKEN_MISSING")
          ? "Hugging Face token missing — add HF_TOKEN in Settings."
          : err.message,
      );
    },
  });

  const saveMut = useMutation({
    mutationFn: (p: WinningProduct) => saveFavFn({ data: { name: p.name, collection_name: "Default", product: p } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["favorites"] }); toast.success("Saved to library"); },
    onError: (err: Error) => toast.error(err.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFavFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["favorites"] }); toast.success("Removed"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const searching = gen.isPending || hfGen.isPending;

  const runSearch = (nicheValue: string) => {
    if (!nicheValue.trim()) return toast.error(t("ui.enter_niche"));
    if (platforms.length === 0) return toast.error(t("ui.select_platform"));
    if ((profileQ.data?.credits ?? 0) <= 0) { setShowPricing(true); return; }
    pushRecent(nicheValue);
    setResultQuery("");
    if (engine !== "default") { hfGen.mutate({ engine }); return; }
    gen.mutate({
      niche: nicheValue, category, audience, platforms, budget,
      target_country: marketplace === "turkey" ? "TR" : targetCountry,
      min_score: minScore,
      marketplace,
      lang: (i18n.language?.slice(0, 2) ?? "en"),
      use_github_trends: useGithubTrends,
      ...deepSearch,
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(niche);
  };

  // "/" or Cmd/Ctrl+K focuses the niche field from anywhere in the finder.
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


  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  const credits = profileQ.data?.credits ?? 0;
  const tier = profileQ.data?.subscription_tier ?? "Free";
  const isPaidTier = ["starter", "pro", "business", "enterprise"].includes(String(tier).toLowerCase());
  // Free (non-admin) accounts: product search only — everything else is locked.
  const locked = !isAdmin && !isPaidTier;

  const favorites = favsQ.data ?? [];
  const favoriteNames = new Set(favorites.map(f => f.name));

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
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <BrandLogo subtitle="Winning Product Intelligence" />

          <div className="flex items-center gap-2">
            <span className="morph-pill rounded-lg inline-flex"><DataSourcesButton /></span>
            <span
              title={`Active engine: ${engineLabel(engine).model}`}
              className={`hidden lg:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                engine === "default"
                  ? "border-white/15 bg-white/5 text-muted-foreground"
                  : "border-[oklch(0.68_0.20_265)]/50 bg-[oklch(0.68_0.20_265)]/15 text-[oklch(0.86_0.10_265)] glow"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${engine === "default" ? "bg-emerald-400" : "bg-[oklch(0.78_0.20_305)]"} animate-pulse-soft`} />
              <Cpu size={11} className="opacity-80" />
              {engineLabel(engine).label}
            </span>
            <ApiKeyBadge />
            <FxBadge />
            <div className="morph-pill heartbeat hidden sm:flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5">
              <Coins size={14} className="morph-icon text-[oklch(0.85_0.18_90)]" />
              <span className="text-sm font-semibold">{credits}</span>
              <span className="text-xs text-muted-foreground">{t("credits")}</span>
            </div>
            <div className="morph-pill heartbeat hidden md:inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
              <Zap size={12} className="morph-icon" /> {tier}
            </div>
            <span className="morph-pill heartbeat rounded-lg inline-flex"><LanguageSwitcher /></span>
            <Link to="/dashboard" className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs" title={t("dashboard")}>
              <LayoutDashboard size={13} className="morph-icon" />
            </Link>
            <Link to="/settings" className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs" title={t("settings")}>
              <SettingsIcon size={13} className="morph-icon" />
            </Link>
            <Link to="/competitor-analysis" search={{ q: undefined, country: targetCountry }} className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs" title="Rakip Analizi">
              <Swords size={13} className="morph-icon" />
            </Link>
            <Link to="/viral-ads" className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs" title="Viral Ads">
              <Megaphone size={13} className="morph-icon" />
            </Link>
            <button onClick={() => setShowPricing(true)} className="morph-pill rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-1.5 text-xs font-semibold glow">
              {t("upgrade")}
            </button>
            {isAdmin && (
              <Link to="/admin" className="morph-pill heartbeat hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[oklch(0.68_0.20_265)]/50 bg-[oklch(0.68_0.20_265)]/10 px-3 py-1.5 text-xs font-semibold" title="Admin Dashboard">
                <Shield size={13} className="morph-icon" /> {t("admin")}
              </Link>
            )}
            <button onClick={async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); nav({ to: "/auth", replace: true }); }} className="morph-pill heartbeat p-2 rounded-lg" aria-label="Sign out">
              <LogOut size={16} className="morph-icon" />
            </button>
          </div>
        </div>
      </header>


      <main className="relative z-10 max-w-7xl mx-auto px-4 py-8">
       <div className="laptop-shell grain px-3 py-6 md:px-8 md:py-10">
        <TabSwitcher
          tabDefs={tabDefs}
          tab={tab}
          onTab={setTab}
          favoritesCount={favorites.length}
        />
       <div key={tab} className="surface-morph">



        {tab === "finder" && (
          <>
            <div className="relative text-center mb-10">
              <div className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-56 w-[min(680px,90%)] rounded-full bg-[radial-gradient(closest-side,oklch(0.68_0.20_265/0.28),transparent)] blur-2xl animate-float-slow" />
              <div className="relative animate-rise-in">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
                  {t("ui.live_research")}
                </span>
                <h1 className="mt-5 text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
                  {t("hero_1")}{" "}
                  <span className="text-aurora">{t("hero_2")}</span>
                </h1>
                <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
                  {t("ui.hero_sub2")}
                </p>
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

            <form onSubmit={onSubmit} className="premium-card grain relative rounded-2xl p-5 md:p-7 max-w-5xl mx-auto space-y-4">
              <div className="grid md:grid-cols-[1fr_180px_1fr] gap-3">
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
                        onClick={() => { setNiche(""); nicheInputRef.current?.focus(); }}
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

                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]">
                  {["Any", "Beauty", "Fitness", "Home", "Tech", "Pets", "Fashion", "Kids", "Outdoor", "Kitchen"].map(c => <option key={c} className="bg-[oklch(0.20_0.035_265)]">{c}</option>)}
                </select>
                <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={t("audience_placeholder")}
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]" />
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 backdrop-blur">
                <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <Cpu size={12} className="text-[var(--accent-active)]" /> {t("ui.engine")}
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as EngineId)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none transition focus:border-[oklch(0.68_0.20_265)] hover:bg-white/10"
                >
                  {ENGINES.map((e) => (
                    <option key={e.id} value={e.id} className="bg-[oklch(0.20_0.035_265)]">{e.label}</option>
                  ))}
                </select>

                <span className="text-[11px] text-muted-foreground">
                  {engineLabel(engine).hint}
                </span>

                {engine !== "default" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.68_0.20_265)]/45 bg-[oklch(0.68_0.20_265)]/12 px-2.5 py-1 text-[10px] font-semibold text-[oklch(0.86_0.10_265)] glow">
                    <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.78_0.20_305)] animate-pulse-soft" />
                    {engine === "hybrid" ? t("ui.hybrid_pill") : t("ui.hf_free")}
                  </span>
                )}
                <EtaBadge running={searching} etaMs={etaMs} />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2"><Store size={12} /> {t("sales_platforms")}</label>

                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const on = platforms.includes(p);
                    return (
                      <button type="button" key={p} onClick={() => togglePlatform(p)}
                        className={`text-xs pl-1.5 pr-3 py-1 rounded-full border transition inline-flex items-center gap-1.5 ${on ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"}`}>
                        <img src={PLATFORM_LOGO[p]} alt="" loading="lazy" className="h-5 w-5 rounded-full bg-white/90 p-0.5 object-contain" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                        <span>{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2"><Wallet size={12} /> Starting Capital</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {BUDGETS.map((b) => {
                    const on = budget === b;
                    return (
                      <button type="button" key={b} onClick={() => setBudget(b)}
                        className={`text-xs px-3 py-2 rounded-lg border text-center transition ${on ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"}`}>
                        {b}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center justify-between gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    <span className="flex items-center gap-1.5"><Globe size={12} /> Hedef Ülke</span>
                    <CountryCurrencyBadge code={targetCountry} />
                  </label>
                  <select
                    value={targetCountry}
                    onChange={(e) => setTargetCountry(e.target.value)}
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
                  >
                    {TARGET_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-[oklch(0.20_0.035_265)]">
                        {c.flag} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="flex items-center justify-between gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    <span className="flex items-center gap-1.5"><Gauge size={12} /> Minimum AI Skoru</span>
                    <span className="text-foreground font-semibold normal-case tracking-normal">{minScore}</span>
                  </label>
                  <input
                    type="range" min={50} max={90} step={5}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="w-full accent-[oklch(0.68_0.20_265)]"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Hibrit skor = Pazar talebi (%55) + Kâr &amp; lojistik (%45)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <input
                  id="use-github-trends"
                  type="checkbox"
                  checked={useGithubTrends}
                  onChange={(e) => setUseGithubTrends(e.target.checked)}
                  className="h-4 w-4 accent-[oklch(0.68_0.20_265)]"
                />
                <label htmlFor="use-github-trends" className="flex-1 text-sm cursor-pointer">
                  <span className="font-medium">Include GitHub repo trends</span>
                  <p className="text-[11px] text-muted-foreground">
                    Adds public open-source repository momentum as an extra signal (free, rate-limit safe).
                  </p>
                </label>
              </div>

              <DeepSearchPanel
                value={deepSearch}
                onChange={setDeepSearch}
                onReset={() => setDeepSearch(DEFAULT_DEEP_SEARCH)}
              />

              <CountryInfoBox code={targetCountry} niche={niche} />


              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CreditCost amount={1} />
                  Bu arama 1 kredi harcar · bakiyeniz <span className="font-semibold text-foreground">{credits}</span>
                </p>
                <button type="submit" disabled={searching}
                  className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 flex items-center justify-center gap-2 whitespace-nowrap">
                  {searching ? <><Loader2 size={16} className="animate-spin" /> Analyzing…</> : <><Sparkles size={16} /> Find Winners</>}
                </button>
              </div>
            </form>

            <FinderMemoryBar
              recent={recent}
              onPick={(q) => { setNiche(q); if (!searching) runSearch(q); }}
              onRemove={removeRecent}
              onClear={clearRecent}
            />



            <section className="mt-10">
              <div className="premium-card grain rounded-2xl p-5 max-w-5xl mx-auto mb-8">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <ShieldCheck size={15} className="text-emerald-400" />
                  <h2 className="text-sm font-semibold">Validate My Product — “Will it sell?”</h2>
                  <CreditCost amount={1} />
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Paste a product link, product name or niche. Our 3-agent engine (Market Scan → Product Finder → Risk Audit) returns a Dual-Gemini Consensus Report. Uses 1 credit.
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
                      <><Loader2 size={16} className="animate-spin" /> Agents debating…</>
                    ) : (
                      <><ShieldCheck size={16} /> Validate</>
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
              {searching && (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[0, 1, 2, 3, 4, 5].map((i) => (<div key={i} className="glass rounded-xl p-5 h-72 animate-pulse" />))}
                </div>
              )}
              {!searching && results.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-16">
                  <Sparkles className="mx-auto mb-3 text-[oklch(0.75_0.18_265)]" />
                  Platformunu ve bütçeni seç, ardından “Kazananları Bul”a bas.
                </div>
              )}
              {!searching && results.length > 0 && (() => {
                const q = resultQuery.trim().toLowerCase();
                const bandPass = (p: WinningProduct) => {
                  if (band === "high") return enrichProduct(p).ai_score >= 80;
                  if (band === "lowcomp") return p.competition_level === "Low";
                  if (band === "margin") return (p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0) >= 40;
                  if (band === "saved") return favoriteNames.has(p.name);
                  if (band === "verified") return (p.realism_score ?? 0) >= 75;
                  if (band === "rising") return (p.market_evidence?.trend_momentum_pct ?? 0) > 0;
                  return true;
                };

                const filtered = applyFilters(results, filters).filter(bandPass).filter((p) =>
                  !q ||
                  [p.name, p.description, p.target_audience, ...(p.platform_fit ?? [])]
                    .filter(Boolean)
                    .some((v) => String(v).toLowerCase().includes(q)),
                );
                const shown = sortProducts(filtered, sortBy, onlyLaunch, sortDesc);
                const bands = [
                  { id: "all", label: `Tümü (${results.length})` },
                  { id: "high", label: "80+ AI skoru" },
                  { id: "lowcomp", label: "Düşük rekabet" },
                  { id: "margin", label: "Marj %40+" },
                  { id: "saved", label: "Kaydedilenler" },
                  { id: "verified", label: `Doğrulanmış (${results.filter((p) => (p.realism_score ?? 0) >= 75).length})` },
                  { id: "rising", label: "Canlı yükselişte" },
                ] as const;


                return (
                <>
                <AdvancedFilters
                  products={results}
                  filters={filters}
                  onChange={setFilters}
                  onReset={() => setFilters(DEFAULT_FILTERS)}
                />
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {bands.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBand(b.id)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                        band === b.id
                          ? "border-[oklch(0.68_0.20_265)]/60 bg-[oklch(0.68_0.20_265)]/15 text-[oklch(0.85_0.15_265)]"
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
                    <span>
                      Analiz {results.length} ürün buldu ama aktif filtreler hepsini gizliyor.
                    </span>
                    <button
                      onClick={() => { setFilters(DEFAULT_FILTERS); setOnlyLaunch(false); }}
                      className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-semibold hover:bg-amber-400/20"
                    >
                      Filtreleri sıfırla
                    </button>
                  </div>
                )}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {shown.map((p, i) => (
                    <ProductCard
                      key={i} p={p}
                      saved={favoriteNames.has(p.name)}
                      onSave={() => saveMut.mutate(p)}
                      onSeo={(name) => { setTab("seo"); requestRun("seo", name); }}
                      onCreative={(name) => { setTab("creative"); requestRun("creative", name); }}
                      onReport={() => setReportProduct(p)}
                      onOpen={() => setDeepDiveProduct(p)}
                      locked={locked}
                      onUpgrade={() => setShowPricing(true)}


                    />
                  ))}
                </div>
                </>
                );
              })()}

            </section>
          </>
        )}

        {tab === "trends" && (
          locked
            ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="Predictive Trends — Sadece abonelik alanlara özel" />
            : <PredictiveTrendsTab country={targetCountry} />
        )}

        {tab === "seo" && (
          locked
            ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="SEO Kit — Sadece abonelik alanlara özel" />
            : <SeoTab seoFn={seoFn} onOutOfCredits={() => setShowPricing(true)} qc={qc} />
        )}

        {tab === "creative" && (
          locked
            ? <LockedPanel onUpgrade={() => setShowPricing(true)} title="Creative Studio — Sadece abonelik alanlara özel" />
            : <CreativeTab scriptsFn={scriptsFn} onOutOfCredits={() => setShowPricing(true)} qc={qc} />
        )}

        {tab === "library" && (
          locked ? (
            <LockedPanel onUpgrade={() => setShowPricing(true)} title="Library — Sadece abonelik alanlara özel" />
          ) : (
            <LibraryTab
              favorites={favorites}
              loading={favsQ.isLoading}
              onDelete={(id) => delMut.mutate(id)}
              onSeo={(name) => { setTab("seo"); requestRun("seo", name); }}
              onCreative={(name) => { setTab("creative"); requestRun("creative", name); }}
            />
          )
        )}

        {tab === "training" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
              <CreditCost kind="free" />
              Simülatör ve alıştırmalar her pakette açıktır. Yalnızca AI destekli tam simülasyon başlatma
              <CreditCost kind="sim" amount={1} className="mx-1" />
              kullanır; Quick Drill kredi harcamaz.
            </div>
            <TrainingSection
              onUpgrade={() => setShowPricing(true)}
              catalog={[
                ...results,
                ...favorites.map((f) => f.product).filter((p) => !results.some((r) => r.name === p.name)),
              ]}
            />
          </>
        )}


        {tab === "academy" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
              <CreditCost kind="free" />
              21 günlük eğitim programı her üyeliğe dahildir — kredi harcamaz.
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
      <ProductDeepDiveModal
        product={deepDiveProduct}
        onClose={() => setDeepDiveProduct(null)}
        onSendToSimulator={() => setTab("training")}
      />
      <DraggableCopilot context={`Dashboard · sekme: ${tab} · niş: ${niche} · ülke: ${targetCountry}`} />
      <ConsensusReportModal report={validationReport} onClose={() => setValidationReport(null)} />
    </div>
    </CurrencyProvider>
  );
}

/* Live FX badge — shows the active target-country currency and the USD rate. */
function FxBadge() {
  const { currency, rate, isLive, updated, fmt } = useMoney();
  if (currency === "USD") return null;
  return (
    <span
      title={`1 USD = ${rate.toFixed(2)} ${currency} · ${isLive ? `canlı kur (${updated})` : "yedek kur"}`}
      className="morph-pill heartbeat hidden md:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"} animate-pulse-soft`} />
      {currency} · {fmt(rate, currency)}/$
    </span>
  );
}



/* Liquid-mercury main menu switcher — the highlight morphs and flows between tabs. */
function TabSwitcher({
  tabDefs, tab, onTab, favoritesCount,
}: {
  tabDefs: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[];
  tab: Tab;
  onTab: (t: Tab) => void;
  favoritesCount: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number; top: number; height: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const el = btnRefs.current[tab];
      if (!wrap || !el) return;
      const w = wrap.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      setPill({ left: b.left - w.left, width: b.width, top: b.top - w.top, height: b.height });
    };
    measure();
    const id = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [tab, favoritesCount]);

  return (
    <div className="flex justify-center mb-6">
      <div ref={wrapRef} className="premium-card relative rounded-full p-1 inline-flex text-sm flex-wrap justify-center">
        {pill && (
          <span
            aria-hidden
            className="mercury-pill"
            style={{ left: pill.left, width: pill.width, top: pill.top, height: pill.height }}
          />
        )}
        {tabDefs.map((td) => {
          const Icon = td.icon;
          const on = tab === td.id;
          return (
            <button
              key={td.id}
              ref={(el) => { btnRefs.current[td.id] = el; }}
              role="tab"
              aria-selected={on}
              onClick={() => onTab(td.id)}
              className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full flex items-center gap-1.5 transition-colors duration-300 ${on ? "text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon size={14} /> {td.label}
              {td.id === "library" && favoritesCount > 0 && (
                <span className="ml-1 text-[10px] rounded-full bg-white/15 px-1.5 py-0.5">{favoritesCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// bridge from cards -> other tabs
const runRefs: {
  seo: ((name: string) => void) | null;
  creative: ((name: string) => void) | null;
} = { seo: null, creative: null };

function requestRun(target: "seo" | "creative", name: string) {
  setTimeout(() => runRefs[target]?.(name), 0);
}

function ProductCard({
  p, saved, onSave, onSeo, onCreative, onReport, onOpen: onOpenRaw, locked = false, onUpgrade = () => {},
}: {
  p: WinningProduct;
  saved: boolean;
  onSave: () => void;
  onSeo: (name: string) => void;
  onCreative: (name: string) => void;
  onReport: () => void;
  onOpen: () => void;
  locked?: boolean;
  onUpgrade?: () => void;
}) {
  // Standard accounts see the product identity + general info only; the full
  // intelligence suite (pricing, economics, deep dive, simulations) is premium.
  const onOpen = () => (locked ? onUpgrade() : onOpenRaw());


  const compColor = p.competition_level === "Low" ? "text-emerald-400" : p.competition_level === "Medium" ? "text-amber-400" : "text-rose-400";
  const cb = p.cost_breakdown;
  const enriched = enrichProduct(p);
  const { money, currency } = useMoney();
  const rec = recommendationStyle(enriched.recommendation);
  const realImg = useRealProductImage(p.name);
  const modelImg = resolveProductImage(p);
  return (
    <article className="premium-card grain card-lift rounded-xl p-5 hover:border-[oklch(0.68_0.20_265)]/50 hover:-translate-y-1 hover:shadow-[0_20px_60px_-20px_oklch(0.68_0.20_265/0.55)] border border-transparent flex flex-col animate-rise-in">
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
        className="mb-3 -mx-5 -mt-5 aspect-[4/3] overflow-hidden rounded-t-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border-b border-white/10 relative group cursor-pointer">
        {realImg || modelImg ? (
          <img
            src={realImg || modelImg!}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 animate-in fade-in duration-700"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-5xl opacity-60 animate-pulse-soft">{p.emoji || "🛍️"}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="flex items-start justify-between mb-2">
        <div className="text-3xl">{p.emoji || "🛍️"}</div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {p.hybrid && (
            <>
              <span
                className="text-[10px] font-semibold px-2 py-1 rounded-full border border-white/15 bg-white/5"
                title={`Hedef pazar: ${countryName(p.hybrid.target_country)} · Tahmini teslimat ${p.hybrid.estimated_shipping_days} gün`}
              >
                <CountryFlag code={p.hybrid.target_country} size={10} /> {p.hybrid.target_country}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${hybridBadge(p.hybrid.calculated_score).cls}`}
                title={p.hybrid.tooltip || `Pazar ${p.hybrid.ai_1_score} · Lojistik ${p.hybrid.ai_2_score}`}
              >
                {hybridBadge(p.hybrid.calculated_score).label} · {p.hybrid.calculated_score}
              </span>
            </>
          )}
          <ConsensusBadge consensus={p.consensus} />
          <RealismBadge score={p.realism_score} />

          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${rec.cls}`} title="AI recommendation">
            {rec.emoji} {enriched.recommendation}
          </span>
          <button onClick={onSave} disabled={saved} title={saved ? "Saved" : "Save to Library"}
            className={`p-1.5 rounded-full border transition ${saved ? "border-rose-400/40 bg-rose-400/10 text-rose-300" : "border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground"}`}>
            <Heart size={13} className={saved ? "fill-current" : ""} />
          </button>
        </div>
      </div>
      <h3 className="font-bold text-lg leading-tight">{p.name}</h3>
      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>


      {p.hybrid && (

        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span>Pazar talebi <b className="text-foreground">{p.hybrid.ai_1_score}</b> (%55)</span>
            <span>Kâr &amp; lojistik <b className="text-foreground">{p.hybrid.ai_2_score}</b> (%45)</span>
            <span>Rekabet <b className="text-foreground">{p.hybrid.local_competition_level}</b></span>
            <span><Truck size={11} className="inline -mt-0.5" /> ~{p.hybrid.estimated_shipping_days} gün</span>
          </div>
          {p.hybrid.tooltip && <p className="text-muted-foreground">{p.hybrid.tooltip}</p>}
          {p.hybrid.alt_country_code && (
            <p className="text-amber-300">
              <CountryFlag code={p.hybrid.alt_country_code} size={10} /> Bu ürün {p.hybrid.alt_country_name ?? countryName(p.hybrid.alt_country_code)} pazarında daha güçlü.
              {p.hybrid.alt_country_note ? ` ${p.hybrid.alt_country_note}` : ""}
            </p>
          )}
        </div>
      )}
      <MarketEvidencePanel ev={p.market_evidence} />

      {typeof p.unified_score === "number" && p.unified_score > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-[11px]">
          <span className="font-semibold">🤝 Ortak Karar Puanı</span>
          <span className="text-muted-foreground">
            (Hibrit {p.hybrid?.calculated_score ?? "—"} + Konsey {p.council?.velora_score ?? "—"}) / 2 ={" "}
            <b className="text-foreground">{p.unified_score}/100</b>
          </span>
        </div>
      )}


      {p.council && (
        <div className="mt-3 rounded-lg border border-[oklch(0.68_0.20_265)]/30 bg-[oklch(0.68_0.20_265)]/[0.07] px-3 py-2 text-[11px] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">🧠 7'li AI Konsey</span>
            <span className="font-extrabold text-foreground">Velora Score {p.council.velora_score}/100</span>
          </div>
          <div className="text-muted-foreground">{p.council.verdict}</div>
          <div className="flex flex-wrap gap-1.5">
            {p.council.teams.map((t) => (
              <span key={t.team} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5" title={`${t.engine} — ${t.summary}`}>
                {t.title}: <b>{t.score}</b>
              </span>
            ))}
          </div>
          {p.council.action_plan.length > 0 && (
            <ul className="text-muted-foreground space-y-0.5">
              {p.council.action_plan.slice(0, 3).map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          )}
          {p.council.risks.length > 0 && (
            <div className="text-amber-300">⚠ {p.council.risks[0]}</div>
          )}
        </div>
      )}




      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <ScorePill label="AI" value={enriched.ai_score} />
        <ScorePill label="Opp" value={enriched.opportunity_score} />
        <ScorePill label="Trend" value={enriched.trend_score} />
        <ScorePill label="Conf" value={enriched.confidence_score} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <MetricPill label="Sales/mo" value={enriched.est_monthly_sales.toLocaleString()} />
        <MetricPill label="Revenue" value={money(enriched.est_monthly_revenue_usd, { compact: true, showUsd: false })} />
        <MetricPill label="Net/mo" value={money(enriched.est_monthly_net_profit_usd, { compact: true, showUsd: false })} highlight />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 border border-white/10 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Supplier</div>
          <div className="text-xs font-semibold mt-0.5">{money(p.supplier_price_usd, { showUsd: false })}</div>
          {currency !== "USD" && <div className="text-[9px] text-muted-foreground">{p.supplier_price_usd}</div>}
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Sell</div>
          <div className="text-xs font-semibold mt-0.5">{money(p.selling_price_usd, { showUsd: false })}</div>
          {currency !== "USD" && <div className="text-[9px] text-muted-foreground">{p.selling_price_usd}</div>}
        </div>
        {(() => {
          const nm = netMarginView(p);
          return (
            <div className={`rounded-lg border p-2 ${nm.bad ? "bg-destructive/15 border-destructive/40" : "bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/20"}`}>
              <div className={`text-[10px] uppercase ${nm.bad ? "text-destructive" : "text-emerald-300/80"}`}>Margin</div>
              <div className={`text-xs font-semibold mt-0.5 flex items-center justify-center gap-0.5 ${nm.bad ? "text-destructive" : "text-emerald-300"}`}>
                {!nm.bad && <Percent size={10} />}{nm.text}
              </div>
            </div>
          );
        })()}

      </div>

      <div className="mt-3 flex items-center justify-center">
        {locked ? (
          <button
            onClick={onUpgrade}
            className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300"
          >
            <Lock size={10} /> Sadece abonelik alanlara özel
          </button>
        ) : (
          <UnlockedBadge />
        )}

      </div>

      {cb && (

        <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/10 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><Receipt size={11} /> Net profit calculator</div>
          <div className="grid grid-cols-2 gap-y-1 text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1"><Package size={10} /> Supplier</span><span className="text-right">{money(cb.supplier_cost, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1"><Truck size={10} /> Shipping</span><span className="text-right">{money(cb.shipping_cost, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1"><Store size={10} /> Platform fee</span><span className="text-right">{money(cb.platform_fee, { showUsd: false })}</span>
            <span className="text-muted-foreground flex items-center gap-1"><Megaphone size={10} /> Ad spend</span><span className="text-right">{money(cb.ad_spend, { showUsd: false })}</span>
            <span className="font-semibold text-emerald-300 flex items-center gap-1 pt-1 border-t border-white/10 mt-1"><DollarSign size={10} /> Net / unit</span>
            <span className="text-right font-semibold text-emerald-300 pt-1 border-t border-white/10 mt-1">{money(cb.net_profit, { showUsd: false })} ({cb.net_margin_pct}%)</span>
          </div>
        </div>

      )}

      <div className="mt-3 space-y-2 text-xs">
        <div className="flex gap-2"><Sparkles size={14} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" /><span className="text-muted-foreground">{p.why_winning}</span></div>
        <div className="flex gap-2"><Users size={14} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" /><span className="text-muted-foreground">{p.target_audience}</span></div>
        <div className="flex gap-2"><DollarSign size={14} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" /><span className={compColor}>{p.competition_level} competition</span></div>
        {p.platform_strategy && (
          <div className="flex gap-2"><Store size={14} className="text-[oklch(0.75_0.18_265)] shrink-0 mt-0.5" /><span className="text-muted-foreground">{p.platform_strategy}</span></div>
        )}
      </div>

      {(p.health_score !== undefined || p.sellability_verdict || p.viral_probability_90d !== undefined) && (
        <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><Activity size={11} /> Reliability</div>
          <div className="space-y-2">
            {p.sellability_verdict && (
              <div className="flex items-center justify-between text-xs">
                <span>Verdict</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${reliabilityStyle(p.sellability_verdict).cls}`}>
                  {reliabilityStyle(p.sellability_verdict).icon} {p.sellability_verdict}
                </span>
              </div>
            )}
            {p.health_score !== undefined && <ScoreBar label="Health" value={p.health_score} color="oklch(0.68 0.20 265)" />}
            {p.viral_probability_90d !== undefined && <ScoreBar label="Viral Potential" value={p.viral_probability_90d} color="oklch(0.75 0.18 200)" />}
            {p.data_sources && p.data_sources.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {p.data_sources.slice(0, 3).map((s, i) => <span key={i} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5">{s}</span>)}
              </div>
            )}
          </div>
        </div>
      )}

      <ConversionBlock p={p} />
      <ConsistencyBadge p={p} />


      {p.ai_insight && (
        <div className="mt-3 rounded-lg border border-[oklch(0.68_0.20_265)]/30 bg-gradient-to-br from-[oklch(0.68_0.20_265)]/10 to-[oklch(0.66_0.24_305)]/5 p-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[oklch(0.85_0.15_265)] mb-1"><Sparkles size={11} /> AI Insight</div>
          <p className="text-xs text-foreground/90 leading-relaxed">{p.ai_insight}</p>
        </div>
      )}

      {p.sales_tactic && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-300 mb-1"><Megaphone size={11} /> AI Sales Tactic</div>
          <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">{p.sales_tactic}</p>
        </div>
      )}

      {p.platform_difficulty && p.platform_difficulty.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5"><Store size={11} /> Platform Difficulty</div>
          <div className="space-y-1.5">
            {p.platform_difficulty.map((pd, i) => {
              const cls = pd.difficulty === "Easy" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : pd.difficulty === "Hard" ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300";
              return (
                <div key={i} className="flex items-start gap-2 text-xs bg-white/[0.03] border border-white/10 rounded px-2 py-1.5">
                  <img src={logoForStore(pd.platform)} alt="" loading="lazy" className="h-5 w-5 rounded bg-white/90 p-0.5 object-contain shrink-0" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{pd.platform}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>{pd.difficulty}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{pd.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {p.competitor_prices && p.competitor_prices.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5"><DollarSign size={11} /> Price Comparison</div>
          <div className="space-y-1">
            {p.competitor_prices.map((cp, i) => {
              const inner = (
                <>
                  <img src={logoForStore(cp.store)} alt="" loading="lazy" className="h-5 w-5 rounded bg-white/90 p-0.5 object-contain shrink-0" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                  <span className="flex-1 truncate">{cp.store}{cp.note ? <span className="text-[10px] text-muted-foreground ml-1">({cp.note})</span> : null}</span>
                  <span className="font-semibold tabular-nums">{cp.price}</span>
                  {cp.url && <ExternalLink size={10} className="text-muted-foreground" />}
                </>
              );
              const cls = "flex items-center gap-2 text-xs bg-white/[0.03] border border-white/10 rounded px-2 py-1.5 hover:bg-white/[0.06] transition";
              return cp.url
                ? <a key={i} href={cp.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
                : <div key={i} className={cls}>{inner}</div>;
            })}
          </div>
        </div>
      )}

      {p.ad_angles?.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5"><Megaphone size={11} /> Ad angles</div>
          <ul className="space-y-1">
            {p.ad_angles.slice(0, 3).map((a, i) => <li key={i} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5">{a}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {p.supplier_links?.map((u, i) => (
          <a key={`al-${i}`} href={u} target="_blank" rel="noreferrer"
             className="text-[11px] inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1">
            <ExternalLink size={10} /> AliExpress
          </a>
        ))}
        {p.alibaba_links?.map((u, i) => (
          <a key={`ab-${i}`} href={u} target="_blank" rel="noreferrer"
             className="text-[11px] inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 px-2.5 py-1">
            <ExternalLink size={10} /> Alibaba
          </a>
        ))}
      </div>

      <ProductDeepDive p={p} />

      <BuyerSimulation p={p} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => (locked ? onUpgrade() : onSeo(p.name))}
          className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
          {locked ? <Lock size={12} className="text-amber-300" /> : <Wand2 size={12} />} SEO Kit {locked && <span className="text-amber-300">· Kilitli</span>}
        </button>
        <button onClick={() => (locked ? onUpgrade() : onCreative(p.name))}
          className="rounded-lg border border-white/10 bg-gradient-to-r from-[oklch(0.68_0.20_265)]/20 to-[oklch(0.66_0.24_305)]/20 hover:from-[oklch(0.68_0.20_265)]/35 hover:to-[oklch(0.66_0.24_305)]/35 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
          {locked ? <Lock size={12} className="text-amber-300" /> : <Film size={12} />} Reels Script {locked && <span className="text-amber-300">· Kilitli</span>}
        </button>
      </div>
      <button onClick={onOpen}
        className="mt-2 rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-2 text-xs font-semibold text-white w-full flex items-center justify-center gap-1.5">
        {locked ? <Lock size={12} /> : <Radar size={12} />} Derinlemesine Analiz {locked && "· Kilitli"}
      </button>
      <button onClick={() => (locked ? onUpgrade() : onReport())}
        className="mt-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 w-full">
        {locked ? <Lock size={12} className="text-amber-300" /> : <FileText size={12} />} View Full Report {locked && <span className="text-amber-300">· Kilitli</span>}
      </button>


    </article>

  );
}

type SortKey = "winner" | "ai" | "buyers" | "margin" | "trend" | "profit" | "realism" | "momentum";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "winner", label: "Winner Score" },
  { id: "ai", label: "AI score" },
  { id: "buyers", label: "Buyers / 1k" },
  { id: "margin", label: "Margin" },
  { id: "trend", label: "Trend" },
  { id: "profit", label: "Est. profit" },
  { id: "realism", label: "Doğrulanmışlık" },
  { id: "momentum", label: "Canlı momentum" },
];

function sortValue(p: WinningProduct, key: SortKey): number {
  const e = enrichProduct(p);
  if (key === "winner") return p.winner_score ?? e.ai_score;
  if (key === "buyers") return buyersPer1000(p).value;
  if (key === "margin") return p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0;
  if (key === "trend") return e.trend_score;
  if (key === "profit") return e.est_monthly_net_profit_usd;
  if (key === "realism") return p.realism_score ?? 0;
  if (key === "momentum") return p.market_evidence?.trend_momentum_pct ?? 0;
  return e.ai_score;
}



function sortProducts(list: WinningProduct[], key: SortKey, onlyLaunch: boolean, desc = true): WinningProduct[] {
  const filtered = onlyLaunch ? list.filter((p) => enrichProduct(p).recommendation === "Launch") : list;
  const dir = desc ? 1 : -1;
  return [...filtered].sort((a, b) => (sortValue(b, key) - sortValue(a, key)) * dir);
}


function toCsv(list: WinningProduct[]): string {
  const head = ["Product", "Supplier price", "Selling price", "Margin %", "AI score", "Trend", "Buyers per 1000", "CVR %", "Recommendation", "Est. monthly profit USD"];
  const rows = list.map((p) => {
    const e = enrichProduct(p);
    const b = buyersPer1000(p).value;
    return [p.name, p.supplier_price_usd, p.selling_price_usd, p.profit_margin_pct, e.ai_score, e.trend_score, b, (b / 10).toFixed(1), e.recommendation, e.est_monthly_net_profit_usd];
  });
  return [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function ResultsToolbar({
  products, sortBy, onSortBy, onlyLaunch, onToggleLaunch,
  sortDesc, onToggleDir, query, onQuery, niche, country,
}: {
  products: WinningProduct[];
  sortBy: SortKey;
  onSortBy: (k: SortKey) => void;
  onlyLaunch: boolean;
  onToggleLaunch: () => void;
  sortDesc: boolean;
  onToggleDir: () => void;
  query: string;
  onQuery: (v: string) => void;
  niche: string;
  country: string;
}) {
  const shown = sortProducts(products, sortBy, onlyLaunch, sortDesc);
  const avgBuyers = shown.length
    ? Math.round(shown.reduce((a, p) => a + buyersPer1000(p).value, 0) / shown.length)
    : 0;
  const totalProfit = shown.reduce((a, p) => a + enrichProduct(p).est_monthly_net_profit_usd, 0);
  const launches = products.filter((p) => enrichProduct(p).recommendation === "Launch").length;
  const avgScore = shown.length
    ? Math.round(shown.reduce((a, p) => a + enrichProduct(p).ai_score, 0) / shown.length)
    : 0;
  const avgMargin = shown.length
    ? Math.round(shown.reduce((a, p) => a + (p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? 0), 0) / shown.length)
    : 0;
  const stamp = new Date().toISOString().slice(0, 10);

  const download = () => {
    const blob = new Blob([toCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `velora-winners-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);

  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ niche, country, generated_at: new Date().toISOString(), products: shown }, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `velora-winners-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = async () => {
    const lines = shown.slice(0, 20).map((p, i) => {
      const e = enrichProduct(p);
      return `${i + 1}. ${p.name} — AI ${e.ai_score} · ${p.selling_price_usd ?? "?"} · marj ${p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? "?"}% · ${e.recommendation}`;
    });
    await navigator.clipboard.writeText(
      [`Velora — ${niche || "product finder"} (${country}) · ${stamp}`, ...lines].join("\n"),
    );
    toast.success("Özet panoya kopyalandı");
  };

  return (
    <div className="premium-card grain rounded-2xl p-4 mb-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <SummaryStat label="Products" value={String(shown.length)} />
        <SummaryStat label="Launch-ready" value={String(launches)} />
        <SummaryStat label="Avg AI score" value={String(avgScore)} />
        <SummaryStat label="Avg net margin" value={`${avgMargin}%`} />
        <SummaryStat label="Avg buyers / 1k" value={String(avgBuyers)} />
        <SummaryStat
          label="Doğrulanmış"
          value={`${shown.filter((p) => (p.realism_score ?? 0) >= 75).length}/${shown.length}`}
        />
        <SummaryStat label="Est. monthly profit" value={formatCurrency(totalProfit)} highlight />

      </div>

      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Sonuçlarda ara — ürün adı, kitle veya platform"
          className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-8 py-2 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]"
        />
        {query && (
          <button
            type="button"
            aria-label="Aramayı temizle"
            onClick={() => onQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <XIcon size={11} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mr-1">Sort</span>
        {SORTS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSortBy(s.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              sortBy === s.id
                ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 text-foreground"
                : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={onToggleDir}
          title={sortDesc ? "Yüksekten düşüğe" : "Düşükten yükseğe"}
          className="text-xs px-2.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
        >
          {sortDesc ? <ArrowDownWideNarrow size={12} /> : <ArrowUpWideNarrow size={12} />}
          {sortDesc ? "Azalan" : "Artan"}
        </button>
        <button
          onClick={onToggleLaunch}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            onlyLaunch ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
          }`}
        >
          🟢 Launch only
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={copySummary}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <Copy size={12} /> Özet kopyala
          </button>
          <button
            onClick={downloadJson}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <FileJson size={12} /> JSON
          </button>
          <button
            onClick={download}
            className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>
    </div>
  );

}

function SummaryStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${highlight ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5" : "border-white/10 bg-white/[0.04]"}`}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="text-lg font-black tracking-tight">{value}</div>
    </div>
  );
}

function ConversionBlock({ p }: { p: WinningProduct }) {
  const { value, estimated } = buyersPer1000(p);
  const tone = conversionTone(value);
  const f = p.conversion?.funnel;
  const pct = Math.min(100, (value / 60) * 100);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-[radial-gradient(120%_120%_at_0%_0%,oklch(0.68_0.20_265/0.16),transparent_60%)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1">
          <Target size={11} /> Buyers per 1,000 viewers
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tone.cls}`}>{tone.label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-black tracking-tight text-aurora leading-none">{value}</span>
        <span className="text-xs text-muted-foreground mb-1">/ 1,000 people</span>
        <span className="ml-auto text-xs font-semibold text-foreground/80 mb-1">{(value / 10).toFixed(1)}% CVR</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)]" style={{ width: `${pct}%` }} />
      </div>
      {f && (
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
          {[
            ["Views", 1000],
            ["Cart", f.add_to_cart],
            ["Checkout", f.checkout_started],
            ["Buy", f.purchases],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-md bg-white/[0.04] border border-white/10 py-1">
              <div className="text-muted-foreground">{l}</div>
              <div className="font-semibold text-[11px]">{Number(v).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
        {estimated
          ? "Estimated from category conversion benchmarks (price, trend and competition adjusted)."
          : p.conversion?.reasoning}
      </p>
      {!estimated && p.conversion?.benchmark && (
        <p className="mt-1 text-[10px] text-muted-foreground/70">Benchmark: {p.conversion.benchmark}</p>
      )}
    </div>
  );
}

function ConsistencyBadge({ p }: { p: WinningProduct }) {
  const [open, setOpen] = useState(false);
  const report = checkConsistency(p);
  const clean = report.issues.length === 0;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] transition ${
          clean
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {clean ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
          {clean ? `Consistency verified · ${report.checked} checks` : `${report.issues.length} consistency warning${report.issues.length > 1 ? "s" : ""}`}
        </span>
        <span className="font-semibold">{report.score}/100</span>
      </button>
      {open && !clean && (
        <ul className="mt-1.5 space-y-1">
          {report.issues.map((i: Issue, idx: number) => (
            <li key={idx} className="text-[11px] text-muted-foreground rounded-md bg-white/[0.03] border border-white/10 px-2 py-1.5">
              <span className={i.level === "error" ? "text-rose-300" : "text-amber-300"}>[{i.field}]</span> {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {

  return (
    <div className="rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-bold text-[oklch(0.85_0.15_265)]">{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function MetricPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-1.5 py-1 text-center ${highlight ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300" : "bg-white/[0.04] border-white/10"}`}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[11px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// ---------- SEO TAB ----------

function SeoTab({
  seoFn, onOutOfCredits, qc,
}: {
  seoFn: (opts: { data: { product: string; audience: string; platform: Platform } }) => Promise<SeoKit>;
  onOutOfCredits: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState<Platform>("Shopify");
  const [kit, setKit] = useState<SeoKit | null>(null);

  const mut = useMutation({
    mutationFn: (v: { product: string; audience: string; platform: Platform }) => seoFn({ data: v }),
    onSuccess: (res) => { setKit(res); qc.invalidateQueries({ queryKey: ["profile"] }); toast.success("SEO kit generated!"); },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) { toast.error("Out of credits."); onOutOfCredits(); }
      else toast.error(err.message);
    },
  });

  useEffect(() => {
    runRefs.seo = (name: string) => {
      setProduct(name);
      mut.mutate({ product: name, audience, platform });
    };
    return () => { runRefs.seo = null; };
  }, [mut, audience, platform]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product.trim()) return toast.error("Enter a product");
    mut.mutate({ product, audience, platform });
  };

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          <span className="text-gradient">SEO & Marketing</span> Tools
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Generate high-converting titles, meta descriptions, keywords, and platform-specific ad copy.
        </p>
        <div className="mt-3"><CreditCost amount={1} label="Her üretim 1 kredi" /></div>
      </div>

      <form onSubmit={onSubmit} className="glass rounded-2xl p-4 md:p-6 max-w-4xl mx-auto space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px] gap-3">
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product name (e.g. Portable Ice Maker XR-500)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]" />
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Target audience (optional)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]" />
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]">
            {PLATFORMS.map(p => <option key={p} className="bg-[oklch(0.20_0.035_265)]">{p}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={mut.isPending}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 flex items-center gap-2">
            {mut.isPending ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Wand2 size={16} /> Generate Kit</>}
          </button>
        </div>
      </form>

      <section className="mt-8 max-w-5xl mx-auto">
        {mut.isPending && (
          <div className="grid gap-4">
            {[0,1,2].map(i => <div key={i} className="glass rounded-xl h-40 animate-pulse" />)}
          </div>
        )}
        {!mut.isPending && !kit && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Wand2 className="mx-auto mb-3 text-[oklch(0.75_0.18_265)]" />
            Enter a product to generate a complete SEO & ad-copy kit.
          </div>
        )}
        {!mut.isPending && kit && <KitView kit={kit} />}
      </section>
    </>
  );
}

function KitView({ kit }: { kit: SeoKit }) {
  return (
    <div className="space-y-6">
      <KitBlock title="SEO Product Titles" items={kit.titles ?? []} />
      <KitBlock title="Meta Descriptions" items={kit.meta_descriptions ?? []} />
      {kit.keywords?.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Search size={14} /> SEO Keywords</div>
          <div className="flex flex-wrap gap-1.5">
            {kit.keywords.map((k, i) => (
              <span key={i} className="text-xs bg-white/5 border border-white/10 rounded-full px-2.5 py-1">{k}</span>
            ))}
          </div>
          <CopyBtn text={kit.keywords.join(", ")} label="Copy all keywords" />
        </div>
      )}
      {kit.ad_copy?.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Megaphone size={14} /> Platform Ad Copy</div>
          <div className="grid md:grid-cols-2 gap-3">
            {kit.ad_copy.map((a, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-wider text-[oklch(0.75_0.18_265)] mb-1">{a.platform}</div>
                <div className="text-sm font-semibold">{a.hook}</div>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.primary}</p>
                <div className="text-[11px] mt-2 inline-block rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 border border-white/10 px-2 py-0.5">CTA: {a.cta}</div>
                <CopyBtn text={`${a.hook}\n\n${a.primary}\n\n${a.cta}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KitBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="glass rounded-xl p-5">
      <div className="text-sm font-semibold mb-3">{title}</div>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <span>{t}</span>
            <CopyBtn text={t} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyBtn({ text, label, compact }: { text: string; label?: string; compact?: boolean }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }
    catch { toast.error("Copy failed"); }
  };
  return (
    <button type="button" onClick={copy}
      className={`text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground ${compact ? "" : "mt-3"}`}>
      {ok ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {label ?? (ok ? "Copied" : "Copy")}
    </button>
  );
}

// ---------- CREATIVE STUDIO TAB ----------

function CreativeTab({
  scriptsFn, onOutOfCredits, qc,
}: {
  scriptsFn: (opts: { data: { product: string; audience: string; platform: Platform } }) => Promise<{ scripts: CreativeScript[] }>;
  onOutOfCredits: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState<Platform>("Shopify");
  const [scripts, setScripts] = useState<CreativeScript[]>([]);

  const mut = useMutation({
    mutationFn: (v: { product: string; audience: string; platform: Platform }) => scriptsFn({ data: v }),
    onSuccess: (res) => { setScripts(res.scripts); qc.invalidateQueries({ queryKey: ["profile"] }); toast.success("Scripts ready!"); },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) { toast.error("Out of credits."); onOutOfCredits(); }
      else toast.error(err.message);
    },
  });

  useEffect(() => {
    runRefs.creative = (name: string) => {
      setProduct(name);
      mut.mutate({ product: name, audience, platform });
    };
    return () => { runRefs.creative = null; };
  }, [mut, audience, platform]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product.trim()) return toast.error("Enter a product");
    mut.mutate({ product, audience, platform });
  };

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          <span className="text-gradient">Creative Studio</span>
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Viral TikTok & Instagram Reels scripts — hook, storyline, visuals, and CTA, ready to shoot.
        </p>
        <div className="mt-3"><CreditCost amount={1} label="Her üretim 1 kredi" /></div>
      </div>

      <form onSubmit={onSubmit} className="glass rounded-2xl p-4 md:p-6 max-w-4xl mx-auto space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px] gap-3">
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product name"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]" />
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience (optional)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]" />
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]">
            {PLATFORMS.map(p => <option key={p} className="bg-[oklch(0.20_0.035_265)]">{p}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={mut.isPending}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 flex items-center gap-2">
            {mut.isPending ? <><Loader2 size={16} className="animate-spin" /> Writing…</> : <><Film size={16} /> Generate Scripts</>}
          </button>
        </div>
      </form>

      <section className="mt-8 max-w-5xl mx-auto">
        {mut.isPending && (
          <div className="grid md:grid-cols-2 gap-4">
            {[0,1].map(i => <div key={i} className="glass rounded-xl h-80 animate-pulse" />)}
          </div>
        )}
        {!mut.isPending && scripts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Film className="mx-auto mb-3 text-[oklch(0.75_0.18_265)]" />
            Enter a product to generate viral short-form video scripts.
          </div>
        )}
        {!mut.isPending && scripts.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            {scripts.map((s, i) => <ScriptCard key={i} s={s} />)}
          </div>
        )}
      </section>
    </>
  );
}

function ScriptCard({ s }: { s: CreativeScript }) {
  const full = `${s.format} — ${s.title}\n\nHOOK:\n${s.hook}\n\nSTORYLINE:\n${s.storyline}\n\nVOICEOVER:\n${s.voiceover}\n\nVISUALS:\n${(s.visuals || []).map(v => `• ${v}`).join("\n")}\n\nCTA: ${s.cta}\n\n${(s.hashtags || []).join(" ")}`;
  return (
    <article className="premium-card grain rounded-xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-[oklch(0.75_0.18_265)] flex items-center gap-1"><Film size={12} /> {s.format}</div>
        <div className="text-[10px] rounded-full bg-white/5 border border-white/10 px-2 py-0.5">{s.duration_seconds}s</div>
      </div>
      <h3 className="font-bold text-lg leading-tight">{s.title}</h3>

      <div className="mt-3 space-y-3 text-sm">
        <Section label="Hook (0-2s)"><p className="font-semibold">{s.hook}</p></Section>
        <Section label="Storyline"><p className="whitespace-pre-wrap text-muted-foreground">{s.storyline}</p></Section>
        <Section label="Voiceover"><p className="whitespace-pre-wrap text-muted-foreground">{s.voiceover}</p></Section>
        {s.visuals?.length > 0 && (
          <Section label="Visuals / Shot list">
            <ul className="space-y-1">
              {s.visuals.map((v, i) => <li key={i} className="text-xs text-muted-foreground">• {v}</li>)}
            </ul>
          </Section>
        )}
        <div className="text-xs inline-block rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 border border-white/10 px-3 py-1">CTA: {s.cta}</div>
        {s.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.hashtags.map((h, i) => <span key={i} className="text-[11px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5">{h.startsWith("#") ? h : `#${h}`}</span>)}
          </div>
        )}
      </div>
      <CopyBtn text={full} label="Copy full script" />
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

// ---------- LIBRARY TAB ----------

function LibraryTab({
  favorites, loading, onDelete, onSeo, onCreative,
}: {
  favorites: FavoriteRow[];
  loading: boolean;
  onDelete: (id: string) => void;
  onSeo: (name: string) => void;
  onCreative: (name: string) => void;
}) {
  const exportCsv = () => {
    if (favorites.length === 0) return toast.error("No products to export");
    const csv = buildShopifyCsv(favorites.map(f => f.product));
    downloadFile(csv, "velora-shopify-products.csv", "text/csv;charset=utf-8;");
    toast.success(`Exported ${favorites.length} product${favorites.length === 1 ? "" : "s"}`);
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            My <span className="text-gradient">Product Library</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Saved winners — export directly to Shopify.</p>
        </div>
        <button onClick={exportCsv} disabled={favorites.length === 0}
          className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-40 whitespace-nowrap self-start md:self-auto">
          <Download size={16} /> Export to Shopify CSV
        </button>
      </div>

      {loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0,1,2].map(i => <div key={i} className="glass rounded-xl h-56 animate-pulse" />)}
        </div>
      )}

      {!loading && favorites.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-16">
          <Bookmark className="mx-auto mb-3 text-[oklch(0.75_0.18_265)]" />
          Your library is empty. Tap the heart icon on any product to save it here.
        </div>
      )}

      {!loading && favorites.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {favorites.map((f) => {
            const p = f.product;
            return (
              <article key={f.id} className="premium-card grain card-lift rounded-xl p-5 flex flex-col hover:-translate-y-1">
                <div className="flex items-start justify-between mb-2">
                  <div className="text-3xl">{p.emoji || "🛍️"}</div>
                  <button onClick={() => onDelete(f.id)} className="p-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/40 text-muted-foreground hover:text-rose-300" title="Remove">
                    <HeartOff size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">{f.collection_name || "Default"}</span>
                  {f.tags?.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full border border-[oklch(0.68_0.20_265)]/30 bg-[oklch(0.68_0.20_265)]/10 text-[oklch(0.85_0.15_265)]">{tag}</span>
                  ))}
                </div>
                <h3 className="font-bold text-lg leading-tight">{p.name}</h3>
                {f.notes && <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">{f.notes}</p>}
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Supplier" value={p.supplier_price_usd} />
                  <Stat label="Sell" value={p.selling_price_usd} />
                  {(() => { const nm = netMarginView(p); return <Stat label="Margin" value={nm.text} highlight={!nm.bad} danger={nm.bad} />; })()}
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1"><Target size={11} /> Buyers / 1,000</span>
                  <span className="text-sm font-black text-aurora">{buyersPer1000(p).value}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.supplier_links?.slice(0, 1).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1">
                      <ExternalLink size={10} /> AliExpress
                    </a>
                  ))}
                  {p.alibaba_links?.slice(0, 1).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 px-2.5 py-1">
                      <ExternalLink size={10} /> Alibaba
                    </a>
                  ))}
                </div>
                <div className="mt-auto pt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => onSeo(p.name)} className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
                    <Wand2 size={12} /> SEO Kit
                  </button>
                  <button onClick={() => onCreative(p.name)} className="rounded-lg border border-white/10 bg-gradient-to-r from-[oklch(0.68_0.20_265)]/20 to-[oklch(0.66_0.24_305)]/20 hover:from-[oklch(0.68_0.20_265)]/35 hover:to-[oklch(0.66_0.24_305)]/35 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
                    <Film size={12} /> Reels
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * ACTUAL net margin for the MARGIN badge: (net profit / selling price) * 100.
 * Falls back to the derived cost stack when the AI omitted a cost breakdown.
 */
function netMarginView(p: WinningProduct): { text: string; bad: boolean } {
  const cb = p.cost_breakdown;
  const sell = parseMoney(p.selling_price_usd);
  let net: number;
  if (cb) {
    net = parseMoney(cb.net_profit);
    if (!net) net = sell - (parseMoney(cb.supplier_cost) + parseMoney(cb.shipping_cost) + parseMoney(cb.platform_fee) + parseMoney(cb.ad_spend));
  } else {
    net = computeUnitEconomics({ retail_price: sell, supplier_cost: p.supplier_price_usd }).net_profit;
  }
  const pct = sell > 0 ? (net / sell) * 100 : 0;
  if (net <= 0 || pct <= 0) return { text: "0% (UNPROFITABLE)", bad: true };
  if (pct < MIN_NET_MARGIN_PCT) return { text: `${pct.toFixed(0)}% (BELOW ${MIN_NET_MARGIN_PCT}%)`, bad: true };
  return { text: `${pct.toFixed(0)}%`, bad: false };
}

function Stat({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${danger ? "bg-destructive/15 border-destructive/40" : highlight ? "bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/20" : "bg-white/5 border-white/10"}`}>
      <div className={`text-[10px] uppercase ${danger ? "text-destructive" : highlight ? "text-emerald-300/80" : "text-muted-foreground"}`}>{label}</div>
      <div className={`text-xs font-semibold mt-0.5 ${danger ? "text-destructive" : highlight ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}


// ---------- Shopify CSV export ----------

function parsePriceNumber(s: string | undefined): string {
  if (!s) return "";
  const m = s.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return m ? m[1] : "";
}

function csvEscape(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function buildShopifyCsv(products: WinningProduct[]): string {
  // Shopify Products CSV columns (core set required for import)
  const headers = [
    "Handle","Title","Body (HTML)","Vendor","Product Category","Type","Tags","Published",
    "Option1 Name","Option1 Value","Variant SKU","Variant Grams","Variant Inventory Tracker",
    "Variant Inventory Qty","Variant Inventory Policy","Variant Fulfillment Service",
    "Variant Price","Variant Compare At Price","Variant Requires Shipping","Variant Taxable",
    "Variant Barcode","Image Src","Image Position","Image Alt Text","Gift Card",
    "SEO Title","SEO Description","Status",
  ];
  const rows: string[] = [headers.join(",")];
  for (const p of products) {
    const handle = slugify(p.name || "product");
    const bodyHtml =
      `<p>${(p.description || "").replace(/</g, "&lt;")}</p>` +
      (p.why_winning ? `<p><strong>Why it wins:</strong> ${p.why_winning.replace(/</g, "&lt;")}</p>` : "") +
      (p.target_audience ? `<p><strong>For:</strong> ${p.target_audience.replace(/</g, "&lt;")}</p>` : "") +
      (p.ad_angles?.length ? `<ul>${p.ad_angles.map(a => `<li>${a.replace(/</g, "&lt;")}</li>`).join("")}</ul>` : "");
    const tags = [
      ...(p.platform_fit ?? []),
      p.competition_level ? `competition:${p.competition_level}` : "",
      `trend:${p.trend_score ?? ""}`,
    ].filter(Boolean).join(", ");
    const price = parsePriceNumber(p.selling_price_usd);
    const cost = parsePriceNumber(p.supplier_price_usd);
    const row = [
      handle, p.name, bodyHtml, "Velora", "", "", tags, "TRUE",
      "Title", "Default Title", `OC-${handle}`.slice(0, 40), "0", "shopify",
      "10", "deny", "manual",
      price, cost, "TRUE", "TRUE",
      "", "", "", p.name, "FALSE",
      p.name.slice(0, 70), (p.description || "").slice(0, 320), "active",
    ].map(csvEscape).join(",");
    rows.push(row);
  }
  return rows.join("\n");
}

const SLOGANS = [
  "Real data in. Winning products out.",
  "Stop guessing. Start sourcing.",
  "Every number verified on the live web.",
  "From trend signal to first sale.",
];

function RotatingSlogan() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % SLOGANS.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-6 flex justify-center">
      <div className="premium-card rounded-full px-5 py-2 h-10 flex items-center gap-2 overflow-hidden">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[oklch(0.72_0.22_285)] animate-pulse-soft" />
        <span key={i} className="text-sm font-semibold text-foreground/90 animate-rise-in whitespace-nowrap">
          {SLOGANS[i]}
        </span>
      </div>
    </div>
  );
}

/** Only accepts a real, verifiable product image URL returned by the model. */
function resolveProductImage(p: WinningProduct): string | null {
  const u = p.image_url?.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (/source\.unsplash\.com|loremflickr|picsum\.photos|placehold|via\.placeholder|dummyimage/i.test(u)) return null;
  return u;
}

// Client-side cache to avoid refetching the same product image.
const _imgCache = new Map<string, string>();
function useRealProductImage(name: string): string | null {
  const [url, setUrl] = useState<string | null>(() => _imgCache.get(name.toLowerCase()) ?? null);
  useEffect(() => {
    const key = name.toLowerCase();
    const hit = _imgCache.get(key);
    if (hit) { setUrl(hit); return; }
    let cancelled = false;
    fetch(`/api/public/product-image?q=${encodeURIComponent(name)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { url?: string } | null) => {
        if (cancelled || !d?.url) return;
        _imgCache.set(key, d.url);
        setUrl(d.url);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [name]);
  return url;
}


function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
