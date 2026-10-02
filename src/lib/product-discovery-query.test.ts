// Ürün sorgusu hazırlığı — ölçülen canlı boşluğun regresyon testi.
//
// CANLI ÖLÇÜM (2026-10-02, niş = "LED masa lambası"): 14 kaynağın 13'ü 0 satır
// döndürdü; listeyi dolduran tek şey ürün OLMAYAN satırlardı (Wikipedia
// maddeleri). Aynı kod İngilizce sorguda gerçek fiyatlı ilan buluyor.
//
// Bu testler iki kırılmayı da kilitler: sorgu dili ve "bu bir ürün mü?" testi.
import { describe, expect, it } from "vitest";

import {
  asciiFold,
  englishProductQuery,
  isGameNiche,
  isTurkishQuery,
  looksLikeProductRow,
  normalizeNiche,
  productQueryVariants,
  stripTurkishAffixes,
} from "./product-discovery-query";

describe("Türkçe ek soyma", () => {
  it("ekleri atar, kökü korur", () => {
    expect(stripTurkishAffixes("lambası")).toBe("lamba");
    expect(stripTurkishAffixes("telefonları")).toBe("telefon");
    expect(stripTurkishAffixes("kulaklık")).toBe("kulaklik");
  });

  it("kısa kelimeleri bozmaz", () => {
    // 2 karakterlik kök + ek, kelimeyi başka bir şeye çevirmemeli.
    expect(stripTurkishAffixes("led")).toBe("led");
    expect(stripTurkishAffixes("air")).toBe("air");
  });

  it("aksanları ASCII'ye indirger", () => {
    expect(asciiFold("Aydınlatma Işığı ÇÖP ŞÜKRÜ")).toBe("aydinlatma isigi cop sukru");
  });
});

describe("englishProductQuery", () => {
  // ÖLÇÜLEN ÖRNEK: bu sorgu pazaryerlerinde 0 sonuç veriyordu.
  it("Türkçe ürün adını pazaryeri diline çevirir", () => {
    expect(englishProductQuery("LED masa lambası")).toBe("led desk lamp");
  });

  it("çekimli halleri de çevirir (kitap → kitabı)", () => {
    // ÖLÇÜLEN HATA: "matematik kitabı" → "matematik kitab" çıkıyordu; Türkçede
    // ünsüz değişimi (kitap → kitab-ı) ek soyma ile geri alınamaz, bu yüzden
    // çekimli biçimler sözlükte açıkça durmalı.
    expect(englishProductQuery("matematik kitabı")).toBe("matematik book");
  });

  it("İngilizce sorguyu BOZMAZ (olduğu gibi bırakır)", () => {
    expect(englishProductQuery("air fryer")).toBe("air fryer");
    expect(englishProductQuery("robot vacuum")).toBe("robot vacuum");
  });

  it("sözlükte olmayan kelimeleri köküyle korur", () => {
    // Yanlış çeviri, yanlış ürün kümesi getirir; o yüzden bilinmeyen korunur.
    const out = englishProductQuery("ahşap masa lambası");
    expect(out).toContain("desk");
    expect(out).toContain("lamp");
    expect(out).toContain("ahsap");
  });

  it("kelime tekrarını eler", () => {
    expect(englishProductQuery("masa masa lambası")).toBe("desk lamp");
  });

  it("boş girdide boş döner", () => {
    expect(englishProductQuery("")).toBe("");
    expect(englishProductQuery("   ")).toBe("");
  });
});

