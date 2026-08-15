// ============================================================================
// Winner Gate — pahalı derin analize girmeden önce ucuz, deterministik eleme.
//   • fuzzy tekilleştirme (aynı ürünün farklı isimleri)
//   • jenerik / doymuş ürün kara listesi
//   • zorunlu eşikler (marj, fiyat bandı, kargo uygunluğu, yasal risk)
// Elenenler kaybolmaz: sebebiyle birlikte döner, UI "Elenenler" bölümünde gösterir.
// ============================================================================
import { netMarginOf } from "./profitability";
import { parseMoney } from "./unit-economics";
import { countryFit, PLATFORM_MARKETS } from "./platform-market";
import { buildVerdict, type MarketVerdict, type VerdictCheck } from "./market-verdict";
import type { Platform } from "./gemini.functions";

/** Ülkeye özel sertifika / gümrük bariyeri olan ürün kalıpları. */
const COUNTRY_BARRIERS: Record<string, { re: RegExp; why: string }[]> = {
  SA: [{ re: /(elektronik|electronic|cosmetic|kozmetik|toy|oyuncak|charger|şarj)/i, why: "Suudi Arabistan SABER/SASO belgesi gerektiriyor" }],
  AE: [{ re: /(cosmetic|kozmetik|supplement|takviye|food|gıda|charger|şarj)/i, why: "BAE ESMA/MoHAP tescili gerektiriyor" }],
  DE: [{ re: /(battery|pil|batarya|elektronik|electronic|packaging)/i, why: "Almanya VerpackG (ambalaj kaydı) + WEEE/BattG zorunluluğu" }],
  FR: [{ re: /(battery|pil|elektronik|electronic|textile|tekstil)/i, why: "Fransa EPR (Triman) kayıt zorunluluğu" }],
  TR: [{ re: /(supplement|takviye|cosmetic|kozmetik|medikal|medical)/i, why: "Türkiye'de Tarım/Sağlık Bakanlığı izni gerekiyor" }],
  IN: [{ re: /(elektronik|electronic|charger|şarj|toy|oyuncak)/i, why: "Hindistan BIS sertifikası gerekiyor" }],
  BR: [{ re: /(elektronik|electronic|charger|şarj|wireless|telsiz)/i, why: "Brezilya ANATEL/INMETRO onayı gerekiyor" }],
  JP: [{ re: /(charger|şarj|battery|pil|wireless|telsiz)/i, why: "Japonya PSE/GİTELEC onayı gerekiyor" }],
};

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
  market_verdict?: MarketVerdict;
};

