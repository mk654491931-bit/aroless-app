import { describe, expect, it } from "vitest";
import {
  aliExpressImage,
  dedupeRows,
  parseAliExpress,
  parseHepsiburada,
  parseN11,
  parseTry,
  parseUsd,
} from "./product-discovery-reader.server";

describe("tr-reader parse", () => {
  it("Türk fiyat biçimini doğru okur", () => {
    expect(parseTry("1.359,15")).toBe(1359.15);
    expect(parseTry("599")).toBe(599);
    expect(parseTry("2.905")).toBe(2905);
    expect(parseTry("")).toBeNull();
  });
  it("Hepsiburada satırından son TL fiyatını, puanı ve sayıyı alır", () => {
    const md = [
      '*   [![Image 14: Bella Maison Arcana Espresso Bardak](https://productimages.hepsiburada.net/s/777/222-222/1.jpg) 2](https://www.hepsiburada.com/bella-maison-arcana-p-HBCV00006TKDVY "Bella Maison Arcana Espresso Bardak")',
      "",
      "Ürün puanı 4.6, 694 değerlendirme 4,6(694)  Kampanya: Peşin fiyatına 3 x 83 TL   Sepete özel 312,49 TL%20 249,99 TL    ",
    ].join("\n");
    const [r] = parseHepsiburada(md);
    expect(r.priceTry).toBe(249.99);
    expect(r.rating).toBe(4.6);
    expect(r.ratingCount).toBe(694);
  });
  it("n11 kalın fiyatı güncel fiyat sayar", () => {
    const md =
      "[![Image 235: Stanley Quencher 1.18 L Pipetli Termos Bardak](https://n11scdn.akamaized.net/a1/200/x.jpg) ### Stanley Quencher 10 günün en düşük fiyatı! 1.489 TL **1.400 TL**](https://www.n11.com/urun/stanley-quencher-118?x=1)";
    const [r] = parseN11(md);
    expect(r.priceTry).toBe(1400);
  });
  it("aynı ürünü tek satıra indirir", () => {
    const a = {
      title: "Cam Bardak 6lı",
      url: "u1",
      imageUrl: "i",
      priceTry: 1,
      rating: null,
      ratingCount: null,
      site: "n11" as const,
    };
    expect(dedupeRows([a, { ...a, url: "u2" }])).toHaveLength(1);
  });
});

/**
 * ALIEXPRESS (GLOBAL) — "air fryer"/US nişinde 28 ham satırın tamamı
 * GitHub/Wikipedia/haber olduğu için ölçülen gerçek: global nişlerde
 * tek satılabilir ürün kaynağı burasıdır (bkz. dosya başlığı).
 */
describe("AliExpress okuyucu (global gerçek ürün satırı)", () => {
  // Sayfa biçimi ölçülmüş hâliyle kullanılır: tek satır = tek ürün.
  const line =
    "*   [![Image 50: 5.5L Digital Air Fryer Oven with Touchscreen](https://ae-pic-a1.aliexpress-media.com/kf/Sabc123.jpg_480x480q75.jpg_.avif) " +
    "![Image 51](https://ae-pic-a1.aliexpress-media.com/kf/H48x48.png) " +
    "### 5.5L Digital Air Fryer Oven with Touchscreen $84.99 $242.47 -64% 4.4 175 sold]" +
    "(https://www.aliexpress.us/item/3256806001234567.html?gatewayAdapt=glo2usa)";

  it("başlık, fiyat, puan, satış adedi, görsel ve ürün linkini ölçer", () => {
    const [r] = parseAliExpress(line);
    expect(r.title).toBe("5.5L Digital Air Fryer Oven with Touchscreen");
    expect(r.priceUsd).toBe(84.99);
    expect(r.rating).toBe(4.4);
    expect(r.sold).toBe(175);
    expect(r.url).toBe("https://www.aliexpress.us/item/3256806001234567.html");
    // Boyut eki 960×960 webp ile değiştirilir (ölçüldü: AVIF'i çözemeyen
    // tarayıcıda da görünür, tam çözünürlüklü dosyayı indirmez).
    expect(r.imageUrl).toBe("https://ae-pic-a1.aliexpress-media.com/kf/Sabc123.jpg_960x960q75.jpg");
  });

  it("fiyatı olmayan satırda fiyat UYDURMAZ (null kalır)", () => {
    const noPrice =
      "[![Image 3: Silicone Baking Mat Set Kitchen Tool](https://ae-pic-a1.aliexpress-media.com/kf/Sxyz.jpg_480x480q75.jpg_.avif) " +
      "### Silicone Baking Mat Set Kitchen Tool 2 sold]" +
      "(https://www.aliexpress.us/item/3256806009999999.html)";
    const [r] = parseAliExpress(noPrice);
    expect(r.priceUsd).toBeNull();
    // Puan da yazılmadı → uydurulmaz; yalnız ölçülen satış adedi taşınır.
    expect(r.rating).toBeNull();
    expect(r.sold).toBe(2);
  });

  it("görsel adresi AliExpress CDN değilse boş döner (rastgele görsel gösterilmez)", () => {
    expect(aliExpressImage("https://example.com/a_480x480q75.jpg_.avif")).toBe("");
    expect(aliExpressImage("https://ae-pic-a1.aliexpress-media.com/kf/A.jpg")).toBe(
      "https://ae-pic-a1.aliexpress-media.com/kf/A.jpg",
    );
  });

  it("USD biçimini binlik ayraçla doğru okur", () => {
    expect(parseUsd("$1,299.00")).toBe(1299);
    expect(parseUsd("$84.99")).toBe(84.99);
    expect(parseUsd("$")).toBeNull();
  });
});

import { applyHardFilter, MIN_COMMERCE_POOL } from "./product-discovery-filter.server";
describe("ticari kanıt kapısı", () => {
  const base = (name: string, extra: Record<string, unknown>) =>
    ({
      name,
      source: "scraped",
      sources: [],
      brand: "",
      seller: "",
      priceUsd: null,
      rating: null,
      ratingCount: null,
      inStock: null,
      url: "",
      notes: "",
      imageUrl: "",
      category: "",
      viewed90d: null,
      salesVolume: null,
      dataCompleteness: 1,
      preScore: 50,
      signals: {},
      ...extra,
    }) as never;
  it("yeterli gerçek ürün varsa fiyatsız/puansız sinyal satırlarını eler", () => {
    const real = Array.from({ length: MIN_COMMERCE_POOL }, (_, i) =>
      base(`Cam Bardak Model ${i}`, { priceUsd: 5 + i }),
    );
    const junk = base("someuser/github-repo", { preScore: 99 });
    const { survivors } = applyHardFilter([...real, junk]);
    expect(survivors.map((p: { name: string }) => p.name)).not.toContain("someuser/github-repo");
    expect(survivors).toHaveLength(MIN_COMMERCE_POOL);
  });
});
