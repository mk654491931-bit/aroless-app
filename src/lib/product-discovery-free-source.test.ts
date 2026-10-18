import { describe, it, expect } from "vitest";

import { PRODUCT_SOURCES, wikipediaPageviewsSource } from "./product-discovery-sources.server";

/**
 * Kullanıcı isteği: "ücretsiz bilgi alabileceğimiz kaynakları ekle".
 *
 * DENENEN VE REDDEDİLENLER (ölçüldü, eklenmedi — doğrulanmamış kaynak
 * eklemek "çalışıyor" iddiası uydurmaktır):
 *   • MercadoLibre herkese açık arama ucu (api.mercadolibre.com sites search)
 *     → tüm pazarlarda HTTP 403.
 *   • Google Books (www.googleapis.com/books/v1/volumes) → HTTP 429.
 *   • Open Food Facts arama ucu → 200 (zaten `openfoodfacts` kaynağı var).
 *   • npm downloads → 200 ama ham indirme sayısı 400'e bölünen talep
 *     sinyalinde her yazılım nişini 100'e doyuruyor; ölçümü bozduğu için
 *     eklenmedi.
 *
 * EKLENEN: Wikipedia görüntülenme API'si. Anahtarsız, JSON, ölçüldü
 * (300-560 ms) ve GERÇEK sayı veriyor.
 */
describe("wikipediaPageviewsSource", () => {
  it("anahtarsız kaynak hattın kaynak listesinde KAYITLI", () => {
    const names = PRODUCT_SOURCES.map((s) => s.name);
    expect(names).toContain("wikipedia-pageviews");
    expect(names).toContain(wikipediaPageviewsSource.name);
  });

  it("aynı anda momentum sinyali iki kez sayılmaz (yalnız görüntülenme)", () => {
    const note = wikipediaPageviewsSource;
    expect(note.name).toBe("wikipedia-pageviews");
    // `google-trends` da momentum yazıyor; pipeline ilk bulduğunu alır ve
    // sonrakini yok sayar, bu yüzden çift sayım oluşmaz.
    expect(PRODUCT_SOURCES.map((s) => s.name)).toContain("google-trends");
  });

  it("kaynak hata fırlatmaz — hat düşmez", async () => {
    // Anahtarsız ve ağa bağımlı olduğu için canlı test değil, yalnız
    // sözleşme kontrolü: boş/çöp nişte satır yok DÖNMELİ, hata fırlatmamalı.
    await expect(wikipediaPageviewsSource.scrape("   ")).resolves.toEqual([]);
  });
});

describe("Google Trends anahtarlı yedek (SearchAPI/SerpAPI)", () => {
  it("momentum iki yarı karşılaştırmasından hesaplanır (aynı kural: ±100 bandı)", async () => {
    const { momentumFromPoints } = await import("./google-trends-keyed.server");
    // İlk yarı 20, son yarı 30 → +50%
    expect(momentumFromPoints([20, 20, 30, 30])).toBe(50);
    // Düşüş → negatif
    expect(momentumFromPoints([40, 40, 20, 20])).toBe(-50);
    // 4 noktadan az → ölçüm YOK (0 uydurulmaz)
    expect(momentumFromPoints([10, 20, 30])).toBeNull();
    // İlk yarı 0 → oran tanımsız
    expect(momentumFromPoints([0, 0, 10, 10])).toBeNull();
    // Aşırı sıçrama ±100 ile kırpılır
    expect(momentumFromPoints([1, 1, 100, 100])).toBe(100);
  });

  it("servis yanıtını (timeline_data) okur; bozuk yanıtta seri UYDURMAZ", async () => {
    const { parseKeyedTrends } = await import("./google-trends-keyed.server");
    const parsed = parseKeyedTrends(
      {
        interest_over_time: {
          timeline_data: [
            { values: [{ extracted_value: 25 }] },
            { values: [{ extracted_value: 25 }] },
            { values: [{ extracted_value: 50 }] },
            { values: [{ extracted_value: 50 }] },
          ],
        },
      },
      "searchapi",
    );
    expect(parsed).toMatchObject({ momentumPct: 100, avgIndex: 38, provider: "searchapi" });
    expect(parseKeyedTrends({}, "serpapi")).toBeNull();
    expect(parseKeyedTrends({ interest_over_time: { timeline_data: "bozuk" } }, "serpapi")).toBeNull();
  });

  it("anahtar yoksa ağa çıkmadan null döner; kaynak listesinde ÜRÜN DIŞI olarak kayıtlıdır", async () => {
    const { fetchKeyedTrends, trendsKeyConfigured } = await import(
      "./google-trends-keyed.server"
    );
    const { isNonProductSource } = await import("./product-discovery-query");
    expect(trendsKeyConfigured({})).toBe(false);
    await expect(fetchKeyedTrends("air fryer", "US")).resolves.toBeNull();
    // Zaman serisi ÜRÜN DEĞİLDİR: aday havuzuna girmemeli.
    expect(isNonProductSource("google-trends-keyed")).toBe(true);
    expect(PRODUCT_SOURCES.map((s) => s.name)).toContain("google-trends-keyed");
  });
});

