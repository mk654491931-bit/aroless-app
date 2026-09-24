// JETON TAHSİLAT KAPISI — davranış sözleşmesi.
//
// NEDEN VAR: Bu kapı yanlış davranırsa iki uçtan biri kırılır:
//   * fail-open olursa (tahsilat yapılamadı ama AI koştu) kullanıcı bedava
//     kullanır ve 22 anahtarlık havuz karşılıksız yanar,
//   * fail-closed yanlış kurgulanırsa kullanıcının bakiyesi olduğu hâlde iş
//     reddedilir ya da kısmi düşme sonrası hata verilip jeton geri gelmez.
// Testler bu iki yönü de sabitler. Veritabanı ve iade katmanı taklit edilir.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  refund: vi.fn(async () => true),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }) }),
    rpc: h.rpc,
  }),
}));

vi.mock("./credit-guard.server", () => ({
  refundCredit: h.refund,
  creditDeductError: (message: string) =>
    new Error(/no_credits/.test(String(message)) ? "NO_CREDITS" : "CREDIT_DEDUCT_FAILED"),
  withCreditRefund: async (_userId: string, run: () => Promise<unknown>) => run(),
}));

import { chargeAiCredits, chargeOrRespond, noCreditsResponse } from "./credit-charge.server";

const USER = "11111111-2222-3333-4444-555555555555";
const TOKEN = "header.payload.signature";

function balance(credits: number, finder = 0) {
  h.maybeSingle.mockResolvedValue({ data: { credits, finder_credits: finder }, error: null });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  h.rpc.mockReset();
  h.maybeSingle.mockReset();
  h.refund.mockClear();
});

describe("chargeAiCredits", () => {
  it("jeton yoksa HİÇ AI başlatılmadan reddeder (fail-closed)", async () => {
    balance(0, 0);
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "council" });
    expect(outcome).toEqual({ ok: false, reason: "NO_CREDITS", charged: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ücretsiz hoş geldin jetonu (finder) harcanabilir sayılır", async () => {
    balance(0, 2);
    h.rpc.mockResolvedValue({ data: 1, error: null });
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "radar-scan" });
    expect(outcome.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("deduct_product_finder_credit");
  });

  it("pahalı aracı (consensus) bakiyeden düştüğü kadar çağırır", async () => {
    balance(9);
    h.rpc.mockResolvedValue({ data: 8, error: null });
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "tool:consensus" });
    expect(outcome).toEqual({ ok: true, charged: 2, remaining: 8, admin: false });
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("kısmi düşmede iade eder ve dürüstçe reddeder (jeton buharlaşmaz)", async () => {
    balance(9);
    h.rpc
      .mockResolvedValueOnce({ data: 8, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "no_credits" } });
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "tool:consensus" });
    expect(outcome).toEqual({ ok: false, reason: "NO_CREDITS", charged: 0 });
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.refund).toHaveBeenCalledWith(USER, 1, "partial_no_credits");
  });

  it("altyapı hatasında (kota değil) UNAVAILABLE döner, kısmi düşme iade edilir", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    balance(9);
    h.rpc
      .mockResolvedValueOnce({ data: 8, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "tool:consensus" });
    expect(outcome).toEqual({ ok: false, reason: "UNAVAILABLE", charged: 0 });
    expect(h.refund).toHaveBeenCalledWith(USER, 1, "deduct_error");
    errorSpy.mockRestore();
  });

  it("jeton (Bearer) yoksa AI başlatılmaz", async () => {
    const outcome = await chargeAiCredits({ userId: USER, token: "", feature: "council" });
    expect(outcome).toEqual({ ok: false, reason: "UNAVAILABLE", charged: 0 });
    expect(h.maybeSingle).not.toHaveBeenCalled();
  });

  it("Supabase yapılandırılmadıysa sessizce bedava açmaz", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "council" });
    expect(outcome).toEqual({ ok: false, reason: "UNAVAILABLE", charged: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("bakiye okunamazsa kararı gerçek düşme denemesi verir", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    h.rpc.mockResolvedValue({ data: 3, error: null });
    const outcome = await chargeAiCredits({ userId: USER, token: TOKEN, feature: "trend-analysis" });
    expect(outcome.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("chargeOrRespond", () => {
  it("bakiye yoksa 402 + NO_CREDITS kodu döner (arayüz yükseltme çağrısı yapar)", async () => {
    balance(0);
    const gate = await chargeOrRespond({ userId: USER, token: TOKEN, feature: "tool:consensus" });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("beklenmeyen başarı");
    expect(gate.response.status).toBe(402);
    const body = (await gate.response.json()) as { code?: string; required?: number };
    expect(body.code).toBe("NO_CREDITS");
    expect(body.required).toBe(2);
  });

  it("altyapı hatasında 503 + CREDIT_UNAVAILABLE döner (jeton düşülmedi)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const gate = await chargeOrRespond({ userId: USER, token: TOKEN, feature: "council" });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("beklenmeyen başarı");
    expect(gate.response.status).toBe(503);
    const body = (await gate.response.json()) as { code?: string };
    expect(body.code).toBe("CREDIT_UNAVAILABLE");
  });
});

describe("noCreditsResponse", () => {
  it("yanıt önbelleğe alınmaz ve paket adı geçer", async () => {
    const response = noCreditsResponse(3, "tool:consensus");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: string; required: number };
    expect(body.required).toBe(3);
    expect(body.error).toContain("3 jeton");
  });
});
