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

/** Sunucu plan göndermezse (eski build veya inline fallback) kullanılan varsayılanlar. */
/**
 * Sunucudan plan gelmeden önceki varsayılan bekleme penceresi.
 *
 * Sunucu sözü uçtan ucadır (tıkla → sonuç): `jobPollingPlan()` 280 sn döndürür
 * ve işçi hattı 260 sn'de bitirir. Bu sabit eskiden 360 sn'ydi; sunucu planı
 * gelmediği bir durumda kullanıcı 6 dakika boşuna bekliyordu.
 */
const DEFAULT_POLL_MAX_MS = 280_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** İlk 30 sn sık, sonrası seyrek yoklanır: uzun Render işlerinde istek sayısı düşer. */
const POLL_BACKOFF_AFTER_MS = 30_000;
const POLL_SLOW_INTERVAL_MS = 5_000;
/** Güvenlik zamanlayıcısı yoklama bütçesinin hemen üstünde kalsın ki mesajı yoklama üretsin. */
const SAFETY_GRACE_MS = 15_000;

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

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
  onResults: (
    products: WinningProduct[],
    rejected: RejectedCandidate[],
    fallback: string | null,
    /**
     * `true` ise bu ÖN sonuçtur: canlı doğrulanmış ürünler hazır, AI Konsey
     * karneleri arka planda üretiliyor. İstemci ürünleri hemen gösterir ve
     * yoklamaya devam eder; nihai sonuç geldiğinde `false` ile tekrar çağrılır.
     */
    enriching?: boolean,
  ) => void;
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
  /**
   * Ön sonuç EKRANDA ve hat hâlâ sürüyor.
   *
   * Bu bayrak sonuç listesinin gösterilmesini açar: `searching` true olsa bile
   * ürünler varsa kullanıcı onları görür (eskiden 280 sn boyunca hiçbir şey
   * görünmüyordu).
   */
  const [enriching, setEnriching] = useState(false);
  /**
   * AI Konsey karneleri hâlâ bekleniyor (`council_pending`).
   *
   * `enriching`den ayrıdır: fast profilde ön sonuç gelebilir ama karne hiç
   * çalışmıyor olabilir. UI yalnızca bu bayrak true iken "karneler tamamlanıyor"
   * der — aksi halde olmayan bir işi varmış gibi göstermiş olurdu.
   */
  const [councilPending, setCouncilPending] = useState(false);
  /** Ön sonuç teslim edildi mi? (hata anında sonuçları korumak için senkron ref) */
  const partialDeliveredRef = useRef(false);
  const searchSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchNicheRef = useRef<string>("");

  /**
   * "Bu iş çok uzadı" kartını gösteren güvenlik zamanlayıcısı. Süre sunucunun
   * yoklama bütçesinden türetilir; böylece Render'ın uzun işi 7. dakikada
   * yanlışlıkla zaman aşımı hatası olarak gösterilmez.
   */
  const armSafetyTimer = useCallback((maxWaitMs: number) => {
    if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
    searchSafetyTimerRef.current = setTimeout(() => {
      setStalled(true);
      // Artık 504 çerçevesi değil: bütçe platforma göre hesaplanıyor, bu yüzden
      // kullanıcıya "arka plan analizi zaman aşımına uğradı" anlatılır.
      setSearchError({
        ...describeSearchFailure("DISCOVERY_JOB_TIMEOUT"),
        niche: searchNicheRef.current,
      });
    }, maxWaitMs);
  }, []);

  const gen = useMutation({
    mutationFn: async (vars: GenVars) => {
      const response = await generateFn({ data: vars });
      const queued = response as {
        jobId?: unknown;
        status?: unknown;
        pollMaxMs?: unknown;
        pollIntervalMs?: unknown;
      } | null;
      if (typeof queued?.jobId !== "string") return response;

      // Bekleme bütçesi sunucudan gelir: Render'da ~14,9 dk, Vercel'de ~52 sn.
      const jobId = queued.jobId;
      const maxWaitMs = positiveNumber(queued.pollMaxMs) ?? DEFAULT_POLL_MAX_MS;
      const intervalMs = positiveNumber(queued.pollIntervalMs) ?? DEFAULT_POLL_INTERVAL_MS;
      armSafetyTimer(maxWaitMs + SAFETY_GRACE_MS);

      const deadline = Date.now() + maxWaitMs;
      let elapsedMs = 0;
      /**
       * ÖN SONUÇ TESLİMİ.
       *
       * Hat, canlı doğrulanmış ürünleri AI Konsey karnelerinden ÖNCE
       * `searches.result` alanına yazar (status hâlâ `processing`). Biz de
       * burada o kaydı ilk gördüğümüzde kullanıcıya gösteriyoruz: kullanıcı
       * 4-5 dakika yerine tipik olarak ~1,5-2 dakikada ürünleri görür.
       * Yoklama durmaz; karne gelince nihai sonuç üzerine yazılır.
       */
      const deliverPartial = (payload: unknown): boolean => {
        if (partialDeliveredRef.current) return false;
        try {
          const partialProducts = toProductList(payload);
          if (partialProducts.length === 0) return false;
          partialDeliveredRef.current = true;
          const notice =
            (payload as { fallback?: { message?: string } | null } | undefined)?.fallback
              ?.message ?? null;
          // Sunucu `council_pending: false` derse (fast profil) karne beklenmiyor
          // demektir: kullanıcıya "karne tamamlanıyor" demeyiz.
          const pending =
            (payload as { council_pending?: boolean } | undefined)?.council_pending === true;
          setEnriching(true);
          setCouncilPending(pending);
          opts.onResults(
            attachWinnerScores(partialProducts),
            (payload as { rejected?: RejectedCandidate[] } | undefined)?.rejected ?? [],
            notice,
            pending,
          );
          setFallbackNotice(notice);
          setSearchError(null);
          setStalled(false);
          if (pending) {
            toast.info(
              `${partialProducts.length} canlı doğrulanmış ürün hazır — AI Konsey karneleri arka planda tamamlanıyor.`,
            );
          }
          return true;
        } catch {
          return false;
        }
      };

      while (Date.now() < deadline) {
        const job = await getDiscoveryJobFn({ data: { jobId } });
        if (job.status === "failed") {
          // Ön sonuç zaten gösterildiyse kullanıcıyı sonuçsuz bırakma: hata
          // yalnızca karne turuna aittir, ürünler canlı doğrulanmıştır.
          if (partialDeliveredRef.current) {
            throw new Error(
              `DISCOVERY_JOB_COUNCIL_TAIL_FAILED: ${job.error || "konsey karnesi tamamlanamadı"}`,
            );
          }
          throw new Error(job.error || "Arama tamamlanamadı.");
        }
        if (job.result) {
          if (job.status === "completed") return job.result;
          // `status: processing` + `result` dolu = ön sonuç.
          deliverPartial(job.result);
        }
        const waitMs =
          elapsedMs < POLL_BACKOFF_AFTER_MS
            ? intervalMs
            : Math.max(intervalMs, POLL_SLOW_INTERVAL_MS);
        if (Date.now() + waitMs >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        elapsedMs += waitMs;
      }
      if (partialDeliveredRef.current) {
        throw new Error(
          `DISCOVERY_JOB_COUNCIL_TAIL_TIMEOUT: konsey karneleri ${Math.round(maxWaitMs / 60_000)} dakikalık pencere içinde yetişmedi.`,
        );
      }
      throw new Error(
        `DISCOVERY_JOB_TIMEOUT: Arka plan analizi ${Math.round(maxWaitMs / 60_000)} dakika içinde tamamlanmadı.`,
      );
    },
    onSuccess: (res, vars) => {
      partialDeliveredRef.current = false;
      setEnriching(false);
      setCouncilPending(false);
      try {
        const products = toProductList(res);
        const fallbackMessage =
          (res as { fallback?: { message?: string } | null } | undefined)?.fallback?.message ?? null;
        // Hat 280 sn ile sınırlı: konsey karneye yer kalmadıysa bunu dürüstçe
        // söyle ("neden bazı ürünlerde konsey kartı yok?" sorusunun cevabı).
        const councilSkipped = Boolean(
          (res as { skipped_council?: boolean } | undefined)?.skipped_council,
        );
        opts.onResults(
          products.length > 0 ? attachWinnerScores(products) : [],
          (res as { rejected?: RejectedCandidate[] } | undefined)?.rejected ?? [],
          fallbackMessage,
        );
        setFallbackNotice(
          fallbackMessage ??
            (councilSkipped
              ? "AI Konsey karneye bu koşuda yer kalmadı (280 sn hat sınırı). Ürünler hibrit motorla puanlandı; aynı nişi tekrar aradığında karne önbellekten daha hızlı gelir."
              : null),
        );
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
      } else if (partialDeliveredRef.current) {
        // Ön sonuç ekranda: hata yalnızca konsey karne turuna ait. Ürünleri
        // silmek kullanıcıyı haksız yere sonuçsuz bırakırdı.
        partialDeliveredRef.current = false;
        setEnriching(false);
        setCouncilPending(false);
        setStalled(false);
        toast.warning(
          "AI Konsey karneleri tamamlanamadı. Canlı doğrulanmış ürünler ve puanları korundu.",
        );
      } else {
        opts.onClearResults();
        setFallbackNotice(null);
        setStalled(false);
        setSearchError({ ...describeSearchFailure(err.message), raw: err.message });
      }
    },
    onSettled: () => {
      setEnriching(false);
      setCouncilPending(false);
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
      partialDeliveredRef.current = false;
      setEnriching(false);
      setCouncilPending(false);
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
      setEnriching(false);
      setCouncilPending(false);
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
      setEnriching(false);
      setCouncilPending(false);
      partialDeliveredRef.current = false;
      searchNicheRef.current = nicheValue;

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

      // İş kuyruğa alınana kadar geçerli varsayılan; sunucudan plan gelince
      // mutationFn içinde gerçek bütçeyle yeniden kurulur.
      armSafetyTimer(DEFAULT_POLL_MAX_MS + SAFETY_GRACE_MS);

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
      armSafetyTimer,
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
    /** Ön sonuç ekranda, hat hâlâ sürüyor (sonuç listesini gösterir). */
    enriching,
    /** AI Konsey karne turu hâlâ bekleniyor (yalnızca dürüst durum rozetini açar). */
    councilPending,
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
