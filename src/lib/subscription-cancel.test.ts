/**
 * AYARLAR → ABONELİK KARTI: iptal durumunun SAF kararı.
 *
 * ÜRÜN KURALI (kullanıcı isteği): "o ay ödediği para verilmeyecek ama gelecek
 * ay da para çekilmeyecek; iptal etmezlerse para çekilsin". Yani iptal
 * DÖNEM SONUNDA yürürlüğe girer, erişim o tarihe kadar sürer ve yenileme
 * durdurulur. Bu testler düğmenin hangi durumlarda görüneceğini ve "iptal
 * edildi" metninin yalnız gerçekten planlıyken çıkacağını kilitler.
 */
import { describe, expect, it } from "vitest";

import {
  formatSubscriptionEnd,
  isPaidTier,
  mySubscriptionView,
  subscriptionCancelView,
  type SubscriptionLedgerRowView,
} from "./subscription-cancel";

const END = "2026-11-08T00:00:00.000Z";

describe("isPaidTier", () => {
  it("ücretli paketleri tanır (büyük/küçük harf ve boşluk toleranslı)", () => {
    expect(isPaidTier("Pro")).toBe(true);
    expect(isPaidTier(" starter ")).toBe(true);
    expect(isPaidTier("BUSINESS")).toBe(true);
  });

  it("ücretsiz/boş değeri ücretli saymaz", () => {
    expect(isPaidTier("Free")).toBe(false);
    expect(isPaidTier("")).toBe(false);
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
  });
});

describe("subscriptionCancelView", () => {
  it("aktif ücretli abonelikte iptal düğmesi açıktır", () => {
    const view = subscriptionCancelView({
      tier: "Pro",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: END,
    });
    expect(view).toEqual({
      state: "active",
      canCancel: true,
      cancelScheduled: false,
      endsAt: END,
    });
  });

  it("iptal planlıysa düğme kapanır ve durum 'scheduled' olur", () => {
    const view = subscriptionCancelView({
      tier: "Pro",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: END,
    });
    expect(view.state).toBe("scheduled");
    expect(view.cancelScheduled).toBe(true);
    expect(view.canCancel).toBe(false);
    expect(view.endsAt).toBe(END);
  });

  it("status 'none' olsa bile ücretli paket aktif sayılır (eski kayıtlar)", () => {
    const view = subscriptionCancelView({ tier: "Business", status: "none" });
    expect(view.state).toBe("active");
    expect(view.canCancel).toBe(true);
  });

  it("ücretsiz planda iptal düğmesi yoktur", () => {
    const view = subscriptionCancelView({ tier: "Free", status: "none" });
    expect(view.state).toBe("free");
    expect(view.canCancel).toBe(false);
    expect(view.cancelScheduled).toBe(false);
  });

  it("sona ermiş abonelikte 'ended' döner, iptal düğmesi yoktur", () => {
    const view = subscriptionCancelView({
      tier: "Pro",
      status: "canceled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: END,
    });
    expect(view.state).toBe("ended");
    expect(view.canCancel).toBe(false);
    expect(view.cancelScheduled).toBe(false);
  });

  it("past_due durumunda iptal AÇIK kalır (tahsilat denemeleri durdurulabilsin)", () => {
    const view = subscriptionCancelView({ tier: "Pro", status: "past_due" });
    expect(view.state).toBe("past_due");
    expect(view.canCancel).toBe(true);
  });

  it("iptal bayrağı ücretsiz planda 'iptal edildi' metnine dönüşmez", () => {
    const view = subscriptionCancelView({
      tier: "Free",
      status: "none",
      cancelAtPeriodEnd: true,
    });
    expect(view.cancelScheduled).toBe(false);
    expect(view.state).toBe("free");
  });
});

const ledgerRow = (over: Partial<SubscriptionLedgerRowView> = {}): SubscriptionLedgerRowView => ({
  paddle_subscription_id: "sub_1",
  status: "active",
  tier: "Pro",
  cancel_at_period_end: false,
  current_period_end: END,
  next_billed_at: END,
  updated_at: "2026-10-19T00:00:00.000Z",
  ...over,
});

describe("mySubscriptionView — profil + abonelik defteri birleşimi", () => {
  it("profille eşleşen defter satırını kullanır (en yeni satır başka abonelik olsa da)", () => {
    const view = mySubscriptionView(
      { subscription_tier: "Pro", subscription_status: "active", paddle_subscription_id: "sub_1" },
      [
        ledgerRow({
          paddle_subscription_id: "sub_2",
          cancel_at_period_end: true,
          current_period_end: "2026-12-08T00:00:00.000Z",
        }),
        ledgerRow({ paddle_subscription_id: "sub_1", cancel_at_period_end: false }),
      ],
    );
    expect(view.subscriptionId).toBe("sub_1");
    expect(view.cancelAtPeriodEnd).toBe(false);
    expect(view.currentPeriodEnd).toBe(END);
  });

  it("başka aboneliğin 'iptal edildi' bayrağı canlı aboneliğe taşınmaz", () => {
    const view = mySubscriptionView(
      { subscription_tier: "Pro", subscription_status: "active", paddle_subscription_id: "sub_1" },
      [ledgerRow({ paddle_subscription_id: "sub_2", cancel_at_period_end: true })],
    );
    expect(view.cancelAtPeriodEnd).toBe(false);
    // Eşleşmeyen satırın tarihi de gösterilmez; profil aynasına düşülür.
    expect(view.currentPeriodEnd).toBeNull();
  });

  it("profilden abonelik kimliği yoksa en yeni defter satırını kullanır", () => {
    const view = mySubscriptionView({ subscription_tier: "Pro", paddle_subscription_id: null }, [
      ledgerRow({ paddle_subscription_id: "sub_latest", cancel_at_period_end: true }),
    ]);
    expect(view.subscriptionId).toBe("sub_latest");
    expect(view.cancelAtPeriodEnd).toBe(true);
  });

  it("defter boşsa profil aynası gösterilir, iptal bayrağı false kalır", () => {
    const view = mySubscriptionView(
      {
        subscription_tier: "Business",
        subscription_status: "active",
        current_period_end: END,
        paddle_subscription_id: "sub_1",
      },
      [],
    );
    expect(view).toEqual({
      tier: "Business",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: END,
      nextBilledAt: null,
      subscriptionId: "sub_1",
    });
  });
});

describe("formatSubscriptionEnd", () => {
  it("geçerli ISO tarihi okunur biçime çevirir", () => {
    const label = formatSubscriptionEnd(END);
    expect(label).toBeTruthy();
    expect(label).toContain("2026");
  });

  it("boş/geçersiz tarihte null döner — uydurma tarih basılmaz", () => {
    expect(formatSubscriptionEnd(null)).toBeNull();
    expect(formatSubscriptionEnd(undefined)).toBeNull();
    expect(formatSubscriptionEnd("")).toBeNull();
    expect(formatSubscriptionEnd("not-a-date")).toBeNull();
  });
});
