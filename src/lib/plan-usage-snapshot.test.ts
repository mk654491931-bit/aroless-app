/**
 * PAKET ÖZETİ — "bilinmiyor" ekranının kök nedeni.
 *
 * ÖLÇÜLEN HATA: `planUsageSnapshot` profil ve sayaçları yalnız `supabaseAdmin`
 * (servis anahtarı) ile okuyordu. Servis anahtarı tanımlı değilse bu istemci
 * ilk erişimde hata fırlatıyor; sonuç:
 *   • sayaç okunamadı → `measured:false` → ekranda "bilinmiyor",
 *   • paket okunamadı → tier "Free" → ÜCRETLİ kullanıcı Free limitleri (2/3/0/1)
 *     görüyordu; yani jeton sayıları aboneliğe göre yazılmıyordu.
 *
 * Bu testler, istekteki kullanıcı istemcisi verildiğinde paketin ve sayaçların
 * servis anahtarı OLMADAN da doğru okunduğunu sabitler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  // Servis anahtarı yok: Proxy'nin taklidinde her özellik erişimi hata fırlatır.
  supabaseAdmin: new Proxy(
    {},
    {
      get() {
        throw new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY");
      },
    },
  ),
}));

vi.mock("./admin-identity.server", () => ({
  isAdminAccount: vi.fn(async () => false),
}));

import { PLAN_BY_ID } from "./plans";
import { planUsageSnapshot } from "./plan-usage.server";

type Row = { tool: string; credits: number };

/** İstemci taklidi: `profiles` tek satır, `credit_usage_log` aylık satırlar. */
function fakeDb(args: { tier?: string | null; rows?: Row[] }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    limit: async () => ({
      data: args.rows ?? [],
      error: null,
    }),
    maybeSingle: async () => ({
      data: args.tier === undefined ? null : { subscription_tier: args.tier },
      error: null,
    }),
  };
  return {
    from: () => chain,
    rpc: async () => ({ data: null, error: null }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("planUsageSnapshot — kullanıcı istemcisiyle (servis anahtarı yok)", () => {
  it("paket limitleri ABONELİKTEN gelir ve sayaç ölçülür", async () => {
    const db = fakeDb({
      tier: "Pro",
      rows: [
        { tool: "tool:listing-seo", credits: 3 },
        { tool: "council", credits: 1 },
      ],
    });
    const snap = await planUsageSnapshot("snapshot-pro", new Date(), db as never);

    expect(snap.tier).toBe("Pro");
    expect(snap.level).toBe(2);
    expect(snap.measured).toBe(true);
    const limits = Object.fromEntries(snap.rows.map((r) => [r.kind, r.limit]));
    expect(limits).toEqual({
      credits: PLAN_BY_ID.Pro.credits,
      toolRuns: PLAN_BY_ID.Pro.toolRuns,
      councilRuns: PLAN_BY_ID.Pro.councilRuns,
      radarScans: PLAN_BY_ID.Pro.radarScans,
    });
    const used = Object.fromEntries(snap.rows.map((r) => [r.kind, r.used]));
    expect(used.toolRuns).toBe(3);
    expect(used.councilRuns).toBe(1);
  });

  it("okuma istemcisi hiç yoksa çökmez; 'ölçülemedi' der (uydurmaz)", async () => {
    const snap = await planUsageSnapshot("snapshot-none", new Date());
    expect(snap.measured).toBe(false);
    expect(snap.tier).toBe("Free");
  });

  it("ücretsiz planda bile limitler plandan yazılır", async () => {
    const snap = await planUsageSnapshot(
      "snapshot-free",
      new Date(),
      fakeDb({ tier: "Free" }) as never,
    );
    expect(snap.measured).toBe(true);
    expect(snap.rows.map((r) => r.limit)).toEqual([2, 3, 0, 1]);
  });
});
