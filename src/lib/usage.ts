// ============================================================================
// Usage quotas (client + server safe)
//
// ONE source of truth for the numbers is `plans.ts` — the SQL migration mirrors
// it for atomic enforcement. Academy and Simulation are free/unlimited for every
// user and never consume quota.
// ============================================================================

import { quotaFor, tierLevel } from "./plans";

export type UsageFeature =
  "product_finder" | "ai_tools" | "council" | "trend_radar" | "academy" | "simulation";

/** Admin default allowance per feature (per month). */
export const ADMIN_FEATURE_LIMIT = 250;

/** Modules that are free and unlimited for everyone. */
export const FREE_UNLIMITED_FEATURES = ["academy", "simulation"] as const;

/** Sentinel limit meaning "unlimited". */
export const UNLIMITED = -1;

export type UsageFeatureMeta = {
  key: UsageFeature;
  label: string;
  unit: string;
  hint: string;
  freeUnlimited: boolean;
};

export const USAGE_FEATURES: UsageFeatureMeta[] = [
  {
    key: "product_finder",
    label: "Ürün Bulucu Kredisi",
    unit: "/ ay",
    hint: "Kazanan ürün aramaları ve derin ürün analizleri",
    freeUnlimited: false,
  },
  {
    key: "ai_tools",
    label: "AI Araç Çalıştırma",
    unit: "/ ay",
    hint: "Mağaza denetimi, kreatif stüdyo, SEO ve script üretimi",
    freeUnlimited: false,
  },
  {
    key: "council",
    label: "AI Konsey Oturumu",
    unit: "/ ay",
    hint: "14'lü AI Konsey icra raporu",
    freeUnlimited: false,
  },
  {
    key: "trend_radar",
    label: "Trend Radar Taraması",
    unit: "/ ay",
    hint: "Canlı trend radarı taramaları",
    freeUnlimited: false,
  },
  {
    key: "academy",
    label: "Akademi Modülü",
    unit: "",
    hint: "21 günlük eğitim programı — her üyeliğe dahil",
    freeUnlimited: true,
  },
  {
    key: "simulation",
    label: "Simülasyon Modülü",
    unit: "",
    hint: "Pazar simülatörü — jeton harcamaz",
    freeUnlimited: true,
  },
];

export const USAGE_FEATURE_KEYS = USAGE_FEATURES.map((f) => f.key);

/** Maps a quota-tracked feature onto its `plans.ts` quota field. */
const FEATURE_TO_QUOTA = {
  product_finder: "credits",
  ai_tools: "toolRuns",
  council: "councilRuns",
  trend_radar: "radarScans",
} as const satisfies Record<string, keyof ReturnType<typeof quotaFor>>;

export function isFreeUnlimited(feature: UsageFeature): boolean {
  return (FREE_UNLIMITED_FEATURES as readonly string[]).includes(feature);
}

/**
 * Monthly allowance for a feature. Mirrors the SQL `usage_feature_limit`
 * exactly so the UI can render before/without a round trip.
 */
export function usageLimitFor(
  tier: string | null | undefined,
  isAdmin: boolean,
  feature: UsageFeature,
): number {
  if (isFreeUnlimited(feature)) return UNLIMITED;
  if (isAdmin) return ADMIN_FEATURE_LIMIT;
  const quota = quotaFor(tierLevel(tier));
  if (feature === "academy" || feature === "simulation") return UNLIMITED;
  return quota[FEATURE_TO_QUOTA[feature]];
}

export type UsageEntry = { used: number; limit: number; unlimited: boolean };

