// ============================================================================
// PADDLE YETKİ TAZELEME (RECONCILE) — saf kararlar.
//
// KİLİTLENEN DAVRANIŞ: "Paddle abonelik başladı diyor ama uygulamada
// başlamıyor." Aktivasyon yalnız webhook'a bağlıydı; bildirim adresi/imza
// yanlışsa ya da teslimat gecikirse kullanıcı ödeme yapmış olmasına rağmen
// "Free" kalıyordu. Tazeleme Paddle'ın KENDİ kaydından yazar. Bu testler
// kararın doğru ve idempotent olduğunu sabitler:
//   • plan çözülemezse YAZILMAZ (uydurma yetki yok),
//   • aynı abonelik+durum+dönem için AYNI olay kimliği (tekrar = no-op),
//   • dönem/durum değişince YENİ kimlik (yeni durum yazılır),
//   • krediler plana göre ve webhook ile aynı miktarda.
// ============================================================================
import { afterEach, describe, expect, it } from "vitest";

import {
  paddleSetupStatus,
  paddleSettings,
  planForSnapshot,
  reconcileCommand,
  reconcileEventKey,
  subscriptionSnapshot,
  transactionSnapshot,
  type PaddleSubscriptionSnapshot,
} from "./paddle.server";

const ENV = {
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

const settings = () => {
  process.env = { ...original, ...ENV };
  const s = paddleSettings();
  if (!s) throw new Error("test ayarları kurulamadı");
  return s;
};

/** Paddle SDK'nın Subscription nesnesine benzeyen ham nesne. */
const sdkSubscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_123",
  status: "active",
  customerId: "ctm_1",
  nextBilledAt: "2026-11-08T00:00:00.000Z",
  currentBillingPeriod: {
    startsAt: "2026-10-08T00:00:00.000Z",
    endsAt: "2026-11-08T00:00:00.000Z",
  },
  scheduledChange: null,
  items: [{ price: { id: "pri_pro", productId: "pro_1" } }],
  customData: { plan: "Pro", userId: "u1" },
  ...over,
});

const snapshot = (over: Partial<PaddleSubscriptionSnapshot> = {}): PaddleSubscriptionSnapshot => ({
  subscriptionId: "sub_123",
  status: "active",
  customerId: "ctm_1",
  priceId: "pri_pro",
  productId: "pro_1",
  planHint: null,
  periodStart: "2026-10-08T00:00:00.000Z",
  periodEnd: "2026-11-08T00:00:00.000Z",
  nextBilledAt: null,
  cancelAtPeriodEnd: false,
  ...over,
});

