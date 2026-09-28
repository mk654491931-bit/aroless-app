/** Shared (client-safe) AI engine definitions for the finder search bar. */
export const HF_TOKEN_STORAGE_KEY = "omni.hf_token";

/**
 * ARAMA MOTORLARI — ARTIK TEK SEÇENEK.
 *
 * NEDEN TEK: `HF: Llama`, `HF: Qwen` ve `Hybrid` seçenekleri kaldırıldı. Bu
 * seçenekler seçiliyken ürün arama Product Discovery hattını **hiç denemeden**
 * klasik üretime geçiyordu; yani seçici, kullanıcı istediği hattan (kazıma →
 * 75 → Gemini 25 → 14 ajan → ilk 5) sessizce çıkarıyordu. "Default AI" ise
 * o hattı çalıştıran ve Gemini'yi önce, havuzu yedek olarak kullanan yoldur.
 *
 * `EngineId` birliği ESKİ değerleri de içermeye devam eder: tarayıcıda
 * `localStorage`'da eski bir seçim ("qwen") kalabiliyor ve eski kodda bu
 * değerlerle yapılan karşılaştırmalar derlenebilir olmalı. `engineLabel` ve
 * arama kancası bu değerleri "default"a NORMALİZE eder; yani eski seçim
 * kalıcı bir hata değil, kendiliğinden düzeltilir.
 */
export const ENGINES = [
  {
    id: "default",
    label: "Default AI",
    hint: "Gemini öncelikli · 22 anahtar havuzu yedek",
    model: "Gemini + havuz",
    etaMs: 4000,
  },
] as const;

/** Seçici yalnız `default` sunar; union eski kalıntıları da tutar (yukarıya bak). */
export type EngineId = "default" | "llama" | "qwen" | "hybrid";

/** Gerçekten kullanılabilen motor sayısı — tek. */
export const ACTIVE_ENGINE_IDS = ENGINES.map((e) => e.id);

/** Kayıtlı/eskimiş bir seçimi bugünkü tek motora indirger. */
export function normalizeEngineId(_value: unknown): "default" {
  return "default";
}

export const MARKETPLACES = [
  { id: "global", labelKey: "ui.market_global", country: "GLOBAL", currency: "USD" },
  { id: "turkey", labelKey: "ui.market_tr", country: "TR", currency: "TRY" },
] as const;
export type MarketplaceId = (typeof MARKETPLACES)[number]["id"];

export function engineLabel(id: EngineId) {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

export function storedHfToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const v = window.localStorage.getItem(HF_TOKEN_STORAGE_KEY);
  return v && v.trim() ? v.trim() : undefined;
}
