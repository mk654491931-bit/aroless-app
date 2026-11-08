import { afterEach, describe, expect, it, vi } from "vitest";

import { runSourceRescue, runSources } from "./product-discovery-sources.server";

/**
 * ANAHTARSIZ KAYNAK "ÇALIŞTI" SAYILMAZ.
 *
 * Ölçülen hata: eBay/BestBuy/YouTube gibi anahtarlı kaynaklar anahtarsızken
 * `[]` dönüyor ve `runSources` tarafından `ok:true, items:0` yazılıyordu.
 * Panel onları "Çalışan kaynak" olarak gösteriyordu; oysa kaynak hiç
 * çağrılmamıştı. Bu testler hem çağrı yapılmadığını hem de raporun
 * "anahtar tanımlı değil" dediğini kilitler.
 */
function clearEbayEnv() {
  for (const name of [
    "EBAY_OAUTH_TOKEN",
    "EBAY_BEARER_TOKEN",
    "EBAY_ACCESS_TOKEN",
    "EBAY_CLIENT_ID",
    "EBAY_APP_ID",
    "EBAY_CLIENT_SECRET",
    "EBAY_CERT_ID",
  ]) {
    vi.stubEnv(name, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runSources — anahtarsız kaynak", () => {
  it("eBay'i çağırmadan unavailable raporlar (0 satır = çalıştı değil)", async () => {
    clearEbayEnv();
    const scrape = vi.fn(async () => []);
    const { reports } = await runSources(
      "air fryer",
      [{ name: "ebay-browse", timeoutMs: 1_000, scrape }],
      { capMs: 1_000 },
    );

    expect(scrape).not.toHaveBeenCalled();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      name: "ebay-browse",
      ok: false,
      items: 0,
      ms: 0,
    });
    expect(reports[0].error).toContain("anahtar tanımlı değil");
    // Anahtar DEĞERİ değil, yalnız gereken ad(lar) raporda kalır.
    expect(reports[0].error).toContain("EBAY_CLIENT_ID");
  });

  it("anahtarı tanımlı kaynağı normal şekilde çağırır", async () => {
    vi.stubEnv("EBAY_OAUTH_TOKEN", "test-token");
    const scrape = vi.fn(async () => []);
    const { reports } = await runSources(
      "air fryer",
      [{ name: "ebay-browse", timeoutMs: 1_000, scrape }],
      { capMs: 1_000 },
    );

    expect(scrape).toHaveBeenCalledOnce();
    expect(reports[0].ok).toBe(true);
    expect(reports[0].error).toBe("");
  });

  it("anahtarsız kaynağı kurtarma turunda da çağırmaz", async () => {
    clearEbayEnv();
    const scrape = vi.fn(async () => []);
    const { reports } = await runSourceRescue("air fryer", "US", {
      capMs: 1_000,
      sources: [{ name: "ebay-browse", timeoutMs: 1_000, scrape }],
    });

    expect(scrape).not.toHaveBeenCalled();
    expect(reports[0].ok).toBe(false);
    expect(reports[0].error).toContain("anahtar tanımlı değil");
  });
});
