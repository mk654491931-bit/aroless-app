// ============================================================================
// ALIEXPRESS TEDARİK AKIŞI TESTLERİ — ayrıştırıcı SAF, ağ YOK.
//
// Fixture, CANLI ölçümde kaydedilen gerçek `itemList.content` yapısının
// birebir kopyasıdır (2026-10-03, `kedi tırmalama tahtası`):
//   • `prices.salePrice.minPrice: 26.36`, `originalPrice.minPrice: 80.52`
//   • `trace.utLogMap.real_trade_count: "695"`
//   • `trace.pdpParams.pdp_cdi` URL-kodlanmış JSON içinde `shipFrom`
//   • `trace.custom.p4pExtendParam` İÇ İÇE JSON DİZESİ (kaçışlı)
// Yapı değişirse bu testler KIRMIZI olur — uydurma sayı üretmektense
// kaynağın susturulması daha kötüdür.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  extractSupplierOffers,
  supplierSearchQuery,
  supplierSearchUrl,
} from "./aliexpress-supplier.server";

/** Canlı sayfadan alınan kart yapısı (sadeleştirilmeden kopyalandı). */
const LIVE_CARD = {
  redirectedId: "3256809985321027",
  itemType: "productV3",
  productId: "3256809985321027",
  image: { imgUrl: "//ae-pic-a1.aliexpress-media.com/kf/Sfb6718ba57124f08aeab1417d53e81c8J.jpg" },
  title: { displayTitle: "JHK 44In Cat Tree Tall Multi-Cat Climbing Tower Sisal Scratching Post" },
  prices: {
    skuId: "12000055963170429",
    currencySymbol: "$",
    originalPrice: { priceType: "original_price", currencyCode: "USD", minPrice: 80.52 },
    salePrice: {
      discount: 67,
      minPriceDiscount: 67,
      priceType: "sale_price",
      currencyCode: "USD",
      minPrice: 26.36,
    },
  },
  evaluation: { starRating: 4.9 },
  trace: {
    pdpParams: {
      pdp_cdi:
        "%7B%22traceId%22%3A%222101%22%2C%22itemId%22%3A%223256809985321027%22%2C%22shipFrom%22%3A%22US%22%2C%22star%22%3A%224.9%22%7D",
    },
    custom: {
      p4pExtendParam:
        '{"company_name":"\\u6613\\u9060\\u9054\\u8cbf\\u6613\\u6709\\u9650\\u516c\\u53f8","store_name":"PETRAEL Local Store"}',
    },
    utLogMap: { real_trade_count: "695", formatted_price: "US $26.36" },
  },
};

/**
 * Canlı HTML'in yapısını taklit eden sarmalayıcı.
 *
 * ÖNEMLİ: gerçek sayfada gömülü metin DÜZ JSON'dur (tırnaklar kaçışsız);
 * yalnız `p4pExtendParam` değerinin İÇİ tırnakları kaçışlıdır. Bu yüzden
 * fixture da düz gömülür — ikinci kez `JSON.stringify`a sokmak, ayrıştırıcının
 * gerçekten gördüğü biçimi test etmez.
 */
function page(cards: unknown[]): string {
  return `<html><script>var boot=${JSON.stringify({ itemList: { content: cards } })};</script></html>`;
}

describe("extractSupplierOffers — canlı yapı", () => {
  it("ölçülen fiyat, indirim, satış adedi, puan, mağaza ve kargo çıkışını okur", () => {
    const offers = extractSupplierOffers(page([LIVE_CARD]));
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer!.unitPriceUsd).toBe(26.36);
    expect(offer!.listPriceUsd).toBe(80.52);
    expect(offer!.discountPct).toBe(67);
    expect(offer!.sold).toBe(695);
    expect(offer!.rating).toBe(4.9);
    expect(offer!.store).toBe("PETRAEL Local Store");
    expect(offer!.shipFrom).toBe("US");
    expect(offer!.url).toBe("https://www.aliexpress.com/item/3256809985321027.html");
    expect(offer!.imageUrl.startsWith("https://")).toBe(true);
  });

  it("birden çok kartın TAMAMINI okur (ölçülen hata: yalnız ilk kart)", () => {
    const offers = extractSupplierOffers(
      page([LIVE_CARD, { ...LIVE_CARD, productId: "3256812781567868" }]),
    );
    expect(offers).toHaveLength(2);
    expect(offers[1]!.url).toContain("3256812781567868");
  });

  it("satış adedi bilinmiyorsa -1 yerine null döner (uydurma 0 yok)", () => {
    const card = {
      ...LIVE_CARD,
      trace: { ...LIVE_CARD.trace, utLogMap: { real_trade_count: "-1" } },
    };
    const [offer] = extractSupplierOffers(page([card]));
    expect(offer!.sold).toBeNull();
  });

  it("USD olmayan fiyatı ÖLÇÜM saymaz", () => {
    const card = {
      ...LIVE_CARD,
      prices: {
        ...LIVE_CARD.prices,
        salePrice: { ...LIVE_CARD.prices.salePrice, currencyCode: "CNY" },
      },
    };
    const [offer] = extractSupplierOffers(page([card]));
    expect(offer!.unitPriceUsd).toBeNull();
  });

  it("ölçülebilir fiyat/başlık yoksa teklif ÜRETMEZ", () => {
    const card = { ...LIVE_CARD, productId: "42" };
    expect(extractSupplierOffers(page([card]))).toHaveLength(0);
  });

  it("sayfa yapısı değişirse boş döner, hata fırlatmaz", () => {
    expect(extractSupplierOffers("<html><body>hiçbir şey</body></html>")).toEqual([]);
    expect(extractSupplierOffers("")).toEqual([]);
  });
});

describe("supplierSearchQuery / supplierSearchUrl", () => {
  it("Türkçe nişi İngilizce ürün sorgusuna çevirir", () => {
    expect(supplierSearchQuery("kedi tırmalama tahtası")).toBe("cat-scratching-board");
  });

  it("ülke verilirse bölge parametresi ekler", () => {
    expect(supplierSearchUrl("cat scratching post", "DE")).toContain("region=DE");
    expect(supplierSearchUrl("cat scratching post")).toContain("glo=y");
  });

  it("boş nişte ağ adresi üretmez (gereksiz istek atılmaz)", () => {
    expect(supplierSearchUrl("")).toBe("");
  });
});
