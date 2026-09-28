import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { describeSearchFailure, type SearchErrorState } from "@/components/search-states";
import { countryName } from "@/lib/countries";
import { countryFit } from "@/lib/platform-market";
import type { WinningProduct, Platform, Budget } from "@/lib/gemini.functions";
import { generateProducts, getDiscoveryJob } from "@/lib/gemini.functions";
import {
  getDiscoveryPreflight,
  advanceDiscoveryRun,
  startDiscoveryRun,
  type DiscoveryWinner,
} from "@/lib/product-discovery.functions";
import type { EngineId, MarketplaceId } from "@/lib/engines";
import type { DeepSearchOptions } from "@/components/deep-search-panel";
import type { RejectedCandidate } from "@/components/winner-score-panel";
import { attachWinnerScores } from "@/lib/winner-score";
import { saveAnalysis } from "@/lib/analysis.functions";
import { insertProductsFromAnalysis } from "@/lib/products.functions";
import { toProductList } from "../utils/response";
import { toWinningProducts, discoverySetupNotice } from "../utils/discovery-result";
import { setDiscoveryPipelineActive } from "../utils/discovery-progress-store";

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

/**
 * YENİ HATIN YOKLAMA BÜTÇESİ.
 *
 * Dört adım Vercel'de QStash ile arka planda çalışır; tipik koşu 1-3
 * dakika sürer. Tavan eski hatla AYNI sözü tutar (280 sn) ki kullanıcı iki
 * yol arasında fark görmesin. Süre dolarsa eski hat devreye girer.
 */
