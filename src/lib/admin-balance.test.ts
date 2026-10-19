// ADMIN 250 — bakiyeyi günde bir kez 250'ye getiren orkestrasyon.
//
// NEDEN: `ADMIN_QUOTA` 250 diyordu ama `profiles.credits` 0 olabiliyordu;
// tahsilat ön kontrolü admini reddediyor, panel 0 gösteriyordu. Bu test
// sıralamayı (önce günlük tazeleme, sonra gün içi taban) ve çift eklemeyi
// engelleyen davranışı sabitler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  refund: vi.fn(),
  rpc: vi.fn(),
  credits: 0,
}));

vi.mock("./admin-identity.server", () => ({ isAdminAccount: h.isAdmin }));
vi.mock("./credit-guard.server", () => ({ refundCredit: h.refund }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { credits: h.credits }, error: null }),
        }),
      }),
    }),
    rpc: h.rpc,
  },
}));

import { ensureAdminBalance } from "./plan-usage.server";

beforeEach(() => {
  h.isAdmin.mockReset();
  h.refund.mockReset();
  h.rpc.mockReset();
  h.isAdmin.mockResolvedValue(true);
  h.refund.mockResolvedValue(true);
  // Günlük tazeleme başarılı olduğunda DB 250 yazar; taklit de aynısını yapar.
  h.rpc.mockImplementation(async () => {
    h.credits = 250;
    return { error: null };
  });
  h.credits = 0;
});

describe("ensureAdminBalance", () => {
  it("admin değilse hiçbir şey yapmaz", async () => {
    h.isAdmin.mockResolvedValue(false);
    await expect(ensureAdminBalance("admin-none")).resolves.toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("bakiye zaten 250 ise tazeleme/ekleme yapmaz", async () => {
    h.credits = 250;
    await expect(ensureAdminBalance("admin-rich")).resolves.toBe(true);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("0 bakiyede günlük tazeleme 250 yazar ve ek iade yapılmaz", async () => {
    await expect(ensureAdminBalance("admin-zero")).resolves.toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("refresh_admin_daily_credits");
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("günlük tazeleme kullanıldıysa günde BİR kez farkı tamamlar", async () => {
    h.rpc.mockResolvedValue({ error: { message: "already refreshed today" } });
    await expect(ensureAdminBalance("admin-floor")).resolves.toBe(true);
    expect(h.refund).toHaveBeenCalledTimes(1);
    const [userId, amount, reason, key] = h.refund.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    expect(userId).toBe("admin-floor");
    expect(amount).toBe(250);
    expect(reason).toBe("admin_quota_floor");
    expect(key).toMatch(/^admin-floor:admin-floor:\d{4}-\d{2}-\d{2}$/);

    // Aynı gün ikinci okuma aynı anahtarı kullanır → jeton İKİ KEZ eklenmez.
    await ensureAdminBalance("admin-floor");
    expect(h.refund).toHaveBeenCalledTimes(1);
  });
});
