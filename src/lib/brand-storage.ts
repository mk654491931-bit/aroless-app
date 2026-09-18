/**
 * Brand storage migration helper — Velora → Aroless
 * Tüm kalıcı anahtarlar artık `aroless.*` ile yazılır.
 * Eski `velora.*` anahtarları dual-read ile okunur, ilk okumada yeniye kopyalanır
 * ve yazıldığında eski anahtar temizlenir. 1 ay sonra legacy temizliği yapılabilir.
 */

const LEGACY_KEY_MAP: Record<string, string> = {
  "aroless.finder.category": "velora.finder.category",
  "aroless.finder.audience": "velora.finder.audience",
  "aroless.finder.platforms": "velora.finder.platforms",
  "aroless.finder.budget": "velora.finder.budget",
  "aroless.finder.country": "velora.finder.country",
  "aroless.finder.min_score": "velora.finder.min_score",
  "aroless.finder.engine": "velora.finder.engine",
  "aroless.finder.github_trends": "velora.finder.github_trends",
  "aroless.finder.deep_search": "velora.finder.deep_search",
  "aroless.finder.sort": "velora.finder.sort",
  "aroless.finder.band": "velora.finder.band",
  "aroless.finder.recent": "velora.finder.recent",
  "aroless.finder.presets": "velora.finder.presets",
  "aroless:target-country": "velora:target-country",
  "aroless_cookie_consent": "velora_cookie_consent",
  "aroless.onboarding.v1": "velora.onboarding.v1",
  "aroless.checklist.hidden": "velora.checklist.hidden",
  "aroless-theme": "velora-theme",
  "aroless-palette": "velora-palette",
  "aroless-cursor": "velora-cursor",
  "aroless-settings-pos": "velora-settings-pos",
  "aroless.ref": "velora.ref",
  "aroless:post-auth": "velora:post-auth",
};

// Prefix migrations for dynamic keys like aroless.checklist.<scope>
function legacyPrefixFallback(newKey: string): string | undefined {
  if (newKey.startsWith("aroless.checklist.")) {
    return newKey.replace("aroless.checklist.", "velora.checklist.");
  }
  if (newKey.startsWith("aroless.finder.")) {
    const suffix = newKey.slice("aroless.finder.".length);
    const cand = `velora.finder.${suffix}`;
    if (!(newKey in LEGACY_KEY_MAP)) return cand;
  }
  return undefined;
}

function getLegacyKey(newKey: string): string | undefined {
  return LEGACY_KEY_MAP[newKey] ?? legacyPrefixFallback(newKey);
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** localStorage için dual-read: önce yeni, yoksa legacy'den oku ve yeniye taşı */
export function getBrandedItem(newKey: string): string | null {
  if (typeof window === "undefined") return null;
  const direct = safeGet(window.localStorage, newKey);
  if (direct !== null) return direct;
  const legacy = getLegacyKey(newKey);
  if (!legacy) return null;
  const lv = safeGet(window.localStorage, legacy);
  if (lv !== null) {
    // migrate to new key silently
    safeSet(window.localStorage, newKey, lv);
  }
  return lv;
}

export function setBrandedItem(newKey: string, value: string): void {
  if (typeof window === "undefined") return;
  safeSet(window.localStorage, newKey, value);
  const legacy = getLegacyKey(newKey);
  if (legacy) safeRemove(window.localStorage, legacy);
}

export function removeBrandedItem(newKey: string): void {
  if (typeof window === "undefined") return;
  safeRemove(window.localStorage, newKey);
  const legacy = getLegacyKey(newKey);
  if (legacy) safeRemove(window.localStorage, legacy);
}

/** sessionStorage için aynı mantık (velora:post-auth) */
export function getBrandedSessionItem(newKey: string): string | null {
  if (typeof window === "undefined") return null;
  const direct = safeGet(window.sessionStorage, newKey);
  if (direct !== null) return direct;
  const legacy = getLegacyKey(newKey);
  if (!legacy) return null;
  const lv = safeGet(window.sessionStorage, legacy);
  if (lv !== null) safeSet(window.sessionStorage, newKey, lv);
  return lv;
}

export function setBrandedSessionItem(newKey: string, value: string): void {
  if (typeof window === "undefined") return;
  safeSet(window.sessionStorage, newKey, value);
  const legacy = getLegacyKey(newKey);
  if (legacy) safeRemove(window.sessionStorage, legacy);
}

export function removeBrandedSessionItem(newKey: string): void {
  if (typeof window === "undefined") return;
  safeRemove(window.sessionStorage, newKey);
  const legacy = getLegacyKey(newKey);
  if (legacy) safeRemove(window.sessionStorage, legacy);
}

/** Uygulama açılışında tüm legacy anahtarları topluca yeniye kopyalar (idempotent) */
export function migrateAllLegacyKeys(): void {
  if (typeof window === "undefined") return;
  for (const [newKey, legacyKey] of Object.entries(LEGACY_KEY_MAP)) {
    try {
      if (safeGet(window.localStorage, newKey) === null) {
        const v = safeGet(window.localStorage, legacyKey);
        if (v !== null) safeSet(window.localStorage, newKey, v);
      }
    } catch {
      /* ignore */
    }
  }
  // prefix checklist.* -> iterate localStorage
  try {
    const toMigrate: Array<[string, string]> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("velora.checklist.")) {
        const nk = k.replace("velora.checklist.", "aroless.checklist.");
        if (safeGet(window.localStorage, nk) === null) toMigrate.push([nk, k]);
      }
    }
    for (const [nk, ok] of toMigrate) {
      const v = safeGet(window.localStorage, ok);
      if (v !== null) safeSet(window.localStorage, nk, v);
    }
  } catch {
    /* ignore */
  }
  // sessionStorage post-auth
  try {
    if (safeGet(window.sessionStorage, "aroless:post-auth") === null) {
      const v = safeGet(window.sessionStorage, "velora:post-auth");
      if (v !== null) safeSet(window.sessionStorage, "aroless:post-auth", v);
    }
  } catch {
    /* ignore */
  }
}

// Event name helpers — yeni + legacy'yi birlikte dinle / tetikle
export const BRAND_EVENTS = {
  theme: { new: "aroless:theme", legacy: "velora:theme" },
  palette: { new: "aroless:palette", legacy: "velora:palette" },
  cursor: { new: "aroless:cursor", legacy: "velora:cursor" },
  cookiePrefs: { new: "aroless:open-cookie-preferences", legacy: "velora:open-cookie-preferences" },
} as const;

export function dispatchBrandedEvent(eventNew: string, eventLegacy: string, detail: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(eventNew, { detail }));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(eventLegacy, { detail }));
  } catch {}
}

export function addBrandedEventListener(
  eventNew: string,
  eventLegacy: string,
  handler: EventListener,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(eventNew, handler);
  window.addEventListener(eventLegacy, handler);
  return () => {
    window.removeEventListener(eventNew, handler);
    window.removeEventListener(eventLegacy, handler);
  };
}
