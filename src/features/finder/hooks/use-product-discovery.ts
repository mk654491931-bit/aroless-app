// ============================================================================
// PRODUCT DISCOVERY — İSTEMCİ HOOK'U.
//
// Uzaktaki (düzeltilmiş) hat iki sunucu fonksiyonu sunar; bu hook onların
// üzerine kurulur ve BAŞKA BİR ŞEY BİLMEZ:
//
//   • `startDiscoveryRun`   → koşuyu başlatır, `{ ok, runId }` döner.
//   • `advanceDiscoveryRun` → zinciri biraz ilerletir VE güncel durumu döner.
//   • `getDiscoveryRun`     → yalnız durum (kuyruk/arka plan yolu için).
//
// NEDEN DOĞRUDAN HTTP DEĞİL: `requireUser` `Authorization: Bearer` başlığı
// zorunlu kılar, `EventSource` ise tarayıcıda başlık gönderemez. Sunucu
// fonksiyonları jetonu sunucu tarafında kullanır; kimlik doğrulama hem
// doğru hem de hat üzerinde başka karışıklık bırakmaz.
//
// SÜRÜCÜ YOKLAMASI (en önemli değişiklik): yoklama artık YALNIZ okumuyor,
// zinciri de ilerletiyor. Nedeni: QStash yapılandırılmamış bir kurulumda ağır
// işi taşıyacak başka bir şey yoktur ve tüm zinciri tek istekte koşturmak
// sunucusuz süre tavanına dayanır. Her yoklama bir parça ilerler; iş nerede
// kaldıysa veritabanındaki ara noktadan devam eder. Kuyruk ya da süreç içi
// arka plan varsa sunucu zaten onları kullanır ve bu çağrı zararsız biçimde
// "hiçbir şey yapmadan" güncel durumu döner (atomik sahiplenme).
//
// YOKLAMA ARALIĞI: ilk 15 sn hızlı (2 sn), sonrası seyrek (4 sn).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { advanceDiscoveryRun, startDiscoveryRun } from "@/lib/product-discovery.functions";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";
import type {
  Consensus,
  ProductDiscoveryInput,
  ProductDiscoveryStatus,
} from "@/lib/product-discovery.types";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const SLOW_POLL_INTERVAL_MS = 4_000;
/** Hızlı yoklamadan seyrek yoklamaya geçiş eşiği. */
const POLL_BACKOFF_AFTER_MS = 15_000;
/** Bu süre içinde hiç ilerleme yoksa yoklama bırakılır (takılı iş). */
const STALL_TIMEOUT_MS = 240_000;

const TERMINAL: readonly string[] = ["completed", "failed"];

export type DiscoveryRun = {
  runId: string | null;
  status: ProductDiscoveryStatus;
  progress: number;
  step: string | null;
  products: DiscoveryWinner[];
  consensus: Consensus[];
  error: string | null;
};

const EMPTY: DiscoveryRun = {
  runId: null,
  status: "queued",
  progress: 0,
  step: null,
  products: [],
  consensus: [],
  error: null,
};

export function useProductDiscovery(): {
  start: (input: ProductDiscoveryInput) => Promise<boolean>;
  isStarting: boolean;
  isRunning: boolean;
  run: DiscoveryRun;
  reset: () => void;
} {
  const qc = useQueryClient();
  const startFn = useServerFn(startDiscoveryRun);
  const statusFn = useServerFn(advanceDiscoveryRun);

  const [isStarting, setIsStarting] = useState(false);
  const [run, setRun] = useState<DiscoveryRun>(EMPTY);

  const reset = useCallback(() => setRun(EMPTY), []);

  const start = useCallback(
    async (input: ProductDiscoveryInput): Promise<boolean> => {
      setIsStarting(true);
      setRun({ ...EMPTY, status: "queued", progress: 5, step: "scrape_filter" });
      try {
        const res = await startFn({ data: input });
        if (!res?.ok || !res.runId) {
          // Sunucu her reddedişte krediyi İADE EDER (no-credits hariç — o zaman
          // zaten kredi yoktur). Mesaj dürüstçe ne olduysa onu söyler.
          const reason = res && "reason" in res ? String(res.reason) : "bilinmeyen";
          const message =
            reason === "no-credits"
              ? "Kredi yok — yükseltme yapmadan devam edemezsin."
              : reason === "credit-unavailable"
                ? "Kredi servisi şu an yanıt vermiyor. Tekrar dene."
                : "Arama başlatılamadı. Jeton iade edildi.";
          toast.error(message);
          setRun(EMPTY);
          return false;
        }
        setRun((prev) => ({ ...prev, runId: res.runId! }));
        toast.success("Arama başlatıldı — kaynaklar taranıyor.");
        void qc.invalidateQueries({ queryKey: ["profile"] });
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Arama başlatılamadı.");
        setRun(EMPTY);
        return false;
      } finally {
        setIsStarting(false);
      }
    },
    [startFn, qc],
  );

  // Yoklama döngüsü. `runId` dolduğunda başlar, terminal durumda veya
  // unmount'ta durur.
  const runId = run.runId;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await statusFn({ data: { runId } });
        if (cancelled) return;

        if (!res?.ok) {
          // 403/404 kalıcı: kayıt yok ya da başkasının. Döngü biter.
          setRun((prev) => ({ ...prev, status: "failed", error: "Bu işe erişim yok." }));
          return;
        }

        setRun((prev) => ({
          ...prev,
          status: (res.status as ProductDiscoveryStatus) ?? prev.status,
          progress: Math.max(0, Math.min(100, Number(res.progress ?? 0))),
          step: res.step || null,
          products: res.result?.products ?? prev.products,
          consensus: res.result?.consensus ?? prev.consensus,
          error: res.error ?? null,
        }));

        if (TERMINAL.includes(res.status)) {
          const found = res.result?.products.length ?? 0;
          if (res.status === "completed") {
            if (found > 0) toast.success(`${found} kazanan ürün bulundu.`);
            else
              toast.warning(
                "Arama tamamlandı ama ölçülebilir kanıtlı ürün çıkmadı. Daha dar bir niş dene.",
              );
          } else {
            toast.error(res.error ?? "Arama başarısız oldu — jeton iade edildi.");
          }
          void qc.invalidateQueries({ queryKey: ["profile"] });
          return;
        }

        // Kademeli yoklama: ilk 15 sn hızlı, sonrası seyrek.
        if (Date.now() - startedAt > STALL_TIMEOUT_MS) {
          setRun((prev) => ({ ...prev, status: "failed", error: "Arama zaman aşımına uğradı." }));
          return;
        }
        const interval =
          Date.now() - startedAt < POLL_BACKOFF_AFTER_MS
            ? DEFAULT_POLL_INTERVAL_MS
            : SLOW_POLL_INTERVAL_MS;
        timer = setTimeout(poll, interval);
      } catch {
        if (cancelled) return;
        // Tek başarısız yoklama işi öldürmez; süre aşımına kadar sürülür.
        if (Date.now() - startedAt > STALL_TIMEOUT_MS) {
          setRun((prev) => ({
            ...prev,
            status: "failed",
            error: "Sunucuya ulaşılamadı; arama durduruldu.",
          }));
          return;
        }
        timer = setTimeout(poll, SLOW_POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, statusFn, qc]);

  return {
    start,
    isStarting,
    isRunning: runId !== null && !TERMINAL.includes(run.status),
    run,
    reset,
  };
}
