// ============================================================================
// ÖNERİ → GERÇEK SONUÇ (saf fonksiyonlar; ağ/AI/DB YOK)
//
// NEDEN VAR: uygulama iki ayrı gerçeği zaten saklıyor ama birbirine BAĞLAMIYOR:
//   • `radar_items` → hangi ürünü önerdik (gün, skor, momentum, fiyat, marj)
//   • `roi_entries` → kullanıcının GERÇEK sipariş / reklam / kâr rakamları
// İkisi birleşince "önerdiğimiz ürünlerin kaçı gerçekten kâr etti" sorusu
// ölçülebilir hâle gelir. Bu, "kendi doğruluğunu ölçen" tek konumlandırmadır ve
// kazanan skorunun ağırlıklarını veriyle ayarlamanın ön koşuludur.
//
// DÜRÜSTLÜK KURALI: satış TAHMİNİ yapılmaz. Yalnız kullanıcının GİRDİĞİ gerçek
// rakamlar (sipariş, iade, reklam harcaması) kullanılır; eşleşme yoksa öneri
// "sonuçsuz" sayılır ve oranların dışında tutulur — 0 kâr varsayılmaz.
// ============================================================================

import { computeRoi, type RoiEntry } from "./roi-math";

/** Radar kaydının ölçülen alanlarından türeyen kriterler. */
export type PickCriterionId = "yuksek-skor" | "pozitif-momentum" | "marj-var" | "fiyat-bandi";

export type PickCriterion = {
  id: PickCriterionId;
  label: string;
  /** Bu kriteri taşıyan öneri sayısı. */
  picks: number;
  /** Bunlardan gerçek sonuca bağlananların sayısı. */
  linked: number;
  /** Bağlananlarda kârlı çıkanların oranı (0-1); veri yoksa `null`. */
  profitRate: number | null;
  /** Bağlananların ortalama net marjı (%). */
  avgMarginPct: number | null;
};

export type PickAccuracy = {
  picks: number;
  linked: number;
  /** Sonuca bağlanmayan öneriler (kullanıcı takip etmemiş) — oranlara girmez. */
  unlinkedTitles: string[];
  /** Bağlanan önerilerde kârlı olanların oranı (0-1); veri yoksa `null`. */
  profitRate: number | null;
  /** Bağlananların toplam net kârı (kullanıcının para birimi). */
  totalProfit: number | null;
  byCriterion: PickCriterion[];
  /** Tek cümlelik, ölçüme dayalı özet. */
  summary: string;
};

export type PickLike = {
  title: string;
  day: string;
  winnerScore: number;
  momentum: number;
  priceMin: number;
  priceMax: number;
  marginPct: number;
};

/** Öneriyi gerçek sonuçla eşleştiren anahtar: normalize başlık (ilk 4 kelime). */
export function pickKey(title: string): string {
  return String(title ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

const CRITERIA: { id: PickCriterionId; label: string; test: (p: PickLike) => boolean }[] = [
  { id: "yuksek-skor", label: "Kazanan skoru 70+", test: (p) => p.winnerScore >= 70 },
  { id: "pozitif-momentum", label: "Pozitif momentum", test: (p) => p.momentum > 0 },
  { id: "marj-var", label: "Marj ölçülmüş", test: (p) => p.marginPct > 0 },
  { id: "fiyat-bandi", label: "Fiyat bandı ölçülmüş", test: (p) => p.priceMin > 0 },
];

/**
 * Önerileri kullanıcının GERÇEK ROI kayıtlarıyla eşleştirir ve kriter bazında
 * isabet oranı üretir.
 *
 * Eşleşme aynı ürünün birden çok ROI kaydını BİRLEŞTİRİR (toplam sipariş,
 * toplam kâr) — aksi hâlde aynı ürünü iki kez sayan yanlış bir oran çıkardı.
 */
export function measurePickAccuracy(
  picks: readonly PickLike[],
  entries: readonly RoiEntry[],
): PickAccuracy {
  const byOutcome = new Map<string, RoiEntry[]>();
  for (const e of entries) {
    const key = pickKey(e.product_name);
    if (!key) continue;
    byOutcome.set(key, [...(byOutcome.get(key) ?? []), e]);
  }

  // Aynı ürünü tek öneri say: en yüksek skorlu gün temsilci olur.
  const unique = new Map<string, PickLike>();
  for (const p of picks) {
    const key = pickKey(p.title);
    if (!key) continue;
    const prev = unique.get(key);
    if (!prev || p.winnerScore > prev.winnerScore) unique.set(key, p);
  }

  const hit = new Map<string, { profit: number; marginPct: number; entries: number }>();
  const unlinkedTitles: string[] = [];
  for (const [key, pick] of unique) {
    const outcome = byOutcome.get(key);
    if (!outcome || outcome.length === 0) {
      unlinkedTitles.push(pick.title);
      continue;
    }
    let profit = 0;
    let revenue = 0;
    for (const e of outcome) {
      const stats = computeRoi(e);
      profit += stats.netProfit;
      revenue += stats.revenue;
    }
    hit.set(key, {
      profit,
      marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
      entries: outcome.length,
    });
  }

  const linked = hit.size;
  const profits = [...hit.values()].map((h) => h.profit);
  const profitable = profits.filter((p) => p > 0).length;
  const totalProfit = linked > 0 ? profits.reduce((s, p) => s + p, 0) : null;
  const profitRate = linked > 0 ? profitable / linked : null;

  const byCriterion: PickCriterion[] = CRITERIA.map(({ id, label, test }) => {
    const matching = [...unique.entries()].filter(([, pick]) => test(pick));
    const linkedMatching = matching.filter(([key]) => hit.has(key));
    const matchingProfits = linkedMatching.map(([key]) => hit.get(key)!.profit);
    const matchingMargins = linkedMatching.map(([key]) => hit.get(key)!.marginPct);
    return {
      id,
      label,
      picks: matching.length,
      linked: linkedMatching.length,
      profitRate:
        matchingProfits.length > 0
          ? matchingProfits.filter((p) => p > 0).length / matchingProfits.length
          : null,
      avgMarginPct:
        matchingMargins.length > 0
          ? Math.round((matchingMargins.reduce((s, m) => s + m, 0) / matchingMargins.length) * 10) / 10
          : null,
    };
  });

  const summary =
    linked === 0
      ? `Henüz sonuca bağlanan öneri yok (${unique.size} öneri izleniyor, ${unlinkedTitles.length} tanesi ROI kaydı bekliyor).`
      : `Önerilen ${unique.size} üründen ${linked} tanesi gerçek ROI kaydıyla eşleşti; %${Math.round((profitRate ?? 0) * 100)} kârlı.`;

  return {
    picks: unique.size,
    linked,
    unlinkedTitles,
    profitRate,
    totalProfit,
    byCriterion,
    summary,
  };
}

/** Ortalama net marj (yalnız bağlanan kayıtlar) — kalibrasyon için ham sinyal. */
export function averageLinkedMarginPct(accuracy: PickAccuracy): number | null {
  const values = accuracy.byCriterion
    .filter((c) => c.id === "marj-var" && c.avgMarginPct !== null)
    .map((c) => c.avgMarginPct as number);
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}
