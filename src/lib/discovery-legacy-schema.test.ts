/**
 * ESKİ ŞEMA REGRESYON TESTİ — `column "locked_until" ... does not exist`.
 *
 * Kapsam (tek, çok dar bir sözleşme):
 *   Güvenilir iş kuyruğu migration'ı (`20260914010000_reliable_search_jobs.sql`)
 *   veritabanında UYGULANMAMIŞKEN iş sonlandırma yolları hata fırlatmamalı.
 *
 * Neden: `locked_until` kolonu `complete_search_job` / `fail_search_job` /
 * `claim_search_job` RPC'leriyle **aynı** migration'dan geliyor. "RPC yok"
 * demek "kolon da yok" demek; ama fallback yalnız RPC'ye bakıp kolonu
 * yazmayı denerse Postgres 42703 döner ve `markJobCompleted` bu hatayı
 * `throw` eder — kullanıcı kredisini ödemiş, ürünü hiç gelmeyen bir işe
 * sahip olur.
 *
 * $0 çalışır: gerçek ağ/veritabanı yok; Supabase istemcisi sahte nesne
 * üzerinden değiştirilir ve migration'ın UYGULANMAMIŞ olduğu hata kodları
 * (42883 fonksiyon yok / 42703 kolon yok) birebir canlandırılır.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Patch = Record<string, unknown>;

const RPC_MISSING = {
  code: "42883",
  message: "function public.complete_search_job does not exist",
};
const COLUMN_MISSING = {
  code: "42703",
  message: 'column "locked_until" of relation "searches" does not exist',
};

// Gönderilen tüm patch'ler; "önce lease'li dene, olmadıysa lease'siz dene"
// sözleşmesini bununla doğruluyoruz.
const sentPatches: Patch[] = [];

/** Migration UYGULANMAMIŞ bir veritabanını taklit eden sahte istemci. */
function legacySchemaStore() {
  return {
    // RPC'ler hiç yok.
    rpc: async () => ({ data: null, error: RPC_MISSING }),
    from: () => ({
      update: (patch: Patch) => {
        sentPatches.push(patch);
        return {
          eq: async () => ({
            data: [],
            // `locked_until` yazan her deneme 42703 alır (kolon yok).
            error: "locked_until" in patch ? COLUMN_MISSING : null,
          }),
        };
      },
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [{ id: "job" }], error: null }),
        }),
      }),
    }),
  };
}

describe("locked_until kolonu yokken iş sonlandırma", () => {
  beforeEach(() => {
    sentPatches.length = 0;
    // `jobStore()` bu değişkenleri şart koşuyor; sahte istemci kullanıldığı
    // için değerlerin gerçek olması gerekmiyor.
    process.env.SUPABASE_URL = "https://legacy-schema.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    vi.resetModules();
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => legacySchemaStore() }));
  });

  it("markJobCompleted RPC yok + kolon yoksa yine de tamamlar", async () => {
    const mod = await import("./discovery-jobs.server");

    await expect(
      mod.markJobCompleted("job-1", { products: [] } as never),
    ).resolves.toBeUndefined();

    // İlk deneme lease'li, kolon yoksa ikinci deneme lease'siz olmalı.
    expect(sentPatches.length).toBeGreaterThanOrEqual(2);
    expect(sentPatches[0]).toHaveProperty("locked_until", null);
    const last = sentPatches[sentPatches.length - 1];
    expect(last).not.toHaveProperty("locked_until");
    expect(last).toMatchObject({ status: "completed" });
  });

  it("markJobFailed RPC yok + kolon yoksa yine de failed yazar", async () => {
    const mod = await import("./discovery-jobs.server");

    await expect(mod.markJobFailed("job-2", "patladı")).resolves.toBeUndefined();

    const last = sentPatches[sentPatches.length - 1];
    expect(last).not.toHaveProperty("locked_until");
    expect(last).toMatchObject({ status: "failed", error: "patladı" });
  });

  it("setJobMessageId kolon yoksa sessizce geçer (hat düşmez)", async () => {
    const mod = await import("./discovery-jobs.server");

    await expect(mod.setJobMessageId("job-3", "msg-123")).resolves.toBeUndefined();
  });
});