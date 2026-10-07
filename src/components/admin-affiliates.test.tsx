// Admin affiliate paneli — render + yeni "affiliate'e özel kod" kontrolleri.
//
// Panel sessizce boş kalabildiği ve yeni kod verme akışı yalnızca admin
// girişinde göründüğü için burada statik render ile sabitlenir: satırlar promo
// kodlarını gösteriyor mu, "kod atanmadı" durumu var mı, kodu oluşturan kutu ve
// indirim alanı çiziliyor mu. (Tıklama akışı mutasyon gerektirir; burada
// güvence altına alınan şey panelin doğru veriyle çökmeden kurulması.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: () => async () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown }) => {
    const key = Array.isArray(queryKey) ? queryKey.join(":") : String(queryKey);
    return {
      isLoading: false,
      isError: false,
      data: key.includes("admin-affiliate-payouts") ? state.rows : undefined,
      refetch: vi.fn(),
    };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null, variables: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminAffiliates } from "./admin-affiliates";

const html = () => renderToStaticMarkup(<AdminAffiliates />);

const row = (over: Record<string, unknown>) => ({
  user_id: "u1",
  email: "ayse@ornek.com",
  status: "verified",
  commission_rate_pct: 30,
  payout_method: null,
  payout_note: null,
  pending_cents: 0,
  pending_count: 0,
  paid_cents: 0,
  paid_count: 0,
  reversed_cents: 0,
  last_paid_at: null,
  eligible: false,
  remaining_cents: 7500,
  promo_codes: [] as string[],
  ...over,
});

beforeEach(() => {
  state.rows = [];
});

describe("AdminAffiliates", () => {
  it("satırları e-postasıyla ve bağlı promo kodlarıyla gösterir", () => {
    state.rows = [row({ promo_codes: ["AYSE-7K2M"] }), row({ user_id: "u2", email: "b@x.com" })];
    const out = html();
    expect(out).toContain("ayse@ornek.com");
    expect(out).toContain("AYSE-7K2M");
    // Kodu olmayan affiliate "kod atanmadı" olarak işaretlenir (sessiz boş hücre yok).
    expect(out).toContain("kod atanmadı");
  });

  it("kodu sonradan vermek için her satırda buton sunar", () => {
    state.rows = [row({})];
    const out = html();
    expect(out).toContain("Kod ver</button>");
    // Kod satırı kapalıyken (varsayılan) yazma alanı GÖRÜNMEMELİ.
    expect(out).not.toContain("için kod (sen yazarsın)");
  });

  it("kodun ELLE yazıldığını ve indirim taşımadığını söyler", () => {
    state.rows = [row({})];
    const out = html();
    // Otomatik üretim kaldırıldı: admin kodu kendi yazar.
    expect(out).toMatch(/Kod vermek için listeden[\s\S]*“Kod ver”/);
    expect(out).toContain("indirim taşımaz");
    expect(out).toContain("Paddle panelinde");
    // Eski otomatik üretim seçeneği artık OLMAMALI.
    expect(out).not.toContain("Görevlendirirken ona özel promosyon kodu da oluştur");
    expect(out).not.toContain("Yeni kodlarda müşteri indirimi");
  });

  it("onaysız başvuruda 'Onayla', onaylıda 'Askıya al' gösterir", () => {
    state.rows = [row({ user_id: "p1", status: "pending" }), row({})];
    const out = html();
    expect(out).toContain("Onayla");
    expect(out).toContain("Askıya al");
    expect(out).toContain("Bekliyor");
    expect(out).toContain("Onaylı");
  });

  it("ödeme eşiğini ve toplam ödenmemişi özetler", () => {
    state.rows = [row({ pending_cents: 8000, eligible: true, remaining_cents: 0 })];
    const out = html();
    expect(out).toContain("Ödeme eşiği");
    expect(out).toContain("$75.00");
    expect(out).toContain("$80.00");
  });

  it("başvuru yokken boş durumu yazar, görevlendirme formunu gizlemez", () => {
    state.rows = [];
    const out = html();
    expect(out).toContain("Henüz affiliate başvurusu yok");
    // Başvuru gelmeden de hesap görevlendirilebilmeli.
    expect(out).toContain("Görevlendir");
    // Kod VERME düğmesi yalnız affiliate satırlarında bulunur; ipucu metni
    // (“Kod ver”) düğme değildir, o yüzden `</button>` ile aranır.
    expect(out).not.toContain("Kod ver</button>");
  });
});
