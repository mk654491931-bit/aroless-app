/**
 * PRODUCT DISCOVERY — kalıcı iş deposunun İADE SÖZLEŞMESİ.
 *
 * Kapsam (tek, çok dar bir sözleşme):
 *   `createDiscoveryJob` satıra `credit_charged = true` yazmalıdır.
 *
 * Neden bu kadar dar: `mark_discovery_credit_refunded` RPC'si
 * `WHERE credit_charged = true AND credit_refunded = false` ile çalışır ve
 * yalnızca bu koşul sağlandığında `true` döner. `failAndRefund` de iadeyi
 * yalnızca o `true` gördüğünde yapar. Bayrak yazılmazsa hata yolunda
 * kullanıcı çalışmayan bir iş için kredisini sessizce kaybeder — para
 * kaybı hat hatasından daha kötü bir sonuç olduğu için regresyon testiyle
 * kilitlenmiştir.
 *
 * $0 çalışır: ağ ve veritabanı yoktur; `discovery-jobs.server` modülü
 * (Supabase erişimi gerektiren tek bağımlılık) vitest ile sahte nesne
 * üzerinden değiştirilir.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { insertMock, selectChain } = vi.hoisted(() => ({
  insertMock: vi.fn(async (_row: Record<string, unknown>) => ({ data: null, error: null })),
  selectChain: {
    select: () => selectChain,
    eq: () => selectChain,
    maybeSingle: async () => ({ data: null, error: null }),
  },
}));

vi.mock("./discovery-jobs.server", () => ({
  JOB_TABLE: "searches",
  jobStore: () => ({
    from: () => ({
      insert: insertMock,
      update: async () => ({ data: null, error: null }),
      select: () => selectChain.select(),
    }),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

const { createDiscoveryJob } = await import("./product-discovery-jobs.server");

const MIGRATION = "supabase/migrations/20260927000000_product_discovery_pipeline.sql";

describe("kredi iade sözleşmesi", () => {
  it("iş kaydı kredinin ALINDIĞINI işaretler (aksi halde iade hiç çalışmaz)", async () => {
    insertMock.mockClear();

    await createDiscoveryJob({
      runId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      input: { niche: "air fryer", country: "US", platform: "General", topN: 5 },
      chargedCredits: 5,
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["credit_charged"]).toBe(true);
    expect(row["charged_credits"]).toBe(5);
    expect(row["status"]).toBe("processing");
    expect(row["discovery_status"]).toBe("queued");
  });

  it("iade RPC'si `credit_charged = true` bekliyor — bayrak ve koşul eşleşmeli", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("mark_discovery_credit_refunded");
    expect(sql).toMatch(/credit_charged\s*=\s*true/);
    expect(sql).toMatch(/credit_refunded\s*=\s*false/);
  });
});
