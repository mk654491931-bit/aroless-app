// ============================================================================
// EKONOMİ KANITI — "bu sayı GERÇEKTEN ölçüldü mü?" sorusunun tek yeridir.
// (saf fonksiyonlar; ağ/AI/DB YOK)
//
// NEDEN VAR (ölçülen hata, 2026-10-03):
//   Ölçümlü keşif hattı (`toWinningProducts`) maliyeti hiç bilmediği halde
//   `supplier_price_usd: ""` + `cost_breakdown: { net_margin_pct: 0 }` +
//   `profit_margin_pct: 0` yazıyordu. Alt katmanlar bu dolu görünen kalıbı
//   ÖLÇÜM sanıyordu. Ölçülen sonuç (tek ürün, gerçek fiyat $24.99):
//
//     • Tedarik maliyeti  →  $0.00
//     • Marj              →  "0% (UNPROFITABLE)"      (her üründe)
//     • Aylık satış      →  21 adet      ← kimse ölçmedi
//     • Aylık ciro        →  $525         ← kimse ölçmedi
//     • Aylık net kâr     →  -$97         ← kimse ölçmedi
//     • Karar             →  "Avoid"      ← uydurma %0 marj yüzünden
//
//   Yani "hep 0" (0.00 / 0% / UNPROFITABLE) ve "saçma sayı" aynı kökten
//   geliyor: boş ölçüm, dolu sayı gibi gösteriliyor.
//
// KURAL (dosyanın tamamı):
//   Metin alanlarda `""` ve sayı alanlarında `0` ÖLÇÜM DEĞİLDİR — kaynak
//   ölçemedi demektir. Bu yüzden ikisi de `null`a çevrilir ve çağıran taraf
//   "—" gösterir (0 göstermez). `money()`/`parseUsd()` gibi yardımcıların
//   `|| 0` varsayılanı bu katmanın YOK sayıldığı içindir.
// ============================================================================

/** Ölçülmüş para: `"$5"`, `"5,00"`, `5` → sayı. Boş/çöp/0/negatif → `null`. */
export function measuredMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  // Binlik ayırıcı olan biçimler de okunur: "$1,299.00", "1.299,00".
  const normalized = text.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  const m = normalized.match(/-?\d[\d.,]*/);
  if (!m) return null;
  const raw = m[0];
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let numeric: string;
  if (lastComma === -1 && lastDot === -1) {
    numeric = raw;
  } else if (lastComma > lastDot) {
    // Avrupa/TR: ondalık ",", binlik "."  →  ondalık noktaya çevir.
    numeric = raw.replace(/\./g, "").replace(",", ".");
  } else {
    // ABD/JS: ondalık ".", binlik "," →  binlik ayırıcıyı at.
    numeric = raw.replace(/,/g, "");
  }
  const n = Number(numeric);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Kartın maliyet kalemi (klasik hattın `CostBreakdown` ile aynı yüzey). */
export type CostEvidence = {
  supplier_cost?: string | number | null;
  shipping_cost?: string | number | null;
  platform_fee?: string | number | null;
  ad_spend?: string | number | null;
  net_profit?: string | number | null;
  net_margin_pct?: number | null;
} | null | undefined;

/** Ekonomisi incelenebilir bir ürünün alt küçük parçası. */
export type EconomicsEvidenceInput = {
  supplier_price_usd?: string | number | null;
  cost_breakdown?: CostEvidence;
  real_economics?: unknown;
};

/**
 * ÖLÇÜLMÜŞ net marj (%), yoksa `null`.
 *
 * `0` marj ÖLÇÜM DEĞİLDİR: kazımada tedarik maliyeti yoktur, dolayısıyla
 * marj da yoktur; `0` yazmak "ölçtük ve sıfır bulduk" anlamına gelirdi.
 * Aynı gerekçeyle negatif marj da ölçüm sayılmaz.
 */
export function measuredMarginPct(p: {
  cost_breakdown?: CostEvidence;
  profit_margin_pct?: number | null;
}): number | null {
  const fromBreakdown = p.cost_breakdown?.net_margin_pct;
  if (typeof fromBreakdown === "number" && Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
    return fromBreakdown;
  }
  const fromTop = p.profit_margin_pct;
  if (typeof fromTop === "number" && Number.isFinite(fromTop) && fromTop > 0) return fromTop;
  return null;
}

/**
 * Bu ürünün BİRİM EKONOMİSİ ölçüldü mü?
 *
 * Ölçümlü keşif hattı yalnız fiyat + puan + satıcı URL'si ölçer; tedarik,
 * kargo, komisyon ve aylık hacim KAZINAMAZ. Bu yüzden o hatta
 * `hasMeasuredEconomics` `false` döner ve kart "—" gösterir.
 *
 * `real_economics` model çıktısı olsa da EN AZ BİR GERÇEK maliyet girdisi
 * (tedarik fiyatı ya da dolu bir maliyet kalemi) varsa kabul edilir; aksi
 * halde `realEconomics` her şeyi varsayılanla doldurup sayı uydurur.
 */
export function hasMeasuredEconomics(p: EconomicsEvidenceInput): boolean {
  if (p.real_economics && typeof p.real_economics === "object") return true;
  if (measuredMoney(p.supplier_price_usd) !== null) return true;
  const cb = p.cost_breakdown;
  if (!cb) return false;
  return (
    measuredMoney(cb.supplier_cost) !== null ||
    measuredMoney(cb.shipping_cost) !== null ||
    measuredMoney(cb.platform_fee) !== null ||
    measuredMoney(cb.ad_spend) !== null ||
    measuredMoney(cb.net_profit) !== null
  );
}
