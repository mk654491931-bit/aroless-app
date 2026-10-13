/**
 * YEREL PAZARYERİ AYRIŞTIRICI TESTLERİ — Otto (DE), Flipkart (IN), Rakuten (JP).
 *
 * NEDEN: bu üç site 2026-10-12 canlı ölçümünde GERÇEK ürün listesi döndürdü
 * (65.330 / 91.000 / 62.432 karakter); global hedefte ürün satırı üreten tek yeni
 * kaynaklar bunlar. Aşağıdaki fixture'lar o ölçümden KIRPILMIŞ gerçek Markdown'dır:
 * testler ağa çıkmaz, ama şekil canlı çıktının aynısıdır.
 */
import { describe, expect, it } from "vitest";

import {
  parseFlipkart,
  parseOtto,
  parseRakuten,
} from "./product-discovery-reader.server";

/** Otto arama sayfası — gerçek kart bloğu (niş: termos, 2026-10-12). */
const OTTO = [
  "Sortieren nach",
  "1.721 Produkte",
  "[](https://www.otto.de/p/vinsun-isolierflasche-edelstahl-trinkflasche-1l-strohhalm-2-deckel-thermoflasche-S08AV0LJ/)",
  "",
  "![Image 6: Vinsun Isolierflasche Edelstahl Trinkflasche 750ml Strohhalm - 2 Deckel Thermoflasche, BPA frei, doppelwandig, auslaufsicher, bruchsicher](https://i.otto.de/i/otto/75101034-a1f3-5905-9d3b-9d3e7999f7c4?$responsive_ft2$)",
  "",
  "Sehr beliebt",
  "",
  "Vinsun Isolierflasche Edelstahl Trinkflasche 750ml Strohhalm - 2 Deckel Thermoflasche",
  "",
  "(24)",
  "",
  "ab 27,99 €",
  "",
  "bis Fr., 16. Okt. bei dir",
  "",
  "[](https://www.otto.de/p/minicloss-thermobecher-360ml-S00GK02D/)",
  "",
  "![Image 7: Minicloss Thermobecher 360ml Thermo Kaffeebecher to go](https://i.otto.de/i/otto/9999-abcd?$responsive_ft2$)",
  "",
  "(5)",
  "",
  "12,50 €",
].join("\n");

/** Flipkart arama sayfası — gerçek kart (niş: thermos, 2026-10-12). */
const FLIPKART = [
  'Showing 1 – 40 of 19,906 results for "flasks"',
  "[![Image 4: cello Lifestyle Stainless Steel Insulated 500 ml Stainless Steel Flask](https://rukminim2.flixcart.com/image/612/612/xif0q/bottle/e/e/x/500-lifestyle-stainless-steel-insulated-flask-500-ml-silver-1-s-enriched-transparent-original-imahft4kkujsaf7a.png?q=70)](https://www.flipkart.com/cello-lifestyle-stainless-steel-insulated-500-ml-flask/p/itmd7cfe73d848b1?pid=BOTFYYMZBSHFYGNY&lid=LSTBOTFYYMZBSHFYGNYKPQZZM&marketplace=FLIPKART)",
  "",
  "4.2![Image 5](blob:http://localhost/21c53851e70e411cc53b436871dc9f91)",
  "",
  "(59,871)",
  "",
  "![Image 6](https://static-assets-web.flixcart.com/fk-p-linchpin-web/fk-cp-zion/img/fa_9e47c1.png)",
  "",
  "[₹579 ₹809 28% off](https://www.flipkart.com/cello-lifestyle-stainless-steel-insulated-500-ml-flask/p/itmd7cfe73d848b1?pid=BOTFYYMZBSHFYGNY)",
  "",
  "Buy 5 items, save extra 10%",
].join("\n");

