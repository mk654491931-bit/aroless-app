/**
 * Kârlılık hesaplayıcısının saf çekirdeği.
 *
 * NEDEN AYRI: modal, satış fiyatı yokken $49 / tedarik yokken satışın %30'u
 * gibi UYDURMA varsayılanlarla hesap yapıyordu. Burada eksik zorunlu girdi
 * varsa sonuç `null` döner; kargo/komisyon/CAC boşsa 0 sayılır (kullanıcı
 * arayüzde bu kuralı görür). Böylece hesap test edilebilir ve dürüst kalır.
 */

export type ProfitInputs = {
  /** Satış fiyatı USD; ölçülmediyse null. */
  price: number | null;
  /** Tedarik/COGS USD; ölçülmediyse null. */
  cogs: number | null;
  /** Kargo USD; boşsa 0. */
  shipping?: number | null;
  /** Platform komisyonu USD; boşsa 0. */
  platformFee?: number | null;
  /** Reklam/CAC USD; boşsa 0. */
  adSpend?: number | null;
  /** Ülke KDV oranı (yüzde). */
  vatPct: number;
};

export type ProfitResult = {
  /** Satış fiyatından hesaplanan KDV; fiyat yoksa null. */
  vat: number | null;
  /** Net kâr; zorunlu girdi eksikse null. */
  net: number | null;
  /** Net marj yüzdesi; net yoksa null. */
  marginPct: number | null;
};

const nonNegative = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function calculateProfit(input: ProfitInputs): ProfitResult {
  const price =
    typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0
      ? input.price
      : null;
  const cogs =
    typeof input.cogs === "number" && Number.isFinite(input.cogs) && input.cogs >= 0
      ? input.cogs
      : null;

  if (price === null || cogs === null) {
    return { vat: null, net: null, marginPct: null };
  }

  const vatPct =
    Number.isFinite(input.vatPct) && input.vatPct > 0 ? Math.min(100, input.vatPct) : 0;
  const vat = (price * vatPct) / 100;
  const net =
    price -
    cogs -
    nonNegative(input.shipping) -
    nonNegative(input.platformFee) -
    nonNegative(input.adSpend) -
    vat;

  return { vat, net, marginPct: (net / price) * 100 };
}
