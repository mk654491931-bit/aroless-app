import { describe, expect, it } from "vitest";

import { missingKeyedSources, sourceKeyReadiness } from "./source-keys";

const ALL_EXCEPT_BESTBUY_YOUTUBE = {
  SERPER_API_KEY: "serper-secret",
  SEARCHAPI_KEY: "searchapi-secret",
  SERPAPI_KEY: "serpapi-secret",
  EBAY_CLIENT_ID: "ebay-id",
  EBAY_CLIENT_SECRET: "ebay-secret",
  TAVILY_API_KEY: "tavily-secret",
  SCRAPERAPI_KEY: "scraper-secret",
};

describe("ürün kaynağı anahtar envanteri", () => {
  it("BestBuy/YouTube dışındaki anahtarlar varsa yalnız o ikisini eksik gösterir", () => {
    const missing = missingKeyedSources(ALL_EXCEPT_BESTBUY_YOUTUBE);
    expect(missing.map((row) => row.source).sort()).toEqual([
      "bestbuy-api",
      "youtube-attention",
    ]);
  });

  it("Google Shopping sağlayıcılarını kota sırasıyla ve yalnız tanımlı olanları gösterir", () => {
    const google = sourceKeyReadiness({
      SERPER_API_KEY: "s",
      SERPAPI_KEY: "sp",
    }).find((row) => row.source === "google-shopping");

    expect(google?.configured).toBe(true);
    expect(google?.providers).toEqual(["serper", "serpapi"]);
  });

  it("eBay'de yarım kimlik kullanılabilir sayılmaz", () => {
    const noSecret = sourceKeyReadiness({ EBAY_CLIENT_ID: "id" }).find(
      (row) => row.source === "ebay-browse",
    );
    const noId = sourceKeyReadiness({ EBAY_CLIENT_SECRET: "secret" }).find(
      (row) => row.source === "ebay-browse",
    );
    const complete = sourceKeyReadiness({
      EBAY_CLIENT_ID: "id",
      EBAY_CLIENT_SECRET: "secret",
    }).find((row) => row.source === "ebay-browse");
    const bearer = sourceKeyReadiness({ EBAY_OAUTH_TOKEN: "token" }).find(
      (row) => row.source === "ebay-browse",
    );

    expect(noSecret?.configured).toBe(false);
    expect(noId?.configured).toBe(false);
    expect(complete?.configured).toBe(true);
    expect(bearer?.configured).toBe(true);
  });

  it("çıktı anahtar değerlerini sızdırmaz; yalnız ad ve var/yok taşır", () => {
    const rows = sourceKeyReadiness(ALL_EXCEPT_BESTBUY_YOUTUBE);
    const serialized = JSON.stringify(rows);

    expect(serialized).not.toContain("serper-secret");
    expect(serialized).not.toContain("searchapi-secret");
    expect(serialized).not.toContain("ebay-secret");
    expect(serialized).toContain("SERPER_API_KEY");
    expect(serialized).toContain('"configured":true');
  });
});
