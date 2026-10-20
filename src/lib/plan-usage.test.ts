import { describe, expect, it } from "vitest";

import {
  UNKNOWN_USAGE_LABEL,
  effectiveUsageLimit,
  emptyUsageCounts,
  freeUsageCeiling,
  limitFor,
  monthKey,
  monthRange,
  planLabelFor,
  planLimitMessage,
  planUsageRows,
  usageKindForFeature,
  usageLabelFor,
  usageMeter,
} from "./plan-usage";
import { ADMIN_QUOTA, PLAN_BY_ID, adminTopUpAmount } from "./plans";
import { PLAN_RECONCILE_GAP_MS, planPollingDone, shouldReconcilePlan } from "./plan-sync";

/**
 * PLAN KULLANIMI — ölçülen üç boşluğu kilitleyen testler:
 *   1. Paket limitleri (8/30/2/6, 15/90/6/20, 50/300/20/60) arayüzde görünüyor
 *      ama tüketimle ilgisi yoktu → `usageMeter` ve `planUsageRows` bunu tek
 *      kaynağa bağlar.
 *   2. Kullanıcı adı "pro"/"enterprise" yazılmış olabilir → kanonik etiket.
 *   3. Ödeme sonrası paket görünmüyordu → bekleyen işaret + yoklama kararı.
 */

describe("usageKindForFeature — her AI işi doğru aylık hakka yazılır", () => {
  it("araç çağrıları AI araç hakkına gider", () => {
    expect(usageKindForFeature("tool:listing-seo")).toBe("toolRuns");
    expect(usageKindForFeature("tool:consensus")).toBe("toolRuns");
    expect(usageKindForFeature("tool:creative-studio")).toBe("toolRuns");
    // Bilinmeyen biçim: en geniş hak (sessizce sınırsız bırakma yok).
    expect(usageKindForFeature("bilinmeyen")).toBe("toolRuns");
  });

  it("konsey/radar/bulucu ayrı havuzlara gider", () => {
    expect(usageKindForFeature("council")).toBe("councilRuns");
    expect(usageKindForFeature("radar-scan")).toBe("radarScans");
    expect(usageKindForFeature("agent-pipeline")).toBe("credits");
    expect(usageKindForFeature("trend-analysis")).toBe("credits");
  });
});

describe("monthRange — sayaç ay başında kendiliğinden sıfırlanır", () => {
  it("ay başını UTC olarak verir", () => {
    const { startIso, key } = monthRange(new Date("2026-10-18T09:00:00.000Z"));
    expect(key).toBe("2026-10");
    expect(startIso).toBe("2026-10-01T00:00:00.000Z");
    expect(monthKey(new Date("2026-01-31T23:59:59.000Z"))).toBe("2026-01");
  });

  it("ay sınırında kova değişir (kullanım sıfıra döner)", () => {
    expect(monthKey(new Date("2026-10-31T23:59:59.000Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-11-01T00:00:01.000Z"))).toBe("2026-11");
  });
});

describe("usageMeter — kullanılan/limit/kalan aynı sayıdan", () => {
  it("normal durum", () => {
    expect(usageMeter(3, 8)).toEqual({
      used: 3,
      limit: 8,
      remaining: 5,
      pct: 38,
      exhausted: false,
      disabled: false,
    });
  });

  it("limit doldu", () => {
    const meter = usageMeter(8, 8);
    expect(meter.remaining).toBe(0);
    expect(meter.exhausted).toBe(true);
    expect(meter.pct).toBe(100);
  });

  it("limit aşılmış olsa bile kalan 0 (negatif yok)", () => {
    expect(usageMeter(12, 8).remaining).toBe(0);
  });

  it("limit yok (0) → hak kapalı, bölme yok", () => {
    const meter = usageMeter(0, 0);
    expect(meter.disabled).toBe(true);
    expect(meter.exhausted).toBe(true);
    expect(Number.isFinite(meter.pct)).toBe(true);
  });

  it("bozuk girdi 0 sayılır (NaN limiti aşmaz)", () => {
    expect(usageMeter(Number.NaN, Number.NaN).limit).toBe(0);
  });
});

