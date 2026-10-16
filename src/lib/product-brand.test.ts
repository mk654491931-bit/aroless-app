/**
 * MARKA ÇIKARIMI — sözleşme testleri (saf, ağ/AI YOK).
 *
 * NEDEN BU TESTLER VAR (ölçülen boşluk, 2026-10-15 canlı "air fryer"/US):
 *   120 ham satır → 75 aday ve **0/75 üründe marka**; sebep pazaryeri LİSTE
 *   sayfalarının marka alanı sunmaması. Marka `productModelKey`in girdisidir
 *   (aynı ürünün iki mağaza yazımı = TEK ürün) ve `dataCompleteness`in "brand"
 *   yuvasıdır. Bu yüzden başlıktan yapısal çıkarım eklendi.
 *
 * ASIL KURAL — UYDURMA YASAK: yanlış marka, marka yokluğundan KÖTÜDÜR
 * (`productModelKey` iki FARKLI ürünü birleştirir ve kartta sahte tedarik
 * fiyatı görünür). Bu yüzden her "evet" testinin yanında bir "hayır" testi var.
 */
import { describe, expect, it } from "vitest";

import {
  brandFromTitle,
  mergeBrands,
  plausibleBrand,
  titleMentionsBrand,
} from "./product-brand";

describe("brandFromTitle — marka ÖLÇÜLEN başlıklardan çıkarılır", () => {
  it("açık etiketi okur (kaynak markayı KENDİSİ etiketlemiş)", () => {
    expect(brandFromTitle("Air Fryer 5.5L — Brand: Ninja")).toBe("Ninja");
    expect(brandFromTitle("Marka: Cosori — 6L hava fritözü")).toBe("Cosori");
  });

  it("model kodundan ÖNCEKİ öbeği marka sayar", () => {
    expect(brandFromTitle("Roborock Q7 L5 robot süpürge")).toBe("Roborock");
    expect(brandFromTitle("Cosori CM5418 hava fritözü 6L")).toBe("Cosori");
  });

  it("'by X' işaretçisini okur", () => {
    expect(brandFromTitle("Air Fryer XL 5.3 QT by Ninja")).toBe("Ninja");
  });

  it("jenerik olmayan ilk öbeği marka sayar", () => {
    expect(brandFromTitle("KitCook Large Air Fryer 8L")).toBe("KitCook");
  });

  it("bilinen marka listesiyle eşleşir (katalog/kaynak ipucu)", () => {
    expect(brandFromTitle("Ninja Air Fryer Pro", ["Ninja"])).toBe("Ninja");
  });
});

describe("brandFromTitle — UYDURMAZ (yanlış marka marka yokluğundan kötüdür)", () => {
  it("ürün cinsiyetiyle başlayan başlıkta marka döndürmez", () => {
    // "Large Capacity Air Fryer…" naive kuralı marka olarak "Large" yazardı.
    expect(brandFromTitle("Large Capacity Air Fryer with Digital Display")).toBe("");
    expect(brandFromTitle("Air Fryer XL 5.3 QT Black Deluxe")).toBe("");
  });

  it("pazaryeri/kanal adını marka sanmaz", () => {
    expect(brandFromTitle("Amazon Basics Air Fryer")).toBe("");
    expect(brandFromTitle("Hepsiburada hava fritözü")).toBe("");
  });

  it("tek başına model kodunu marka saymaz", () => {
    expect(brandFromTitle("Q7 L5 robot süpürge")).toBe("");
  });

  it("rakamla başlayan öbeği marka saymaz", () => {
    expect(brandFromTitle("10L Large Air Fryer")).toBe("");
  });

  it("boş/çok kısa metinde boş döner", () => {
    expect(brandFromTitle("")).toBe("");
    expect(brandFromTitle("   ")).toBe("");
    expect(brandFromTitle("ab")).toBe("");
  });
});

describe("plausibleBrand — dış kaynakların marka alanını süzer", () => {
  it("jenerik/ürün cinsi metni marka saymaz", () => {
    // Ölçülen bozuk katalog alanı: "Air" her başlıkta geçtiği için 17 adaya
    // yanlış marka yazdırıyordu; "Air fryer XL" ise hiç marka değildir.
    expect(plausibleBrand("Air")).toBe(false);
    expect(plausibleBrand("Air fryer XL")).toBe(false);
    expect(plausibleBrand("")).toBe(false);
  });

  it("ölçü/spec kodunu marka saymaz", () => {
    // Ölçülen başlık artefaktı: "Deli 9.5QT" → katalog sorgusu boşa gitti.
    expect(plausibleBrand("Deli 9.5QT")).toBe(false);
  });

  it("gerçek markaları kabul eder", () => {
    expect(plausibleBrand("Ninja")).toBe(true);
    expect(plausibleBrand("Power AirFryer")).toBe(true);
  });
});

describe("titleMentionsBrand", () => {
  it("başlığın herhangi bir yerindeki markayı yakalar (çapraz doğrulama)", () => {
    // Katalog markayı verdiğinde başlıkla ÇAPRAZ kontrol edilir: kaynak
    // "Ninja" diyorsa ve başlıkta "Ninja" geçiyorsa eşleşme güvenilirdir.
    expect(titleMentionsBrand("Air Fryer XL 5.3 QT by Ninja", "Ninja")).toBe(true);
    expect(titleMentionsBrand("Air Fryer XL 5.3 QT by Ninja", "Cosori")).toBe(false);
  });

  it("KELİME SINIRI: markayı başka bir kelimenin İÇİNDE bulmaz", () => {
    expect(titleMentionsBrand("Repair Kit Deluxe", "Air")).toBe(false);
    expect(titleMentionsBrand("Ninjago Air Fryer", "Ninja")).toBe(false);
    // Ama ek alan yazımlar eşleşir ("Cosori'nin hava fritözü").
    expect(titleMentionsBrand("Cosori'nin hava fritözü", "Cosori")).toBe(true);
  });

  it("çok kısa marka adında yanlış eşleşme üretmez", () => {
    expect(titleMentionsBrand("Huawei P40 Lite", "Hu")).toBe(false);
  });
});

describe("mergeBrands", () => {
  it("sırayla ilk GEÇERLİ markayı döndürür (kaynak → katalog)", () => {
    expect(mergeBrands("", null, "Cosori")).toBe("Cosori");
    expect(mergeBrands("Ninja", "Cosori")).toBe("Ninja");
  });

  it("hiçbiri geçerli değilse boş döner — uydurma yok", () => {
    expect(mergeBrands("", null, undefined)).toBe("");
  });
});