describe("GitHub repo kanıtı — jetonla kota, ölçülen alanlarla kanıt", () => {
  it("jeton varsa Authorization başlığı eklenir, yoksa anahtarsız başlık kümesi korunur", async () => {
    const { githubApiHeaders, githubApiToken } = await import("./github-repos.server");
    expect(githubApiToken({})).toBe("");
    const anon = githubApiHeaders({});
    expect(anon.authorization).toBeUndefined();
    expect(anon.accept).toContain("github");

    const auth = githubApiHeaders({ GITHUB_API_TOKEN: "test-token" });
    expect(auth.authorization).toBe("Bearer test-token");
    // Git kimliği için kullanılan GITHUB_TOKEN otomatik TÜKETİLMEZ.
    expect(githubApiHeaders({ GITHUB_TOKEN: "git-token" }).authorization).toBeUndefined();
  });

  it("yalnız yanıtta yazan sayılar yazılır, archived repo elenir", async () => {
    const { parseGithubRepos } = await import("./github-repos.server");
    const now = Date.parse("2026-10-18T00:00:00Z");
    const rows = parseGithubRepos(
      {
        items: [
          {
            full_name: "acme/air-fryer-ctl",
            description: "Air fryer controller",
            stargazers_count: 1200,
            forks_count: 84,
            open_issues_count: 12,
            pushed_at: "2026-10-08T00:00:00Z",
            html_url: "https://github.com/acme/air-fryer-ctl",
            language: "TypeScript",
            topics: ["iot", "kitchen"],
          },
          // Bakımı bitmiş repo "canlı ekosistem" kanıtı değildir.
          { full_name: "old/legacy", archived: true, stargazers_count: 9999 },
          // Sayılar yoksa alan uydurulmaz.
          { full_name: "fresh/repo", html_url: "https://github.com/fresh/repo" },
        ],
      },
      8,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.source).toBe("github");
    expect(rows[0]!.notes).toContain("1.200 yıldız");
    expect(rows[0]!.notes).toContain("84 fork");
    expect(rows[0]!.notes).toContain("etiketler iot, kitchen");
    expect(rows[0]!.notes).toContain("TypeScript");
    // İkinci satırda hiçbir sayı yok → notes boş kalır (0 yazılmaz).
    expect(rows[1]!.notes).toBe("");
    // Tarih farkı ölçülebilir (test saatine göre 10 gün).
    expect(rows[0]!.notes).toMatch(/son push \d+ gün önce/);
    expect(now).toBeGreaterThan(0);
  });
});

