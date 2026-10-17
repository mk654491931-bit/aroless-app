// AFFILIATE PARA AKIŞI — arayüz testleri (üst menü rozeti · affiliate paneli · admin ödeme özeti).
//
// NEDEN VAR: ürünün tam olarak istediği üç şey ÖLÇÜLEBİLİR olmalı, yoksa sessizce
// bozulur:
//   1. Üst menüdeki affiliate paneli butonu YALNIZ admin'in affiliate olarak
//      tanımladığı (ve onayladığı) hesaplarda görünür.
//   2. Affiliate kendi panelinde "ne kadar kazandım" ve "hesabıma para ATILDI MI"
//      sorularının cevabını görür — bekleme sebebi tutar/tarihle birlikte.
//   3. Admin panelinde "kim ne kadar kazandı, ne kadarı ödendi?" tek özetten
//      okunur ve ödeme listesi indirilebilir.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initReactI18next } from "react-i18next";

import i18n, { RESOURCES } from "@/lib/i18n";

import type { AffiliateSummary } from "@/lib/affiliate.functions";
import type { AdminAffiliatePayout } from "@/lib/affiliate.functions";
import { affiliateTopbarBadge } from "@/lib/affiliate";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: () => async () => state.rows,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isLoading: false, isError: false, data: state.rows, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AffiliatePayoutHistory } from "./affiliate-payout-history";
import { AdminAffiliatePayoutSummary } from "./admin-affiliate-payout-summary";

// Metinlerin gerçekten sözlükten geldiğini görmek için i18n'i Türkçe kurarız:
// bileşenler `t()` kullanır, anahtar dönerse test yanlış şeyi doğrulamış olur.
beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: RESOURCES,
      lng: "tr",
      fallbackLng: "en",
      ns: ["common"],
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
  } else {
    await i18n.changeLanguage("tr");
  }
});

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

/** Tam ödeme profili — testler yalnız ilgilendikleri alanı değiştirir. */
const PAYOUT_PROFILE_READY = {
  method: "wise" as const,
  account_holder: "Ayşe Yılmaz",
  iban_masked: null,
  wise_email: "ayse@ornek.com",
  tax_id_set: false,
  ready: true,
  missing: [] as string[],
};

/** Ölçülmüş bir affiliate özeti kurar; testler yalnız ilgilendiği alanı değiştirir. */
function summary(overrides: Partial<AffiliateSummary> = {}): AffiliateSummary {
  return {
    applied: true,
    status: "verified",
    commission_rate_pct: 30,
    commission_max_months: 12,
    referral_code: "AB12CD34",
    pending_cents: 0,
    pending_count: 0,
    payable_cents: 0,
    held_cents: 0,
    paid_cents: 0,
    paid_count: 0,
    paid_transactions: 0,
    earned_cents: 0,
    payout_eligible: false,
    payout_remaining_cents: 7500,
    min_payout_cents: 7500,
    paid_any: false,
    payouts: [],
    payouts_truncated: false,
    last_payout: null,
    next_unlock_at: null,
    totals_exact: true,
    promo_codes: [],
    payout: { ready: false, missing: [] },
    recent: [],
    ...overrides,
  } as unknown as AffiliateSummary;
}

describe("affiliateTopbarBadge — buton yalnız affiliate hesaplarda", () => {
  it("onaylı affiliate hesapta gösterir ve ödenmemiş/ödenen tutarı taşır", () => {
    const view = affiliateTopbarBadge({
      is_affiliate: true,
      pending_cents: 12_340,
      paid_cents: 5_000,
    });
    expect(view).toEqual({ show: true, unpaidCents: 12_340, paidCents: 5_000 });
  });

  it("affiliate OLMAYAN hesapta göstermez (bekleyen/askıda/normal hesap)", () => {
    expect(affiliateTopbarBadge({ is_affiliate: false, status: "pending" }).show).toBe(false);
    expect(affiliateTopbarBadge({ is_affiliate: false, status: "revoked" }).show).toBe(false);
    expect(affiliateTopbarBadge({ is_affiliate: false, status: null }).show).toBe(false);
  });

  it("rozet okunamadıysa (null) buton basmaz — bilinmeyen 'affiliate' sayılmaz", () => {
    expect(affiliateTopbarBadge(null).show).toBe(false);
    expect(affiliateTopbarBadge(undefined).show).toBe(false);
  });

  it("ölçülmemiş tutar 0 sayılır, uydurulmaz", () => {
    const view = affiliateTopbarBadge({ is_affiliate: true });
    expect(view.unpaidCents).toBe(0);
    expect(view.paidCents).toBe(0);
  });
});