export type UsageSnapshot = {
  tier: string;
  isAdmin: boolean;
  periodStart: string;
  periodEnd: string;
  features: Record<UsageFeature, UsageEntry>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalises the RPC payload into a fully populated snapshot, filling any
 * missing feature from the static plan config so the UI never renders blanks.
 */
export function normalizeUsageSnapshot(
  raw: unknown,
  fallbackTier = "Free",
  fallbackIsAdmin = false,
): UsageSnapshot {
  const root = asRecord(raw);
  const tier = typeof root["tier"] === "string" ? root["tier"] : fallbackTier;
  const isAdmin = root["is_admin"] === true || (root["is_admin"] === undefined && fallbackIsAdmin);
  const rawFeatures = asRecord(root["features"]);

  const features = {} as Record<UsageFeature, UsageEntry>;
  for (const key of USAGE_FEATURE_KEYS) {
    const entry = asRecord(rawFeatures[key]);
    const unlimited = isFreeUnlimited(key) || entry["unlimited"] === true;
    const limit = unlimited
      ? UNLIMITED
      : toNumber(entry["limit"], usageLimitFor(tier, isAdmin, key));
    features[key] = {
      used: Math.max(0, toNumber(entry["used"], 0)),
      limit,
      unlimited,
    };
  }

  const periodStart = typeof root["period_start"] === "string" ? root["period_start"] : "";
  const periodEnd = typeof root["period_end"] === "string" ? root["period_end"] : "";

  return { tier, isAdmin, periodStart, periodEnd, features };
}

/** 0–100 completion for a quota (unlimited features always report 0). */
export function usagePercent(entry: UsageEntry): number {
  if (entry.unlimited || entry.limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((entry.used / entry.limit) * 100)));
}

/** True when the feature has no allowance left. */
export function isExhausted(entry: UsageEntry): boolean {
  if (entry.unlimited) return false;
  return entry.used >= entry.limit;
}

/** Human label for an entry, e.g. "12 / 30 kullanıldı". */
export function usageLabel(entry: UsageEntry): string {
  if (entry.unlimited) return "Ücretsiz / Sınırsız";
  return `${entry.used} / ${entry.limit} kullanıldı`;
}

export type UsageConsumeResult =
  | { ok: true; used: number; limit: number; remaining: number; unlimited: boolean }
  | {
      ok: false;
      error: "limit_reached" | "unavailable" | "unauthenticated";
      limit: number;
      used: number;
    };

/** Parses the `consume_usage` RPC payload. */
export function parseConsumeResult(raw: unknown): UsageConsumeResult {
  const data = asRecord(raw);
  if (data["ok"] === true) {
    const limit = toNumber(data["limit"], UNLIMITED);
    return {
      ok: true,
      used: toNumber(data["used"], 0),
      limit,
      remaining: toNumber(data["remaining"], limit < 0 ? UNLIMITED : 0),
      unlimited: data["unlimited"] === true || limit < 0,
    };
  }
  const error = data["error"];
  return {
    ok: false,
    error:
      error === "limit_reached" || error === "unavailable" || error === "unauthenticated"
        ? error
        : "unavailable",
    limit: toNumber(data["limit"], 0),
    used: toNumber(data["used"], 0),
  };
}

/** Copy shown when a quota is exhausted. */
export function limitReachedMessage(feature: UsageFeature, tier: string): string {
  const meta = USAGE_FEATURES.find((f) => f.key === feature);
  const label = meta?.label ?? "Bu özellik";
  return `${label} limitin doldu (${tier} paketi). Paketini yükselterek devam edebilirsin.`;
}

/** Copy shown when a quota is exhausted and the tier is not known. */
export function quotaExceededMessage(feature: UsageFeature, limit: number): string {
  const meta = USAGE_FEATURES.find((f) => f.key === feature);
  const label = meta?.label ?? "Bu özellik";
  return `${label} için aylık ${limit} hakkın doldu. Paketini yükselterek devam edebilirsin.`;
}

export type UsageEnforcement =
  | { ok: true; used: number; limit: number; unlimited: boolean }
  | { ok: false; reason: "limit_reached"; used: number; limit: number }
  | { ok: false; reason: "unavailable" };

export type RpcResult = { data: unknown; error: { message: string } | null };

export type RpcCapable = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult>;
};
