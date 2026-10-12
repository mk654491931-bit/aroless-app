/**
 * KAYDEDİLMİŞ PAZARYERİ FIXTURE'LARI — ağ olmadan sözleşme kilidi.
 *
 * NEDEN VAR: önceki doğrulamalar canlı ağ çağrılarıyla yapılıyordu; paketteki
 * canlı test dosyaları (adları `.live.test.ts` ile biter) varsayılan olarak
 * ATLANIYOR, yani
 * "vitrin gerçek ürün + gerçek fotoğrafla dolar" sözleşmesi hiçbir zaman
 * otomatik koşmuyordu. Bu dosya o boşluğu kapatır: metinler 2026-10-12'de
 * Jina Reader üzerinden KAYDEDİLEN gerçek sayfa çıktılarından alınmıştır
 * (özellikle işaretlenen tek durum hariç — `lowest90d`, kaydedilmiş satırın
 * yapısına göre yazılmış minimal bir örnektir).
 *
 * Testler $0 ve ağsızdır: yalnız saf parse fonksiyonları + kapı çalışır.
 */
import { describe, expect, it } from "vitest";

import {
  aliExpressImage,
  n11Image,
  neweggImage,
  parseAliExpress,
  parseN11,
  parseNewegg,
} from "./product-discovery-reader.server";
import { buildShortlist } from "./product-discovery-shortlist.server";
import { shouldRequireImages } from "./product-discovery-pipeline.server";

/** Newegg arama sayfasından kaydedilen kart (satır satır, kırpılmadan). */
const NEWEGG_CARD = [
  "[![Image 24: Rosewill 4-in-1 Portable Glass Air Fryer, 4.7QT Transparent Glass Cooking Pot with Storage Lid & Tongs, Compact Smart for Deep Roast, Recrisp, Keep Warm – Navy Blue](https://c1.neweggimages.com/productimage/nb300/96-268-231-08.jpg) Quick View](https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231)",
  "",
  "[](https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231)[](https://www.newegg.com/rosewill-rhaf-25001dg/p/N82E16896268230)",
  "",
  '[(2)](https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231#IsFeedbackTab "Rating + 3")[![Image 25: Rosewill](https://c1.neweggimages.com/brandimage/Brand2177.gif)](https://www.newegg.com/Rosewill/BrandStore/ID-2177)',
  "",
  '[Rosewill 4-in-1 Portable Glass Air Fryer, 4.7QT Transparent Glass Cooking Pot with Storage Lid & Tongs, Compact Smart for Deep Roast, Recrisp, Keep Warm – Navy Blue](https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231 "View Details")',
  "+ $15 off w/ promo code GTWF457, limited offer",
  "",
  "Save: $30.00 (30%)",
  "",
  "$**69**.99",
  "",
  "$99.99",
  "",
  "[More options from $69.99 - $99.99](https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231?Item=N82E16896268231#moreBuyOptions)",
  "",
  "Free Shipping",
].join("\n");

/** n11 arama sayfasından kaydedilen kartlar (browser motoru biçimi). */
const N11_ROWS = [
  "[![Image 99: SQUARE](https://n11scdn.akamaized.net/a1/org/26/01/15/87/38/33/54/52/78/53/31/35/1457228049396482625.png) ÜCRETSİZ KARGO ![Image 100: Paşabahçe Gaia 18 Parça Bardak Takımı 950082](https://n11scdn.akamaized.net/a1/320_480/04/04/89/05/IMG-3714649058660008423.jpg) ![Image 101: Paşabahçe Gaia 18 Parça Bardak Takımı 950082](https://n11scdn.akamaized.net/a1/320_480/08/68/23/07/IMG-6458526660463295518.jpg) ![Image 102: Paşabahçe Gaia 18 Parça Bardak Takımı 950082](https://n11scdn.akamaized.net/a1/320_480/06/21/40/91/IMG-2937527424761267334.jpg) ## Paşabahçe Gaia 18 Parça Bardak Takımı 950082 (17) SÜPER 1.199 TL SEPETTE ### 649 TL ![Image 103: add-icon](https://n11scdn.akamaized.net/custom/upload/54/54/5441093088481329623.svg)](https://www.n11.com/urun/pasabahce-gaia-18-parca-bardak-takimi-950082-84716428)",
  "[![Image 119: Kartal Figürlü 3 D Kabartmalı Paslanmaz Çelik Kupa Bardak Alk6334](https://n11scdn.akamaized.net/a1/216/14/56/99/41/IMG-1573559093117585819.jpg) Ücretsiz Kargo LovestaHome Kartal Figürlü 3 D Kabartmalı Paslanmaz Çelik Kupa Bardak Alk6334 _(0)_ 1.134 TL](https://www.n11.com/urun/kartal-figurlu-3-d-kabartmali-paslanmaz-celik-kupa-bardak-alk6334-140698459?magaza=lovestahome&adBidding=true)",
].join("\n");

