/**
 * Tek satış modelimiz: 3 aylık abonelik paketi.
 * Tek seferlik kredi paketi / ek satış yoktur.
 */
export type PlanId = "Starter" | "Pro" | "Business";

export type Plan = {
  id: PlanId;
  label: string;
  usd: number;
  credits: number;
  /** Paket seviyesi: modül erişimi bu seviyeye göre açılır. */
  level: 1 | 2 | 3;
  highlight: boolean;
  moduleCount: number;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "Starter",
    label: "Starter",
    usd: 39,
    credits: 8,
    level: 1,
    highlight: false,
    moduleCount: 3,
    features: [
      "8 kredi / ay",
      "Ürün Bulucu + Karşılaştırma",
      "Sourcing & Factory Hub",
      "E-Com News Explainer",
      "Akademi ve simülatör dahil",
      "E-posta desteği",
    ],
  },
  {
    id: "Pro",
    label: "Pro",
    usd: 59,
    credits: 15,
    level: 2,
    highlight: true,
    moduleCount: 6,
    features: [
      "15 kredi / ay",
      "Starter'daki her modül",
      "Financial & Cost Engine",
      "Growth & Market AI",
      "Multi-Platform Trend Radar",
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
    moduleCount: 9,
    features: [
      "50 kredi / ay",
      "Pro'daki her modül",
      "Compliance & Legal Guard",
      "14'lü AI Konsey",
      "Büyüme Suite (Radar, ROI, Denetçi, Stüdyo)",
      "Öncelikli destek",
    ],
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = {
  Starter: PLANS[0],
  Pro: PLANS[1],
  Business: PLANS[2],
};

/** Sidebar grup kimliği → gereken minimum paket seviyesi. */
export const MODULE_LEVEL: Record<string, 1 | 2 | 3> = {
  library: 1,
  sourcing: 1,
  news: 1,
  finance: 2,
  growth: 2,
  radar: 2,
  compliance: 3,
  council: 3,
  growth_suite: 3,
};

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

export function requiredPlanFor(groupId: string): Plan {
  const lvl = MODULE_LEVEL[groupId] ?? 1;
  return PLANS.find((p) => p.level === lvl) ?? PLANS[0];
}
