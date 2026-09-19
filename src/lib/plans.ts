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
export const USAGE_ROWS: {
  key: keyof Pick<Plan, "credits" | "toolRuns" | "councilRuns" | "radarScans">;
  label: string;
  unit: string;
}[] = [
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

/** Admin hesabı için kota — her kalemde 250 jeton (tek kaynak). */
export const ADMIN_QUOTA = {
  credits: 250,
  toolRuns: 250,
  councilRuns: 250,
  radarScans: 250,
} as const satisfies Pick<Plan, "credits" | "toolRuns" | "councilRuns" | "radarScans">;

/** Aylık kullanım kotaları; ücretsiz hesap Find Winner'da 2 jeton (klasik düzen). */
export function quotaFor(
  level: 0 | 1 | 2 | 3,
): Pick<Plan, "credits" | "toolRuns" | "councilRuns" | "radarScans"> {
  if (level === 0) return { credits: 2, toolRuns: 3, councilRuns: 0, radarScans: 1 };
  const p = planForLevel(level);
  return {
    credits: p.credits,
    toolRuns: p.toolRuns,
    councilRuns: p.councilRuns,
    radarScans: p.radarScans,
  };
}

/* ------------------------------------------------------------------ */
/* Admin paket tanımlama (yönetici, seçtiği kullanıcıya süreli paket)  */
/* ------------------------------------------------------------------ */

/** Adminin paket tanımlarken seçebileceği süreler (ay). */
export const ADMIN_PERIOD_MONTHS = [1, 2, 3, 6, 12] as const;

export type AdminPeriodMonths = (typeof ADMIN_PERIOD_MONTHS)[number];

/** Süre üst sınırı (ay) — kazara 100 ay yazılmasını engeller. */
export const ADMIN_MAX_PERIOD_MONTHS = 36;

/** Metni geçerli bir paket kimliğine çevirir (büyük/küçük harf duyarsız). */
export function normalizePlanId(value: unknown): PlanId | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "starter") return "Starter";
  if (text === "pro") return "Pro";
  if (text === "business" || text === "enterprise" || text === "ultra") return "Business";
  return null;
}

/**
 * Verilen tarihe ay ekler. Ay sonu taşması kırpılır (31 Oca + 1 ay → 28/29 Şub),
 * böylece süre her zaman takvimde gerçekten var olan bir güne denk gelir.
 */
export function addMonths(iso: string, months: number): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) throw new Error("INVALID_DATE");
  const whole = Math.min(ADMIN_MAX_PERIOD_MONTHS, Math.max(1, Math.round(months)));
  const day = base.getUTCDate();
  const target = new Date(base.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + whole);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

/** Admin tanımlamasında paketle birlikte verilen simülasyon kredisi. */
export const ADMIN_SIM_GRANTS: Record<PlanId, number> = {
  Starter: 5,
  Pro: 10,
  Business: 25,
};

/** Admin paket tanımlamasında verilecek kredi miktarları (tek kaynak: PLANS). */
export function adminGrantFor(plan: PlanId): { credits: number; simCredits: number } {
  return {
    credits: PLAN_BY_ID[plan]?.credits ?? 0,
    simCredits: ADMIN_SIM_GRANTS[plan] ?? 0,
  };
}

/** Bitiş tarihine kalan gün sayısı (tarih geçmişse 0, tarih yoksa null). */
export function daysLeft(
  periodEnd: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!periodEnd) return null;
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
}

/** Paket süresi dolmuş mu? (Bitiş tarihi yoksa süresiz kabul edilir → false.) */
export function isPlanExpired(
  periodEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const left = daysLeft(periodEnd, now);
  return left !== null && left <= 0;
}