/** AliExpress arama sayfasından kaydedilen satır (kırpılmadan). */
const ALI_ROW =
  "[![Image 1: 8-in-1 Air Fryer 6 Qt, Premium Ceramic Coating,Precise Heating for Even Results, Air Fry, Roast, Bake, Broil,Frozen, Proof,120V](https://ae-pic-a1.aliexpress-media.com/kf/S76891a5ea0a24b3abca529cf2575a3ebW.jpg_480x480q75.jpg_.avif) ![Image 2](https://ae-pic-a1.aliexpress-media.com/kf/Scd7f7a07781e4818bcbede1eb6b720d6K/702x72.png) ### 8-in-1 Air Fryer 6 Qt, Premium Ceramic Coating,Precise Heating for Even Results, Air Fry, Roast, Bake, Broil,Frozen, Proof,120V $41.42 $104.52 -60% ![Image 5](https://ae-pic-a1.aliexpress-media.com/kf/S5efe9a37755e44cfa878e2e714900709h/48x48.png)4.9 144 sold](https://www.aliexpress.us/item/3256812032026.html?gatewayAdapt=glo2usa)";

/** `lowest90d` — kaydedilmiş satırların yapısına göre yazılmış minimal örnek. */
const ALI_LOWEST_ROW =
  "[![Image 7: Large Capacity Smart Air Fryer Multifunctional Touch Screen](https://ae-pic-a1.aliexpress-media.com/kf/Sabc987.jpg_480x480q75.jpg_.avif) ### Large Capacity Smart Air Fryer Multifunctional Touch Screen $73.16 4.6 40 sold Lowest price in 90 days See preview Similar items](https://www.aliexpress.us/item/3256812466801.html)";

describe("kaydedilmiş Newegg kartı", () => {
  it("fiyatı PROMOSYONDAN değil kalın güncel fiyattan okur", () => {
    const [r] = parseNewegg(NEWEGG_CARD);
    // Kartta sırasıyla `$15 off`, `Save: $30.00`, `$**69**.99`, `$99.99` var.
    expect(r.priceUsd).toBe(69.99);
    expect(r.title).toContain("Rosewill 4-in-1 Portable Glass Air Fryer");
    expect(r.url).toBe("https://www.newegg.com/rosewill-rhaf-25001nb/p/N82E16896268231");
    expect(r.ratingCount).toBe(2);
    expect(r.brand).toBe("Rosewill");
    expect(r.imageUrl).toBe("https://c1.neweggimages.com/productimage/nb640/96-268-231-08.jpg");
  });

  it("puan DEĞERİ listede yoksa null kalır (uydurulmaz)", () => {
    const [r] = parseNewegg(NEWEGG_CARD);
    expect(r.rating).toBeNull();
  });
});

describe("kaydedilmiş n11 kartları (browser motoru)", () => {
  const rows = parseN11(N11_ROWS);

  it("rozet görselini ürün sanmaz; güncel fiyatı ve değerlendirme sayısını ölçer", () => {
    const gaia = rows.find((r) => r.title.includes("Paşabahçe Gaia"));
    expect(gaia).toBeDefined();
    expect(gaia!.priceTry).toBe(649); // liste fiyatı 1.199 değil
    expect(gaia!.ratingCount).toBe(17);
    expect(gaia!.imageUrl).toContain("/a1/320_480/");
    expect(gaia!.url).toBe(
      "https://www.n11.com/urun/pasabahce-gaia-18-parca-bardak-takimi-950082-84716428",
    );
  });

  it("mağaza adını ölçer ve `_(0)_` sayısını 0 olarak taşır", () => {
    const kupa = rows.find((r) => r.title.includes("Kartal Figürlü"));
    expect(kupa!.priceTry).toBe(1134);
    expect(kupa!.ratingCount).toBe(0);
    expect(kupa!.seller).toBe("lovestahome");
    expect(kupa!.imageUrl).toBe(
      "https://n11scdn.akamaized.net/a1/320_480/14/56/99/41/IMG-1573559093117585819.jpg",
    );
  });
});

describe("kaydedilmiş AliExpress satırı", () => {
  it("fiyat, puan ve satış adedini ölçer", () => {
    const [r] = parseAliExpress(ALI_ROW);
    expect(r.priceUsd).toBe(41.42);
    expect(r.rating).toBe(4.9);
    expect(r.sold).toBe(144);
    expect(r.lowest90d).toBe(false);
  });

  it("'son 90 günün en düşük fiyatı' bayrağını yalnız yazıyorsa açar", () => {
    const [r] = parseAliExpress(ALI_LOWEST_ROW);
    expect(r.lowest90d).toBe(true);
    expect(r.priceUsd).toBe(73.16);
  });
});

