/**
 * Araç formlarının AI ÇAĞRISINDAN ÖNCE çalışan doğrulaması.
 *
 * NEDEN AYRI DOSYA: `tool-card.tsx` bir React bileşeni; oradan yardımcı
 * fonksiyon dışa aktarmak Fast Refresh'i bozuyor. Form kuralları bileşenden
 * bağımsız test edilebilir kalsın diye burada tutulur.
 */

export function requireText(value: string, label: string, min = 2): string | null {
  return value.trim().length >= min ? null : `${label} en az ${min} karakter olmalı.`;
}

export function requirePositive(value: string, label: string): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? null : `${label} sıfırdan büyük olmalı.`;
}

/** İlk gerçek hatayı döner; yoksa `null`. */
export function firstValidationError(...checks: Array<string | null | undefined>): string | null {
  return checks.find((value): value is string => Boolean(value)) ?? null;
}