describe('AffiliatePayoutHistory — "hesabıma para atıldı mı?"', () => {
  it("para gönderilmişse transferi tarih, referans, yöntem ve tutarla yazar", () => {
    const out = html(
      <AffiliatePayoutHistory
        summary={summary({
          paid_cents: 8_250,
          paid_transactions: 2,
          paid_any: true,
          earned_cents: 8_250,
          payouts: [
            {
              ref: "PAY-20261001-ALICE",
              paidAt: "2026-10-01T09:00:00.000Z",
              cents: 8_250,
              count: 2,
              method: "wise",
            },
          ],
          last_payout: {
            ref: "PAY-20261001-ALICE",
            paidAt: "2026-10-01T09:00:00.000Z",
            cents: 8_250,
            count: 2,
            method: "wise",
          },
        })}
      />,
    );
    expect(out).toContain("Hesabına para gönderildi");
    expect(out).toContain("PAY-20261001-ALICE");
    expect(out).toContain("Wise");
    expect(out).toContain("$82,50");
    expect(out).toContain("Ödeme geçmişi (1)");
  });

  it("para gönderilmemişse NEDEN beklediğini ölçülmüş sayıyla söyler (eşik)", () => {
    const out = html(
      <AffiliatePayoutHistory
        summary={summary({
          pending_cents: 3_000,
          payable_cents: 3_000,
          payout_remaining_cents: 4_500,
          payout: { ...PAYOUT_PROFILE_READY },
        })}
      />,
    );
    expect(out).toContain("Henüz hesabına para gönderilmedi");
    expect(out).toContain("daha birikince");
    expect(out).toContain("Ödeme geçmişi (0)");
  });

  it("beklemedeki bakiyenin çözülme tarihini yazar", () => {
    const out = html(
      <AffiliatePayoutHistory
        summary={summary({
          pending_cents: 5_000,
          held_cents: 5_000,
          next_unlock_at: "2026-11-05T00:00:00.000Z",
          payout: { ...PAYOUT_PROFILE_READY },
        })}
      />,
    );
    expect(out).toContain("iade penceresi");
    expect(out).toContain("Beklemedeki");
  });

  it("ödeme bilgisi eksikse para gönderilemeyeceğini açıkça söyler", () => {
    const out = html(
      <AffiliatePayoutHistory
        summary={summary({
          pending_cents: 9_000,
          payable_cents: 9_000,
          payout: { ...PAYOUT_PROFILE_READY, ready: false, missing: ["IBAN"] },
        })}
      />,
    );
    expect(out).toContain("Ödeme yapılabilmesi için");
    expect(out).toContain("IBAN");
    // Eşik/bekleme mesajı BASILMAZ: asıl engel ödeme bilgisidir.
    expect(out).not.toContain("daha birikince");
  });

  it("okuma sınırına takılırsa listenin EKSİK olduğunu söyler", () => {
    const out = html(<AffiliatePayoutHistory summary={summary({ payouts_truncated: true })} />);
    expect(out).toContain("sınırlı");
  });

  it("dil değişince metinler yeni dilde çizilir (sabit Türkçe metin yok)", async () => {
    const view = summary({
      paid_cents: 8_250,
      paid_any: true,
      payouts: [
        {
          ref: "PAY-GLOBAL-1",
          paidAt: "2026-10-01T09:00:00.000Z",
          cents: 8_250,
          count: 2,
          method: "wise",
        },
      ],
    });

    await i18n.changeLanguage("tr");
    expect(html(<AffiliatePayoutHistory summary={view} />)).toContain("Hesabına para gönderildi");

    await i18n.changeLanguage("de");
    const de = html(<AffiliatePayoutHistory summary={view} />);
    expect(de).toContain("Geld wurde auf dein Konto überwiesen");
    expect(de).toContain("Auszahlungsverlauf (1)");
    expect(de).not.toContain("Hesabına para gönderildi");

    // Dosyadaki diğer testler Türkçe beklentiyle çalışır: dili geri al.
    await i18n.changeLanguage("tr");
  });
});

describe("AdminAffiliatePayoutSummary — kim ne kadar kazandı / ödendi mi?", () => {
  beforeEach(() => {
    state.rows = [
      {
        user_id: "u1",
        status: "verified",
        eligible: true,
        pending_cents: 20_000,
        pending_count: 3,
        payable_cents: 7_500,
        held_cents: 12_500,
        paid_cents: 5_000,
        paid_count: 1,
        reversed_cents: 0,
      },
      {
        user_id: "u2",
        status: "pending",
        eligible: false,
        pending_cents: 1_000,
        pending_count: 1,
        payable_cents: 0,
        held_cents: 1_000,
        paid_cents: 0,
        paid_count: 0,
        reversed_cents: 0,
      },
    ] as unknown as AdminAffiliatePayout[];
  });

  it("ölçülen toplamları tek özetten gösterir ve ödeme ekranına/CSV'ye buton verir", () => {
    const out = html(<AdminAffiliatePayoutSummary />);
    expect(out).toContain("Ödenmemiş (borç)");
    expect(out).toContain("$210,00"); // 20.000 + 1.000 kuruş → borç
    expect(out).toContain("$75,00"); // ödemeye hazır (eşiğin tam üstü)
    expect(out).toContain("$50,00"); // ödenen toplam
    expect(out).toContain("1 onaylı hesap · 1 ödemeye hazır");
    expect(out).toContain("Kim ne kadar kazandı / ödendi mi?");
    expect(out).toContain("Ödeme listesini indir (CSV)");
  });

  it("hiç affiliate satırı yoksa sıfırları dürüstçe gösterir (boş ekran bırakmaz)", () => {
    state.rows = [];
    const out = html(<AdminAffiliatePayoutSummary />);
    expect(out).toContain("$0,00");
    expect(out).toContain("0 onaylı hesap · 0 ödemeye hazır");
  });
});
