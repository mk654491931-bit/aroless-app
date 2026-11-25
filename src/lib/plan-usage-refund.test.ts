// İADE DEFTERİ — aylık kullanım sayacının gerçekten düşmesi.
//
// REGRESYON: `refundFeatureCredits` iade tutarını POZİTİF gönderiyor, defter
// fonksiyonu ise `Math.min(0, …)` ile onu 0'a indiriyordu. Jeton bakiyeye geri
// dönüyor ama `credit_usage_log`'daki pozitif satır kalıyordu; kullanıcı
// bakiyesi varken "bu ay hakkın doldu" (PLAN_LIMIT) görüyordu.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: h.from },
}));

import { recordUsageRefund } from "./plan-usage.server";

const USER = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  h.from.mockReset();
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.from.mockReturnValue({ insert: h.insert });
});

describe("recordUsageRefund", () => {
  it("pozitif iade tutarını NEGATİF defter satırı olarak yazar", async () => {
    await recordUsageRefund({ userId: USER, feature: "tool:consensus", credits: 2 });

    expect(h.from).toHaveBeenCalledWith("credit_usage_log");
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER,
        tool: "tool:consensus",
        credits: -2,
      }),
    );
  });

  it("negatif girdide çift eksi üretmez (tek çağrı biçimi)", async () => {
    await recordUsageRefund({ userId: USER, feature: "council", credits: -1 });

    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ credits: -1 }));
  });

  it("sıfır tutarda deftere hiç dokunmaz", async () => {
    await recordUsageRefund({ userId: USER, feature: "council", credits: 0 });

    expect(h.from).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });
});
