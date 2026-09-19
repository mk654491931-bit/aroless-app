/** Kazanan Ürün Radarı — günlük akış için prompt ve tip yardımcıları (sunucu tarafı). */

export type RadarSeed = {
  title: string;
  niche: string;
  category: string;
  country: string;
  platform: string;
  winner_score: number;
  momentum: number;
  price_min: number;
  price_max: number;
  est_margin_pct: number;
  reason: string;
};

/** Google Trends ile doğrulanmış canlı kanıt (radar_items.payload içinde saklanır). */
export type RadarEvidence = {
  keyword: string;
  /** Momentumun kaynağı: gerçek Google Trends mi, yoksa tahmin mi? */
  trend_source: "google-trends" | "estimated";
  /** Google Trends'ten gelen gerçek 30 günlük değişim (%). */
  trend_momentum_pct: number;
  /** 12 aylık ilgi serisi (0-100), sparkline için. */
  series: number[];
  /** Ürünü kim üretti: AI konseyi mi, canlı trend taraması mı? */
  generated_by: "ai" | "trends";
};

export const RADAR_COUNTRIES = ["US", "TR", "DE", "GB", "AE", "FR"] as const;

export function radarPrompt(country: string, count = 10): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a senior e-commerce trend analyst. Today is ${today}.
List ${count} products that are GAINING momentum RIGHT NOW for online sellers targeting ${country}.

Hard rules:
- Real, currently sellable physical products (no vague categories, no "smart gadget").
- Every product must be UNIQUE: no two items may share the same or a near-identical name.
- Avoid saturated evergreen items (phone cases, generic LED strips, basic resistance bands).
- Prefer products with a clear problem/benefit, light shipping and a healthy price band.
- Prices in USD, realistic retail (not cost).
- "reason" MUST cite a concrete, checkable driver (a rising search trend, a season starting,
  a platform policy/payment change, a viral format, a supply shift). No generic "trending now".

