/**
 * PADDLE — ABONELİĞİ DÖNEM SONUNDA İPTAL ETME.
 *
 * KİLİTLENEN SÖZLEŞME (kullanıcı isteği):
 *   • İptal `effective_from: next_billing_period` ile yapılır — "immediately"
 *     ASLA değil. Kullanıcı bu ayın parasını ödedi; ayın geri kalanını kullanır.
 *   • Bu ay için iade YOKTUR (kod iade çağırmaz), gelecek ay yenileme YOKTUR.
 *   • Sonuç, webhook'u beklemeden `process_paddle_event` ile yazılır ve kredi
 *     ÜRETMEZ (iptal bir ödeme değildir).
 *   • Paddle'da abonelik yoksa/bitmişse düğme sahte bir "iptal edildi"
 *     göstermez; neden dürüstçe döner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_EFFECTIVE_FROM,
  cancelEventCommand,
  scheduleSubscriptionCancellation,
  type CancelableSubscription,
  type CancelSubscriptionDeps,
} from "./paddle-cancel.server";
import { paddleSettings, subscriptionSnapshot, type PaddleEventCommand } from "./paddle.server";

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

const PERIOD_END = "2026-11-08T00:00:00.000Z";

const sdkSub = (over: Partial<CancelableSubscription> = {}): CancelableSubscription => ({
  id: "sub_1",
  status: "active",
  customerId: "ctm_1",
  nextBilledAt: PERIOD_END,
  scheduledChange: null,
  currentBillingPeriod: {
    startsAt: "2026-10-08T00:00:00.000Z",
    endsAt: PERIOD_END,
  },
  items: [{ price: { id: "pri_pro", productId: "pro_1" } }],
  customData: { plan: "Pro" },
  ...over,
});

type CancelFn = CancelSubscriptionDeps["cancelSubscription"];
type PersistFn = NonNullable<CancelSubscriptionDeps["persist"]>;

function makeDeps(over: Partial<CancelSubscriptionDeps> = {}) {
  const cancelSubscription = vi.fn<CancelFn>(async (id) =>
    sdkSub({ id, scheduledChange: { action: "cancel" }, nextBilledAt: null }),
  );
  const persist = vi.fn<PersistFn>(async () => true);

  const deps: CancelSubscriptionDeps = {
    settings: settings(),
    getSubscription: vi.fn(async () => sdkSub()),
    findCustomerIdByEmail: vi.fn(async () => "ctm_1"),
    fetchActionableSubscription: vi.fn(async () => sdkSub()),
    cancelSubscription,
    persist,
    ...over,
  };
  return { deps, cancelSubscription, persist };
}

const NOW = new Date("2026-10-19T09:00:00.000Z");

describe("scheduleSubscriptionCancellation — dönem sonunda iptal", () => {
  it("`next_billing_period` ile iptal eder, sonucu kredisiz yazar", async () => {
    const { deps, cancelSubscription, persist } = makeDeps();

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      email: "user@example.com",
      subscriptionId: "sub_1",
      tierHint: "Pro",
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      reason: "scheduled",
      subscriptionId: "sub_1",
      tier: "Pro",
      periodEnd: PERIOD_END,
      persisted: true,
    });
    expect(cancelSubscription).toHaveBeenCalledTimes(1);
    expect(cancelSubscription.mock.calls[0]![0]).toBe("sub_1");
    // "immediately" DEĞİL: kullanıcı ayın geri kalanını kullanmaya devam eder.
    expect(cancelSubscription.mock.calls[0]![1]).toEqual({
      effectiveFrom: "next_billing_period",
    });
    expect(CANCEL_EFFECTIVE_FROM).toBe("next_billing_period");

    const command = persist.mock.calls[0]![0];
    expect(command).toMatchObject({
      eventType: "subscription.cancel.scheduled",
      userId: "u1",
      tier: "Pro",
      cancelAtPeriodEnd: true,
      searchCredits: 0,
      simCredits: 0,
      transactionId: null,
      amountCents: null,
      periodEnd: PERIOD_END,
    });
    expect(command.eventId).toBe(`cancel-schedule:sub_1:${PERIOD_END}`);
  });

  it("zaten iptal planlıysa Paddle'a İKİNCİ istek atılmaz", async () => {
    const { deps, cancelSubscription, persist } = makeDeps({
      getSubscription: async () => sdkSub({ scheduledChange: { action: "cancel" } }),
    });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      subscriptionId: "sub_1",
    });

    expect(result).toMatchObject({ ok: true, reason: "already_scheduled", periodEnd: PERIOD_END });
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("profil kimliği yoksa e-posta → müşteri → abonelik zincirini kullanır", async () => {
    const findCustomerIdByEmail = vi.fn(async () => "ctm_9");
    const fetchActionableSubscription = vi.fn(async () => sdkSub({ id: "sub_9" }));
    const { deps } = makeDeps({
      getSubscription: undefined,
      findCustomerIdByEmail,
      fetchActionableSubscription,
    });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      email: "user@example.com",
    });

    expect(findCustomerIdByEmail).toHaveBeenCalledWith("user@example.com");
    expect(fetchActionableSubscription).toHaveBeenCalledWith("ctm_9");
    expect(result).toMatchObject({ ok: true, subscriptionId: "sub_9", reason: "scheduled" });
  });

  it("müşteri bulunamazsa `no_customer` döner (Paddle'a istek yok)", async () => {
    const { deps, cancelSubscription } = makeDeps({
      getSubscription: undefined,
      findCustomerIdByEmail: async () => null,
    });

    const result = await scheduleSubscriptionCancellation(deps, { userId: "u1", email: "x@y.z" });

    expect(result).toEqual({ ok: false, reason: "no_customer" });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("canlı abonelik yoksa `no_live_subscription` döner", async () => {
    const { deps, cancelSubscription } = makeDeps({
      getSubscription: undefined,
      fetchActionableSubscription: async () => null,
    });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      customerId: "ctm_1",
    });

    expect(result).toEqual({ ok: false, reason: "no_live_subscription" });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("sona ermiş abonelikte `already_ended` döner, iptal çağrılmaz", async () => {
    const { deps, cancelSubscription } = makeDeps({
      getSubscription: async () => sdkSub({ status: "canceled" }),
    });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      subscriptionId: "sub_1",
    });

    expect(result).toMatchObject({ ok: false, reason: "already_ended", subscriptionId: "sub_1" });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("Paddle hatası dürüstçe raporlanır; sahte başarı ve DB yazımı yoktur", async () => {
    const persist = vi.fn<PersistFn>(async () => true);
    const { deps } = makeDeps({
      cancelSubscription: async () => {
        throw new Error("paddle 400: subscription is not cancelable");
      },
      persist,
    });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      subscriptionId: "sub_1",
    });

    expect(result).toMatchObject({ ok: false, reason: "api_failed" });
    expect(result.message).toContain("not cancelable");
    expect(persist).not.toHaveBeenCalled();
  });

  it("DB yazımı başarısız olsa da iptal GEÇERLİDİR (persisted=false)", async () => {
    const { deps } = makeDeps({ persist: async () => false });

    const result = await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      subscriptionId: "sub_1",
      tierHint: "Pro",
    });

    expect(result).toMatchObject({
      ok: true,
      reason: "scheduled",
      persisted: false,
      periodEnd: PERIOD_END,
    });
  });

  it("plan çözülemezse profil ipucuna düşer, o da yoksa null kalır", async () => {
    const bare = sdkSub({ items: [], customData: null });

    const withHint = makeDeps({ getSubscription: async () => bare });
    const hinted = await scheduleSubscriptionCancellation(withHint.deps, {
      userId: "u1",
      subscriptionId: "sub_1",
      tierHint: "business",
    });
    expect(hinted.tier).toBe("Business");

    const noHint = makeDeps({ getSubscription: async () => bare });
    const unknown = await scheduleSubscriptionCancellation(noHint.deps, {
      userId: "u1",
      subscriptionId: "sub_1",
    });
    expect(unknown.tier).toBeNull();
    expect(unknown.ok).toBe(true);
  });

  it("plan çözülemezse profildeki Free korunur (DB 'Pro' varsayılanına düşmez)", async () => {
    const bare = sdkSub({ items: [], customData: null });
    const { deps, persist } = makeDeps({ getSubscription: async () => bare });

    await scheduleSubscriptionCancellation(deps, {
      userId: "u1",
      subscriptionId: "sub_1",
      tierHint: "Free",
    });

    // `null` gönderilseydi process_paddle_event profili 'Pro'ya yükseltirdi.
    expect(persist.mock.calls[0]![0].tier).toBe("Free");
  });

  it("yapılandırma yoksa `not_configured` döner", async () => {
    const { deps, cancelSubscription } = makeDeps({ settings: null });

    const result = await scheduleSubscriptionCancellation(deps, { userId: "u1" });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});

describe("cancelEventCommand — idempotent iptal kaydı", () => {
  const snapshot = subscriptionSnapshot(sdkSub())!;

  it("aynı abonelik + dönem için AYNI olay kimliğini üretir", () => {
    const a = cancelEventCommand({
      snapshot,
      tier: "Pro",
      userId: "u1",
      occurredAt: NOW.toISOString(),
    });
    const b = cancelEventCommand({
      snapshot,
      tier: "Pro",
      userId: "u1",
      occurredAt: "2026-10-20T09:00:00.000Z",
    });
    expect(a.eventId).toBe(b.eventId);
  });

  it("yeni dönemde YENİ kimlik üretir (yeni iptal yazılabilir)", () => {
    const next = cancelEventCommand({
      snapshot: { ...snapshot, periodEnd: "2026-12-08T00:00:00.000Z" },
      tier: "Pro",
      userId: "u1",
      occurredAt: NOW.toISOString(),
    });
    const current = cancelEventCommand({
      snapshot,
      tier: "Pro",
      userId: "u1",
      occurredAt: NOW.toISOString(),
    });
    expect(next.eventId).not.toBe(current.eventId);
  });

  it("iptal kaydı kredi ve işlem ÜRETMEZ", () => {
    const command: PaddleEventCommand = cancelEventCommand({
      snapshot,
      tier: "Pro",
      userId: "u1",
      occurredAt: NOW.toISOString(),
    });
    expect(command.searchCredits).toBe(0);
    expect(command.simCredits).toBe(0);
    expect(command.transactionId).toBeNull();
    expect(command.amountCents).toBeNull();
    expect(command.cancelAtPeriodEnd).toBe(true);
    expect(command.status).toBe("active");
  });
});
