import { describe, expect, it } from "vitest";

import {
  extractMicOffers,
  micCardBlocks,
  micSearchQuery,
  micSearchUrl,
} from "./mic-supplier.server";

/**
 * FIXTURE'LAR GERÇEK SAYFADAN ALINDI (2026-10-16, canlı ölçüm).
 *
 * Kısaltıldı ama YAPI korundu: sınıf adları, `(MOQ)` ipucu, boşluk düzeni ve
 * bağlantı biçimi sayfadakiyle aynıdır. Amaç, kaynağın şeması değiştiğinde
 * testin KIRILMASI ve sessiz bozulmanın yakalanmasıdır.
 */

/** ŞEMA A — `<div class="list-node">` + `<h2 class="product-name">`. */
const SCHEMA_A_CARD = `
<div class="list-node " faw-module="Search_prod_list" >
 <div class="list-node-content cf"> <div class="prod-content"> <div class="prod-info">
  <h2 class="product-name" data-prod-tag="" title="OEM Custom 6000K Adjustable 5 Brightness LED Sewing Machine Lights Manufacture Smart Office Manicure Table Lamp for Nail Desk">
   <a referrerpolicy="unsafe-url" href="https://funderled.en.made-in-china.com/product/HgCYZuwjSfcv/China-OEM-Custom-6000K-Adjustable.html" target="_blank" ads-data="t:6"> OEM Custom 6000K Adjustable <strong>LED</strong> Lamp </a>
  </h2>
  <a class="product-detail" referrerpolicy="unsafe-url" href="https://funderled.en.made-in-china.com/product/HgCYZuwjSfcv/China-OEM-Custom-6000K-Adjustable.html" target="_blank" faw-module="Search_prod_list">
   <div class="product-property">
    <div class="info price-info"><strong class="price">US$<span>23.50</span>-<span>27.60</span></strong><span class="price_hint"> (FOB Price)</span></div>
    <div class="info">12 Pieces<span class="price_hint"> (MOQ)</span></div>
   </div>
  </a>
  <div class="company-name-wrapper"><div class="company-name-txt">
   <a href="https://funderled.en.made-in-china.com" rel="nofollow" target="_blank" class="compnay-name J-compnay-name">Shenzhen Founder Industrial Co., Ltd.</a>
  </div></div>
 </div></div>
</div>`;

/**
 * ŞEMA C — uyumlu yolun şeması: `<div class="product-name-wrap">` + başlık
 * `<a title=…>` İÇİNDE + `<span class="moq-text">(MOQ)` + `company-name`.
 */
const SCHEMA_C_CARD = `
<div class="product-name-wrap ">
 <h2 class="product-name" data-prod-tag="">
  <a title="Hot Sale Home 60 Min Timer 5L Auto off Visual Glass Healthy 1300W Digital Air Fryer" href="https://oushine-tech.en.made-in-china.com/product/GTaReMsjAKVo/China-Hot-Sale-Home-60-Min-Timer-5L-Digital-Air-Fryer.html" target="_blank" ads-data="t:1,a:1,p:2">Hot Sale Home 60 Min Timer 5L Auto off Visual Glass Healthy 1300W Digital <strong>Air</strong> <strong>Fryer</strong></a>
 </h2>
</div>
<div class="product-property">
 <div class="ellipsis attr-item J-faketitle price-new"><span class="attribute"><strong class="price">US$<span>24.00</span>-<span>27.00</span></strong></span></div>
 <div class="ellipsis attr-item J-faketitle moq-new"><span class="attribute"><span>1,000 Pieces</span> </span> <span class="moq-text">(MOQ)</span></div>
</div>
<div class="company-info">
 <div class="company-name ellipsis">
  <a href="https://oushine-tech.en.made-in-china.com" title="Foshan Oushine Technology Co., Ltd." target="_blank" ads-data="t:1,a:1,p:2" class="compnay-name"><span>Foshan Oushine Technology Co., Ltd.</span></a>
  <i class="ob-icon icon-right"></i>
 </div>
</div>`;