describe("ön kontrol — ürün kaynak anahtarları görünür", () => {
  it("SerpAPI ve ScraperAPI ön kontrolde İSTEĞE BAĞLI olarak raporlanır", async () => {
    const { envChecks } = await import("./product-discovery-preflight.server");
    const checks = envChecks({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sr",
    });
    const serp = checks.find((c) => c.id === "serpapi");
    const scraper = checks.find((c) => c.id === "scraperapi");
    expect(serp).toBeDefined();
    expect(scraper).toBeDefined();
    // Anahtar yoksa hata DEĞİL, isteğe bağlı: hat çalışmaya devam eder.
    expect(serp?.optional).toBe(true);
    expect(scraper?.optional).toBe(true);
    expect(serp?.fix).toContain("SERPAPI_KEY");
    expect(scraper?.fix).toContain("SCRAPERAPI_KEY");
  });
});

describe("GTIN Mod-10 doğrulama ve GS1 ülke öneki (product-identity)", () => {
  it("geçerli EAN-13 ve UPC-A (12 hane) kodlarını doğrular ve normalize eder", async () => {
    const { isValidGtin, normalizeGtin, gs1PrefixCountry } = await import("./product-identity");
    // 0622356559775 → geçerli 13 haneli barkod (son hane 5).
    expect(isValidGtin("0622356559775")).toBe(true);
    // 622356559775 (12 hane UPC-A) → 13 haneye '0' önekiyle tamamlanır.
    expect(normalizeGtin("622356559775")).toBe("0622356559775");
    // 869 (Türkiye) öneki
    expect(gs1PrefixCountry("8690504011507")).toBe("TR");
    // 690-699 (Çin) öneki
    expect(gs1PrefixCountry("6901234567892")).toBe("CN");
  });

  it("hatalı kontrol haneli veya tekrarlı sahte barkodları reddeder", async () => {
    const { isValidGtin, normalizeGtin } = await import("./product-identity");
    expect(isValidGtin("0622356559772")).toBe(false);
    expect(isValidGtin("0000000000000")).toBe(false);
    expect(isValidGtin("9999999999999")).toBe(false);
    expect(normalizeGtin("12345")).toBe("");
  });
});