/** Rakuten arama sayfası — gerçek kart (niş: termos, 2026-10-12). */
const RAKUTEN = [
  "[![Image 13: TERMOS サーモス 保冷炭酸飲料ボトル 0.53L RBAA-500 国内正規品 保冷専用](https://tshop.r10s.jp/yoshikip2/cabinet/ir20260508/rbaa-500_1.jpg?fitin=275:275)](https://item.rakuten.co.jp/yoshikip2/rbaa-500/)",
  "",
  "もっと見る",
  "",
  "お気に入りに登録",
  "",
  "新しく追加するには、5,000件未満に整理していただく必要があります。[お気に入り一覧へ](https://my.bookmark.rakuten.co.jp/)",
  "",
  '## [TERMOS サーモス 保冷炭酸飲料ボトル 0.53L RBAA-500 国内正規品 保冷専用](https://item.rakuten.co.jp/yoshikip2/rbaa-500/ "TERMOS サーモス 保冷炭酸飲料ボトル 0.53L RBAA-500 国内正規品 保冷専用")',
  "",
  "4,180 円",
  "",
  "送料無料",
  "",
  "38 ポイント(1 倍)",
  "",
  "[![Image 14: San Kyu Shop](https://r.r10s.jp/com/assets/resources/39shop.svg)](https://www.rakuten.co.jp/yoshikip2/)",
].join("\n");

describe("parseOtto", () => {
  it("başlık (görsel alt metni), € fiyatı ve değerlendirme sayısını ölçer", () => {
    const rows = parseOtto(OTTO);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Vinsun Isolierflasche Edelstahl Trinkflasche 750ml Strohhalm - 2 Deckel Thermoflasche, BPA frei, doppelwandig, auslaufsicher, bruchsicher",
      url: "https://www.otto.de/p/vinsun-isolierflasche-edelstahl-trinkflasche-1l-strohhalm-2-deckel-thermoflasche-S08AV0LJ/",
      price: 27.99,
      currency: "EUR",
      ratingCount: 24,
      site: "Otto",
    });
    // Puan DEĞERİ listede sayı olarak yok: uydurulmaz.
    expect(rows[0]?.rating).toBeNull();
    // Görsel gerçek ürün görselidir (i.otto.de), boyut parametresi korunur.
    expect(rows[0]?.imageUrl).toContain("i.otto.de/i/otto/");
    // „ab“ olmayan düz fiyat da okunur.
    expect(rows[1]?.price).toBe(12.5);
  });

  it("boş/başlıksız sayfa `[]` döner (satır uydurulmaz)", () => {
    expect(parseOtto("")).toEqual([]);
    expect(parseOtto("nur Text ohne Karten")).toEqual([]);
  });
});

describe("parseFlipkart", () => {
  it("teklif fiyatını (ilk ₹), puanı ve değerlendirme sayısını ölçer", () => {
    const rows = parseFlipkart(FLIPKART);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "cello Lifestyle Stainless Steel Insulated 500 ml Stainless Steel Flask",
      url: "https://www.flipkart.com/cello-lifestyle-stainless-steel-insulated-500-ml-flask/p/itmd7cfe73d848b1",
      price: 579,
      currency: "INR",
      rating: 4.2,
      ratingCount: 59871,
      site: "Flipkart",
    });
    // Liste fiyatı (₹809) ve yüzde indirim fiyat SAYILMAZ.
    expect(rows[0]?.price).not.toBe(809);
  });

  it("blob: görselleri ürün görseli sanmaz", () => {
    const rows = parseFlipkart(FLIPKART);
    expect(rows[0]?.imageUrl.startsWith("https://rukminim")).toBe(true);
  });
});

describe("parseRakuten", () => {
  it("¥ fiyatını binlik ayırıcıyla doğru okur, puanı uydurmaz", () => {
    const rows = parseRakuten(RAKUTEN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      price: 4180,
      currency: "JPY",
      url: "https://item.rakuten.co.jp/yoshikip2/rbaa-500/",
      site: "Rakuten",
    });
    expect(rows[0]?.title).toContain("TERMOS");
    expect(rows[0]?.rating).toBeNull();
    expect(rows[0]?.imageUrl).toContain("tshop.r10s.jp");
  });

  it("„5,000件“ (adet) ve „38 ポイント“ (puan) fiyat olarak OKUNMAZ", () => {
    const rows = parseRakuten(RAKUTEN);
    expect(rows[0]?.price).toBe(4180);
  });
});