/** ŞEMA B — `<a class="prod-item">` + `<a class="prod-name">` + `prod-img`. */
const SCHEMA_B_CARD = `
<a class="prod-item J-focus-faw" rel="nofollow" href="//yuecheng2026.en.made-in-china.com/product/TuiUelIDsgWY/China-Smart-Dual-Function-Air-Fryer-Oven.html" target="_blank">
 <div class="prod-img-box"> <div class="prod-img-mask" title="Smart Dual-Function Stainless Steel Electric Air Fryer Oven"></div>
  <img class="prod-img" src="//image.made-in-china.com/2f1j00FuDjEinqrkob/Smart-Dual-Function-Air-Fryer-Oven.jpg" alt="Smart Dual-Function Stainless Steel Electric Air Fryer Oven">
 </div>
 <a class="prod-name fc1 J-focus-faw" title="Smart Dual-Function Stainless Steel Electric Air Fryer Oven" href="//yuecheng2026.en.made-in-china.com/product/TuiUelIDsgWY/China-Smart-Dual-Function-Air-Fryer-Oven.html" target="_blank"> Smart Dual-Function Stainless Steel Electric Air Fryer Oven </a>
 <a class="prod-price fc1 J-focus-faw" title="18.0" href="//yuecheng2026.en.made-in-china.com/product/TuiUelIDsgWY/China-Smart-Dual-Function-Air-Fryer-Oven.html" target="_blank"><span class="price"><strong class="price">US$<span>18.00</span></strong></span></a>
 <div class="company-name-wrapper"><div class="company-name-txt">
  <a href="https://yuecheng2026.en.made-in-china.com" target="_blank" class="compnay-name J-compnay-name">Guangdong Yuecheng Electric Appliance Co., Ltd.</a>
 </div></div>
</a>`;

/** MOQ YOK: kartta yalnız FOB aralığı var (ölçüldü: kartların %19'u böyle). */
const NO_MOQ_CARD = `
<div class="list-node "><div class="list-node-content cf"><div class="prod-content"><div class="prod-info">
 <h2 class="product-name" title="Sustainable Eco Friendly Corrugated Cat Toy Cat Scratcher Board with Indoor">
  <a href="https://rzcsmy.en.made-in-china.com/product/OrARagiZnWcd/China-Sustainable-Cat-Scratcher-Board.html">Sustainable Eco Friendly Corrugated Cat Toy Cat Scratcher Board with Indoor</a>
 </h2>
 <a class="product-detail" href="https://rzcsmy.en.made-in-china.com/product/OrARagiZnWcd/China-Sustainable-Cat-Scratcher-Board.html">
  <div class="product-property">
   <div class="info price-info"><strong class="price">US$<span>0.89</span>-<span>1.12</span></strong><span class="price_hint"> (FOB Price)</span></div>
  </div>
 </a>
 <div class="company-name-wrapper"><div class="company-name-txt"><a href="https://rzcsmy.en.made-in-china.com" class="compnay-name J-compnay-name">Ruizhou Trading Co., Ltd.</a></div></div>
</div></div></div>`;

/** MOQ YERİNE YILLIK KAPASİTE: `(MOQ)` ipucu YOK → MOQ okunmamalı. */
const ANNUAL_CAPACITY_CARD = `
<div class="list-node "><div class="list-node-content cf"><div class="prod-content"><div class="prod-info">
 <h2 class="product-name" title="Automatic Pet Water Fountain 2.5L Silent Dispenser">
  <a href="https://fk-pet.en.made-in-china.com/product/tpdYOrDAhFca/China-Automatic-Pet-Water-Fountain.html">Automatic Pet Water Fountain 2.5L Silent Dispenser</a>
 </h2>
 <a class="product-detail" href="https://fk-pet.en.made-in-china.com/product/tpdYOrDAhFca/China-Automatic-Pet-Water-Fountain.html">
  <div class="product-property">
   <div class="info price-info"><strong class="price">US$<span>29.69</span>-<span>35.69</span></strong><span class="price_hint"> (FOB Price)</span></div>
  </div>
  <div class="extra">50000pieces/Year</div>
 </a>
 <div class="company-name-wrapper"><div class="company-name-txt"><a href="https://fk-pet.en.made-in-china.com" class="compnay-name J-compnay-name">Hefei Fengkun Intelligent Technology Co., Ltd</a></div></div>
</div></div></div>`;

const page = (...cards: string[]) =>
  `<html><head><title>Air fryer, China air fryer catalog</title></head><body><div class="search-list"><div class="prod-list">${cards.join(
    "\n",
  )}</div></div></body></html>`;

