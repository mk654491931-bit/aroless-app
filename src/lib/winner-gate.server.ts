// ============================================================================
// Winner Gate — pahalı derin analize girmeden önce ucuz, deterministik eleme.
//   • fuzzy tekilleştirme (aynı ürünün farklı isimleri)
//   • jenerik / doymuş ürün kara listesi
//   • zorunlu eşikler (marj, fiyat bandı, kargo uygunluğu, yasal risk)
// Elenenler kaybolmaz: sebebiyle birlikte döner, UI "Elenenler" bölümünde gösterir.
// ============================================================================
import { netMarginOf } from "./profitability";
import { parseMoney } from "./unit-economics";

export type GateInput = {
  name?: string;
  description?: string;
  selling_price_usd?: string;
  supplier_price_usd?: string;
  competition_level?: string;
  differentiation?: string[];
  viral_proof?: Array<{ url?: string; views?: string }>;
  cost_breakdown?: { supplier_cost?: string; net_margin_pct?: number };
  platform_fit?: string[];
  trend_score?: number;
};

export type Rejected<T> = { product: T; rejection_reason: string };

/** Klişeleşmiş, aşırı doymuş ürünler — belirgin farklılaşma kanıtı yoksa elenir. */
const SATURATED = [
  /telefon kılıf|phone case/i,
  /halka ışık|ring light/i,
  /posture corrector|duruş düzeltici/i,
  /selfie stick|selfie çubuğu/i,
  /pop ?socket/i,
  /fidget spinner|stres çarkı/i,
  /generic (led|usb) (strip|cable)/i,
  /su şişesi|generic water bottle/i,
  /yoga mat[ıi]?$/i,
  /wireless earbuds?$/i,
];

const BULKY = /(koltuk|kanepe|treadmill|koşu bandı|buzdolabı|fridge|mattress|yatak|sofa|bisiklet|bicycle|televizyon|akvaryum|piyano|piano)/i;
const ILLEGAL = /(replica|çakma|counterfeit|sahte|first copy|knock ?off|airsoft|silah|weapon|reçeteli|prescription)/i;

const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü ]+/gi, " ")
    .replace(/\b(pro|plus|max|mini|set|kit|adet|pcs|pack|the|for|ile|with|new|yeni|2024|2025|2026)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter((w) => w.length > 2));
  const tb = new Set(normalizeName(b).split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  ta.forEach((t) => {
    if (tb.has(t)) hit++;
  });
  return hit / Math.min(ta.size, tb.size);
}

/** Aynı ürünün farklı isimlerini birleştirir (token benzerliği >= 0.7). */
export function dedupeCandidates<T extends GateInput>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const name = (item?.name ?? "").trim();
    if (!name) continue;
    const dup = kept.find((k) => tokenSimilarity(k.name ?? "", name) >= 0.7);
    if (dup) {
      // Daha zengin veriye sahip olanı sakla.
      const richer = JSON.stringify(item).length > JSON.stringify(dup).length ? item : dup;
      kept[kept.indexOf(dup)] = richer;
      continue;
    }
    kept.push(item);
  }
  return kept;
}

export type GateOptions = {
  minNetMargin?: number;
  priceMin?: number;
  priceMax?: number;
  /** Elemeden sonra en az kaç ürün kalmalı — altına düşerse en iyiler geri alınır. */
  keepAtLeast?: number;
};

/** Deterministik ön eleme. Hayatta kalanlar + gerekçeli elenenler döner. */
export function winnerGate<T extends GateInput>(
  items: T[],
  opts: GateOptions = {},
): { survivors: T[]; rejected: Rejected<T>[] } {
  const minMargin = opts.minNetMargin ?? 18;
  const priceMin = opts.priceMin ?? 0;
  const priceMax = opts.priceMax ?? 0;
  const keepAtLeast = opts.keepAtLeast ?? 3;

  const unique = dedupeCandidates(items);
  const survivors: T[] = [];
  const rejected: Rejected<T>[] = [];

  for (const p of unique) {
    const text = `${p.name ?? ""} ${p.description ?? ""}`;
    const price = parseMoney(p.selling_price_usd);
    const margin = netMarginOf(p);
    const hasDiff = (p.differentiation ?? []).length >= 2;

    let reason = "";
    if (ILLEGAL.test(text)) reason = "Yasal risk: taklit / kısıtlı ürün.";
    else if (SATURATED.some((r) => r.test(text)) && !hasDiff)
      reason = "Aşırı doymuş jenerik ürün — belirgin farklılaşma kanıtı yok.";
    else if (BULKY.test(text)) reason = "Hacimli/ağır ürün — kargo maliyeti kârı yok ediyor.";
    else if (price > 0 && price < 9) reason = `Satış fiyatı çok düşük ($${price.toFixed(2)}) — reklam maliyeti karşılanmaz.`;
    else if (priceMin > 0 && price > 0 && price < priceMin) reason = `Hedef fiyat bandının altında ($${price.toFixed(2)}).`;
    else if (priceMax > 0 && price > 0 && price > priceMax) reason = `Hedef fiyat bandının üstünde ($${price.toFixed(2)}).`;
    else if (margin < minMargin) reason = `Net marj yetersiz (%${Math.round(margin)} < %${minMargin}).`;

    if (reason) rejected.push({ product: p, rejection_reason: reason });
    else survivors.push(p);
  }

  // Hiç ürün kalmadıysa kullanıcıyı boş ekranla bırakma: en iyi adayları geri al.
  if (survivors.length < keepAtLeast && rejected.length) {
    const rescued = [...rejected]
      .sort((a, b) => netMarginOf(b.product) - netMarginOf(a.product))
      .slice(0, keepAtLeast - survivors.length);
    for (const r of rescued) {
      survivors.push(r.product);
      rejected.splice(rejected.indexOf(r), 1);
    }
  }

  return { survivors, rejected };
}
