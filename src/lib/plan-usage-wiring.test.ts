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
    expect(usage).toContain('gte("created_at", startIso)');
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
    expect(guard).toContain("usage?: {");
    expect(guard).toContain("db?: ReadDb | null;");
    expect(guard).toContain("recordAiUsage");
  });

  it("sayaç yazımı ve admin 250 servis anahtarı olmadan da yazılır", () => {
    // Kök neden: ikisi de yalnız supabaseAdmin ile yazılıyordu.
    const usage = src("./plan-usage.server.ts");
    expect(usage).toContain("log_ai_usage");
    expect(usage).toContain("claim_admin_daily_credits");
    expect(usage).toContain("serviceReadDb");
    // Tahsilat yolu kendi JWT istemcisini deftere geçirir.
    expect(src("./credit-charge.server.ts")).toContain("await recordAiUsage(");
    expect(src("./credit-charge.server.ts")).toContain("client,");
    // Araç/konsey/radar yolları da istemciyi verir.
    expect(src("./compare.functions.ts")).toContain("db: context.supabase");
    expect(src("./radar.functions.ts")).toContain("db: ctx.supabase");
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
    // Sayaç okunamadığında "0" değil "bilinmiyor" gösterilir.
    expect(sidebar).toContain("usageLabelFor");
  });

  it("üst bar da kullanılan/limit gösterir (aynı kaynak)", () => {
    const topbar = src("../components/app-topbar.tsx");
    expect(topbar).toContain("usePlanUsage");
    expect(topbar).toContain("usageLabelFor");
    // Bakiye okunamadığında 0 değil "bilinmiyor".
    expect(topbar).toContain("creditCountLabel");
    expect(src("../hooks/use-plan-usage.ts")).toContain("getMyPlanUsage");
  });

  it("admin tazelemesi bakiye ön kontrolünden ÖNCE çalışır (0 jetonla reddedilmez)", () => {
    const charge = src("./credit-charge.server.ts");
    expect(charge).toContain("ensureAdminBalance");
    expect(charge.indexOf("ensureAdminBalance")).toBeLessThan(
      charge.indexOf("state.total < amount"),
    );
    // Eski hatalı formül geri gelmesin: kullanılan + bakiye kullanılır.
    expect(charge).not.toContain("Math.max(limit, state?.total");
    expect(charge).toContain("effectiveUsageLimit");
  });

  it("paket özeti KULLANICI istemcisiyle okunur (servis anahtarı zorunlu değil)", () => {
    // "bilinmiyor" ekranının kök nedeni: yalnız supabaseAdmin ile okumak.
    // Anahtar yoksa sayaç ve paket okunamıyor, ücretli kullanıcı Free limiti
    // görüyordu. Artık istekteki JWT istemcisi verilir.
    expect(src("./plan-usage.functions.ts")).toContain(
      "planUsageSnapshot(context.userId, new Date(), context.supabase)",
    );
    expect(src("./plan-usage.server.ts")).toContain("serviceReadDb");
    expect(src("./admin-identity.server.ts")).toContain("serviceReadDb");
  });

  it("kullanıcı kapsamlı jeton RPC'leri güvenli (yalnız pozitif, yalnız kendi satırı)", () => {
    // Aylık limit bu defterin toplamından hesaplanır. Negatif satır yazılabilir
    // olsaydı kullanıcı limitini kendi lehine düşürebilirdi; bu yüzden iade
    // yolu service_role'da kalmalı.
    const sql = src("../../supabase/migrations/20261020120000_user_scoped_credit_ops.sql");
    expect(sql).toContain("IF _credits IS NULL OR _credits <= 0 THEN RETURN; END IF;");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.log_ai_usage(text, integer) TO authenticated",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_admin_daily_credits() TO authenticated",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.log_ai_usage(text, integer) FROM PUBLIC, anon",
    );
    expect(sql).toContain("'admin-daily:'");
  });

  it("admin 250 jetonu için sunucu ve istemci bağlı", () => {
    expect(src("./plan-usage.server.ts")).toContain("ensureAdminBalance");
    expect(src("./plan-usage.functions.ts")).toContain("ensureMyAdminBalance");
    expect(src("../components/app-topbar.tsx")).toContain("ensureMyAdminBalance");
    // Admin, ücretli pakette görünse bile 250 alır (paket seviyesine bağlı değil).
    expect(src("./plan-usage.server.ts")).not.toContain("level === 0 ? await isAdminUser");
  });

  it("mükerrer kayıt/IP üç havuzu da kapatır (finder dahil)", () => {
    const s = src("./signup.server.ts");
    expect(s).toContain("finder_credits: 0");
    expect(s).toContain("admin_exempt");
  });
});
