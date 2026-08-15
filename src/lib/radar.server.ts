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

export const RADAR_COUNTRIES = ["US", "TR", "DE", "GB", "AE", "FR"] as const;

export function radarPrompt(country: string, count = 8): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a senior e-commerce trend analyst. Today is ${today}.
List ${count} products that are GAINING momentum RIGHT NOW for online sellers targeting ${country}.

Hard rules:
- Real, currently sellable physical products (no vague categories, no "smart gadget").
- Avoid saturated evergreen items (phone cases, generic LED strips, basic resistance bands).
- Prefer products with a clear problem/benefit, light shipping and a healthy price band.
- Prices in USD, realistic retail (not cost).

Return STRICT JSON only, no markdown:
{"items":[{
 "title": string (specific product name, max 60 chars),
 "niche": string (2-3 words),
 "category": string (one of: Home, Kitchen, Beauty, Fitness, Pet, Baby, Tech Accessories, Outdoor, Auto, Fashion, Office, Health),
 "platform": string (best sales channel: Shopify, TikTok Shop, Amazon, Etsy, Trendyol, eBay),
 "winner_score": number 0-100 (overall opportunity),
 "momentum": number -30..60 (percentage change in demand vs last month),
 "price_min": number, "price_max": number,
 "est_margin_pct": number 0-80,
 "reason": string (max 140 chars, why it is rising now — concrete driver)
}]}`;
}

export function sanitizeRadar(items: unknown, country: string): RadarSeed[] {
  if (!Array.isArray(items)) return [];
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };
  return items
    .map((raw) => {
      const it = raw as Record<string, unknown>;
      const title = String(it['title'] ?? "").trim().slice(0, 80);
      if (title.length < 3) return null;
      const min = num(it['price_min'], 1, 5000, 19);
      const max = Math.max(min + 1, num(it['price_max'], 1, 6000, min + 20));
      return {
        title,
        niche: String(it['niche'] ?? "General").slice(0, 40),
        category: String(it['category'] ?? "General").slice(0, 40),
        country,
        platform: String(it['platform'] ?? "Shopify").slice(0, 30),
        winner_score: num(it['winner_score'], 0, 100, 60),
        momentum: num(it['momentum'], -50, 200, 10),
        price_min: min,
        price_max: max,
        est_margin_pct: num(it['est_margin_pct'], 0, 90, 35),
        reason: String(it['reason'] ?? "").slice(0, 240),
      } satisfies RadarSeed;
    })
    .filter((x): x is RadarSeed => x !== null)
    .slice(0, 12);
}
