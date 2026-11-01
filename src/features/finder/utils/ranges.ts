/**
 * TAHMİN ARALIĞI — model çıktısı tek bir kesin sayı gibi sunulmaz.
 *
 * Ürün bulucudaki aylık satış/ciro gibi değerler ölçüm değil, benchmark
 * tabanlı model çıktısıdır. "1.240 adet/ay" yazmak ölçülmüş bir gerçeklik
 * izlenimi veriyordu; aynı sayıyı "~990–1.550" aralığında göstermek hem
 * dürüst hem de kullanıcının planlama yapmasına daha uygundur.
 */

export type NumericBand = { low: number; high: number };

/** Bir tahminin çevresinde simetrik olmayan alt/üst bant üretir. */
export function estimateBand(
  value: number | null | undefined,
  lowFactor = 0.75,
  highFactor = 1.25,
): NumericBand | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const low = Math.max(0, Math.round(value * lowFactor));
  const high = Math.max(low + 1, Math.round(value * highFactor));
  return { low, high };
}

/** `~1.200–1.800` biçiminde tam sayı aralığı. */
export function formatIntegerBand(band: NumericBand | null): string | null {
  if (!band) return null;
  return `~${band.low.toLocaleString("tr-TR")}–${band.high.toLocaleString("tr-TR")}`;
}

/** Biçimlendirici enjekte edilebilir para aralığı (para birimi/hizalama farkı). */
export function formatMoneyBand(
  band: NumericBand | null,
  format: (value: number) => string,
): string | null {
  if (!band) return null;
  return `${format(band.low)}–${format(band.high)}`;
}

/** Yüzde tahmini için `~%35–45` aralığı. */
export function formatPercentBand(
  value: number | null | undefined,
  spread = 8,
  min = 0,
  max = 95,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const low = Math.max(min, Math.round(value - spread));
  const high = Math.min(max, Math.round(value + spread));
  return `~%${low}–${high}`;
}