const PIPELINE_MAX_WAIT_MS = DEFAULT_POLL_MAX_MS;
/** Adım adım ilerleme 1,5 sn'de bir görünür; yoklama bu sıklıkta yapılır. */
const PIPELINE_POLL_MS = 1_500;
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
  const startDiscoveryFn = useServerFn(startDiscoveryRun);
  // SÜRÜCÜ: yoklama aynı zamanda zinciri ilerletir. Kuyruk yoksa iş bu şekilde
  // ilerler; kuyruk/arka plan varsa çağrı atomik sahiplenme sayesinde hiçbir
  // şeyi ikiye katlamaz, yalnız güncel durumu döner.
  const getDiscoveryRunFn = useServerFn(advanceDiscoveryRun);
  const getPreflightFn = useServerFn(getDiscoveryPreflight);

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
  /**
   * Hangi hat koşuyor? Arayüzün bekleme adımlarını HATTA GÖRE değiştirmesi
   * için gerekir: yeni hatta "kazıma → 75 → Gemini 25 → 14 ajan → ilk 5",
   * klasik hatta eski metin. Değer ayrı bir depoda tutulur çünkü tüketicisi
   * başka bir bileşen (bekleme modalı); prop zinciri kurmak yerine tek
   * satırlık yayın/abone bağı kurmak daha dayanıklı. Bkz.
   * `discovery-progress-store.ts`.
   */
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

      // Bekleme bütçesi sunucudan gelir; ürün bulucu tek bir söz verir:
      // uçtan uca 280 sn (`jobPollingPlan`). Ön sonuç mekanizması sayesinde bu
      // pencere yalnızca ÜST SINIRdır: ürünler tipik olarak ~1,5-2 dk'da görünür.
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
          (res as { fallback?: { message?: string } | null } | undefined)?.fallback?.message ??
          null;
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
        saveAnalysisFn({
          data: {
            search_query: `${vars.niche} · ${vars.category} · ${vars.budget}`,
            results: products,
          },
        }).catch(() => {});
        insertProductsFn({ data: { products, target_country: vars.target_country } }).catch(
          () => {},
        );
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

  // HuggingFace yolu (Llama/Qwen/Hybrid) KALDIRILDI: bu seçenekler seçiliyken
  // ürün arama Product Discovery hattını hiç denemeden klasik üretime geçiyordu.
  // `hfFn`, `storedHfToken` ve `hfGen` referansları da aynı sebepten kaldırıldı.

  /**
   * ESKİ HATA: YENİ HAT — BİRİNCİL YOL.
   *
   * Kazıma → deterministik filtre (Top 75) → Gemini kısa liste (25) → 14 ajan →
   * Top 5. Dört adım QStash'e bölünmüş hâlde arka planda çalışır; bu
   * fonksiyon yalnız başlatır ve yoklar.
   *
   * GERİ DÜŞME SÖZLEŞMESİ: yeni hat kurulamazsa (kuyruk yok, QStash yok,
   * zaman aşımı) `fallback` döner ve `onSuccess` ESKİ hatta (`gen.mutate`)
   * düşer. Yani yeni hatın bir sorunu ürün arama özelliğini KAPATMAZ — yalnız
   * eski yol devreye girer. Kullanıcı farkı görmez, hat çalışır.
   *
   * Kredi: yeni hat krediyi kendi düşer (`startDiscoveryRun`). Düşülemezse
   * `no-credits` döner ve ESKİ hat DENEMEZ — yoksa kullanıcı iki kez ücret
   * öderdi. Kuyruk/timeout gibi "para alındı ama iş yapılmadı" durumlarında
   * yeni hat krediyi tam bir kez iade eder, sonra eski hat kendi kredisini
   * düşer: net bir kredi.
   */
  const pipeline = useMutation({
    mutationFn: async (
      vars: GenVars,
    ): Promise<
      | { ok: true; rows: DiscoveryWinner[] }
      | { ok: false; fallback: true; reason: string; paid: boolean }
    > => {
      const country =
        vars.target_country === "GLOBAL"
          ? "US"
          : vars.target_country.slice(0, 2).toUpperCase() || "US";
      const started = await startDiscoveryFn({
        data: {
          niche: vars.niche,
          country,
          platform: (vars.platforms[0] ?? "General").slice(0, 40),
          topN: 5,
        },
      });
      if (!started.ok) {
        // Kredi bittiyse düşme: kullanıcıya yükseltme gösterilir.
        if (started.reason === "no-credits" || started.reason === "credit-unavailable") {
          throw new Error(started.reason === "no-credits" ? "NO_CREDITS" : "CREDIT_UNAVAILABLE");
        }
        return { ok: false, fallback: true, reason: started.detail ?? "queue_failed", paid: false };
      }

      armSafetyTimer(PIPELINE_MAX_WAIT_MS);
      // Yeni hat GERÇEKTEN kuruldu (kredi düşüldü, iş kaydı açıldı, ilk adım
      // kuyruğa alındı). Bundan sonra modal doğru adımları göstermeli.
      setDiscoveryPipelineActive(true);
      const deadline = Date.now() + PIPELINE_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        const state = await getDiscoveryRunFn({ data: { runId: started.runId } });
        // Sahiplik reddi (başkasının runId'si) veya satırın kaybolması.
        if (!state.ok) return { ok: false, fallback: true, reason: "run_not_visible", paid: false };
        if (state.status === "failed") {
          return {
            ok: false,
            fallback: true,
            reason: state.error ?? "pipeline_failed",
            paid: false,
          };
        }
        if (state.status === "completed") {
          const rows = state.result?.products ?? [];
          if (rows.length === 0) {
            return { ok: false, fallback: true, reason: "empty_result", paid: true };
          }
          return { ok: true, rows };
        }
        await new Promise((resolve) => setTimeout(resolve, PIPELINE_POLL_MS));
      }
      // Zaman aşımı: iş hâlâ koşuyor olabilir, kredi HARCANMIŞTIR.
      return { ok: false, fallback: true, reason: "timeout", paid: true };
    },
    onSuccess: (outcome, vars) => {
      if (!outcome.ok) {
        if (outcome.paid) {
          // Kredi harcanmış durumda: eski hat KENDİ kredisini düşeceği için
          // düşmek, kullanıcıyı aynı arama için İKİ KEZ ücretlendirmek demek.
          // Kullanıcı dürüstçe bilgilendirilir; ikinci kez denemesi yeterli.
          toast.error(
            "Arama zaman aşımına uğradı ve kredi bu çalışma için kullanıldı. Tekrar denemek istersen kredi düşülecek.",
          );
          setStalled(false);
          return;
        }
        // Kredi İADE EDİLMİŞ durumda (kuyruk/hata) → eski hatta düşmek bedava.
        console.warn(`[finder] yeni hat düştü (${outcome.reason}) — eski hatta geri dönülüyor`);
        // DÜRÜST BİLDİRİM: eskiden tek satırlık genel bir mesaj vardı ve kullanıcı
        // hatta ne olduğunu öğrenemiyordu. "5 ürün" gördüğü için hattın hiç
        // çalışmadığını fark etmiyordu. Artık ekranda: sebep + eksik olan şey +
        // ÇÖZÜM yazıyor. Teşhis `getDiscoveryPreflight` sunucu fonksiyonuyla
        // çekilir (HTTP ucu tarayıcıdan açılamaz: Bearer başlığı ister).
        setFallbackNotice(discoverySetupNotice(outcome.reason, null));
        void getPreflightFn({ data: {} })
          .then((report) => setFallbackNotice(discoverySetupNotice(outcome.reason, report)))
          .catch(() => {
            /* teşhis alınamazsa yukarıdaki kısa mesaj kalır */
          });
        gen.mutate(vars);
        return;
      }
      const products = attachWinnerScores(toWinningProducts(outcome.rows, outcome.rows));
      partialDeliveredRef.current = false;
      setEnriching(false);
      setCouncilPending(false);
      opts.onResults(products, [], null);
      setStalled(false);
      setSearchError(null);
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(`${products.length} ürün 14 ajan konsesiyle seçildi.`);
      saveAnalysisFn({
        data: {
          search_query: `${vars.niche} · ${vars.category} · ${vars.budget}`,
          results: products,
        },
      }).catch(() => {});
      insertProductsFn({
        data: { products, target_country: vars.target_country },
      }).catch(() => {});
    },
    onError: (err: Error) => {
      setStalled(false);
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits — upgrade to keep going.");
        opts.onNeedUpgrade();
        return;
      }
      if (err.message.includes("CREDIT_UNAVAILABLE")) {
        opts.onClearResults();
        setSearchError({
          kind: "auth",
          title: "Kredi alınamadı",
          body: err.message,
          hint: "",
          raw: err.message,
        });
        return;
      }
      opts.onClearResults();
      setSearchError({ ...describeSearchFailure(err.message), raw: err.message });
    },
    onSettled: () => {
      setStalled(false);
      setDiscoveryPipelineActive(false);
      if (searchSafetyTimerRef.current) clearTimeout(searchSafetyTimerRef.current);
    },
  });
  /**
   * Bekleme göstergesi üç yolun birleşimidir: yeni hat, eski hat, HF motoru.
   * `pipeline` YUKARIDA tanımlıdır; aşağıda yazmak TDZ hatası verirdi.
   */
  const searching = gen.isPending || pipeline.isPending;

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
        const allBlocked = opts.platforms.every(
          (p) => countryFit(p, opts.effectiveCountry) === "unavailable",
        );
        if (!allBlocked) return opts.platforms;
        const cb = opts.platforms
          .filter((p) => countryFit(p, opts.effectiveCountry) === "cross-border")
          .slice(0, 3);
        if (cb.length > 0) {
          toast.info(
            `All selected platforms are unavailable in ${countryName(opts.effectiveCountry)}. Using cross-border options.`,
          );
          return cb;
        }
        const globalFallback = ["Amazon", "Shopify", "eBay"].filter(
          (p) => countryFit(p as Platform, opts.effectiveCountry) !== "unavailable",
        ) as Platform[];
        if (globalFallback.length > 0) {
          toast.info(
            `Switching to global platforms for ${countryName(opts.effectiveCountry)} market.`,
          );
          return globalFallback;
        }
        return opts.platforms;
      })();

      // İş kuyruğa alınana kadar geçerli varsayılan; sunucudan plan gelince
      // mutationFn içinde gerçek bütçeyle yeniden kurulur.
      armSafetyTimer(DEFAULT_POLL_MAX_MS + SAFETY_GRACE_MS);

      // SEÇİCİ ARTIK TEK MOTOR: `llama`/`qwen`/`hybrid` seçenekleri kaldırıldı
      // ve `normalizeEngineId` tarayıcıda kalmış eski bir seçimi de "default"a
      // indirir (bkz. `src/lib/engines.ts`). Bu yüzden burada motor kontrolü
      // YOK: yeni hat her zaman birincil yoldur; başlatma/sonuç başarısız
      // olursa `pipeline` kendi içinde eski hatta (`gen`) düşer ve sebebi
      // ekranda yazar.
      pipeline.mutate({
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
    runSearch,
    setSearchError,
    setStalled,
  };
}
