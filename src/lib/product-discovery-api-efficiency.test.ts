import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  delete process.env.TAVILY_API_KEY;
  delete process.env.EBAY_OAUTH_TOKEN;
  delete process.env.SERPER_API_KEY;
  delete process.env.SEARCHAPI_KEY;
  delete process.env.SERPAPI_KEY;
});

describe("API verimliliği — anahtarlı kaynak önbelleği", () => {
  it("Tavily aynı nişte ikinci aramada ağa çıkmaz", async () => {
    process.env.TAVILY_API_KEY = "test-tavily";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Ninja Air Fryer AF101 4 Qt Review",
            url: "https://example.test/ninja-air-fryer",
            content: "Now $89.99 · rated 4.7 out of 5 · 1,200 reviews",
          },
        ],
      }),
    });

    const { tavilySearchSource } = await import("./product-discovery-sources.server");
    const first = await tavilySearchSource.scrape("air fryer cache test");
    const second = await tavilySearchSource.scrape("air fryer cache test");

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Google Shopping üç anahtar varken yalnız Serper'e gider, tekrar aramada hiç ağa çıkmaz", async () => {
    process.env.SERPER_API_KEY = "test-serper";
    process.env.SEARCHAPI_KEY = "test-searchapi";
    process.env.SERPAPI_KEY = "test-serpapi";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        shopping: Array.from({ length: 20 }, (_, i) => ({
          title: `Air Fryer Google Cache Test Model ${i}`,
          price: "$99.99",
          rating: 4.5,
          ratingCount: 100 + i,
          imageUrl: `https://example.test/air-fryer-${i}.jpg`,
          source: "Example Store",
          link: `https://example.test/air-fryer-${i}`,
        })),
      }),
    }));

    const { googleShoppingSource } = await import("./product-discovery-sources.server");
    const first = await googleShoppingSource.scrape("air fryer google cache test");
    const second = await googleShoppingSource.scrape("air fryer google cache test");

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("google.serper.dev/shopping");
  });

  it("eBay aynı nişte ikinci aramada ağa çıkmaz", async () => {
    process.env.EBAY_OAUTH_TOKEN = "test-ebay";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 1,
        itemSummaries: [
          {
            title: "Ninja Air Fryer AF101 4 Qt",
            itemWebUrl: "https://www.ebay.com/itm/123",
            price: { value: "89.99", currency: "USD" },
            image: { imageUrl: "https://example.test/ninja.jpg" },
            seller: { username: "seller" },
            categories: [{ categoryName: "Home & Garden" }],
          },
        ],
      }),
    });

    const { ebayBrowseSource } = await import("./product-discovery-sources.server");
    const first = await ebayBrowseSource.scrape("air fryer ebay cache test");
    const second = await ebayBrowseSource.scrape("air fryer ebay cache test");

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