describe("extractMicOffers — toptan kart ayrıştırma (ağ YOK)", () => {
  it("ŞEMA A kartından FOB bandı, MOQ ve tedarikçi adını okur", () => {
    const offers = extractMicOffers(page(SCHEMA_A_CARD));
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer.title).toBe(
      "OEM Custom 6000K Adjustable 5 Brightness LED Sewing Machine Lights Manufacture Smart Office Manicure Table Lamp for Nail Desk",
    );
    // FOB ARALIĞI iki uç olarak taşınır (tek sayıya indirgenmez).
    expect(offer.unitPriceUsd).toBe(23.5);
    expect(offer.unitPriceHighUsd).toBe(27.6);
    expect(offer.moqUnits).toBe(12);
    expect(offer.moqUnit).toBe("pieces");
    expect(offer.store).toBe("Shenzhen Founder Industrial Co., Ltd.");
    expect(offer.url).toBe(
      "https://funderled.en.made-in-china.com/product/HgCYZuwjSfcv/China-OEM-Custom-6000K-Adjustable.html",
    );
    // Ölçmediği alan UYDURULMAZ.
    expect(offer.shipFrom).toBe("");
  });

  it("ŞEMA C (uyumlu yol) kartını okur: başlık `<a title>`, MOQ `moq-text`, firma `company-name`", () => {
    const offers = extractMicOffers(page(SCHEMA_C_CARD));
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer.title).toBe(
      "Hot Sale Home 60 Min Timer 5L Auto off Visual Glass Healthy 1300W Digital Air Fryer",
    );
    expect(offer.unitPriceUsd).toBe(24);
    expect(offer.unitPriceHighUsd).toBe(27);
    expect(offer.moqUnits).toBe(1000);
    expect(offer.moqUnit).toBe("pieces");
    expect(offer.store).toBe("Foshan Oushine Technology Co., Ltd.");
  });

  it("aynı ürün iki kartta görünürse DAHA ÇOK YUVASI ÖLÇÜLMÜŞ kart kazanır", () => {
    // Önce ZAYIF kart (MOQ ve firma yok) gelir; "ilk gelen kazanır" kuralı
    // ölçülmüş MOQ/firmayı kaybettirirdi.
    const poorCard = SCHEMA_C_CARD.replace(
      /<div class="ellipsis attr-item J-faketitle moq-new">[\s\S]*?<\/div>/,
      "",
    ).replace(
      /<div class="company-info">[\s\S]*?<\/div>\n<\/div>/,
      '<div class="company-info"></div>',
    );
    const offers = extractMicOffers(page(poorCard, SCHEMA_C_CARD));
    expect(offers).toHaveLength(1);
    expect(offers[0].moqUnits).toBe(1000);
    expect(offers[0].store).toBe("Foshan Oushine Technology Co., Ltd.");
  });

  it("ŞEMA B kartını (prod-item/prod-name) da okur — eski sürüm burada 0 kart veriyordu", () => {
    const offers = extractMicOffers(page(SCHEMA_B_CARD));
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer.title).toBe("Smart Dual-Function Stainless Steel Electric Air Fryer Oven");
    expect(offer.unitPriceUsd).toBe(18);
    expect(offer.unitPriceHighUsd).toBeNull();
    // Tek fiyatlı kartta MOQ sayfada yoksa `null` kalır.
    expect(offer.moqUnits).toBeNull();
    expect(offer.store).toBe("Guangdong Yuecheng Electric Appliance Co., Ltd.");
    expect(offer.url.startsWith("https://yuecheng2026.en.made-in-china.com/product/")).toBe(true);
    expect(offer.imageUrl.startsWith("https://image.made-in-china.com/")).toBe(true);
  });

  it("sayfada asıl liste şeması seçilir, vitrin şeridi ayrı kart SAYILMAZ", () => {
    // Vitrin (`prod-item`) kartı listenin ARASINA girerse eski sürüm blokları
    // ortadan bölüyordu; şimdi ana şema (burada A) tek başına kullanılır.
    const offers = extractMicOffers(page(SCHEMA_A_CARD, SCHEMA_B_CARD, NO_MOQ_CARD));
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.title).join(" | ")).toContain("Sewing Machine");
    expect(offers.map((o) => o.title).join(" | ")).toContain("Corrugated Cat Toy");
    // Şema C varsa o DAHA ÖNDE gelir (uyumlu yolun şeması).
    const withSchemaC = extractMicOffers(page(SCHEMA_A_CARD, SCHEMA_C_CARD, NO_MOQ_CARD));
    expect(withSchemaC).toHaveLength(1);
    expect(withSchemaC[0].title).toContain("Hot Sale Home 60 Min Timer");
    expect(withSchemaC[0].moqUnits).toBe(1000);
  });

  it("MOQ ipucu yoksa `null` kalır — YILLIK KAPASİTE minimum sipariş sanılmaz", () => {
    const offers = extractMicOffers(page(ANNUAL_CAPACITY_CARD));
    expect(offers).toHaveLength(1);
    expect(offers[0].unitPriceUsd).toBe(29.69);
    // "50000pieces/Year" metni MOQ DEĞİLDİR: arkasında `(MOQ)` ipucu yok.
    expect(offers[0].moqUnits).toBeNull();
    expect(offers[0].moqUnit).toBe("");
  });

  it("aynı ürün iki kez gelirse TEK teklif olur (URL kimliği)", () => {
    const offers = extractMicOffers(page(SCHEMA_A_CARD, SCHEMA_A_CARD));
    expect(offers).toHaveLength(1);
  });

  it("ürün adı veya bağlantısı olmayan kart ATLANIR (yarım karttan teklif üretilmez)", () => {
    const broken = `<div class="list-node "><div class="product-property"><strong class="price">US$<span>9.99</span></strong></div></div>`;
    expect(extractMicOffers(page(broken))).toEqual([]);
  });

  it("boş/çok kısa gövdede ağ çağrısı olmadan boş liste döner", () => {
    expect(extractMicOffers("")).toEqual([]);
    expect(extractMicOffers("<html>kısa</html>")).toEqual([]);
  });

  it("bölme mantığı: ana şemanın kart sayısı kadar blok üretir", () => {
    // Liste şeması (A) varsa yalnız o bölünür; vitrin (`prod-item`) ayrı kart
    // sayılmaz — ölçülen sebep: blokları ortadan bölüyordu.
    expect(micCardBlocks(page(SCHEMA_A_CARD, SCHEMA_B_CARD))).toHaveLength(1);
    expect(micCardBlocks(page(SCHEMA_A_CARD, NO_MOQ_CARD))).toHaveLength(2);
    // Ana liste yoksa `prod-item` şemasına düşülür (eski sürümün tek yolu).
    expect(micCardBlocks(page(SCHEMA_B_CARD))).toHaveLength(1);
    expect(micCardBlocks(page("<html>kart yok</html>"))).toEqual([]);
  });
});

