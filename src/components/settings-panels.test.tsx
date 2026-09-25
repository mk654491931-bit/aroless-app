// Ayarlar sayfasının üç paneli — render + durum testleri.
//
// Bu üç panel daha önce sessizce boş kalabiliyordu: hata durumu yoktu, sunucu
// hatası "hiçbir şey olmadı" gibi görünüyordu. Testler panelin gerçek
// durumlarda içerik ürettiğini sabitler ve render çökmesini yakalar.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  referral: {
    code: "AB12CD34",
    invited: 2,
    credits_earned: 2,
    referred_by_code: null as string | null,
    claimable: true,
    recent: [] as Array<{ created_at: string; credits: number }>,
  } as Record<string, unknown>,
  affiliate: {
    applied: true,
    status: "verified" as string | null,
    commission_rate_pct: 30,
    referral_code: "AB12CD34",
    earned_cents: 0,
    paid_transactions: 0,
    recent: [] as Array<Record<string, unknown>>,
  } as Record<string, unknown>,
  promoPerformance: {
    code: "VLRWELCOME",
    signups: 12,
    purchases: 7,
    conversion_pct: 58,
    revenue_cents: 20300,
    by_tier: [
      { tier: "Pro", users: 5 },
      { tier: "Starter", users: 2 },
    ],
    first_signup_at: "2026-01-10T00:00:00.000Z",
    last_signup_at: "2026-02-11T00:00:00.000Z",
    own_tier: "Business",
  } as Record<string, unknown> | null,
  tickets: [] as Array<Record<string, unknown>>,
  promoError: false,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: (fn: { name?: string }) => {
    const label = fn.name ?? "";
    if (label.includes("PromoPerformance")) return async () => state.promoPerformance;
    if (label.includes("Affiliate")) return async () => state.affiliate;
    if (label.includes("Referral")) return async () => state.referral;
    if (label.includes("Ticket")) return async () => state.tickets;
    return async () => null;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  // Sorgu anahtarına göre doğru veriyi döndürür: panellerin hepsi useQuery
  // kullandığı için tek bir mock herkese aynı yanıtı veremez.
  useQuery: ({ queryKey }: { queryKey: unknown }) => {
    const key = Array.isArray(queryKey) ? queryKey.join(":") : String(queryKey);
    let data: unknown;
    if (key.includes("affiliate-promo")) data = state.promoPerformance;
    else if (key.includes("affiliate")) data = state.affiliate;
    else if (key.includes("referral")) data = state.referral;
    else if (key.includes("tickets")) data = state.tickets;
    return { isLoading: false, isError: state.promoError, data, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AffiliatePanel } from "./affiliate-panel";
import { ReferralPanel } from "./referral-panel";
import { SupportPanel } from "./support-panel";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

// Paneller davet linkini `window.location.origin` ile kuruyor; node ortamında
// window yok. Davet linkinin gerçekten koddan üretildiğini doğrulayabilmek için
// minimal bir window taklidi kurulur.
beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = {
    location: { origin: "https://app.example.com" },
  };
});

beforeEach(() => {
  state.promoError = false;
  state.referral = {
    code: "AB12CD34",
    invited: 2,
    credits_earned: 2,
    referred_by_code: null,
    claimable: true,
    recent: [],
  };
  state.affiliate = {
    applied: true,
    status: "verified",
    commission_rate_pct: 30,
    referral_code: "AB12CD34",
    earned_cents: 0,
    paid_transactions: 0,
    recent: [],
  };
  state.promoPerformance = {
    code: "VLRWELCOME",
    signups: 12,
    purchases: 7,
    conversion_pct: 58,
    revenue_cents: 20300,
    by_tier: [
      { tier: "Pro", users: 5 },
      { tier: "Starter", users: 2 },
    ],
    first_signup_at: "2026-01-10T00:00:00.000Z",
    last_signup_at: "2026-02-11T00:00:00.000Z",
    own_tier: "Business",
  };
  state.tickets = [];
});

