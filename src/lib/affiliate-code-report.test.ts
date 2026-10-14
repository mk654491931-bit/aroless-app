/**
 * Affiliate kod raporu — saf toplama kuralları.
 *
 * NEDEN TEST: bu rapor para kararına girer. En pahalı iki hata şunlardır:
 *   1. Aynı affiliate'in iki kodunda bakiyenin İKİ KEZ gösterilmesi → admin
 *      olmayan parayı ödemeye çalışır.
 *   2. Bakiyesi olan ama kodu olmayan affiliate'in raporda HİÇ görünmemesi →
 *      borçlu olduğumuz para ekranda kaybolur.
 * Bu iki kural burada kilitlenir.
 */
import { describe, expect, it } from "vitest";
import {
  buildAffiliateCodeReport,
  type AffiliateBalance,
  type CodeAttributionStat,
} from "./affiliate-code-report";

const affiliate = (over: Partial<AffiliateBalance> = {}): AffiliateBalance => ({
  user_id: "a1",
  email: "ayse@ornek.com",
  status: "verified",
  commission_rate_pct: 30,
  payable_cents: 0,
  held_cents: 0,
  paid_cents: 0,
  eligible: false,
  remaining_cents: 7500,
  payout_missing: [],
  codes: [],
  ...over,
});

const stat = (over: Partial<CodeAttributionStat> = {}): CodeAttributionStat => ({
  code: "AYSE-7K2M",
  signups: 4,
  subscriptions: 2,
  revenue_cents: 11800,
  by_tier: { Pro: 1, Business: 1 },
  ...over,
});