describe("planUsageRows — paket limitleri plans.ts ile birebir", () => {
  it("Starter / Pro / Business limitleri", () => {
    const zeros = emptyUsageCounts();
    const pick = (rows: ReturnType<typeof planUsageRows>) =>
      Object.fromEntries(rows.map((r) => [r.kind, r.limit]));

    expect(pick(planUsageRows(1, zeros))).toEqual({
      credits: PLAN_BY_ID.Starter.credits,
      toolRuns: PLAN_BY_ID.Starter.toolRuns,
      councilRuns: PLAN_BY_ID.Starter.councilRuns,
      radarScans: PLAN_BY_ID.Starter.radarScans,
    });
    expect(limitFor(2, "toolRuns")).toBe(90);
    expect(limitFor(3, "credits")).toBe(50);
  });

  it("ücretsiz plan: 2 bulucu / 3 araç / 0 konsey / 1 radar", () => {
    const rows = planUsageRows(0, emptyUsageCounts());
    expect(rows.map((r) => r.limit)).toEqual([2, 3, 0, 1]);
  });

  it("admin her kalemde 250", () => {
    const rows = planUsageRows(0, emptyUsageCounts(), true);
    expect(rows.every((r) => r.limit === 250)).toBe(true);
  });

  it("kullanım sayacı satıra yansır", () => {
    const rows = planUsageRows(2, { ...emptyUsageCounts(), toolRuns: 90 });
    const tools = rows.find((r) => r.kind === "toolRuns")!;
    expect(tools.used).toBe(90);
    expect(tools.exhausted).toBe(true);
    expect(rows.find((r) => r.kind === "credits")!.used).toBe(0);
  });
});

// REGRESYON: sayaç okunamadığında satır "bilinmiyor" yazıyordu; kullanıcı hem
// kullanımını hem de aboneliğinin aylık hakkını kaybediyordu. Limit abonelikten
// geldiği için HER ZAMAN bilinir: ölçülemeyen sayaçta limit gösterilir.
describe("usageLabelFor — ölçülemeyen sayaçta abonelik hakkı görünür", () => {
  it("ölçülemeyen sayaç '?/limit' yazar (0 YAZMAZ, 'bilinmiyor' DEMEZ)", () => {
    expect(usageLabelFor({ used: 0, limit: 250, measured: false })).toBe("?/250");
    expect(usageLabelFor({ used: 0, limit: 8, measured: false })).toBe("?/8");
    expect(UNKNOWN_USAGE_LABEL).toBe("?");
    expect(usageLabelFor({ used: 0, limit: 250, measured: false })).not.toContain("bilinmiyor");
  });

  it("limiti olmayan (kapalı) hakta yalnız '?' yazılır", () => {
    expect(usageLabelFor({ used: 0, limit: 0, measured: false })).toBe("?");
  });

  it("yüklenirken '…', kapalı hakta '—', ölçülde 'kullanılan/limit'", () => {
    expect(usageLabelFor({ used: 0, limit: 250, loading: true })).toBe("…");
    expect(usageLabelFor({ used: 0, limit: 0, disabled: true, measured: true })).toBe("—");
    expect(usageLabelFor({ used: 3, limit: 8, measured: true })).toBe("3/8");
  });
});

describe("freeUsageCeiling — her kazanılan jeton harcanabilir kalır", () => {
  it("kullanılan + kalan bakiye (eski max() jetonu kilitliyordu)", () => {
    // 2 hoş geldin jetonu harcandı, davet ile 2 jeton kazanıldı:
    // eski formül max(2, 2) = 2 → used=2 limiti aşmış görünüp ENGELLİYORDU.
    expect(freeUsageCeiling(2, 2)).toBe(4);
    expect(freeUsageCeiling(0, 2)).toBe(2);
    expect(freeUsageCeiling(5, 3)).toBe(8);
  });

  it("okunamayan sayaç 'bilinmiyor' (null) — 0 sayılmaz", () => {
    expect(freeUsageCeiling(null, 2)).toBeNull();
    expect(freeUsageCeiling(2, null)).toBeNull();
  });
});

describe("effectiveUsageLimit — admin paketten bağımsız 250", () => {
  it("admin ücretli pakette olsa da 250 alır", () => {
    expect(
      effectiveUsageLimit({
        level: 3,
        kind: "credits",
        isAdmin: true,
        used: 0,
        balance: 50,
      }),
    ).toBe(ADMIN_QUOTA.credits);
  });

  it("ücretsiz plan kullanılan + bakiye, ücretli plan paket limiti", () => {
    expect(
      effectiveUsageLimit({ level: 0, kind: "credits", isAdmin: false, used: 2, balance: 2 }),
    ).toBe(4);
    expect(
      effectiveUsageLimit({ level: 1, kind: "toolRuns", isAdmin: false, used: 10, balance: 8 }),
    ).toBe(PLAN_BY_ID.Starter.toolRuns);
    expect(
      effectiveUsageLimit({ level: 0, kind: "toolRuns", isAdmin: false, used: null, balance: 2 }),
    ).toBeNull();
  });
});

