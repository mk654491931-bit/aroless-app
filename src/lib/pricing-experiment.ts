/**
 * Fiyat A/B testi + otomatik WELCOME30 kupon helper'ı.
 *
 * - Kontrol (A): normal fiyat
 * - Varyant (B): ilk ay %30 indirim (WELCOME30)
 *
 * Deterministic hash → aynı kullanıcı her zaman aynı varyanta düşer.
 * DB bağımlılığı yok — pure fonksiyonlar, test edilebilir.
 * Signup akışı bu helper'ı çağırarak profile.promo_code otomatik yazar.
 */

export const WELCOME30_CODE = "WELCOME30" as const;
export const WELCOME30_DISCOUNT_PCT = 30 as const;
export const EXPERIMENT_SPLIT_PCT = 50 as const; // %50 B'ye

export type AbVariant = "control" | "variant";

function hashDjb2(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return h >>> 0;
}

/**
 * Kullanıcı için A/B varyantı. Giren her şey (userId, email) aynı bucket'a gider.
 * Boş string → control.
 */
export function abVariant(seed: string): AbVariant {
  const s = String(seed ?? "").trim().toLowerCase();
  if (!s) return "control";
  const bucket = hashDjb2(s) % 100;
  return bucket < EXPERIMENT_SPLIT_PCT ? "variant" : "control";
}

/** Varyanta karşılık gelen indirim yüzdesi. */
export function discountForVariant(variant: AbVariant): number {
  return variant === "variant" ? WELCOME30_DISCOUNT_PCT : 0;
}

/** Seed'den direkt indirim (kolay kısayol). */
export function welcomeDiscountForSeed(seed: string): number {
  return discountForVariant(abVariant(seed));
}

/** Otomatik kupon uygulanmalı mı? (varyant + henüz kodu yoksa) */
export function shouldAutoApplyWelcome30(args: {
  seed: string;
  existingPromoCode?: string | null;
}): boolean {
  const existing = String(args.existingPromoCode ?? "").trim();
  if (existing) return false;
  return abVariant(args.seed) === "variant";
}

/** Checkout'ta gösterilecek kupon kodu (varsa). */
export function welcomeCodeForSeed(seed: string): string | null {
  return abVariant(seed) === "variant" ? WELCOME30_CODE : null;
}

/** Fiyat sonrası hesaplama (görsel doğrulama için). */
export function priceAfterDiscount(usd: number, discountPct: number): number {
  const p = Math.max(0, Math.min(100, discountPct));
  return Math.round(usd * (1 - p / 100) * 100) / 100;
}