describe("micSearchUrl — kaynak adresi kilitli (robots.txt uyumu)", () => {
  it("robots-uyumlu yolu üretir (sorgu dizesi YOK)", () => {
    expect(micSearchUrl("air fryer")).toBe(
      "https://www.made-in-china.com/products-search/hot-china-products/air_fryer.html",
    );
    expect(micSearchUrl("led desk lamp")).toBe(
      "https://www.made-in-china.com/products-search/hot-china-products/led_desk_lamp.html",
    );
  });

  it("YASAKLI yollara geri dönmez (robots.txt: `/*.do?` ve `/*html?*` disallow)", () => {
    // Regresyon bekçisi: ilk sürüm `productdirectory.do?word=…` çağırıyordu ve
    // bu, sitenin kendi kuralına aykırıydı. Ölçülen robots satırları:
    //   Disallow: /*.do$   ·   Disallow: /*.do?   ·   Disallow: /*html?*
    for (const niche of ["air fryer", "led desk lamp", "masa lambası"]) {
      const url = micSearchUrl(niche);
      expect(url).not.toContain(".do");
      expect(url).not.toContain("?");
      expect(url.startsWith("https://www.made-in-china.com/products-search/")).toBe(true);
    }
  });

  it("Türkçe niş sözlükteki karşılığıyla aranır (kaynak İngilizce arama yapar)", () => {
    expect(micSearchQuery("masa lambası")).toBe("desk lamp");
    expect(micSearchUrl("masa lambası")).toContain("desk_lamp.html");
  });

  it("sözlükte olmayan Türkçe nişte de geçerli BİR adres üretir (patlamaz, boş sonuç fail-soft)", () => {
    const url = micSearchUrl("hava fritözü");
    expect(url).toContain("hava_fritozu.html");
    expect(url.startsWith("https://www.made-in-china.com/products-search/")).toBe(true);
  });

  it("boş nişte adres ÜRETİLMEZ (boş sorguyla ağa gidilmez)", () => {
    expect(micSearchUrl("")).toBe("");
    expect(micSearchUrl("   ")).toBe("");
  });
});