describe("adminTopUpAmount — 250 hedefi, üstü kırpılmaz", () => {
  it("eksik bakiyeyi tamamlar, fazlasını silmez", () => {
    expect(adminTopUpAmount(0)).toBe(250);
    expect(adminTopUpAmount(249)).toBe(1);
    expect(adminTopUpAmount(250)).toBe(0);
    expect(adminTopUpAmount(400)).toBe(0);
    expect(adminTopUpAmount(null)).toBe(250);
  });
});

describe("planLabelFor — arayüzde her zaman okunur paket adı", () => {
  it("küçük harf ve eşanlamlılar kanonik etikete döner", () => {
    expect(planLabelFor("starter")).toBe("Starter");
    expect(planLabelFor("pro")).toBe("Pro");
    expect(planLabelFor("PRO")).toBe("Pro");
    expect(planLabelFor("business")).toBe("Business");
    expect(planLabelFor("enterprise")).toBe("Business");
    expect(planLabelFor("ultra")).toBe("Business");
  });

  it("boş/anlamsız değer Free'dir", () => {
    expect(planLabelFor("")).toBe("Free");
    expect(planLabelFor(null)).toBe("Free");
    expect(planLabelFor(undefined)).toBe("Free");
    expect(planLabelFor("free")).toBe("Free");
  });
});

describe("planLimitMessage — dürüst ve yönlendirici", () => {
  it("hangi hak, kaç, hangi paket yazılır", () => {
    const msg = planLimitMessage("toolRuns", 30, "starter");
    expect(msg).toContain("Starter");
    expect(msg).toContain("30");
    expect(msg).toContain("AI araç");
    expect(msg).toContain("pakete geç");
  });
});

describe("plan-sync — ödeme sonrası yoklama kararı", () => {
  it("bekleyen işaret yoksa hiç sorgu yapılmaz", () => {
    expect(
      shouldReconcilePlan({ tier: "Free", pendingAgeMs: null, lastReconcileAt: null, attempts: 0 }),
    ).toBe(false);
  });

  it("paket zaten ücretliyse tazeleme yok (yenileme ödemesi boşa API yakmaz)", () => {
    expect(
      shouldReconcilePlan({ tier: "Pro", pendingAgeMs: 1_000, lastReconcileAt: null, attempts: 0 }),
    ).toBe(false);
  });

  it("bekleyen ödeme + Free → tazelenir; denemeler arasında boşluk bırakılır", () => {
    expect(
      shouldReconcilePlan({
        tier: "Free",
        pendingAgeMs: 1_000,
        lastReconcileAt: null,
        attempts: 0,
      }),
    ).toBe(true);
    expect(
      shouldReconcilePlan({
        tier: "free",
        pendingAgeMs: 1_000,
        lastReconcileAt: 1_000,
        attempts: 1,
        now: 1_000 + PLAN_RECONCILE_GAP_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldReconcilePlan({
        tier: "free",
        pendingAgeMs: 1_000,
        lastReconcileAt: 1_000,
        attempts: 1,
        now: 1_000 + PLAN_RECONCILE_GAP_MS,
      }),
    ).toBe(true);
  });

  it("deneme sınırı aşılırsa durur (sonsuz yoklama yok)", () => {
    expect(
      shouldReconcilePlan({
        tier: "Free",
        pendingAgeMs: 1_000,
        lastReconcileAt: null,
        attempts: 4,
      }),
    ).toBe(false);
  });

  it("paket göründüğünde ya da sınır dolduğunda yoklama biter", () => {
    expect(planPollingDone({ tier: "Pro", pendingAgeMs: 1_000, attempts: 0 })).toBe(true);
    expect(planPollingDone({ tier: "Free", pendingAgeMs: null, attempts: 0 })).toBe(true);
    expect(planPollingDone({ tier: "Free", pendingAgeMs: 1_000, attempts: 4 })).toBe(true);
    expect(planPollingDone({ tier: "Free", pendingAgeMs: 1_000, attempts: 1 })).toBe(false);
  });
});
