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

import {
  advanceDiscoveryRun,
  findMeasuredWinners,
  startDiscoveryRun,
} from "@/lib/product-discovery.functions";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";
import type {
  Consensus,
  FilterStats,
  ProductDiscoveryInput,
  ProductDiscoveryStatus,
  TopProduct,
} from "@/lib/product-discovery.types";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const SLOW_POLL_INTERVAL_MS = 4_000;
/** Hızlı yoklamadan seyrek yoklamaya geçiş eşiği. */
const POLL_BACKOFF_AFTER_MS = 15_000;
/**
 * GERÇEK TAKILMA EŞİĞİ — ilerleme HİÇ değişmezse bu kadar beklenir.
 *
 * ÖNEMLİ DÜZELTME: eskiden bu deger "başlangıçtan geçen süre" olarak
 * kullanılıyordu, yani 4. dakikadaki sağlıklı bir konsey turunu da "takıldı"
 * sayıp işi `failed` işaretliyordu. Kullanıcı hat çalışırken "zaman aşımı"
 * görüyor, job ise sunucuda tamamlanıyordu. Şimdi ölçüt "İLERLEME DEĞİŞMEDİ"
 * süresidir.
 */
const STALL_TIMEOUT_MS = 180_000;
/**
 * MUTLAK TAVAN — yoklama en fazla bu kadar sürer.
 *
 * NEDEN 9 DAKİKA: hat kendi bütçesinde (Vercel Hobby 300 sn) bölünebilir ve
 * her adımı kendi penceresinde bitirir; istemci yalnız izleyicidir. 14 ajan
 * turu + kazıma normalde ~2 dk'da biter, bu tavan yalnız istisnai yavaş
 * koşuları yakalar.
 */
const ABSOLUTE_TIMEOUT_MS = 540_000;

const TERMINAL: readonly string[] = ["completed", "failed"];

export type DiscoveryRun = {
  runId: string | null;
  status: ProductDiscoveryStatus;
  progress: number;
  step: string | null;
  products: DiscoveryWinner[];
  consensus: Consensus[];
  /**
   * Sunucunun ilk adımda ölçtüğü kaynak/filtre sayaçları. Sonuç ekranındaki
   * "hangi kaynak çağrıldı / anahtarsız / hata verdi" panelinin TEK kaynağı;
   * yoksa panel gösterilmez.
   */
  stats: FilterStats | null;
  /**
   * Nihai ürünlerin sözleşmesi (`top_products`, varsayılan 5 / üst sınır 10). Sunucu tarafında kalıcı sonuca
   * yazıldığı için TÜM taşıyıcılarda (qstash / arka plan / yoklama) dolar;
   * eski koşularda boştur ve arayüz sessizce ürün kartlarına düşer.
   */
  topProducts: TopProduct[];
  error: string | null;
  /**
   * Kalıcı iş kaydı açılamadığında hat ölçülmüş kazananlara düştüyse dolar.
   * Arayüz bunu "14 ajan koştu" gibi göstermez; kaynağı açıkça yazar.
   */
  note: string | null;
  /** Bu sonuç DB'siz ölçülmüş yoldan mı geldi? */
  measured: boolean;
};

