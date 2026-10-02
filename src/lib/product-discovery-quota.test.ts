/**
 * SCRAPERAPI KREDİ KORUMASI — testler (ağ YOK).
 *
 * Kullanıcı talebi: ScraperAPI ÜCRETSİZ plan kullanılıyor, kredi "1 ay kadar
 * bitmesin". Buradaki testler o sözün TAŞINIR olduğunu kanıtlar:
 *   - anahtar yoksa ağ yok,
 *   - aynı niş 24 saat bedava,
 *   - kota dolduysa ağ yok,
 *   - boş sonuç önbelleğe YAZILMAZ (geçici hata nişi bir gün boş bırakmaz),
 *   - bir aramada en çok 2 pazar denenir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Ağ çağrısı sayacı: kredi harcaması = bu sayının artması. */
let proxiedFetches = 0;
let cachedValue: unknown = null;
let quotaAllows: boolean | null = true;
let cachedWrites = 0;

const marketplaceHtml = `<html><head>
<script type="application/ld+json">${JSON.stringify({
  "@type": "ItemList",
  itemListElement: [
    {
      item: {
        "@type": "Product",
        name: "Philips Hue Masa Lambası",
        aggregateRating: { ratingValue: "4.6", bestRating: "5", ratingCount: "1284" },
        offers: { price: "249.99", priceCurrency: "USD", availability: "https://schema.org/InStock" },
      },
    },
  ],
})}</script></head><body></body></html>`;

vi.mock("./product-image.server", () => ({
  scraperApiConfigured: () => configured,
  fetchThroughScraperApi: async () => {
    proxiedFetches += 1;
    return marketplaceHtml;
  },
}));

vi.mock("./ai-cache.server", () => ({
  cacheKey: async () => "tr-marketplace:test",
  cacheGet: async () => cachedValue,
  cacheSet: async () => {
    cachedWrites += 1;
    cachedValue = [{ title: "Philips Hue Masa Lambası" }];
  },
}));

vi.mock("./scraper-quota.server", () => ({
  allowScraperCredit: async () => quotaAllows,
}));

let configured = true;

beforeEach(() => {
  proxiedFetches = 0;
  cachedValue = null;
  quotaAllows = true;
  cachedWrites = 0;
  configured = true;
});

afterEach(() => {
  vi.resetModules();
});

async function scrape(niche = "LED masa lambası") {
  const { trMarketplaceSource } = await import("./product-discovery-sources.server");
  return trMarketplaceSource.scrape(niche);
}

describe("trMarketplaceSource — kredi koruması", () => {
  it("anahtar yoksa HİÇ ağ isteği yapmaz", async () => {
    configured = false;
    const rows = await scrape();
    expect(rows).toEqual([]);
    expect(proxiedFetches).toBe(0);
  });

  it("önbellekte varsa kredi harcamaz", async () => {
    cachedValue = [
      {
        title: "Philips Hue Masa Lambası",
        brand: "",
        seller: "Hepsiburada",
        priceUsd: 50.89,
        rating: 4.6,
        ratingCount: 1284,
        inStock: true,
        source: "tr-marketplace",
        url: "",
        imageUrl: "",
        notes: "",
      },
    ];

    const rows = await scrape();

    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(4.6);
    expect(proxiedFetches).toBe(0); // ← kredi harcanmadı
    expect(cachedWrites).toBe(0);
  });

  it("kota dolduysa kazım YAPMAZ (ağ yok)", async () => {
    quotaAllows = false;

    const rows = await scrape();

    expect(rows).toEqual([]);
    expect(proxiedFetches).toBe(0);
  });

  it("sayaç okunamazsa fail-open: yine de dener", async () => {
    quotaAllows = null; // RPC hata verdi

    const rows = await scrape();

    // Kota tüküğünde ürün göstermemek, kotanın birkaç hafta sonra tükeneceğinden
    // daha kötüdür. Bu yüzden belirsizlikte kazım yapılır.
    expect(rows.length).toBeGreaterThan(0);
    expect(proxiedFetches).toBeGreaterThan(0);
  });

  it("bir aramada EN ÇOK 2 kredi harcar (varyant × pazar çarpımı yok)", async () => {
    await scrape("LED masa lambası");
    // Sorgu varyantı ile pazar denemeleri çarpılırsa 2×2 = 4 olurdu.
    expect(proxiedFetches).toBeLessThanOrEqual(2);
  });

  it("bulunan sonucu önbelleğe yazar (tekrar aramada bedava)", async () => {
    const rows = await scrape();
    expect(rows.length).toBeGreaterThan(0);
    expect(cachedWrites).toBe(1);
  });it("BOŞ sonucu önbelleğe YAZMAZ (geçici hata nişi bir gün boş bırakmaz)", async () => {
    // Sayfa ürün döndürür ama hiçbiri nişle eşleşmez → sonuç boş.
    const rows = await scrape("qqqzzz bulunmayan niş qqqzzz");
    expect(rows).toEqual([]);
    // Önbelleğe yazılmadı: yarın yeniden denenebilsin.
    expect(cachedWrites).toBe(0);
  });

it("ilk pazar ürün döndürürse ikinciye GİTMEZ (tek kredi)", async () => {
    await scrape();
    // Türkçe sorgu önce denendiği için ilk pazar isabet ediyor: 1 kredi.
    expect(proxiedFetches).toBe(1);
  });
});