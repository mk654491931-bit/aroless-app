/**
 * KULLANIM DEFTERİ + ADMIN GÜNLÜK 250 — SERVİS ANAHTARI OLMADAN.
 *
 * ÖLÇÜLEN HATA: ikisi de yalnız `supabaseAdmin` ile yazılıyordu. Servis
 * anahtarı tanımlı değilse:
 *   • jeton düşüyor ama deftere satır yazılamıyordu → "bu ay" sayaçları hep 0,
 *   • admin bakiyesi 250'ye tazelenemiyordu → admin 0 jetonla `NO_CREDITS`.
 * Artık kullanıcının kendi JWT'siyle `log_ai_usage` / `claim_admin_daily_credits`
 * RPC'lerine düşülüyor. Bu testler o yolu kilitler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  // Servis anahtarı YOK: Proxy'nin her özellik erişimi hata fırlatır.
  supabaseAdmin: new Proxy(
    {},
    {
      get() {
        throw new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY");
      },
    },
  ),
}));

const h = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  credits: 0,
}));

vi.mock("./admin-identity.server", () => ({ isAdminAccount: h.isAdmin }));

import { ensureAdminBalance, recordAiUsage } from "./plan-usage.server";

/** Kullanıcı istemcisi taklidi: kendi profil satırı + RPC kayıtları. */
function fakeUserDb() {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_admin_daily_credits") h.credits = 250;
    return { data: null, error: null };
  });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { credits: h.credits }, error: null }),
  };
  return { from: () => chain, rpc };
}

beforeEach(() => {
  h.isAdmin.mockReset();
  h.isAdmin.mockResolvedValue(true);
  h.credits = 0;
});

describe("recordAiUsage — servis anahtarı yokken kullanıcı RPC'si", () => {
  it("pozitif tüketimi log_ai_usage ile yazar", async () => {
    const db = fakeUserDb();
    await recordAiUsage({ userId: "u-log", feature: "tool:listing-seo", credits: 2 }, db as never);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("log_ai_usage", {
      _tool: "tool:listing-seo",
      _credits: 2,
    });
  });

  it("istemci yoksa çökmez, yalnız uyarır (iş fail-soft kalır)", async () => {
    await expect(
      recordAiUsage({ userId: "u-none", feature: "council", credits: 1 }),
    ).resolves.toBeUndefined();
  });

  it("0 jetonluk iş deftere yazılmaz (önbellekten dönen yanıt bedava)", async () => {
    const db = fakeUserDb();
    await recordAiUsage({ userId: "u-zero", feature: "council", credits: 0 }, db as never);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("ensureAdminBalance — servis anahtarı yokken günlük 250", () => {
  it("claim_admin_daily_credits ile bakiyeyi 250 yapar", async () => {
    const db = fakeUserDb();
    await expect(ensureAdminBalance("admin-claim", new Date(), db as never)).resolves.toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("claim_admin_daily_credits");
    expect(h.credits).toBe(250);
  });

  it("admin olmayan hesap için RPC hiç çağrılmaz", async () => {
    h.isAdmin.mockResolvedValue(false);
    const db = fakeUserDb();
    await expect(ensureAdminBalance("user-claim", new Date(), db as never)).resolves.toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("bakiye zaten 250 ise tazeleme çağrılmaz", async () => {
    h.credits = 250;
    const db = fakeUserDb();
    await expect(ensureAdminBalance("admin-rich-claim", new Date(), db as never)).resolves.toBe(
      true,
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