export type Rejected<T> = { product: T; rejection_reason: string; verdict?: MarketVerdict };

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
  /** Hedef ülke kodu (TR, DE, GLOBAL ...). */
  country?: string;
  /** Kullanıcının seçtiği satış kanalları. */
  platforms?: string[];
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
  const country = (opts.country || "GLOBAL").toUpperCase();
  const platforms = opts.platforms ?? [];
  // Kullanıcının seçtiği kanallardan bu ülkede gerçekten çalışanlar.
  const usable = platforms.filter((p) => p in PLATFORM_MARKETS && countryFit(p as Platform, country) !== "unavailable");
  const barriers = COUNTRY_BARRIERS[country] ?? [];

  const unique = dedupeCandidates(items);
  const survivors: T[] = [];
  const rejected: Rejected<T>[] = [];

  for (const p of unique) {
    const text = `${p.name ?? ""} ${p.description ?? ""}`;
    const price = parseMoney(p.selling_price_usd);
    const margin = netMarginOf(p);
    const hasDiff = (p.differentiation ?? []).length >= 2;
    const barrierHit = barriers.find((b) => b.re.test(text));
    const channelBlocked =
      usable.length > 0 &&
      (p.platform_fit ?? []).length > 0 &&
      !(p.platform_fit ?? []).some(
        (f) => !(f in PLATFORM_MARKETS) || countryFit(f as Platform, country) !== "unavailable",
      );

    const checks: VerdictCheck[] = [
      { label: "Yasal risk taraması", passed: !ILLEGAL.test(text), detail: "Taklit / kısıtlı ürün kalıpları" },
      {
        label: "Doygunluk",
        passed: !(SATURATED.some((r) => r.test(text)) && !hasDiff),
        detail: hasDiff ? "En az 2 farklılaşma kanıtı var" : "Farklılaşma kanıtı yetersiz",
      },
      { label: "Kargo uygunluğu", passed: !BULKY.test(text), detail: "Hacimli/ağır ürün kontrolü" },
      {
        label: "Satış fiyatı tabanı",
        passed: !(price > 0 && price < 9),
        value: price > 0 ? `$${price.toFixed(2)}` : "—",
        threshold: "≥ $9",
      },
      {
        label: "Hedef fiyat bandı",
        passed: !((priceMin > 0 && price > 0 && price < priceMin) || (priceMax > 0 && price > 0 && price > priceMax)),
        value: price > 0 ? `$${price.toFixed(2)}` : "—",
        threshold: priceMin || priceMax ? `$${priceMin || 0} – $${priceMax || "∞"}` : "sınır yok",
      },
      {
        label: "Net marj eşiği",
        passed: margin >= minMargin,
        value: `%${Math.round(margin)}`,
        threshold: `≥ %${minMargin}`,
      },
      {
        label: "Kanal uyumu",
        passed: !channelBlocked,
        detail: channelBlocked
          ? `Önerilen kanallar ${country} pazarında kullanılamıyor`
          : usable.length
            ? `${usable.length} seçili kanal bu ülkede çalışıyor`
            : "Kanal filtresi uygulanmadı",
      },
      {
        label: "Sertifika / gümrük bariyeri",
        passed: !(barrierHit && !hasDiff),
        detail: barrierHit ? barrierHit.why : "Ülkeye özel bariyer kuralı tetiklenmedi",
      },
    ];

    let reason = "";
    if (ILLEGAL.test(text)) reason = "Yasal risk: taklit / kısıtlı ürün.";
    else if (SATURATED.some((r) => r.test(text)) && !hasDiff)
      reason = "Aşırı doymuş jenerik ürün — belirgin farklılaşma kanıtı yok.";
    else if (BULKY.test(text)) reason = "Hacimli/ağır ürün — kargo maliyeti kârı yok ediyor.";
    else if (price > 0 && price < 9) reason = `Satış fiyatı çok düşük ($${price.toFixed(2)}) — reklam maliyeti karşılanmaz.`;
    else if (priceMin > 0 && price > 0 && price < priceMin) reason = `Hedef fiyat bandının altında ($${price.toFixed(2)}).`;
    else if (priceMax > 0 && price > 0 && price > priceMax) reason = `Hedef fiyat bandının üstünde ($${price.toFixed(2)}).`;
    else if (margin < minMargin) reason = `Net marj yetersiz (%${Math.round(margin)} < %${minMargin}).`;
    else if (channelBlocked) reason = `Önerilen satış kanalları ${country} pazarında kullanılamıyor.`;
    else if (barrierHit && !hasDiff) reason = `Pazar uyumu: ${barrierHit.why} — küçük satıcı için giriş bariyeri yüksek.`;

    const verdict = buildVerdict({
      decision: reason ? "rejected" : "kept",
      country,
      platforms,
      checks,
      barrier: barrierHit ? { rule: `${country} pazar kuralı`, why: barrierHit.why } : undefined,
      reason: reason || undefined,
    });
    (p as GateInput).market_verdict = verdict;

    if (reason) rejected.push({ product: p, rejection_reason: reason, verdict });
    else survivors.push(p);
  }

  // Hiç ürün kalmadıysa kullanıcıyı boş ekranla bırakma: en iyi adayları geri al.
  if (survivors.length < keepAtLeast && rejected.length) {
    const rescued = [...rejected]
      .sort((a, b) => netMarginOf(b.product) - netMarginOf(a.product))
      .slice(0, keepAtLeast - survivors.length);
    for (const r of rescued) {
      const v = (r.product as GateInput).market_verdict;
      if (v) {
        v.decision = "rescued";
        v.summary = buildVerdict({
          decision: "rescued",
          country,
          platforms,
          checks: v.checks,
          barrier: v.barrier,
          reason: r.rejection_reason,
        }).summary;
      }
      survivors.push(r.product);
      rejected.splice(rejected.indexOf(r), 1);
    }
  }

  return { survivors, rejected };
}