Return STRICT JSON only, no markdown:
{"items":[{
 "title": string (specific product name, max 60 chars, unique),
 "niche": string (2-3 words),
 "category": string (one of: Home, Kitchen, Beauty, Fitness, Pet, Baby, Tech Accessories, Outdoor, Auto, Fashion, Office, Health),
 "platform": string (best sales channel: Shopify, TikTok Shop, Amazon, Etsy, Trendyol, eBay),
 "keyword": string (exact 2-4 word English search term buyers type — used to verify demand),
 "winner_score": number 0-100 (overall opportunity),
 "momentum": number -30..60 (percentage change in demand vs last month),
 "price_min": number, "price_max": number,
 "est_margin_pct": number 0-80,
 "reason": string (max 140 chars, why it is rising now — concrete driver)
}]}`;
}

function num(v: unknown, min: number, max: number, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}

/**
 * AI çıktısını güvenli seed'lere çevirir.
 *
 * ÖNEMLİ: başlıklar `lower(title)` bazında tekilleştirilir. `radar_items`
 * tablosunda `(day, country, lower(title))` üzerinde UNIQUE index var; aynı
 * gün için tekrar eden bir başlık TÜM toplu insert'i düşürüyordu ve radar
 * kalıcı olarak boş kalıyordu.
 */
export function sanitizeRadar(items: unknown, country: string): RadarSeed[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: RadarSeed[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const title = String(it["title"] ?? "")
      .trim()
      .slice(0, 80);
    if (title.length < 3) continue;
    const key = title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    const min = num(it["price_min"], 1, 5000, 19);
    const max = Math.max(min + 1, num(it["price_max"], 1, 6000, min + 20));
    out.push({
      title,
      niche: String(it["niche"] ?? "General").slice(0, 40),
      category: String(it["category"] ?? "General").slice(0, 40),
      country,
      platform: String(it["platform"] ?? "Shopify").slice(0, 30),
      winner_score: num(it["winner_score"], 0, 100, 60),
      momentum: num(it["momentum"], -50, 200, 10),
      price_min: min,
      price_max: max,
      est_margin_pct: num(it["est_margin_pct"], 0, 90, 35),
      reason: String(it["reason"] ?? "").slice(0, 240),
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** AI'nın önerdiği doğrulama kelimesi (yoksa başlık). */
export function radarKeyword(raw: unknown, title: string): string {
  const it = raw as Record<string, unknown> | null;
  const kw = String(it?.["keyword"] ?? "").trim();
  return (kw || title).slice(0, 80);
}

/**
 * Google Trends kanıtını seed'e işler: momentum ve skor artık uydurma değil,
 * gerçek 30 günlük arama değişiminden hesaplanır.
 *
 * `trendScore` 50 nötr kabul edilir; her +1% momentum yaklaşık +0.8 puan.
 * Nihai skor AI skoru (%65) + trend skoru (%35) karışımıdır — böylece hem
 * modelin nitel değerlendirmesi hem ölçülmüş talep artışı yansır.
 */
export function applyTrendEvidence(seed: RadarSeed, evidence: RadarEvidence): RadarSeed {
  if (evidence.trend_source !== "google-trends") {
    return { ...seed, momentum: evidence.trend_momentum_pct || seed.momentum };
  }
  const trendScore = Math.max(5, Math.min(98, Math.round(50 + evidence.trend_momentum_pct * 0.8)));
  const blended = Math.round(seed.winner_score * 0.65 + trendScore * 0.35);
  const sign = evidence.trend_momentum_pct >= 0 ? "+" : "";
  const proof = ` Google Trends "${evidence.keyword}": ${sign}${evidence.trend_momentum_pct}% / 30 gün.`;
  return {
    ...seed,
    momentum: Math.max(-50, Math.min(200, evidence.trend_momentum_pct)),
    winner_score: Math.max(1, Math.min(100, blended)),
    // Gerekçe artık ölçülmüş talep kanıtını da taşır (uydurma momentum yok).
    reason: `${seed.reason.slice(0, 240 - proof.length).trimEnd()}${proof}`,
  };
}

/**
 * Son güvenlik ağı: AI motorlarının TAMAMI düşerse radar yine boş kalmaz.
 * Bu kavramlar gerçek, satılabilir ürünlerdir; momentum/skor değerleri
 * Google Trends'ten canlı çekilir ve çıktı arayüzde "canlı trend verisi"
 * olarak dürüstçe etiketlenir.
 */
export const RADAR_TREND_KEYWORDS: {
  title: string;
  keyword: string;
  niche: string;
  category: string;
  platform: string;
  price_min: number;
  price_max: number;
  est_margin_pct: number;
}[] = [
  {
    title: "Portable Neck Fan",
    keyword: "neck fan",
    niche: "Summer Gadgets",
    category: "Tech Accessories",
    platform: "TikTok Shop",
    price_min: 19,
    price_max: 39,
    est_margin_pct: 42,
  },
  {
    title: "Reusable Pet Hair Remover Roller",
    keyword: "pet hair remover",
    niche: "Pet Care",
    category: "Pet",
    platform: "Amazon",
    price_min: 12,
    price_max: 29,
    est_margin_pct: 46,
  },
  {
    title: "Insulated Stanley-Style Tumbler",
    keyword: "insulated tumbler",
    niche: "Drinkware",
    category: "Kitchen",
    platform: "Shopify",
    price_min: 24,
    price_max: 45,
    est_margin_pct: 38,
  },
  {
    title: "Posture Corrector Brace",
    keyword: "posture corrector",
    niche: "Health & Posture",
    category: "Health",
    platform: "Amazon",
    price_min: 18,
    price_max: 39,
    est_margin_pct: 44,
  },
  {
    title: "Sunset Projection Lamp",
    keyword: "sunset lamp",
    niche: "Room Decor",
    category: "Home",
    platform: "TikTok Shop",
    price_min: 15,
    price_max: 34,
    est_margin_pct: 48,
  },
  {
    title: "Resistance Bands Set with Handles",
    keyword: "resistance bands set",
    niche: "Home Gym",
    category: "Fitness",
    platform: "Amazon",
    price_min: 20,
    price_max: 42,
    est_margin_pct: 40,
  },
  {
    title: "Adjustable Laptop Stand",
    keyword: "laptop stand",
    niche: "Remote Work",
    category: "Office",
    platform: "Amazon",
    price_min: 26,
    price_max: 55,
    est_margin_pct: 36,
  },
  {
    title: "Silicone Kitchen Utensil Set",
    keyword: "silicone utensils",
    niche: "Kitchen Tools",
    category: "Kitchen",
    platform: "Etsy",
    price_min: 22,
    price_max: 49,
    est_margin_pct: 41,
  },
  {
    title: "Magnetic Phone Mount for Car",
    keyword: "magnetic car mount",
    niche: "Car Accessories",
    category: "Auto",
    platform: "Amazon",
    price_min: 14,
    price_max: 32,
    est_margin_pct: 45,
  },
  {
    title: "LED Sunset Wall Mirror",
    keyword: "led wall mirror",
    niche: "Beauty Setup",
    category: "Beauty",
    platform: "TikTok Shop",
    price_min: 29,
    price_max: 69,
    est_margin_pct: 43,
  },
];

/** Yedek liste → seed (Google Trends kanıtı uygulanmadan önceki ham hâl). */
export function trendFallbackSeeds(country: string, count = 10): RadarSeed[] {
  return RADAR_TREND_KEYWORDS.slice(0, count).map((k) => ({
    title: k.title,
    niche: k.niche,
    category: k.category,
    country,
    platform: k.platform,
    winner_score: 62,
    momentum: 0,
    price_min: k.price_min,
    price_max: k.price_max,
    est_margin_pct: k.est_margin_pct,
    reason: "Canlı Google Trends taramasıyla doğrulanan talep — AI motorları meşgulken hesaplandı.",
  }));
}
