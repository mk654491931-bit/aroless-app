import { useEffect } from "react";

/**
 * Akıcılık (fluidity) yönetimi — tek kaynak.
 *
 * Amaç: site genelinde donma/tekleme yaratan sürekli çalışan dekoratif işleri
 * (ağır blur katmanları, backdrop-filter, sonsuz animasyonlar, rAF döngüleri)
 * yalnızca gerçekten kaldıramayan cihazlarda/oturumlarda kısmak. Görsel dil
 * aynı kalır; sahne yalnızca hafifler.
 *
 * İki tetikleyici vardır:
 *  1. Cihaz sezgisi: veri tasarrufu, düşük çekirdek/bellek, azaltılmış hareket.
 *  2. Ölçüm: ilk saniyelerde kare süreleri 22 ms'in üzerindeyse (≈45 fps altı)
 *     oturum boyunca `html.perf-lite` açılır.
 *
 * Ayrıca sekme arka plana atıldığında `html.is-hidden` eklenir; CSS bu sınıf
 * altındaki animasyonları duraklatır, böylece kullanıcı geri döndüğünde
 * birikmiş iş yüzünden donma yaşanmaz.
 */

const LITE_CLASS = "perf-lite";
const HIDDEN_CLASS = "is-hidden";
const LITE_EVENT = "fluidity:lite";
const STORAGE_KEY = "aroless.perf-lite";

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

/** Kullanıcı hareket azaltmayı seçtiyse dekoratif animasyonlar çalışmaz. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Cihazın kendi sezgileri: düşük çekirdek/bellek veya veri tasarrufu. */
export function isLiteDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (prefersReducedMotion()) return true;
  const nav = navigator as NavigatorWithHints;
  if (nav.connection?.saveData) return true;
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  if (cores > 0 && cores <= 4) return true;
  if (memory > 0 && memory <= 4) return true;
  return false;
}

/** `html.perf-lite` şu an açık mı? */
export function isLiteMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(LITE_CLASS);
}

/** Hafif modu açar (tek yönlü: oturum boyunca açık kalır). */
export function enableLiteMode(reason = "manual"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.classList.contains(LITE_CLASS)) return;
  root.classList.add(LITE_CLASS);
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* depolama kapalı olabilir */
  }
  console.log(`[fluidity] hafif mod açıldı (${reason})`);
  try {
    window.dispatchEvent(new CustomEvent(LITE_EVENT, { detail: { reason } }));
  } catch {
    /* CustomEvent desteklenmiyorsa yoksay */
  }
}

/** Hafif mod açıldığında çalışır (dekoratif rAF döngülerini durdurmak için). */
export function onLiteMode(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LITE_EVENT, callback);
  return () => window.removeEventListener(LITE_EVENT, callback);
}

/**
 * Kare sağlığını ölçer. Medyan kare süresi 22 ms'i aşıyorsa veya karelerin
 * %20'sinden fazlası uzunsa `false` döner (cihaz akıcı değil).
 */
export async function measureFrameHealth(frames = 75, budgetMs = 22): Promise<boolean> {
  if (typeof window === "undefined" || typeof performance === "undefined") return true;
  if (document.hidden) return true;

  const deltas: number[] = [];
  let last = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      if (delta > 0 && delta < 200) deltas.push(delta);
      if (deltas.length >= frames) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  if (deltas.length < 10) return true;
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const dropped = deltas.filter((d) => d > budgetMs * 2).length / deltas.length;
  return median <= budgetMs && dropped <= 0.2;
}

/** Uygulama başlangıcında bir kez çağrılır (bkz. __root.tsx → useFluidity). */
export function initFluidity(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;

  let stored = false;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    stored = false;
  }
  if (stored) enableLiteMode("session");
  else if (isLiteDevice()) enableLiteMode("device");

  const syncHidden = () => {
    root.classList.toggle(HIDDEN_CLASS, document.hidden);
  };
  syncHidden();

  let cancelled = false;
  let timer: number | null = null;
  let idleId: number | null = null;
  const runMeasure = () => {
    if (cancelled || document.hidden || isLiteMode()) return;
    void measureFrameHealth().then((healthy) => {
      if (!cancelled && !healthy) enableLiteMode("measured-frames");
    });
  };
  const startMeasurement = () => {
    if (cancelled || isLiteMode()) return;
    // İlk boyama + derleme gürültüsü geçtikten sonra, idle zamanında ölç — ana thread bloklanmaz
    const doSchedule = () => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof ric === "function") {
        idleId = ric(() => {
          idleId = null;
          runMeasure();
        }, { timeout: 2800 }) as unknown as number;
      } else {
        timer = window.setTimeout(() => {
          timer = null;
          runMeasure();
        }, 1200) as unknown as number;
      }
    };
    // load sonrası bir miktar bekle, sonra idle'da çalıştır
    timer = window.setTimeout(() => {
      timer = null;
      doSchedule();
    }, 900) as unknown as number;
  };

  // İlk boyama/JS derleme gürültüsü geçtikten sonra ölç.
  if (document.readyState === "complete") startMeasurement();
  else window.addEventListener("load", startMeasurement, { once: true });

  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const onMotionChange = () => {
    if (mq?.matches) enableLiteMode("reduced-motion");
  };
  mq?.addEventListener?.("change", onMotionChange);
  document.addEventListener("visibilitychange", syncHidden);

  return () => {
    cancelled = true;
    if (timer !== null) window.clearTimeout(timer);
    if (idleId !== null) {
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (typeof cic === "function") cic(idleId);
      else clearTimeout(idleId);
    }
    window.removeEventListener("load", startMeasurement);
    document.removeEventListener("visibilitychange", syncHidden);
    mq?.removeEventListener?.("change", onMotionChange);
  };
}

/** Kök bileşende bir kez bağlanır. */
export function useFluidity(): void {
  useEffect(() => initFluidity(), []);
}
