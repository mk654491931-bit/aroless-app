import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { describeSearchFailure, type SearchErrorState } from "@/components/search-states";
import { countryName } from "@/lib/countries";
import { countryFit } from "@/lib/platform-market";
import type { WinningProduct, Platform, Budget } from "@/lib/gemini.functions";
import { generateProducts, getDiscoveryJob } from "@/lib/gemini.functions";
import { huggingFaceSearch } from "@/lib/hf.functions";
import { storedHfToken, type EngineId, type MarketplaceId } from "@/lib/engines";
import type { DeepSearchOptions } from "@/components/deep-search-panel";
import type { RejectedCandidate } from "@/components/winner-score-panel";
import { attachWinnerScores } from "@/lib/winner-score";
import { saveAnalysis } from "@/lib/analysis.functions";
import { insertProductsFromAnalysis } from "@/lib/products.functions";
import { toProductList } from "../utils/response";

type GenVars = {
  niche: string;
  category: string;
  audience: string;
  platforms: Platform[];
  budget: Budget;
  target_country: string;
  min_score: number;
  marketplace: MarketplaceId;
  lang: string;
  use_github_trends: boolean;
} & DeepSearchOptions;

export function useFinderSearch(opts: {
  platforms: Platform[];
  effectiveCountry: string;
  engine: EngineId;
  t: (k: string) => string;
  profileCredits: number | undefined;
  profileIsSuccess: boolean;
  niche: string;
  category: string;
  audience: string;
  budget: Budget;
  targetCountry: string;
  minScore: number;
  marketplace: MarketplaceId;
  lang: string;
  useGithubTrends: boolean;
  deepSearch: DeepSearchOptions;
  pushRecent: (q: string) => void;
  onNeedUpgrade: () => void;
  onResults: (products: WinningProduct[], rejected: RejectedCandidate[], fallback: string | null) => void;
  onClearResults: () => void;
}) {
  const qc = useQueryClient();
  const generateFn = useServerFn(generateProducts);
  const getDiscoveryJobFn = useServerFn(getDiscoveryJob);
  const saveAnalysisFn = useServerFn(saveAnalysis);
  const insertProductsFn = useServerFn(insertProductsFromAnalysis);
  const hfFn = useServerFn(huggingFaceSearch);

  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<SearchErrorState | null>(null);
  const [searchAttempt, setSearchAttempt] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const searchSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gen = useMutation({
    mutationFn: async (vars: GenVars) => {
      const response = await generateFn({ data: vars });
      const queued = response as { jobId?: unknown; status?: unknown } | null;
      if (typeof queued?.jobId !== "string") return response;
      for (let attempt = 0; attempt < 180; attempt++) {
        const job = await getDiscoveryJobFn({ data: { jobId: queued.jobId } });
        if (job.status === "completed" && job.result) return job.result;
        if (job.status === "failed") throw new Error(job.error || "Arama tamamlanamadı.");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error("DISCOVERY_JOB_TIMEOUT: Arka plan analizi 6 dakika içinde tamamlanmadı.");
    },
    onSuccess: (res, vars) => {
      try {
        const products = toProductList(res);
        opts.onResults(
          products.length > 0 ? attachWinnerScores(products) : [],
          (res as { rejected?: RejectedCandidate[] } | undefined)?.rejected ?? [],
          (res as { fallback?: { message?: string } | null } | undefined)?.fallback?.message ?? null,
        );
        setFallbackNotice((res as { fallback?: { message?: string } | null } | undefined)?.fallback?.message ?? null);
        setSearchError(null);
        setStalled(false);
        qc.invalidateQueries({ queryKey: ["profile"] });
        if (products.length === 0) {
          toast.error("Aradığınız kriterlere uygun ürün bulunamadı.");
          return;
        }
        toast.success(`${products.length} winning products generated!`);
        saveAnalysisFn({ data: { search_query: `${vars.niche} · ${vars.category} · ${vars.budget}`, results: products } }).catch(
          () => {},
        );
        insertProductsFn({ data: { products, target_country: vars.target_country } }).catch(() => {});
      } catch (err) {
        console.error("Ürün arama sonucu işlenirken hata:", err);
        toast.error("Sonuçlar işlenirken bir sorun oluştu. Lütfen tekrar dene.");
      }
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits — upgrade to keep going.");
        opts.onNeedUpgrade();
      } else {
        opts.onClearResults();
        setFallbackNotice(null);
        setStalled(false);
        setSearchError({ ...describeSearchFailure(err.message), raw: err.message });
      }
    },
    onSettled: () => {
      setStalled(false);
      if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
    },
  });

  const hfGen = useMutation({
    mutationFn: (vars: { engine: "qwen" | "llama" | "hybrid"; platforms?: Platform[] }) =>
      hfFn({
        data: {
          niche: opts.niche,
          category: opts.category,
          audience: opts.audience,
          platforms: vars.platforms ?? opts.platforms,
          budget: opts.budget,
          target_country: opts.marketplace === "turkey" ? "TR" : opts.targetCountry,
          marketplace: opts.marketplace,
          lang: (opts.lang.slice(0, 2) as "en" | "tr") ?? "en",
          engine: vars.engine,
          token: storedHfToken(),
        },
      }),
    onSuccess: (res) => {
      try {
        const products = toProductList(res);
        opts.onResults(products.length > 0 ? attachWinnerScores(products) : [], [], null);
        setFallbackNotice(null);
        setSearchError(null);
        setStalled(false);
        qc.invalidateQueries({ queryKey: ["profile"] });
        const model = (res as { model?: string } | undefined)?.model ?? "Hugging Face";
        if (products.length === 0) toast.error("Hugging Face returned no products — try another niche.");
        else toast.success(`${products.length} products from ${model}`);
      } catch (err) {
        console.error("HF arama sonucu işlenirken hata:", err);
        toast.error("Sonuçlar işlenirken bir sorun oluştu. Lütfen tekrar dene.");
      }
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits — upgrade to keep going.");
        opts.onNeedUpgrade();
        return;
      }
      opts.onClearResults();
      setStalled(false);
      setSearchError(
        err.message.includes("HF_TOKEN_MISSING")
          ? {
              kind: "auth",
              title: "Hugging Face token eksik",
              body: "Bu motor senin kendi Hugging Face token'ınla çalışır, bu yüzden istek yetkilendirilemedi.",
              hint: "Ayarlar → API anahtarları bölümünden HF_TOKEN ekleyip tekrar dene.",
              raw: err.message,
            }
          : { ...describeSearchFailure(err.message), raw: err.message },
      );
    },
    onSettled: () => {
      setStalled(false);
      if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
    },
  });

  const searching = gen.isPending || hfGen.isPending;

  const runSearch = useCallback(
    (nicheValue: string, resultQuerySetter?: (v: string) => void) => {
      if (!nicheValue.trim()) return toast.error(opts.t("ui.enter_niche"));
      if (opts.platforms.length === 0) return toast.error(opts.t("ui.select_platform"));
      if (opts.profileIsSuccess && (opts.profileCredits ?? 0) <= 0) {
        opts.onNeedUpgrade();
        return;
      }
      opts.pushRecent(nicheValue);
      resultQuerySetter?.("");
      setSearchError(null);
      setSearchAttempt(nicheValue);
      setStalled(false);

      const effectivePlatforms = (() => {
        const allBlocked = opts.platforms.every((p) => countryFit(p, opts.effectiveCountry) === "unavailable");
        if (!allBlocked) return opts.platforms;
        const cb = opts.platforms.filter((p) => countryFit(p, opts.effectiveCountry) === "cross-border").slice(0, 3);
        if (cb.length > 0) {
          toast.info(`All selected platforms are unavailable in ${countryName(opts.effectiveCountry)}. Using cross-border options.`);
          return cb;
        }
        const globalFallback = ["Amazon", "Shopify", "eBay"].filter(
          (p) => countryFit(p as Platform, opts.effectiveCountry) !== "unavailable",
        ) as Platform[];
        if (globalFallback.length > 0) {
          toast.info(`Switching to global platforms for ${countryName(opts.effectiveCountry)} market.`);
          return globalFallback;
        }
        return opts.platforms;
      })();

      if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
      searchSafetyTimerRef.current = setTimeout(() => {
        setStalled(true);
        setSearchError({ ...describeSearchFailure("504 gateway timeout"), niche: nicheValue });
      }, 420_000);

      if (opts.engine !== "default") {
        hfGen.mutate({ engine: opts.engine as "qwen" | "llama" | "hybrid", platforms: effectivePlatforms });
        return;
      }
      gen.mutate({
        niche: nicheValue,
        category: opts.category,
        audience: opts.audience,
        platforms: effectivePlatforms,
        budget: opts.budget,
        target_country: opts.marketplace === "turkey" ? "TR" : opts.targetCountry,
        min_score: opts.minScore,
        marketplace: opts.marketplace,
        lang: opts.lang.slice(0, 2) ?? "en",
        use_github_trends: opts.useGithubTrends,
        ...opts.deepSearch,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      opts.platforms,
      opts.effectiveCountry,
      opts.engine,
      opts.t,
      opts.profileCredits,
      opts.profileIsSuccess,
      opts.category,
      opts.audience,
      opts.budget,
      opts.targetCountry,
      opts.minScore,
      opts.marketplace,
      opts.lang,
      opts.useGithubTrends,
      opts.deepSearch,
      opts.pushRecent,
      opts.onNeedUpgrade,
      opts.niche,
      gen,
      hfGen,
    ],
  );

  useEffect(() => {
    return () => {
      if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
    };
  }, []);

  return {
    searching,
    fallbackNotice,
    searchError,
    searchAttempt,
    stalled,
    gen,
    hfGen,
    runSearch,
    setSearchError,
    setStalled,
  };
}
