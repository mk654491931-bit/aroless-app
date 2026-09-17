/**
 * Session Persistence & State Management
 * Kullanıcı oturumunu ve durumunu cihazlar arasında eşitleme
 */

interface SessionData {
  lastRoute?: string;
  theme?: "light" | "dark";
  language?: string;
  scrollPositions?: Record<string, number>;
  preferences?: Record<string, unknown>;
  timestamp?: number;
  version?: number;
  lastWebVitals?: Record<string, number>;
  isOnline?: boolean;
}

const SESSION_KEY = "aroless_session";
const SESSION_VERSION = 1;

// --- Debounced idle flush: rapid WebVitals/scroll writes merge into single localStorage write ---
let pendingPatch: Partial<SessionData> | null = null;
let flushTimer: number | null = null;
let flushIdle: number | null = null;
function doFlushSession() {
  flushTimer = null;
  flushIdle = null;
  if (!pendingPatch) return;
  const patch = pendingPatch;
  pendingPatch = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    let existing: SessionData = {};
    if (raw) {
      try {
        existing = JSON.parse(raw) as SessionData;
        if (existing.timestamp && Date.now() - existing.timestamp > 24 * 60 * 60 * 1000) {
          existing = {};
        }
      } catch {
        existing = {};
      }
    }
    const updated: SessionData = { ...existing, ...patch, timestamp: Date.now(), version: SESSION_VERSION };
    localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  } catch {
    /* storage kapalı */
  }
}
function scheduleSessionFlush() {
  if (flushTimer !== null || flushIdle !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") {
      flushIdle = ric(() => doFlushSession(), { timeout: 1500 }) as unknown as number;
    } else {
      doFlushSession();
    }
  }, 120) as unknown as number;
}

/**
 * Session Storage Management
 */
export const sessionManager = {
  /**
   * Oturumu localStorage'dan al — pendingPatch ile birleştirir (debounce sırasında tutarlılık)
   */
  getSession(): SessionData | null {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      let data: SessionData | null = null;
      if (stored) {
        data = JSON.parse(stored) as SessionData;
        if (data.timestamp && Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
          sessionManager.clearSession();
          return pendingPatch ? ({ ...pendingPatch } as SessionData) : null;
        }
      }
      if (pendingPatch) {
        return { ...(data ?? {}), ...pendingPatch } as SessionData;
      }
      return data;
    } catch (error) {
      console.error("Session restore failed:", error);
      return pendingPatch ? ({ ...pendingPatch } as SessionData) : null;
    }
  },

  /**
   * Oturumu kaydet — idle'da tek yazıma birleştirilir (ana thread bloklanmaz)
   */
  saveSession(data: Partial<SessionData>) {
    if (typeof window === "undefined") return;
    pendingPatch = { ...(pendingPatch ?? {}), ...data };
    scheduleSessionFlush();
  },

  /**
   * Belirli bir alanı güncelle (debounced)
   */
  updateField<K extends keyof SessionData>(key: K, value: SessionData[K]) {
    if (typeof window === "undefined") return;
    pendingPatch = { ...(pendingPatch ?? {}), [key]: value } as Partial<SessionData>;
    scheduleSessionFlush();
  },

  /**
   * Oturumu temizle — bekleyen yazımı da iptal eder
   */
  clearSession() {
    try {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (flushIdle !== null) {
        const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cic === "function") cic(flushIdle);
        else clearTimeout(flushIdle);
        flushIdle = null;
      }
      pendingPatch = null;
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error("Session clear failed:", error);
    }
  },

  /**
   * Scroll konumunu kaydet — 120ms debounce + idle flush
   */
  saveScrollPosition(route: string, position: number) {
    if (typeof window === "undefined") return;
    const current = pendingPatch?.scrollPositions ?? sessionManager.getSession()?.scrollPositions ?? {};
    const next = { ...current, [route]: position };
    pendingPatch = { ...(pendingPatch ?? {}), scrollPositions: next };
    scheduleSessionFlush();
  },

  /**
   * Scroll konumunu al
   */
  getScrollPosition(route: string): number {
    const session = sessionManager.getSession();
    return session?.scrollPositions?.[route] ?? 0;
  },
};

/**
 * React Hook - Oturumu yönet
 */
import { useEffect, useState, useCallback } from "react";

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Session'ı başlat
  useEffect(() => {
    const savedSession = sessionManager.getSession();
    setSession(savedSession);
    setIsLoaded(true);
  }, []);

  // Session'ı kaydet (debounced)
  const saveSession = useCallback((data: Partial<SessionData>) => {
    sessionManager.saveSession(data);
    setSession((prev) => (prev ? { ...prev, ...data } : null));
  }, []);

  return { session, isLoaded, saveSession };
}

/**
 * Network Status Awareness - Bağlantı durumuna göre optimize et
 */
export const networkAwareness = {
  /**
   * Ağ bağlantı hızını kontrol et
   */
  getEffectiveType(): "slow-2g" | "2g" | "3g" | "4g" | "5g" | "unknown" {
    if (typeof window === "undefined") return "unknown";
    const connection = (navigator as any).connection || (navigator as any).mozConnection;
    return connection?.effectiveType ?? "unknown";
  },

  /**
   * Ağ bağlantısı var mı?
   */
  isOnline(): boolean {
    if (typeof window === "undefined") return true;
    return navigator.onLine;
  },

  /**
   * Ağ hızına göre chunk boyutunu ayarla
   */
  getOptimalChunkSize(): number {
    const type = networkAwareness.getEffectiveType();
    switch (type) {
      case "slow-2g":
      case "2g":
        return 50 * 1024; // 50KB
      case "3g":
        return 200 * 1024; // 200KB
      case "4g":
        return 500 * 1024; // 500KB
      case "5g":
        return 1024 * 1024; // 1MB
      default:
        return 200 * 1024;
    }
  },

  /**
   * Ağ bağlantı yavaşsa optimizasyon yapılabilir
   */
  isSlowNetwork(): boolean {
    const type = networkAwareness.getEffectiveType();
    return type === "slow-2g" || type === "2g" || type === "3g";
  },

  /**
   * Bağlantı durumu değişikliğini dinle
   */
  onConnectionChange(callback: (online: boolean) => void) {
    if (typeof window === "undefined") return () => {};

    window.addEventListener("online", () => callback(true));
    window.addEventListener("offline", () => callback(false));

    return () => {
      window.removeEventListener("online", () => callback(true));
      window.removeEventListener("offline", () => callback(false));
    };
  },
};

