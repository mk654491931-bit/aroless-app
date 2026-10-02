/**
 * PAZARYERİ JSON-LD AYRIŞTIRICI — saf testler (ağ YOK, anahtar YOK).
 *
 * Kapsam: ayrıştırıcının (a) gerçek markup'tan gerçek sayı çıkardığını ve
 * (b) SAYI OLMAYAN YERDE SAYI UYDURMADIGINI kanıtlar. Pazaryeri markup'ı
 * sürekli değiştiği için testin ikinci yarısı daha önemlidir: alan eksikse
 * `null` dönmeli, 0 ya da tahmin üretmemelidir.
 */
import { describe, expect, it } from "vitest";

import { extractJsonLdBlocks, parseMarketplaceHtml } from "./marketplace-jsonld";

/** Gerçek bir ItemList JSON-LD'nin HTML'e gömülmüş hâli. */
function pageWithLd(ld: unknown): string {
  return `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    </head><body><div class="product-card">görünmez</div></body></html>`;
}

const itemList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      item: {
        "@type": "Product",
        name: "Philips Hue Masa Lambası",
        image: ["https://cdn.example.com/hue-1.jpg"],
        brand: { "@type": "Brand", name: "Philips" },
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.6",
          bestRating: "5",
          ratingCount: "1284",
        },
        offers: {
          "@type": "Offer",
          price: "2499.90",
          priceCurrency: "TRY",
          availability: "https://schema.org/InStock",
          seller: { "@type": "Organization", name: "Hepsiburada" },
        },
      },
    },
    {
      "@type": "ListItem",
      position: 2,
      item: {
        "@type": "Product",
        name: "Xiaomi Mi Desk Lamp",
        image: "https://cdn.example.com/mi.jpg",
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.2", ratingCount: "310" },
        offers: {
          "@type": "Offer",
          price: "799,00 TL",
          priceCurrency: "TRY",
          availability: "https://schema.org/OutOfStock",
        },
      },
    },
  ],
};

describe("parseMarketplaceHtml", () => {
  it("ItemList içinden ad, fiyat, puan ve yorum sayısını çıkarır", () => {
    const rows = parseMarketplaceHtml(pageWithLd(itemList));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Philips Hue Masa Lambası",
      brand: "Philips",
      priceLocal: 2499.9,
      currency: "TRY",
      rating: 4.6,
      ratingCount: 1284,
      inStock: true,
      seller: "Hepsiburada",
    });
  });

  it("görseli hem dizi hem tek metin olarak kabul eder", () => {
    const rows = parseMarketplaceHtml(pageWithLd(itemList));
    expect(rows[0].imageUrl).toBe("https://cdn.example.com/hue-1.jpg");
    expect(rows[1].imageUrl).toBe("https://cdn.example.com/mi.jpg");
  });

  it("stok durumunu OutOfStock'tan okur", () => {
    const rows = parseMarketplaceHtml(pageWithLd(itemList));
    expect(rows[1].inStock).toBe(false);
  });

  it("DÖNÜŞÜM YAPMAZ — fiyatı kendi para biriminde döner", () => {
    const rows = parseMarketplaceHtml(pageWithLd(itemList));
    // 2499.90 TL'nin USD karşılığı hesaplanmamıştır; parser saf kalmalıdır.
    expect(rows[0].priceLocal).toBe(2499.9);
    expect(rows[0].currency).toBe("TRY");
  });

  it("10'lu ölçekteki puanı 5'lik ölçeğe böler", () => {
    const html = pageWithLd({
      "@type": "Product",
      name: "Ölçekli Ürün",
      aggregateRating: { ratingValue: "9.2", bestRating: "10", ratingCount: "88" },
      offers: { price: "100", priceCurrency: "TRY" },
    });

    const rows = parseMarketplaceHtml(html);

    // 9.2/10 → 4.6/5. Aksi halde kart "9.2 yıldız" derdi.
    expect(rows[0].rating).toBe(4.6);
    expect(rows[0].ratingCount).toBe(88);
  });

  it("olmayan alan için SAYI UYDURMAZ", () => {
    const html = pageWithLd({
      "@type": "Product",
      name: "Puanızız Ürün",
      offers: { price: "349.00", priceCurrency: "TRY" },
    });

    const rows = parseMarketplaceHtml(html);

    expect(rows[0].rating).toBeNull();
    expect(rows[0].ratingCount).toBeNull();
    expect(rows[0].brand).toBe("");
    expect(rows[0].seller).toBe("");
    expect(rows[0].inStock).toBeNull();
  });

  it("fiyatı da puanı da olmayan kartı kanıt saymaz", () => {
    const html = pageWithLd({
      "@type": "Product",
      name: "Hicbiri Olmayan Ürün",
    });

    expect(parseMarketplaceHtml(html)).toEqual([]);
  });

  it("JSON-LD bloğu bozuksa satır üretmez ve PATLAMAZ", () => {
    const html = `<script type="application/ld+json">{bozuk json,</script>`;
    expect(parseMarketplaceHtml(html)).toEqual([]);
  });

  it("JSON-LD hiç yoksa boş döner (markup değişmiş olabilir)", () => {
    const html = `<html><body><div class="prc-price">₺1.999</div></body></html>`;
    expect(parseMarketplaceHtml(html)).toEqual([]);
  });

  it("aynı ürünü iki kez saymaz", () => {
    const product = {
      "@type": "Product",
      name: "Tekrar Ürün",
      offers: { price: "10", priceCurrency: "TRY" },
    };
    const rows = parseMarketplaceHtml(pageWithLd({ "@type": "ItemList", itemListElement: [{ item: product }, { item: product }] }));
    expect(rows).toHaveLength(1);
  });

  it("limiti uygular (ücretsiz kota koruması)", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      item: {
        "@type": "Product",
        name: `Ürün ${i}`,
        offers: { price: `${i + 1}`, priceCurrency: "TRY" },
      },
    }));
    expect(parseMarketplaceHtml(pageWithLd({ "@type": "ItemList", itemListElement: items }), 12)).toHaveLength(12);
  });

  it("boş ve geçersiz girdide istisna fırlatmaz", () => {
    expect(parseMarketplaceHtml("")).toEqual([]);
    expect(parseMarketplaceHtml("   ")).toEqual([]);
  });
});

describe("extractJsonLdBlocks", () => {
  it("tüm ld+json bloklarını döner", () => {
    const html = `
      <script type="application/ld+json">{"a":1}</script>
      <script>ignored()</script>
      <script type='application/ld+json'>{"b":2}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual(['{"a":1}', '{"b":2}']);
  });
});