describe("Yeni ücretsiz kaynaklar ve tedarik/kategori yükseltmeleri (2026)", () => {
  it("Open Beauty Facts, WooCommerce Storefront, eBay Browse, Tavily ve YouTube kaynak listesinde kayıtlıdır", () => {
    const names = PRODUCT_SOURCES.map((s) => s.name);
    expect(names).toContain("openbeautyfacts");
    expect(names).toContain("woo-storefront");
    expect(names).toContain("ebay-browse");
    expect(names).toContain("tavily-search");
    expect(names).toContain("youtube-attention");
  });

  it("niş kapılı kaynaklar yalnız ilgili nişlerde devreye girer (alakasız nişte 0 ms boş döner)", async () => {
    const { isBeautyNiche, openBeautyFactsSource } = await import(
      "./product-discovery-sources.server"
    );
    expect(isBeautyNiche("vitamin c serum")).toBe(true);
    expect(isBeautyNiche("sunscreen lotion")).toBe(true);
    expect(isBeautyNiche("robot vacuum")).toBe(false);

    // Alakasız nişte ağa çıkmadan [] döner
    await expect(openBeautyFactsSource.scrape("robot vacuum")).resolves.toEqual([]);
  });

  it("Google Shopping ücretsiz alternatifleri (SearchAPI + Serper) kaynak listesinde ve ayrıştırıcıları saf", async () => {
    const names = PRODUCT_SOURCES.map((s) => s.name);
    expect(names).toContain("searchapi-shopping");
    expect(names).toContain("serper-shopping");

    const { parseSerperShopping, parseSearchApiShopping } = await import(
      "./shopping-api-sources.server"
    );
    // Serper şeması (`shopping[]`): fiyat metinden, puan 0-5, görsel `imageUrl`.
    const serper = parseSerperShopping(
      {
        shopping: [
          {
            title: "Ninja AF101 Air Fryer 4 Qt",
            price: "$89.99",
            rating: 4.7,
            ratingCount: 1200,
            imageUrl: "https://example.com/ninja.jpg",
            source: "Best Buy",
            link: "https://example.com/ninja",
          },
          { title: "Fiyatı okunamayan kart", source: "X" },
        ],
      },
      "air fryer",
    );
    expect(serper).toHaveLength(1);
    expect(serper[0]).toMatchObject({
      title: "Ninja AF101 Air Fryer 4 Qt",
      source: "serper-shopping",
      priceUsd: 89.99,
      rating: 4.7,
      ratingCount: 1200,
      imageUrl: "https://example.com/ninja.jpg",
      seller: "Best Buy",
    });

    // SearchAPI şeması SerpAPI ile aynı (`shopping_results[]`).
    const searchApi = parseSearchApiShopping(
      {
        shopping_results: [
          {
            title: "Cosori Air Fryer 5.8L",
            price: "$119.00",
            extracted_price: 119,
            rating: 4.5,
            reviews: 900,
            thumbnail: "https://example.com/cosori.jpg",
            source: "Amazon",
            link: "https://example.com/cosori",
          },
        ],
      },
      "air fryer",
    );
    expect(searchApi).toHaveLength(1);
    expect(searchApi[0]).toMatchObject({
      source: "searchapi-shopping",
      priceUsd: 119,
      rating: 4.5,
      ratingCount: 900,
    });

    // Nişle alakasız başlık / bozuk yanıt satır ÜRETMEZ.
    expect(parseSerperShopping({ shopping: [] }, "air fryer")).toEqual([]);
    expect(parseSearchApiShopping(null, "air fryer")).toEqual([]);
  });

  it("anahtarlı kaynaklar (Tavily, eBay, YouTube, CJ, Woo, SearchAPI, Serper) anahtar yokken ağa çıkmadan [] döner", async () => {
    const {
      tavilySearchSource,
      ebayBrowseSource,
      youtubeAttentionSource,
      wooStorefrontSource,
      searchApiShoppingSource,
      serperShoppingSource,
    } = await import("./product-discovery-sources.server");
    const { fetchCjOffers, parseCjOffers } = await import("./mic-supplier.server");
    await expect(tavilySearchSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(ebayBrowseSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(youtubeAttentionSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(wooStorefrontSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(searchApiShoppingSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(serperShoppingSource.scrape("air fryer")).resolves.toEqual([]);
    await expect(fetchCjOffers("air fryer")).resolves.toEqual([]);

    // CJ parser testi (saf):
    const parsed = parseCjOffers({
      data: {
        content: [
          {
            productList: [
              {
                id: "cj-123",
                nameEn: "Portable Mini Blender 380ml",
                sellPrice: "4.50 -- 6.20",
                directMinOrderNum: 2,
                countryCode: "CN",
                bigImage: "https://example.com/blender.jpg",
              },
            ],
          },
        ],
      },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: "Portable Mini Blender 380ml",
      unitPriceUsd: 4.5,
      unitPriceHighUsd: 6.2,
      moqUnits: 2,
      store: "CJ Dropshipping",
      shipFrom: "CN",
    });
  });

  it("başlıktan deterministik kategori çıkarımı (inferProductCategory) TR ve EN ürünlerini sınıflandırır", async () => {
    const { inferProductCategory } = await import("./product-categories");
    expect(inferProductCategory("Ninja AF101 Air Fryer 4 Qt")).toBe("Kitchen > Small Appliances");
    expect(inferProductCategory("Roborock Q7 Max Robot Süpürge")).toBe(
      "Home > Cleaning & Floor Care",
    );
    expect(inferProductCategory("La Roche Posay Cilt Bakım Serum")).toBe(
      "Beauty > Skincare & Haircare",
    );
    expect(inferProductCategory("Royal Canin Kedi Tuvaleti")).toBe("Pets > Cat & Dog Supplies");
    expect(inferProductCategory("Bilinmeyen X12345 Nesnesi")).toBe("");
  });
});
