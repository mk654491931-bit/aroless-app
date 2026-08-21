/**
 * Tek satış modelimiz: 3 aylık abonelik paketi.
 * Tek seferlik kredi paketi / ek satış yoktur.
 *
 * ÖNEMLİ: Tüm modüller her pakette AÇIKTIR. Paketler arasındaki fark
 * modül erişimi değil, aylık KULLANIM MİKTARIDIR (kredi + araç çalıştırma hakkı).
 */
export type PlanId = "Starter" | "Pro" | "Business";

export type Plan = {
  id: PlanId;
  label: string;
  usd: number;
  /** Aylık ürün bulucu / derin analiz kredisi. */
  credits: number;
  /** Paket seviyesi (sadece sıralama ve kullanım kotası için). */
  level: 1 | 2 | 3;
  highlight: boolean;
  /** Aylık AI araç çalıştırma hakkı (tüm modüller ortak havuz). */
  toolRuns: number;
  /** Aylık AI Konsey oturumu. */
  councilRuns: number;
  /** Aylık trend radar taraması. */
  radarScans: number;
  features: string[];
};

/** Tüm paketlerde açık olan modül grupları. */
export const ALL_MODULES = 9;

export const PLANS: Plan[] = [
  {
    id: "Starter",
    label: "Starter",
    usd: 39,
    credits: 8,
    level: 1,
    highlight: false,
    toolRuns: 30,
    councilRuns: 2,
    radarScans: 6,
    features: [
      "Tüm 9 modül açık",
      "8 ürün bulucu kredisi / ay",
      "30 AI araç çalıştırma / ay",
      "2 AI Konsey oturumu / ay",
      "6 trend radar taraması / ay",
      "Akademi ve simülatör dahil",
    ],
  },
  {
    id: "Pro",
    label: "Pro",
    usd: 59,
    credits: 15,
    level: 2,
    highlight: true,
    toolRuns: 90,
    councilRuns: 6,
    radarScans: 20,
    features: [
      "Tüm 9 modül açık",
      "15 ürün bulucu kredisi / ay",
      "90 AI araç çalıştırma / ay",
      "6 AI Konsey oturumu / ay",
      "20 trend radar taraması / ay",
      "Öncelikli üretim kuyruğu",
    ],
  },
  {
    id: "Business",
    label: "Business",
    usd: 199,
    credits: 50,
    level: 3,
    highlight: false,
    toolRuns: 300,
    councilRuns: 20,
    radarScans: 60,
    features: [
      "Tüm 9 modül açık",
      "50 ürün bulucu kredisi / ay",
      "300 AI araç çalıştırma / ay",
      "20 AI Konsey oturumu / ay",
      "60 trend radar taraması / ay",
      "Öncelikli destek",
    ],
  },

];

export const PLAN_BY_ID: Record<PlanId, Plan> = {
  Starter: PLANS[0],
  Pro: PLANS[1],
  Business: PLANS[2],
};

/** Kullanım karşılaştırma tablosu satırları. */
export const USAGE_ROWS: { key: keyof Pick<Plan, "credits" | "toolRuns" | "councilRuns" | "radarScans">; label: string; unit: string }[] = [
  { key: "credits", label: "Ürün Bulucu kredisi", unit: "/ ay" },
  { key: "toolRuns", label: "AI araç çalıştırma", unit: "/ ay" },
  { key: "councilRuns", label: "14'lü AI Konsey oturumu", unit: "/ ay" },
  { key: "radarScans", label: "Trend radar taraması", unit: "/ ay" },
];

/** Kullanıcının abonelik tier metnini seviyeye çevirir (0 = ücretsiz). */
export function tierLevel(tier: string | undefined | null): 0 | 1 | 2 | 3 {
  switch (String(tier ?? "").toLowerCase()) {
    case "starter":
      return 1;
    case "pro":
      return 2;
    case "business":
    case "enterprise":
    case "ultra":
      return 3;
    default:
      return 0;
  }
}

/** Seviyeye karşılık gelen paket (0 → Starter önerisi). */
export function planForLevel(level: number): Plan {
  return PLANS.find((p) => p.level === Math.min(3, Math.max(1, level))) ?? PLANS[0];
}

/** Aylık kullanım kotaları; ücretsiz hesap için küçük bir deneme kotası. */
export function quotaFor(level: 0 | 1 | 2 | 3): Pick<Plan, "credits" | "toolRuns" | "councilRuns" | "radarScans"> {
  if (level === 0) return { credits: 1, toolRuns: 3, councilRuns: 0, radarScans: 1 };
  const p = planForLevel(level);
  return { credits: p.credits, toolRuns: p.toolRuns, councilRuns: p.councilRuns, radarScans: p.radarScans };
}