describe("ReferralPanel", () => {
  it("renders the invite code, counters and the claim form", () => {
    const out = html(<ReferralPanel />);
    expect(out).toContain("Arkadaşını davet et");
    // Davet linki kodu içermeli (aksi halde link boş/kopuk çalışır).
    expect(out).toContain("https://app.example.com/auth?ref=AB12CD34");
    expect(out).toContain("Davet edilen");
    expect(out).toContain("Kazanılan kredi");
    expect(out).toContain("Uygula");
  });

  it("explains the 30-day window instead of silently hiding the form", () => {
    state.referral = { ...state.referral, claimable: false, referred_by_code: null };
    const out = html(<ReferralPanel />);
    expect(out).toContain("ilk 30 gün");
  });

  it("shows which invite code the account already used", () => {
    state.referral = { ...state.referral, claimable: false, referred_by_code: "ZZ99ZZ99" };
    const out = html(<ReferralPanel />);
    expect(out).toContain("ZZ99ZZ99");
  });

  it("surfaces a load failure with a retry instead of an empty box", () => {
    state.promoError = true;
    const out = html(<ReferralPanel />);
    expect(out).toContain("Tekrar dene");
  });
});

describe("AffiliatePanel", () => {
  it("shows the application state before verification", () => {
    state.affiliate = { ...state.affiliate, status: "pending" };
    state.promoPerformance = null;
    const out = html(<AffiliatePanel />);
    expect(out).toContain("inceleniyor");
    // Onaylanmadan promo kodu performansı GÖSTERİLMEMELİ.
    expect(out).not.toContain("VLRWELCOME");
  });

  it("shows the account's own promo code performance once verified", () => {
    const out = html(<AffiliatePanel />);
    expect(out).toContain("Promo kodun");
    expect(out).toContain("VLRWELCOME");
    expect(out).toContain("Getirdiği kullanıcı");
    expect(out).toContain("12");
    expect(out).toContain("%58");
    expect(out).toContain("203.00");
    expect(out).toContain("Kodun getirdiklerinin paketleri");
    expect(out).toContain("Pro");
    expect(out).toContain("Business");
  });

  it("offers an application when the account never applied", () => {
    state.affiliate = { ...state.affiliate, status: null, applied: false };
    state.promoPerformance = null;
    const out = html(<AffiliatePanel />);
    expect(out).toContain("Başvuru yap");
  });

  it("surfaces a load failure with a retry", () => {
    state.promoError = true;
    const out = html(<AffiliatePanel />);
    expect(out).toContain("Tekrar dene");
  });
});

describe("SupportPanel", () => {
  it("renders the report form", () => {
    const out = html(<SupportPanel />);
    expect(out).toContain("Destek");
    expect(out).toContain("Konu");
    expect(out).toContain("Gönder");
  });

  it("says there are no tickets yet instead of hiding the section", () => {
    const out = html(<SupportPanel />);
    expect(out).toContain("Henüz talep göndermedin");
  });

  it("renders submitted tickets with category, status and admin reply", () => {
    state.tickets = [
      {
        id: "t1",
        email: "u@example.com",
        category: "bug",
        subject: "Hata bildirimi",
        message: "Ürün araması boş dönüyor.",
        status: "in_progress",
        admin_note: "İnceleniyor, teşekkürler.",
        created_at: "2026-02-01T10:00:00.000Z",
      },
    ];
    const out = html(<SupportPanel />);
    expect(out).toContain("Hata bildirimi");
    expect(out).toContain("Hata bildirimi"); // kategori rozeti
    expect(out).toContain("İnceleniyor");
    expect(out).toContain("Ürün araması boş dönüyor.");
    expect(out).toContain("İnceleniyor, teşekkürler.");
  });

  it("offers a retry when the ticket list cannot be loaded", () => {
    state.promoError = true;
    const out = html(<SupportPanel />);
    expect(out).toContain("tekrar dene");
  });
});