/**
 * React Hook - Network Awareness
 */
export function useNetworkAwareness() {
  const [isOnline, setIsOnline] = useState(true);
  const [effectiveType, setEffectiveType] = useState<string>("unknown");

  useEffect(() => {
    setIsOnline(networkAwareness.isOnline());
    setEffectiveType(networkAwareness.getEffectiveType());

    const unsubscribe = networkAwareness.onConnectionChange(setIsOnline);
    return unsubscribe;
  }, []);

  return {
    isOnline,
    effectiveType,
    isSlowNetwork: networkAwareness.isSlowNetwork(),
  };
}

/**
 * DeviceType Detection - Cihaz türüne göre optimize et
 */
export const deviceDetection = {
  /**
   * Cihazın tipini al
   */
  getDeviceType(): "mobile" | "tablet" | "desktop" {
    if (typeof window === "undefined") return "desktop";
    const width = window.innerWidth;

    if (width < 768) return "mobile";
    if (width < 1024) return "tablet";
    return "desktop";
  },

  /**
   * Mobil mi?
   */
  isMobile(): boolean {
    return deviceDetection.getDeviceType() === "mobile";
  },

  /**
   * Touch device mi?
   */
  isTouchDevice(): boolean {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(hover: none)").matches ||
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0
    );
  },

  /**
   * Cihaz pixel oranı
   */
  getPixelRatio(): number {
    if (typeof window === "undefined") return 1;
    return window.devicePixelRatio ?? 1;
  },

  /**
   * Renk şemasını kontrol et (dark mode)
   */
  getDarkModePreference(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  },

  /**
   * Hafif modu kontrol et (veri tasarrufu)
   */
  isDataSaver(): boolean {
    if (typeof window === "undefined") return false;
    return (navigator as any).connection?.saveData ?? false;
  },

  /**
   * Cihaz orentasyonunu dinle
   */
  onOrientationChange(callback: (orientation: "portrait" | "landscape") => void) {
    if (typeof window === "undefined") return () => {};

    const handleChange = () => {
      const orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
      callback(orientation);
    };

    window.addEventListener("orientationchange", handleChange);
    window.addEventListener("resize", handleChange);

    return () => {
      window.removeEventListener("orientationchange", handleChange);
      window.removeEventListener("resize", handleChange);
    };
  },
};

/**
 * React Hook - Device Detection
 */
export function useDeviceDetection() {
  const [deviceType, setDeviceType] = useState<"mobile" | "tablet" | "desktop">("desktop");
  const [isTouch, setIsTouch] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);

  useEffect(() => {
    setDeviceType(deviceDetection.getDeviceType());
    setIsTouch(deviceDetection.isTouchDevice());
    setIsDarkMode(deviceDetection.getDarkModePreference());
    setDataSaver(deviceDetection.isDataSaver());

    const handleResize = () => {
      setDeviceType(deviceDetection.getDeviceType());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    deviceType,
    isTouch,
    isDarkMode,
    dataSaver,
    isMobile: deviceType === "mobile",
  };
}

/**
 * Cache Management - Cihazdan yardımcı depolama
 */
export const cacheManager = {
  /**
   * IndexedDB kullanarak büyük veriler depola
   */
  async setCacheData(key: string, data: unknown, expiryMs?: number): Promise<void> {
    if (typeof window === "undefined" || !window.indexedDB) return;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open("aroless_cache", 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["cache"], "readwrite");
        const store = transaction.objectStore("cache");

        store.put({
          key,
          data,
          timestamp: Date.now(),
          expiryMs,
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("cache")) {
          db.createObjectStore("cache", { keyPath: "key" });
        }
      };
    });
  },

  /**
   * IndexedDB'den veri al
   */
  async getCacheData(key: string): Promise<unknown | null> {
    if (typeof window === "undefined" || !window.indexedDB) return null;

    return new Promise((resolve) => {
      const request = window.indexedDB.open("aroless_cache", 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["cache"], "readonly");
        const store = transaction.objectStore("cache");
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          const item = getRequest.result;
          if (!item) {
            resolve(null);
            return;
          }

          // Expiry kontrol et
          if (item.expiryMs && Date.now() - item.timestamp > item.expiryMs) {
            cacheManager.deleteCacheData(key);
            resolve(null);
            return;
          }

          resolve(item.data);
        };

        getRequest.onerror = () => resolve(null);
      };

      request.onerror = () => resolve(null);
    });
  },

  /**
   * Cache'ten sil
   */
  async deleteCacheData(key: string): Promise<void> {
    if (typeof window === "undefined" || !window.indexedDB) return;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open("aroless_cache", 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["cache"], "readwrite");
        const store = transaction.objectStore("cache");
        store.delete(key);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Tüm cache'i temizle
   */
  async clearCache(): Promise<void> {
    if (typeof window === "undefined" || !window.indexedDB) return;

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open("aroless_cache", 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["cache"], "readwrite");
        const store = transaction.objectStore("cache");
        store.clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  },
};
