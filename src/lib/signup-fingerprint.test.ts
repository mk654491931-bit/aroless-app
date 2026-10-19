// KAYIT / IP POLİTİKASI — "ilk kayıt + ilk IP'ye tek seferlik 2 ürün bulucu
// jetonu" kuralını sabitler.
//
// ÖLÇÜLEN HATA: mükerrer kayıtta yalnız `credits` ve `sim_credits` sıfırlanıyor,
// `finder_credits` dokunulmadan kalıyordu. Yani aynı cihaz/IP ile açılan ikinci
// hesap 2 hoş geldin jetonuyla ürün bulucuyu kullanmaya devam ediyordu.
import { describe, expect, it } from "vitest";

import { applyFingerprintPolicy } from "./signup.server";

type Result = { data?: unknown; error?: unknown };

type FakeAdmin = {
  calls: Array<{ table: string; op: string; payload?: unknown }>;
  rpc: (name: string, args?: unknown) => Promise<Result>;
  from: (table: string) => {
    select: (...args: unknown[]) => unknown;
    insert: (payload: unknown) => unknown;
    update: (payload: unknown) => unknown;
  };
};

/**
 * Supabase zincirini taklit eder. Sorgular ya `await` edilir ya da
 * `maybeSingle()`/`limit()` ile sonlanır; ikisi de aynı sonucu döner.
 */
function fakeAdmin(handler: (table: string, op: string) => Result | undefined): FakeAdmin {
  const calls: FakeAdmin["calls"] = [];
  const builder = (table: string, op: string, payload?: unknown) => {
    const result = handler(table, op) ?? { data: null, error: null };
    const chain = {
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => result,
      single: () => result,
      then: (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    if (payload !== undefined) calls.push({ table, op, payload });
    return chain;
  };
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ table: "rpc", op: name, payload: args });
      return { data: null, error: null };
    },
    from: (table) => ({
      select: (..._args: unknown[]) => builder(table, "select"),
      insert: (payload: unknown) => builder(table, "insert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
    }),
  };
}

const BASE = {
  visitorId: "visitor-1",
  userId: "user-1",
  email: "user@example.com",
  tier: "Free",
  ipHash: "ip-1",
  source: "email_signup",
};

function updates(admin: FakeAdmin) {
  return admin.calls.filter((c) => c.table === "profiles" && c.op === "update");
}

function audit(admin: FakeAdmin) {
  return admin.calls.find((c) => c.table === "free_credit_audit" && c.op === "insert")?.payload as
    { granted: boolean; reason: string; meta?: Record<string, unknown> } | undefined;
}

describe("applyFingerprintPolicy — tek seferlik 2 ürün bulucu jetonu", () => {
  it("ilk kayıt + ilk IP: kredi sıfırlanmaz, denetime first_signup yazılır", async () => {
    const admin = fakeAdmin((table, op) => {
      if (table === "device_fingerprints" && op === "select") return { data: [], error: null };
      if (table === "user_roles" && op === "select") return { data: null, error: null };
      if (table === "profiles" && op === "select")
        return { data: { credits: 0, finder_credits: 2, sim_credits: 1 }, error: null };
      if (table === "free_credit_audit" && op === "select") return { data: [], error: null };
      return undefined;
    });

    const blocked = await applyFingerprintPolicy(admin as never, BASE);

    expect(blocked).toBe(false);
    expect(updates(admin)).toHaveLength(0);
    expect(audit(admin)?.granted).toBe(true);
    expect(audit(admin)?.reason).toBe("first_signup");
    expect(audit(admin)?.meta).toMatchObject({ finder_credits: 2 });
  });

  it("aynı IP ile ikinci ücretsiz hesap: ÜÇ havuz da kapanır (finder dahil)", async () => {
    let deviceSelects = 0;
    const admin = fakeAdmin((table, op) => {
      if (table === "device_fingerprints" && op === "select") {
        deviceSelects += 1;
        // 1) cihaz: yok, 2) IP: daha önce kullanılmış
        return { data: deviceSelects === 1 ? [] : [{ id: "previous" }], error: null };
      }
      if (table === "user_roles" && op === "select") return { data: null, error: null };
      if (table === "profiles" && op === "select") return { data: null, error: null };
      if (table === "free_credit_audit" && op === "select") return { data: [], error: null };
      return undefined;
    });

    const blocked = await applyFingerprintPolicy(admin as never, BASE);

    expect(blocked).toBe(true);
    expect(updates(admin)).toHaveLength(1);
    expect(updates(admin)[0]?.payload).toEqual({
      credits: 0,
      finder_credits: 0,
      sim_credits: 0,
    });
    expect(audit(admin)?.granted).toBe(false);
    expect(audit(admin)?.reason).toBe("duplicate_ip");
  });

  it("admin muaftır: mükerrer IP adminin 250 jetonunu sıfırlamaz", async () => {
    const admin = fakeAdmin((table, op) => {
      if (table === "device_fingerprints" && op === "select")
        return { data: [{ id: "prev" }], error: null };
      if (table === "user_roles" && op === "select")
        return { data: { role: "admin" }, error: null };
      if (table === "profiles" && op === "select")
        return { data: { credits: 250, finder_credits: 0, sim_credits: 100 }, error: null };
      if (table === "free_credit_audit" && op === "select") return { data: [], error: null };
      return undefined;
    });

    const blocked = await applyFingerprintPolicy(admin as never, BASE);

    expect(blocked).toBe(false);
    expect(updates(admin)).toHaveLength(0);
    expect(audit(admin)?.reason).toBe("admin_exempt");
    expect(audit(admin)?.meta).toMatchObject({ admin: true });
  });
});