describe("görsel boyutu yükseltme (ölçülmüş CDN davranışı)", () => {
  it("Newegg nb300 → nb640", () => {
    expect(neweggImage("https://c1.neweggimages.com/productimage/nb300/96-268-231-08.jpg")).toBe(
      "https://c1.neweggimages.com/productimage/nb640/96-268-231-08.jpg",
    );
  });
  it("n11 boyut yolunu 320_480'e sabitler", () => {
    expect(n11Image("https://n11scdn.akamaized.net/a1/216/14/56/99/41/X.jpg")).toBe(
      "https://n11scdn.akamaized.net/a1/320_480/14/56/99/41/X.jpg",
    );
  });
  it("AliExpress CDN dışı adres kabul edilmez", () => {
    expect(aliExpressImage("https://example.com/a.jpg_480x480q75.jpg_.avif")).toBe("");
  });
});

/**
 * VİTRİN SÖZLEŞMESİ — kaydedilmiş fixture'lardan üretilen havuz + fotoğrafsız
 * sinyal satırları aynı kapıdan geçer: kapı açıkken hiçbir fotoğrafsız satır
 * listeye GİRMEZ (kullanıcı şikâyeti: "ürünlerin fotoğrafları çıkmıyor").
 */
describe("fixture havuzu → kapı → kısa liste", () => {
  const row = (title: string, imageUrl: string, source: string, priceUsd: number | null) => ({
    title,
    brand: "",
    seller: source,
    priceUsd,
    rating: null,
    ratingCount: null,
    inStock: true,
    source,
    url: `https://example.test/${encodeURIComponent(title)}`,
    imageUrl,
    notes: source,
  });

  const imaged = [
    row(
      "Rosewill 4-in-1 Portable Glass Air Fryer 4.7QT",
      neweggImage("https://c1.neweggimages.com/productimage/nb300/96-268-231-08.jpg"),
      "newegg-reader",
      69.99,
    ),
    row(
      "Rosewill 8-in-1 Portable Glass Air Fryer 5.5QT",
      neweggImage("https://c1.neweggimages.com/productimage/nb300/96-268-231-09.jpg"),
      "newegg-reader",
      89.99,
    ),
    row(
      "Air Fryer 8L 2800W Oil Free Electric",
      "https://ae-pic-a1.aliexpress-media.com/kf/A.jpg_960x960q75.jpg",
      "aliexpress-reader",
      79.4,
    ),
    row(
      "Air Fryer 6 Qt Premium Ceramic Coating",
      "https://ae-pic-a1.aliexpress-media.com/kf/B.jpg_960x960q75.jpg",
      "aliexpress-reader",
      41.42,
    ),
    row(
      "KitCook Large Air Fryer 1500W 7QT",
      "https://ae-pic-a1.aliexpress-media.com/kf/C.jpg_960x960q75.jpg",
      "aliexpress-reader",
      44.56,
    ),
    row(
      "Air Fryer 10QT DualZone 1700W",
      "https://ae-pic-a1.aliexpress-media.com/kf/D.jpg_960x960q75.jpg",
      "aliexpress-reader",
      84.99,
    ),
  ];
  // Fotoğrafsız satırlar: GitHub deposu / Wikipedia maddesi / haber snippet'i.
  const junk = [
    row("chef/air-fryer-recipes (GitHub)", "", "github", null),
    row("Air fryer - Wikipedia", "", "wikipedia", null),
    row("The best air fryers of 2026, tested", "", "google-news", null),
  ];

  it("kapı açılır ve listeye yalnız ölçülmüş fotoğraflı satırlar girer", () => {
    expect(shouldRequireImages([...imaged, ...junk], 15)).toBe(true);
    const built = buildShortlist([...imaged, ...junk], {
      niche: "air fryer",
      limit: 15,
      requireImage: true,
    });
    expect(built.survivors.length).toBeGreaterThan(0);
    for (const s of built.survivors) expect(s.imageUrl).not.toBe("");
    expect(built.survivors.map((s) => s.name)).not.toContain("chef/air-fryer-recipes (GitHub)");
  });

  it("havuzda fotoğraflı ürün YOKSA kapı kapanır (liste boşaltılmaz)", () => {
    expect(shouldRequireImages(junk, 15)).toBe(false);
    const built = buildShortlist(junk, {
      niche: "air fryer",
      limit: 15,
      requireImage: false,
    });
    // Kapı kapalıyken davranış eskisi gibi: ürün kaybedilmez.
    expect(built.survivors.length).toBeGreaterThan(0);
  });
});
