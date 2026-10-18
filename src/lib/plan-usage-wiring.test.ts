import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * KABLOLAMA TESTLERİ — "yazdım ama bağlanmadı" hatasını yakalar.
 *
 * Ölçülen asıl sorun buydu: `credit_usage_log` tablosu vardı, `plans.ts` dört
 * aylık hak tanımlıyordu, sol bar "30 araç / ay" yazıyordu — ama tabloya HİÇ
 * satır yazılmıyor, limit hiç kontrol edilmiyor ve ekran hiç tazelenmiyordu.
 * Saf birim testleri bunu göremez; bu yüzden zincirin her halkası kaynak
 * düzeyinde sabitlenir.
 */

const src = (file: string): string => readFileSync(new URL(file, import.meta.url), "utf8");

describe("kullanım defteri — yazma ve okuma bağlı", () => {
  it("kayıt gerçekten credit_usage_log'a yazılır", () => {
    const usage = src("./plan-usage.server.ts");
    expect(usage).toContain('from("credit_usage_log").insert');
    expect(usage).toContain("recordAiUsage");
    expect(usage).toContain('from("credit_usage_log")');
    // Ay sınırı ile okunur; ay başında sayaç kendiliğinden sıfırlanır.
    expect(usage).toContain("gte(\"created_at\", startIso)");
  });

  it("her jeton düşmesi deftere yazılır (tek kapı)", () => {
    const charge = src("./credit-charge.server.ts");
    expect(charge).toContain("recordAiUsage");
    expect(charge).toContain("monthUsage");
    // Limit kapısı bakiyeden ÖNCE değil, bakiyeden SONRA ama düşmeden önce.
    expect(charge.indexOf("AYLIK PAKET LİMİTİ")).toBeGreaterThan(0);
    expect(charge).toContain("PLAN_LIMIT");
    expect(charge).toContain("planLimitResponse");
  });

  it("chargeForAi yolu da kullanım yazabilir (aksi hâlde 4 özellik sayaçsız kalırdı)", () => {
    const guard = src("./credit-guard.server.ts");
    expect(guard).toContain("usage?: { userId: string; feature: string }");
    expect(guard).toContain("recordAiUsage");
  });
});

describe("paket yansıması — ödeme sonrası ekran tazelenir", () => {
  it("ödeme modalı bekleyen işaret bırakır, kabuk tazeleme yapar", () => {
    expect(src("../components/pricing-modal.tsx")).toContain("markPlanPurchasePending");
    const sync = src("../hooks/use-plan-sync.ts");
    expect(sync).toContain("reconcileMySubscription");
    expect(sync).toContain('invalidateQueries({ queryKey: ["profile"] })');
    expect(src("../components/app-topbar.tsx")).toContain("usePlanSync");
  });

  it("profil sorgusu pencere odağında tazelenir (60 sn 'Free' kalma hatası)", () => {
    const hook = src("../hooks/use-entitlements.ts");
    expect(hook).toContain("refetchOnWindowFocus: true");
    expect(hook).toContain("planLabelFor");
  });

  it("paket adı kanonik etiketle gösterilir", () => {
    expect(src("../routes/dashboard.tsx")).toContain("planLabelFor");
    expect(src("../routes/settings.tsx")).toContain("planLabelFor");
  });
});

describe("sol bar — modül kullanımı sayaçtan okunur", () => {
  it("sidebar bu ayın kullanımını gösterir", () => {
    const sidebar = src("../components/app-sidebar.tsx");
    expect(sidebar).toContain("usePlanUsage");
    expect(sidebar).toContain("row.used");
    expect(sidebar).toContain("row.limit");
    expect(sidebar).toContain("planUsage.measured");
  });

  it("üst bar da kullanılan/limit gösterir (aynı kaynak)", () => {
    expect(src("../components/app-topbar.tsx")).toContain("usePlanUsage");
    expect(src("../hooks/use-plan-usage.ts")).toContain("getMyPlanUsage");
  });
});