describe("productQueryVariants", () => {
  it("İngilizce karşılığı öne alır", () => {
    const variants = productQueryVariants("LED masa lambası");
    expect(variants[0]).toBe("led desk lamp");
  });

  it("aynı sorguyu iki kez denemez", () => {
    const variants = productQueryVariants("air fryer");
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("tekrarları eler, özgün sorguyu da korur", () => {
    expect(productQueryVariants("air fryer", 3)).toContain("air fryer");
    expect(productQueryVariants("masa lambası", 3).length).toBeGreaterThan(1);
  });
});

describe("isTurkishQuery", () => {
  it("Türkçe karakter görür", () => {
    expect(isTurkishQuery("LED masa lambası")).toBe(true);
  });
  it("İngilizce sorguda yanlış dönmez", () => {
    expect(isTurkishQuery("air fryer")).toBe(false);
  });
});

describe("normalizeNiche", () => {
  it("aksanları atar, noktalama temizler", () => {
    expect(normalizeNiche("Işık Lambası, LED (2'li)")).toBe("isik lambasi led 2 li");
  });
});

describe("looksLikeProductRow", () => {
  // ÖLÇÜLEN GERÇEK: kazanan 5 ürünün 5'i de ansiklopedi maddesiydi.
  it("Wikipedia maddesini ürün SAYMAZ", () => {
    expect(looksLikeProductRow("Light-emitting diode - Wikipedia", "wikipedia-demand")).toBe(
      false,
    );
  });

  it("tanım cümlesini ürün SAYMAZ", () => {
    expect(looksLikeProductRow("Light Emitting Diode (LED): What is it", "wikipedia-demand")).toBe(
      false,
    );
  });

  it("ürün olmayan kaynaktan gelen satırı eler", () => {
    expect(looksLikeProductRow("Some GitHub repository", "github")).toBe(false);
    expect(looksLikeProductRow("Bir haber yazısı", "web-reviews")).toBe(false);
  });

  it("fiyatı olan satırı ürün sayar (haberden çıkarılmış fiyat gerçek veridir)", () => {
    expect(
      looksLikeProductRow("Brightech Libra LED desk lamp $97.99", "web-reviews", {
        priceUsd: 97.99,
      }),
    ).toBe(true);
  });

  it("pazaryeri kaynağından gelen ürünü kabul eder", () => {
    expect(looksLikeProductRow("Philips Hue Desk Lamp", "marketplace-price", {})).toBe(true);
  });

  it("gerçek ürün adını ürün kaynağından geldiğinde kabul eder", () => {
    expect(looksLikeProductRow("Anker PowerCore 10000", "marketplace-price")).toBe(true);
  });

  it("ansiklopedi kaynağı ürün adı taşısa bile ürün SAYMAZ", () => {
    // Kaynağın kendisi talep sinyali: ad ne kadar ürün benzeri olursa olsun
    // satılabilir ürün değildir. Başlığın gerçekçiliği kaynağı değiştirmez.
    expect(looksLikeProductRow("Anker PowerCore 10000", "wikipedia-demand")).toBe(false);
  });

  it("boş başlığı eler", () => {
    expect(looksLikeProductRow("", "marketplace-price")).toBe(false);
  });
});

describe("isGameNiche", () => {
  it("Türkçe oyun nişini tanır", () => {
    expect(isGameNiche("coşku oyunu")).toBe(true);
    expect(isGameNiche("steam oyunları")).toBe(true);
  });

  it("Türkçe ekleri soyup köke iner", () => {
    expect(isGameNiche("oyunu")).toBe(true);
    expect(isGameNiche("oyunların")).toBe(true);
  });

  it("İngilizce oyun nişini tanır", () => {
    // REGRESYON: ek soyucu İngilizce kelimeye uygulanırsa "game" → "gam"
    // olur ve bu niş eşleşmezdi. Token iki biçimde de denenir.
    expect(isGameNiche("strategy game")).toBe(true);
    expect(isGameNiche("indie games")).toBe(true);
  });

  it("fiziksel üründe Steam'i tetikleMEZ", () => {
    expect(isGameNiche("LED masa lambası")).toBe(false);
    expect(isGameNiche("air fryer")).toBe(false);
  });

  it("oyun sözcüğü geçmeyen İngilizce nişleri eler", () => {
    expect(isGameNiche("strategy")).toBe(false);
    expect(isGameNiche("desk lamp")).toBe(false);
  });
});