const EMPTY: DiscoveryRun = {
  runId: null,
  status: "queued",
  progress: 0,
  step: null,
  products: [],
  consensus: [],
  stats: null,
  topProducts: [],
  error: null,
  note: null,
  measured: false,
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
  const measuredFn = useServerFn(findMeasuredWinners);

  const [isStarting, setIsStarting] = useState(false);
  const [run, setRun] = useState<DiscoveryRun>(EMPTY);

  const reset = useCallback(() => setRun(EMPTY), []);

  /**
   * DB'SİZ YEDEK — Büyüme Suite'in boş kalmasını engeller.
   *
   * `startDiscoveryRun` iş kaydını Supabase'e yazar. Servis rolü/migration
   * yoksa kayıt açılamaz ve sunucu `queue-failed` döner (krediyi iade eder).
   * Eski istemci bu durumda yalnız toast gösterip ekranı boşaltıyordu; kullanıcı
   * "Büyüme Suite çalışmıyor" diyordu. Oysa kazıma + filtre hattı DB'ye ihtiyaç
   * duymaz: `findMeasuredWinners` aynı gerçek satırları tek istekte döndürür.
   *
   * DÜRÜSTLÜK: bu yol 14 ajanlık konseyi ÇALIŞTIRMAZ. Sonuç "ölçülmüş" olarak
   * etiketlenir ve arayüz bunu ayrı bir notla söyler.
   */
  const runMeasuredFallback = useCallback(
    async (input: ProductDiscoveryInput): Promise<boolean> => {
      setRun((prev) => ({
        ...prev,
        status: "queued",
        progress: 10,
        step: "measured",
        stats: null,
        note: "İş kaydı açılamadı; doğrudan ölçülmüş kazananlara geçiliyor.",
        measured: true,
      }));
      try {
        const res = await measuredFn({
          data: {
            niche: input.niche,
            country: input.country,
            platform: input.platform,
            topN: Math.max(3, Math.min(10, input.topN)),
          },
        });
        if (!res?.ok) {
          const message =
            res?.reason === "empty"
              ? "Bu niş için ölçülebilir kanıtlı ürün çıkmadı. Daha dar bir niş dene."
              : res?.reason === "no-credits"
                ? "Kredi yok — ölçülmüş arama da başlatılamadı."
                : res?.reason === "plan-limit"
                  ? "Paketinin aylık kullanım hakkı doldu."
                  : "Ölçülmüş arama da tamamlanamadı.";
          toast.error(message);
          setRun({
            ...EMPTY,
            status: "completed",
            progress: 100,
            step: "measured",
            error: message,
            measured: true,
          });
          return false;
        }
        setRun({
          ...EMPTY,
          status: "completed",
          progress: 100,
          step: "measured",
          products: res.rows,
          stats: null,
          note:
            "14 ajanlık konsey çalışmadı (kalıcı iş kaydı yok). Aşağıdaki ürünler " +
            "kazınmış fiyat, puan, satış ve kaynak kanıtıyla sıralandı; AI anahtarı " +
            "varsa yalnızca mevcut gerçek satırlar arasından seçim yaptı, yoksa sıralama " +
            "deterministik kaldı.",
          measured: true,
        });
        toast.success(`${res.rows.length} ölçülmüş kazanan bulundu.`);
        void qc.invalidateQueries({ queryKey: ["profile"] });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Ölçülmüş arama başlatılamadı.";
        toast.error(message);
        setRun({
          ...EMPTY,
          status: "completed",
          progress: 100,
          step: "measured",
          error: message,
          measured: true,
        });
        return false;
      }
    },
    [measuredFn, qc],
  );

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
            reason === "plan-limit"
              ? // Paket limiti: bakiye var, aylık hak bitti. Sunucunun dürüst
                // mesajı (hangi hak/kaç adet) varsa o gösterilir.
                (res && "message" in res && typeof res.message === "string" && res.message) ||
                "Paketinin aylık kullanım hakkı doldu."
              : reason === "no-credits"
                ? "Kredi yok — yükseltme yapmadan devam edemezsin."
                : reason === "credit-unavailable"
                  ? "Kredi servisi şu an yanıt vermiyor. Tekrar dene."
                  : "Arama başlatılamadı. Jeton iade edildi.";
          // Yalnız DB'ye bağlı başlatma hatasında ölçülmüş yedeğe düş.
          // Kredi/paket hatalarında ikinci bir ücretli çağrı başlatmak yanlış
          // olurdu: o durumda gerçekten kredi yoktur.
          if (reason === "queue-failed") {
            return await runMeasuredFallback(input);
          }
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
    [startFn, qc, runMeasuredFallback],
  );

  // Yoklama döngüsü. `runId` dolduğunda başlar, terminal durumda veya
  // unmount'ta durur.
  const runId = run.runId;
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    // İlerleme en son ne zaman DEĞİŞTİ? Takılma ölçütü budur (toplam süre değil).
    let lastProgressAt = Date.now();
    let lastFingerprint = "";
    /** Sunucunun son kalp atışı (ms) — çalışan adımın canlılık kanıtı. */
    let lastHeartbeatAt = 0;

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

        // SUNUCU CANLILIĞI — UZUN ADIM İŞİ BIRAKTIRMAZ.
        //
        // `progress`/`step` yalnız adım sınırlarında değişir; 14 ajanın konseyi
        // dakikalarca sürebilir. Eskiden takılma ölçütü yalnız bu alanların
        // değişimine bakıyordu, yani sağlıklı bir `deep` turu ortasında
        // "ilerlemedi" damgası yiyor ve ÜRÜNLER SUNUCUDA HAZIRLANIRKEN ekranda
        // hata kalıyordu. Çalışan adım `updated_at`i 20 sn'de bir tazeler;
        // burada o kalp atışı takılma saatini SIFIRLAR. Ölçüt artık "sunucu
        // nefes almıyor"dur, "yüzde değişmedi" değil.
        const heartbeatAt = Number(res.updatedAt ?? 0);
        if (heartbeatAt && heartbeatAt !== lastHeartbeatAt) {
          lastHeartbeatAt = heartbeatAt;
          lastProgressAt = Date.now();
        }

        setRun((prev) => {
          const next = {
            ...prev,
            status: (res.status as ProductDiscoveryStatus) ?? prev.status,
            progress: Math.max(0, Math.min(100, Number(res.progress ?? 0))),
            step: res.step || null,
            products: res.result?.products ?? prev.products,
            consensus: res.result?.consensus ?? prev.consensus,
            stats: res.stats ?? prev.stats,
            // Sözleşme yalnız terminal sonuçta gelir; ara yoklamada üstüne
            // yazılmaz ( aksi hâlde hazır olmayan bir liste üstüne yazılırdı ).
            topProducts: res.result?.topProducts.length ? res.result.topProducts : prev.topProducts,
            error: res.error ?? null,
            // Ölçülmüş yedek notu DB yoklamasında silinmez; normal işte null'dır.
            note: prev.note,
            measured: prev.measured,
          };
          // İlerleme parmak izi değiştiyse "takılma saati" sıfırlanır.
          const fingerprint = `${next.status}|${next.progress}|${next.step}|${next.products.length}`;
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            lastProgressAt = Date.now();
          }
          return next;
        });

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
        // YARDIMCI: iki ayrı tavan — mutlak (9 dk) ve İLERLEMESİZLİK (3 dk).
        // Eskiden yalnız "başlangıçtan geçen süre" ölçülüyordu ve sağlıklı
        // uzun konsey turları sahte "zaman aşımı" üretiyordu.
        if (Date.now() - startedAt > ABSOLUTE_TIMEOUT_MS) {
          setRun((prev) => ({ ...prev, error: "Arama çok uzun sürdü; sonuç birazdan gelebilir." }));
          return;
        }
        if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
          setRun((prev) => ({
            ...prev,
            status: "failed",
            error: "Arama ilerlemedi ve zaman aşımına uğradı.",
          }));
          return;
        }
        const interval =
          Date.now() - startedAt < POLL_BACKOFF_AFTER_MS
            ? DEFAULT_POLL_INTERVAL_MS
            : SLOW_POLL_INTERVAL_MS;
        timer = setTimeout(poll, interval);
      } catch {
        if (cancelled) return;
        // Tek başarısız yoklama işi öldürmez; sunucu YANIT VERMİYORSA da
        // ilerleme sayacı işler ve gerçekten takılan iş bırakılır.
        if (Date.now() - startedAt > ABSOLUTE_TIMEOUT_MS) {
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