describe("buildAffiliateCodeReport", () => {
  it("kodu getirdiği abonelik ve ödenebilir bakiyeyle eşler", () => {
    const report = buildAffiliateCodeReport({
      stats: [stat()],
      affiliates: [
        affiliate({
          codes: ["AYSE-7K2M"],
          payable_cents: 8400,
          eligible: true,
          remaining_cents: 0,
        }),
      ],
    });

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.code).toBe("AYSE-7K2M");
    expect(row.affiliate_email).toBe("ayse@ornek.com");
    expect(row.signups).toBe(4);
    expect(row.subscriptions).toBe(2);
    expect(row.conversion_pct).toBe(50);
    expect(row.revenue_cents).toBe(11800);
    expect(row.payable_cents).toBe(8400);
    expect(row.eligible).toBe(true);
    expect(row.by_tier).toEqual([
      { tier: "Business", users: 1 },
      { tier: "Pro", users: 1 },
    ]);
  });

  it("aynı affiliate'in İKİ kodunda bakiyeyi yalnız bir kez sayar", () => {
    const report = buildAffiliateCodeReport({
      stats: [
        stat({ code: "AYSE-A", subscriptions: 3 }),
        stat({ code: "AYSE-B", subscriptions: 1 }),
      ],
      affiliates: [affiliate({ codes: ["AYSE-A", "AYSE-B"], payable_cents: 9000 })],
    });

    expect(report.rows.map((r) => r.code)).toEqual(["AYSE-A", "AYSE-B"]);
    // Bakiye yalnız en çok abonelik getiren kodun satırında.
    expect(report.rows[0].balance_owned).toBe(true);
    expect(report.rows[0].payable_cents).toBe(9000);
    expect(report.rows[1].balance_owned).toBe(false);
    expect(report.rows[1].payable_cents).toBe(0);
    expect(report.rows[1].subscriptions).toBe(1);
    // Toplam ÇİFT SAYILMAZ.
    expect(report.totals.payable_cents).toBe(9000);
    expect(report.totals.subscriptions).toBe(4);
    expect(report.totals.codes).toBe(2);
    expect(report.totals.affiliates).toBe(1);
    expect(report.totals.shared_balance_codes).toBe(1);
  });

  it("hiç kullanılmamış kodları 0 ile listeler ve sahipsiz olarak sayar", () => {
    const report = buildAffiliateCodeReport({
      stats: [],
      affiliates: [],
      allCodes: ["YENI-KOD", "ayse-7k2m"],
    });

    expect(report.rows.map((r) => r.code)).toEqual(["AYSE-7K2M", "YENI-KOD"]);
    expect(report.rows[0].subscriptions).toBe(0);
    expect(report.rows[0].payout_missing).toEqual([]);
    expect(report.totals.unlinked_codes).toBe(2);
    expect(report.totals.affiliates).toBe(0);
    expect(report.totals.payable_cents).toBe(0);
  });

  it("kodu olmayan affiliate'i (borç görünmez olmasın) satır olarak gösterir", () => {
    const report = buildAffiliateCodeReport({
      stats: [],
      affiliates: [affiliate({ codes: [], payable_cents: 12000, held_cents: 500 })],
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].code).toBeNull();
    expect(report.rows[0].balance_owned).toBe(true);
    expect(report.rows[0].payable_cents).toBe(12000);
    expect(report.totals.codes).toBe(0);
    expect(report.totals.affiliates).toBe(1);
    expect(report.totals.payable_cents).toBe(12000);
    expect(report.totals.held_cents).toBe(500);
  });

  it("önce en çok ödenecek parayı, sonra en çok aboneliği sıralar", () => {
    const report = buildAffiliateCodeReport({
      stats: [
        stat({ code: "BUYUK", subscriptions: 5 }),
        stat({ code: "KUCUK", subscriptions: 1 }),
        stat({ code: "BORC", subscriptions: 9 }),
      ],
      affiliates: [
        affiliate({ user_id: "a1", codes: ["BUYUK"], payable_cents: 20000 }),
        affiliate({ user_id: "a2", codes: ["KUCUK"], payable_cents: 7500 }),
      ],
    });

    // Bakiye sırası baskın: 20000 → 7500 → bakiyesiz (ama en çok abonelik).
    expect(report.rows.map((r) => r.code)).toEqual(["BUYUK", "KUCUK", "BORC"]);
    expect(report.rows[2].affiliate_id).toBeNull();
    expect(report.rows[2].subscriptions).toBe(9);
    expect(report.rows[2].commission_rate_pct).toBeNull();
  });

  it("ödemeye hazır hesap sayısını ve eksik ödeme bilgisini taşır", () => {
    const report = buildAffiliateCodeReport({
      stats: [stat({ code: "HAZIR" }), stat({ code: "EKSIK" })],
      affiliates: [
        affiliate({ user_id: "a1", codes: ["HAZIR"], payable_cents: 10000, eligible: true }),
        affiliate({
          user_id: "a2",
          codes: ["EKSIK"],
          payable_cents: 9000,
          eligible: false,
          remaining_cents: 0,
          payout_missing: ["Hesap sahibi adı", "IBAN"],
        }),
      ],
    });

    expect(report.totals.payable_affiliates).toBe(1);
    const eksik = report.rows.find((r) => r.code === "EKSIK");
    expect(eksik?.payout_missing).toEqual(["Hesap sahibi adı", "IBAN"]);
    expect(report.totals.payable_cents).toBe(19000);
  });

  it("bozuk/eksik sayıları 0 kabul eder (uydurma tutar yazmaz)", () => {
    const report = buildAffiliateCodeReport({
      stats: [
        {
          code: "BOZUK",
          signups: Number.NaN,
          subscriptions: 2,
          revenue_cents: undefined as unknown as number,
          by_tier: { Pro: Number.NaN },
        },
      ],
      affiliates: [affiliate({ codes: ["BOZUK"] })],
    });

    expect(report.rows[0].signups).toBe(0);
    expect(report.rows[0].conversion_pct).toBe(0);
    expect(report.rows[0].revenue_cents).toBe(0);
    expect(report.rows[0].by_tier).toEqual([]);
  });
});
