import { describe, expect, it } from "vitest";

import {
  PRODUCT_SOURCES,
  dealFeedSource,
  firstUsdAmount,
  parseDealFeed,
} from "./product-discovery-sources.server";
import { NON_PRODUCT_SOURCES } from "./product-discovery-query";

/**
 * ÜCRETSİZ KAYNAK: Slickdeals arama RSS'i (deal akışı).
 *
 * NEDEN EKLENDİ (ölçülen boşluk): hattın ürün satırlarında fiyat 21/21
 * doluydu ama satırlar yalnız LİSTE sayfalarından geliyordu; "indirime girdi
 * ve topluluk oy verdi" bilgisi — yani talep kanıtı — hiçbir kaynaktan
 * gelmiyordu. Slickdeals RSS'i anahtarsız, bot korumasız ve ÖLÇÜLDÜ
 * (2026-10-16): HTTP 200, ~69 KB, 25 öğe, ~600 ms; "robot vacuum" aramasında
 * Roborock/Lefant/Dreame gibi GERÇEK markalı ürünler döndü.
 *
 * ÖLÇÜLÜP REDDEDİLENLER (kaynağı ölçmeden eklemek "çalışıyor" iddiasıdır):
 *   • api.mercadolibre.com sites search → 403 (anahtar istiyor).
 *   • Target RedSky plp_search_v2 → 435 (PerimeterX bot duvarı).
 *   • dealnews.com/rss/search → 404 · bensbargains.com/rss.xml → 403.
 *   • Indiegogo genel proje API'si → 200 ama `query` yok sayılıyor (224 sabit
 *     proje, film/yardım ağırlıklı) → ürün nişlerinde ~0 eşleşme.
 *   • Stack Exchange (anahtarsız 300/gün) → 200 ama tüketici nişleri BAŞLIKTA
 *     yok; niş süzgecinden geçen satır ~0 → talep katkısı ölçülemedi.
 *   • Open Products/Beauty Facts arama → 200 ama `brands` çoğu kayıtta boş;
 *     marka boşluğunu kapatmıyor.
 */
const FIXTURE = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Slickdeals - 'air fryer' search</title>
    <item>
      <title>Dash 23L Air Fryer Toaster Oven with Aircrisp Technology, 6-Slice Capacity, Black - $54.98</title>
      <link>https://slickdeals.net/f/20166429-dash-air-fryer?utm_source=rss&amp;utm_medium=RSS2</link>
      <description>https://www.walmart.com/ip/DASH-2 [walmart.com] has it on sale for $69.99 - 21% off</description>
      <content:encoded><![CDATA[<div><img src="https://static.slickdealscdn.com/attachment/2/3/8/5/300x300/21986271.thumb" alt="Dash"></div><div>Thumb Score: +37 </div>]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[2-Piece GENICOOK Stainless Steel Food Storage Container Set $17.99 + Free Shipping]]></title>
      <link>https://slickdeals.net/f/20164950-genicook-container</link>
      <description><![CDATA[Genicook via Amazon [amazon.com] has it for $29.99 - 40% off]]></description>
      <content:encoded><![CDATA[<div><img src="https://static.slickdealscdn.com/attachment/2/0/3/1/300x300/21982158.thumb"></div>]]></content:encoded>
    </item>
    <item>
      <title>Ninja AF101 Air Fryer — bugün indirimde</title>
      <link>https://slickdeals.net/f/20160000-ninja-af101</link>
      <description>fiyat yakında açıklanacak</description>
    </item>
  </channel>
</rss>`;

describe("firstUsdAmount — ölçüm, tahmin değil", () => {
  it("ilk `$` tutarını sayıya çevirir, binlik ayıracı soyar", () => {
    expect(firstUsdAmount("Dash Air Fryer - $54.98")).toBe(54.98);
    expect(firstUsdAmount("Robot Vacuum $1,299.00 + Free Shipping")).toBe(1299);
    expect(firstUsdAmount("$180")).toBe(180);
  });

  it("tutar yoksa `null` döner (0 değil)", () => {
    expect(firstUsdAmount("fiyat belirtilmemiş")).toBeNull();
    expect(firstUsdAmount("")).toBeNull();
    expect(firstUsdAmount("$0")).toBeNull();
  });
});

describe("parseDealFeed — gerçek deal satırları", () => {
  it("fiyat + görsel + satıcı + topluluk oyunu ölçülen alanlara yazar", () => {
    const rows = parseDealFeed(FIXTURE, "air fryer");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source).toBe("deal-feed");
    expect(row.priceUsd).toBe(54.98);
    // Ürün adı fiyat kuyruğundan temizlenir.
    expect(row.title).toBe(
      "Dash 23L Air Fryer Toaster Oven with Aircrisp Technology, 6-Slice Capacity, Black",
    );
    expect(row.imageUrl).toBe(
      "https://static.slickdealscdn.com/attachment/2/3/8/5/300x300/21986271.thumb",
    );
    expect(row.seller).toBe("walmart.com");
    expect(row.notes).toContain("%21 indirim");
    expect(row.notes).toContain("topluluk oyu +37");
  });

  it("puan ve değerlendirme sayısı RSS'te yok → `null` kalır (0 YAZILMAZ)", () => {
    const row = parseDealFeed(FIXTURE, "air fryer")[0];
    expect(row.rating).toBeNull();
    expect(row.ratingCount).toBeNull();
    expect(row.inStock).toBeNull();
  });

  it("nişle eşleşmeyen ve fiyatı okunamayan öğe havuza GİRMEZ", () => {
    const titles = parseDealFeed(FIXTURE, "air fryer").map((r) => r.title);
    // Slickdeals aramasi gevşek eşleşiyor: "food storage container" elenmeli.
    expect(titles.some((t) => /Storage Container/i.test(t))).toBe(false);
    // Fiyatsız öğe (üçüncü) atlanır.
    expect(titles.some((t) => /Ninja AF101/.test(t))).toBe(false);
  });

  it("niş verilmezse hiçbir satır elenmez (süzgeç çağırana ait)", () => {
    expect(parseDealFeed(FIXTURE, "").length).toBeGreaterThanOrEqual(2);
  });

  it("bozuk/boş XML `[]` döner — hat düşmez", () => {
    expect(parseDealFeed("", "air fryer")).toEqual([]);
    expect(parseDealFeed("<rss><channel><item></item></channel></rss>", "air fryer")).toEqual([]);
  });
});

describe("dealFeedSource — sözleşme", () => {
  it("kaynak listesinde kayıtlı ve ÜRÜN kaynağı sayılıyor", () => {
    expect(PRODUCT_SOURCES.map((s) => s.name)).toContain("deal-feed");
    // Ürün satan bir kaynak aday havuzuna girebilir; talep-only listesinde
    // OLMAMALIDIR (aksi hâlde gerçek fiyatlı ürünler elenirdi).
    expect(NON_PRODUCT_SOURCES.has("deal-feed")).toBe(false);
  });

  it("boş nişte ağ çağrısı yapmaz ve hata fırlatmaz", async () => {
    await expect(dealFeedSource.scrape("   ")).resolves.toEqual([]);
  });

  it("ABD dışında 0 ağ çağrısı yapar (Slickdeals ABD pazarıdır)", async () => {
    await expect(dealFeedSource.scrapeForCountry?.("air fryer", "TR")).resolves.toEqual([]);
    await expect(dealFeedSource.scrapeForCountry?.("air fryer", "DE")).resolves.toEqual([]);
  });
});
