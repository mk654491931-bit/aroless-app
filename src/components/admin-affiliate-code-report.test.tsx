// Kod bazlı getiri raporu — statik render güvencesi.
//
// Rapor para kararına girdiği için iki kural burada görünür kılınır:
//   1. Aynı affiliate'in ikinci kodunda bakiye TEKRAR yazılmaz ("aynı hesapta").
//   2. Kodu olmayan affiliate satırı GİZLENMEZ (borç ekranda kalır).
// Ayrıca ödeme bilgisi eksikken "ödemeye hazır" denmediği ve affiliate'siz
// kodların işaretlendiği kontrol edilir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ report: null as unknown }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: () => async () => state.report,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isLoading: false,
    isError: false,
    data: state.report,
    refetch: vi.fn(),
  }),
}));

import { AdminAffiliateCodeReport } from "./admin-affiliate-code-report";
import { buildAffiliateCodeReport } from "@/lib/affiliate-code-report";

const html = () => renderToStaticMarkup(<AdminAffiliateCodeReport />);

const affiliate = (over: Record<string, unknown> = {}) => ({
  user_id: "a1",
  email: "ayse@ornek.com",
  status: "verified",
  commission_rate_pct: 30,
  payable_cents: 0,
  held_cents: 0,
  paid_cents: 0,
  eligible: false,
  remaining_cents: 7500,
  payout_missing: [] as string[],
  codes: [] as string[],
  ...over,
});

const stat = (over: Record<string, unknown> = {}) => ({
  code: "AYSE-7K2M",
  signups: 4,
  subscriptions: 2,
  revenue_cents: 11800,
  by_tier: { Pro: 2 },
  ...over,
});

beforeEach(() => {
  state.report = buildAffiliateCodeReport({ stats: [], affiliates: [] });
});

describe("AdminAffiliateCodeReport", () => {
  it("kodu, aboneliği ve ödenebilir bakiyeyi tek satırda gösterir", () => {
    state.report = buildAffiliateCodeReport({
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
    const out = html();
    expect(out).toContain("Kod Bazlı Getiri Raporu");
    expect(out).toContain("AYSE-7K2M");
    expect(out).toContain("ayse@ornek.com");
    expect(out).toContain("$84.00");
    expect(out).toContain("Ödemeye hazır");
    expect(out).toContain("Pro ×2");
    expect(out).toContain("çift sayılmaz");
  });

  it("aynı affiliate'in ikinci kodunda bakiyeyi TEKRAR yazmaz", () => {
    state.report = buildAffiliateCodeReport({
      stats: [
        stat({ code: "AYSE-A", subscriptions: 3 }),
        stat({ code: "AYSE-B", subscriptions: 1 }),
      ],
      affiliates: [affiliate({ codes: ["AYSE-A", "AYSE-B"], payable_cents: 9000 })],
    });
    const out = html();
    expect(out).toContain("AYSE-A");
    expect(out).toContain("AYSE-B");
    expect(out).toContain("aynı hesapta");
    // Bakiye tek kez basılır: toplam şeritte ve ilk satırda.
    const occurrences = out.split("$90.00").length - 1;
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it("ödeme bilgisi eksikken 'ödemeye hazır' DEMEZ", () => {
    state.report = buildAffiliateCodeReport({
      stats: [stat()],
      affiliates: [
        affiliate({
          codes: ["AYSE-7K2M"],
          payable_cents: 9000,
          eligible: false,
          remaining_cents: 0,
          payout_missing: ["Hesap sahibi adı", "IBAN"],
        }),
      ],
    });
    const out = html();
    expect(out).toContain("Ödeme bilgisi eksik");
    expect(out).toContain("Hesap sahibi adı");
    expect(out).not.toContain("Ödemeye hazır");
  });

  it("kodu olmayan affiliate'i gizlemez, affiliate'siz kodu işaretler", () => {
    state.report = buildAffiliateCodeReport({
      stats: [stat({ code: "SAHIPSIZ", subscriptions: 1 })],
      affiliates: [affiliate({ codes: [], payable_cents: 12000 })],
      allCodes: ["SAHIPSIZ"],
    });
    const out = html();
    expect(out).toContain("kod verilmemiş");
    expect(out).toContain("$120.00");
    expect(out).toContain("bağlı değil (komisyon doğmaz)");
    expect(out).toContain("komisyon hesaplanmaz");
  });

  it("rapor boşken sessiz kalmaz", () => {
    state.report = buildAffiliateCodeReport({ stats: [], affiliates: [] });
    const out = html();
    expect(out).toContain("Henüz raporlanacak kod ya da affiliate yok.");
  });
});