describe("subscriptionSnapshot — SDK nesnesini sadeleştirir", () => {
  it("abonelik alanlarını okur", () => {
    const s = subscriptionSnapshot(sdkSubscription());
    expect(s).toEqual({
      subscriptionId: "sub_123",
      status: "active",
      customerId: "ctm_1",
      priceId: "pri_pro",
      productId: "pro_1",
      planHint: "Pro",
      periodStart: "2026-10-08T00:00:00.000Z",
      periodEnd: "2026-11-08T00:00:00.000Z",
      nextBilledAt: "2026-11-08T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
  });

  it("iptal planını (scheduledChange.action=cancel) işaretler", () => {
    const s = subscriptionSnapshot(sdkSubscription({ scheduledChange: { action: "cancel" } }));
    expect(s?.cancelAtPeriodEnd).toBe(true);
  });

  it("kimliksiz/eksik nesnede null döner — uydurma abonelik üretilmez", () => {
    expect(subscriptionSnapshot({})).toBeNull();
    expect(subscriptionSnapshot({ id: null })).toBeNull();
    // Kalem yoksa plan çözülemez ama anlık görüntü yine de okunabilir.
    expect(subscriptionSnapshot({ id: "sub_x" })?.priceId).toBeNull();
  });

  it("customData'daki tanınmayan plan adını plan ipucu saymaz", () => {
    const s = subscriptionSnapshot(sdkSubscription({ customData: { plan: "Ultra" } }));
    expect(s?.planHint).toBeNull();
  });
});

describe("planForSnapshot — plan çözümü", () => {
  it("fiyat ID'sinden çözer (en özgül kaynak)", () => {
    expect(planForSnapshot(settings(), snapshot({ priceId: "pri_business" }))).toBe("Business");
  });

  it("fiyat ID'si tanınmıyorsa ÜRÜN ID'sine bakar", () => {
    process.env = { ...original, ...ENV, PADDLE_PRO_PRODUCT_ID: "pro_prod" };
    const s = paddleSettings();
    expect(
      planForSnapshot(
        s!,
        snapshot({ priceId: "pri_bilinmeyen", productId: "pro_prod", planHint: null }),
      ),
    ).toBe("Pro");
  });

  it("hiçbiri çözülemezse customData ipucuna düşer", () => {
    expect(
      planForSnapshot(
        settings(),
        snapshot({ priceId: "pri_x", productId: "y", planHint: "Starter" }),
      ),
    ).toBe("Starter");
  });

  it("çözülemezse null döner (yazılmayacak)", () => {
    expect(
      planForSnapshot(settings(), snapshot({ priceId: "pri_x", productId: "y", planHint: null })),
    ).toBeNull();
  });
});

describe("reconcileEventKey — idempotentlik anahtarı", () => {
  it("aynı abonelik + durum + dönem için AYNI anahtarı üretir", () => {
    const a = reconcileEventKey(snapshot());
    const b = reconcileEventKey(snapshot());
    expect(a).toBe(b);
    expect(a).toContain("sub_123");
  });

  it("dönem değişince YENİ anahtar üretir (yeni dönem yazılmalı)", () => {
    const first = reconcileEventKey(snapshot());
    const renewed = reconcileEventKey(snapshot({ periodEnd: "2026-12-08T00:00:00.000Z" }));
    expect(renewed).not.toBe(first);
  });

  it("durum değişince YENİ anahtar üretir (iptal/askı yazılmalı)", () => {
    const active = reconcileEventKey(snapshot());
    const canceled = reconcileEventKey(snapshot({ status: "canceled" }));
    expect(canceled).not.toBe(active);
  });
});

describe("reconcileCommand — DB komutuna dönüşüm", () => {
  it("plan çözülürse komut üretir ve kaynağı 'reconcile' olarak işaretler", () => {
    const cmd = reconcileCommand({
      settings: settings(),
      snapshot: snapshot(),
      transaction: { transactionId: "txn_1", amountCents: 2900, currency: "USD" },
      userId: "user-1",
      occurredAt: "2026-10-08T00:00:00.000Z",
    });
    expect(cmd).not.toBeNull();
    expect(cmd!.eventType).toBe("reconcile.subscription");
    expect(cmd!.eventId).toBe(reconcileEventKey(snapshot()));
    expect(cmd!.tier).toBe("Pro");
    expect(cmd!.status).toBe("active");
    expect(cmd!.userId).toBe("user-1");
    expect(cmd!.paddleSubscriptionId).toBe("sub_123");
    expect(cmd!.priceId).toBe("pri_pro");
    expect(cmd!.transactionId).toBe("txn_1");
    expect(cmd!.amountCents).toBe(2900);
    expect(cmd!.currency).toBe("USD");
    expect(cmd!.periodEnd).toBe("2026-11-08T00:00:00.000Z");
  });

  it("plana göre webhook ile AYNI kredileri verir", () => {
    const grants = (priceId: string) =>
      reconcileCommand({
        settings: settings(),
        snapshot: snapshot({ priceId }),
        transaction: null,
        userId: "u",
        occurredAt: "2026-10-08T00:00:00.000Z",
      });
    expect(grants("pri_starter")).toMatchObject({ searchCredits: 10, simCredits: 5 });
    expect(grants("pri_pro")).toMatchObject({ searchCredits: 20, simCredits: 10 });
    expect(grants("pri_business")).toMatchObject({ searchCredits: 50, simCredits: 25 });
  });

  it("işlem yoksa kredi yine haritalanır ama işlem kimliği null kalır", () => {
    const cmd = reconcileCommand({
      settings: settings(),
      snapshot: snapshot(),
      transaction: null,
      userId: "u",
      occurredAt: "2026-10-08T00:00:00.000Z",
    });
    expect(cmd!.transactionId).toBeNull();
    // İşlem kimliği olmadığı için çağıran krediyi tekilleştiremez → karar onun.
    expect(cmd!.searchCredits).toBe(20);
  });

  it("plan çözülemezse null döner — sessizce 'Free' ya da uydurma plan yazılmaz", () => {
    const cmd = reconcileCommand({
      settings: settings(),
      snapshot: snapshot({ priceId: "pri_x", productId: "y", planHint: null }),
      transaction: null,
      userId: "u",
      occurredAt: "2026-10-08T00:00:00.000Z",
    });
    expect(cmd).toBeNull();
  });

  it("iptal durumunu olduğu gibi taşır (yetki düşürme kararı DB'de)", () => {
    const cmd = reconcileCommand({
      settings: settings(),
      snapshot: snapshot({ status: "canceled", cancelAtPeriodEnd: true }),
      transaction: null,
      userId: "u",
      occurredAt: "2026-10-08T00:00:00.000Z",
    });
    expect(cmd!.status).toBe("canceled");
    expect(cmd!.cancelAtPeriodEnd).toBe(true);
  });
});

describe("transactionSnapshot — ciro/kredi kaydı için işlem özeti", () => {
  it("string grandTotal'ı minor unit'e çevirir", () => {
    expect(
      transactionSnapshot({
        id: "txn_1",
        currencyCode: "USD",
        details: { totals: { grandTotal: "2900" } },
      }),
    ).toEqual({ transactionId: "txn_1", amountCents: 2900, currency: "USD" });
  });

  it("0 tutarı (indirimli alışveriş) korur — 0 geçerlidir, eksik değil", () => {
    expect(
      transactionSnapshot({
        id: "txn_2",
        currencyCode: "USD",
        details: { totals: { grandTotal: "0" } },
      }),
    ).toMatchObject({ amountCents: 0 });
  });

  it("eksik tutarı uydurmaz: null döner", () => {
    expect(transactionSnapshot({ id: "txn_3" })).toMatchObject({ amountCents: null });
  });

  it("kimliksiz işlemde null döner", () => {
    expect(transactionSnapshot(null)).toBeNull();
    expect(transactionSnapshot({ id: null })).toBeNull();
  });

  it("`totals: null` (Paddle'ın döndürebildiği hâl) çökmez, tutar null kalır", () => {
    expect(
      transactionSnapshot({ id: "txn_4", currencyCode: "USD", details: { totals: null } }),
    ).toMatchObject({ transactionId: "txn_4", amountCents: null, currency: "USD" });
  });
});

describe("paddleSetupStatus — kurulum teşhisi yalnız ADLARI söyler", () => {
  /** Paddle'lı tüm değişkenler silinmiş ortam (sızıntı olmasın). */
  const cleanEnv = () => {
    const env = { ...original };
    for (const key of Object.keys(env)) {
      if (/^(VITE_)?PADDLE_/.test(key)) delete env[key];
    }
    return env;
  };

  it("eksik anahtarları adıyla sayar, var olanı saymaz", () => {
    process.env = { ...cleanEnv(), PADDLE_API_KEY: "k" };
    const status = paddleSetupStatus();
    expect(status.ready).toBe(false);
    expect(status.missingEnv).toContain("PADDLE_WEBHOOK_SECRET_KEY");
    expect(status.missingEnv).toContain("PADDLE_CLIENT_TOKEN");
    expect(status.missingEnv).not.toContain("PADDLE_API_KEY");
  });

  it("tam kurulumda ready ve eksik plan yok", () => {
    process.env = { ...cleanEnv(), ...ENV };
    const status = paddleSetupStatus();
    expect(status.ready).toBe(true);
    expect(status.missingEnv).toEqual([]);
    expect(status.missingPlanAssets).toEqual([]);
  });

  it("hiç fiyat/ürün kimliği olmayan planı eksik sayar (o plan satılamaz)", () => {
    process.env = {
      ...cleanEnv(),
      PADDLE_API_KEY: "k",
      PADDLE_WEBHOOK_SECRET_KEY: "s",
      PADDLE_CLIENT_TOKEN: "t",
      PADDLE_PRO_PRICE_ID: "pri_pro",
    };
    const status = paddleSetupStatus();
    expect(status.ready).toBe(true);
    expect(status.missingPlanAssets).toEqual(["Starter", "Business"]);
  });
});
