// ADMIN KİMLİĞİ — rol yoksa e-posta tabanlı tanıma düşer.
//
// NEDEN: `handle_new_user` admini e-postayla tanıyıp 250 jeton veriyor; ama
// yalnız `user_roles` sorulduğunda rolü yazılmamış eski bir admin "Free"
// görünüyor ve 250 jetonluk kotayı alamıyordu.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: vi.fn(),
  profile: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => (table === "user_roles" ? h.role() : h.profile()),
      };
      return chain;
    },
    rpc: h.rpc,
  },
}));

import { isAdminAccount } from "./admin-identity.server";

beforeEach(() => {
  h.role.mockReset();
  h.profile.mockReset();
  h.rpc.mockReset();
});

describe("isAdminAccount", () => {
  it("rol varsa hızlı yoldan admin döner (e-posta sorgusu yok)", async () => {
    h.role.mockResolvedValue({ data: { role: "admin" }, error: null });
    await expect(isAdminAccount("user-1")).resolves.toBe(true);
    expect(h.profile).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rol yoksa designated e-posta tanımına düşer", async () => {
    h.role.mockResolvedValue({ data: null, error: null });
    h.profile.mockResolvedValue({ data: { email: "admin@aroless.com" }, error: null });
    h.rpc.mockResolvedValue({ data: true, error: null });
    await expect(isAdminAccount("user-2")).resolves.toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("is_designated_admin", { _email: "admin@aroless.com" });
  });

  it("rol yok + e-posta tanımı yok → admin DEĞİL (fail-closed)", async () => {
    h.role.mockResolvedValue({ data: null, error: null });
    h.profile.mockResolvedValue({ data: { email: "user@example.com" }, error: null });
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(isAdminAccount("user-3")).resolves.toBe(false);
  });

  it("e-posta okunamıyorsa admin saymaz", async () => {
    h.role.mockResolvedValue({ data: null, error: null });
    h.profile.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(isAdminAccount("user-4")).resolves.toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
