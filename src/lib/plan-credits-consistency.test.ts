/**
 * ABONELİK JETONLARI — TEK KAYNAK KİLİDİ.
 *
 * ÖLÇÜLEN HATA: jeton miktarı üç yerde AYRI yazılıydı:
 *   • `plans.ts` (fiyat tablosunda görünen sayı): Starter 8, Pro 15
 *   • ödeme grant'i (`SUBSCRIPTION_CREDIT_GRANTS`): Starter 10, Pro 20
 *   • aylık limit (`limitFor`): yine 8 / 15
 * Sonuç: Pro kullanıcı 20 jeton alıyor ama 15'ten sonra `PLAN_LIMIT` görüyordu
 * — yani 5 jeton HİÇ kullanılamıyordu. Bu test üç sayının eşit kalmasını
 * zorunlu kılar; biri değişirse test kırılır.
 */
import { describe, expect, it } from "vitest";

import { PLANS, adminGrantFor, quotaFor } from "./plans";
import { limitFor } from "./plan-usage";
import { SUBSCRIPTION_CREDIT_GRANTS } from "./paddle.server";

describe("abonelik jetonları", () => {
  it("verilen jeton = aylık limit = fiyat tablosundaki sayı", () => {
    for (const plan of PLANS) {
      expect(SUBSCRIPTION_CREDIT_GRANTS[plan.id].search).toBe(plan.credits);
      expect(SUBSCRIPTION_CREDIT_GRANTS[plan.id].sim).toBe(plan.credits / 2);
      expect(limitFor(plan.level, "credits")).toBe(plan.credits);
      expect(quotaFor(plan.level).credits).toBe(plan.credits);
      expect(adminGrantFor(plan.id).credits).toBe(plan.credits);
    }
  });

  it("fiyat tablosundaki metin paketin kendi jeton sayısını yazar", () => {
    for (const plan of PLANS) {
      expect(plan.features).toContain(`${plan.credits} ürün bulucu kredisi / ay`);
    }
  });

  it("verilen jetonun tamamı harcanabilir (limit < grant OLMAMALI)", () => {
    for (const plan of PLANS) {
      expect(limitFor(plan.level, "credits")).toBeGreaterThanOrEqual(
        SUBSCRIPTION_CREDIT_GRANTS[plan.id].search,
      );
    }
  });
});
