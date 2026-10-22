/**
 * ABONELİK JETONLARI — TEK KAYNAK KİLİDİ.
 *
 * İKİ ÖLÇÜLMÜŞ HATA burada sabitlenir:
 *
 *  1. Jeton miktarı üç yerde AYRI yazılıydı (`plans.ts` 8, ödeme grant'i 10,
 *     aylık limit 8). Sonuç: Pro kullanıcı 20 jeton alıyor ama 15'ten sonra
 *     `PLAN_LIMIT` görüyordu — 5 jeton HİÇ kullanılamıyordu.
 *  2. Grant yalnız "ürün bulucu kredisi" kadardı ama HER AI işi aynı cüzdandan
 *     harcanıyor. Yani fiyat tablosunda yazan 30 araç / 2 konsey / 6 radar
 *     hakkına ulaşmak imkânsızdı: 10 jeton = en fazla 10 iş.
 *
 * Bu test üç şeyi zorunlu kılar:
 *   • grant = dört aylık hakkın TOPLAMI,
 *   • her hakkın tavanı kendi paketinden gelir,
 *   • her hak, tek başına harcansa bile grant ile karşılanabilir (tavan > grant
 *     olan bir kalem "hayali hak" olurdu).
 */
import { describe, expect, it } from "vitest";

import { PLANS, adminGrantFor, monthlyCreditGrant, quotaFor } from "./plans";
import { limitFor, usageKindForFeature, type UsageKind } from "./plan-usage";
import { SUBSCRIPTION_CREDIT_GRANTS } from "./paddle.server";

const KINDS: UsageKind[] = ["credits", "toolRuns", "councilRuns", "radarScans"];

describe("abonelik jetonları", () => {
  it("grant = dört aylık hakkın toplamı", () => {
    for (const plan of PLANS) {
      const expected = plan.credits + plan.toolRuns + plan.councilRuns + plan.radarScans;
      expect(monthlyCreditGrant(plan)).toBe(expected);
      expect(SUBSCRIPTION_CREDIT_GRANTS[plan.id].search).toBe(expected);
      expect(SUBSCRIPTION_CREDIT_GRANTS[plan.id].sim).toBe(plan.credits / 2);
    }
  });

  it("her hakkın tavanı paketten gelir ve grant ile karşılanır", () => {
    for (const plan of PLANS) {
      const grant = SUBSCRIPTION_CREDIT_GRANTS[plan.id].search;
      for (const kind of KINDS) {
        const limit = limitFor(plan.level, kind);
        // Hayali hak yok: yazılan tavan, o işi gerçekten yapmaya yetecek jetonla
        // birlikte gelmeli (aksi hâlde kullanıcı "bitti" duvarına çarpar).
        expect(limit, `${plan.id} · ${kind}`).toBeLessThanOrEqual(grant);
        expect(quotaFor(plan.level)[kind]).toBe(limit);
      }
      // Ürün bulucu hakkı hâlâ fiyat tablosundaki sayıdır.
      expect(limitFor(plan.level, "credits")).toBe(plan.credits);
      expect(adminGrantFor(plan.id).credits).toBe(plan.credits);
    }
  });

  it("fiyat tablosundaki metin paketin kendi jeton sayısını yazar", () => {
    for (const plan of PLANS) {
      expect(plan.features).toContain(`${plan.credits} ürün bulucu kredisi / ay`);
    }
  });

  it("her AI özelliği dört haktan birine düşer (sahipsiz iş yok)", () => {
    const features = [
      "tool:listing-seo",
      "tool:consensus",
      "tool:store-audit",
      "council",
      "agent-pipeline",
      "trend-analysis",
      "radar-scan",
    ];
    for (const feature of features) {
      expect(KINDS).toContain(usageKindForFeature(feature));
    }
  });
});
