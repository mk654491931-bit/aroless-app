// ============================================================================
// PADDLE — KATALOG KISMİYETİ VE İNDİRİM OKUMA.
//
// Kilitlenen davranış (ölçülen hatalar):
//   1. Tek bir eksik fiyat ID'si TÜM ödeme altyapısını düşürüyordu: sunucu
//      checkout'u kullanılamıyor, tarayıcı customData'sız ham checkout'a
//      düşüyor, webhook ödemeyi hiçbir kullanıcıya bağlayamıyor ve satın alma
//      "sistemde hiçbir şey" olarak kalıyordu.
//   2. %100 indirim koduyla alındığında `grandTotal` 0 olduğu için paketin
//      kendi kendini onarma yolu devre dışı kalıyordu; bu yüzden indirimli
//      alışverişlerde plan atanıyordu ama hesap "Free" görünüyordu.
// ============================================================================
import { afterEach, describe, expect, it } from "vitest";

import { appliedDiscountId, paddleSettings } from "./paddle.server";

const REQUIRED = {
  PADDLE_API_KEY: "k",
  PADDLE_WEBHOOK_SECRET_KEY: "s",
  PADDLE_CLIENT_TOKEN: "t",
  PADDLE_STARTER_PRICE_ID: "pri_starter",
  PADDLE_PRO_PRICE_ID: "pri_pro",
  PADDLE_BUSINESS_PRICE_ID: "pri_business",
} as Record<string, string>;

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("paddleSettings — kısmi katalog", () => {
  it("fiyat ID'lerinin üçü de varken ayarlar döner", () => {
    process.env = { ...original, ...REQUIRED };
    const settings = paddleSettings();
    expect(settings?.priceIds.Pro).toBe("pri_pro");
  });

  it("BİR fiyat ID'si eksikse entegrasyon AYAKTA kalır", () => {
    // Ölçülen hata tam buradaydı: eksik fiyat ID'si null dönüyor, webhook
    // 500 veriyor, hiçbir ödeme işlenmiyordu.
    process.env = { ...original, ...REQUIRED, PADDLE_BUSINESS_PRICE_ID: undefined };
    delete process.env["PADDLE_BUSINESS_PRICE_ID"];
    const settings = paddleSettings();
    expect(settings).not.toBeNull();
    // Yalnız o plan satın alınamaz; sunucu checkout'u o plan için açık hata verir.
    expect(settings?.priceIds.Business).toBeUndefined();
    expect(settings?.priceIds.Starter).toBe("pri_starter");
  });

  it("apiKey / webhookSecret / clientToken eksikse hâlâ null döner", () => {
    // Bunlar olmadan Paddle ile konuşulamaz; katalog kısmiyken de bu eşik korunur.
    for (const key of [
      "PADDLE_API_KEY",
      "PADDLE_WEBHOOK_SECRET_KEY",
      "PADDLE_CLIENT_TOKEN",
    ] as const) {
      process.env = { ...original, ...REQUIRED };
      delete process.env[key];
      expect(paddleSettings()).toBeNull();
    }
  });
});

describe("appliedDiscountId — indirim gerçekten uygulanmış mı", () => {
  it("details.discounts içindeki discount_id'yi okur", () => {
    expect(
      appliedDiscountId({
        details: { discounts: [{ discount_id: "dsc_100pct", amount: "3000" }] },
      }),
    ).toBe("dsc_100pct");
  });

  it("düz discount_id alanını da okur", () => {
    expect(appliedDiscountId({ discount_id: "dsc_flat" })).toBe("dsc_flat");
  });

  it("indirim yoksa null döner (uydurma kod basılmaz)", () => {
    expect(appliedDiscountId({ details: { totals: { grandTotal: "0" } } })).toBeNull();
    expect(appliedDiscountId({})).toBeNull();
    expect(appliedDiscountId(null)).toBeNull();
  });

  it("%100 indirimde de kodu bulur — indirimli alışveriş de izlenebilir kalmalı", () => {
    // Kullanıcının "%100 indirim kodunu Paddle doğrulamadı" şikâyeti bu
    // alanın hiç okunmamasından geliyordu.
    const data = {
      id: "txn_1",
      details: { totals: { grandTotal: "0" }, discounts: [{ discount_id: "dsc_full" }] },
    };
    expect(appliedDiscountId(data)).toBe("dsc_full");
  });
});
