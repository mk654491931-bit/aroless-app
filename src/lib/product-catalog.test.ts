/**
 * ÜRÜN KATALOĞU ZENGİNLEŞTİRMESİ — sözleşme testleri (saf, ağ/AI YOK).
 *
 * NEDEN VAR (ölçülen boşluk, 2026-10-15 canlı "air fryer"/US): 120 ham satır →
 * 75 aday ve **0/75 üründe marka**, kategori de boştu. Ölçülen sebep: pazaryeri
 * LİSTE sayfaları marka/kategori alanı sunmuyor (AliExpress kart şemasında
 * `brand` YOK). Bu yüzden anahtarsız ücretsiz ürün kataloğu (UPCitemdb)
 * eklenmiştir: marka, model, GTIN ve kategori BAĞIMSIZ bir veri kümesinden
 * gelir.
 *
 * ASIL KURAL — YANLIŞ MARKA, MARKA YOKLUĞUNDAN KÖTÜDÜR: bu testlerin yarısı
 * "hangi durumda EŞLEŞME REDDEDİLİR"i kilitler. Zayıf eşleşme kabul edilirse
 * başka bir ürünün markası adayın üzerine yazılır ve `productModelKey` iki
 * FARKLI ürünü birleştirir.
 */
import { describe, expect, it } from "vitest";

import {
  CATALOG_MAX_SEARCHES_PER_RUN,
  CATALOG_MIN_MATCH,
  bestCatalogMatch,
  catalogMatchScore,
  catalogQueriesForRun,
  catalogSearchUrl,
  confirmedBrandsFromRecords,
  enrichRowsWithCatalog,
  parseCatalogItems,
  type CatalogRecord,
} from "./product-catalog.server";
import type { RawProduct } from "./product-discovery.types";

/** UPCitemdb `search` yanıtının ÖLÇÜLMÜŞ şekli (2026-10-15, canlı). */
const payload = {
  code: "OK",
  total: 3,
  items: [
    {
      ean: "0622356559775",
      title: "Ninja AF101 Air Fryer, 4 Qt",
      brand: "Ninja",
      model: "AF101",
      category: "Home & Garden > Kitchen & Dining > Small Appliances",
      lowest_recorded_price: 89.99,
      highest_recorded_price: 129.99,
      images: ["https://example.com/ninja.jpg"],
    },
    { title: "" },
    { title: "Ok" },
  ],
};

const ninja: CatalogRecord = {
  title: "Ninja AF101 Air Fryer 4 Qt",
  brand: "Ninja",
  model: "AF101",
  category: "Home & Garden > Kitchen & Dining",
  gtin: "0622356559775",
  lowestUsd: 89.99,
  highestUsd: 129.99,
  imageUrl: "https://example.com/ninja.jpg",
};

const row = (over: Partial<RawProduct> = {}): RawProduct => ({
  title: "Test Ürünü",
  brand: "",
  seller: "",
  priceUsd: null,
  source: "aliexpress-reader",
  url: "",
  notes: "",
  ...over,
});

describe("parseCatalogItems — YALNIZ okunabilen alanlar", () => {
  it("marka/model/GTIN/kategori/fiyat/görsel okunur", () => {
    const [record] = parseCatalogItems(payload);
    expect(record?.brand).toBe("Ninja");
    expect(record?.model).toBe("AF101");
    expect(record?.gtin).toBe("0622356559775");
    expect(record?.category).toContain("Kitchen");
    expect(record?.lowestUsd).toBe(89.99);
    expect(record?.imageUrl).toBe("https://example.com/ninja.jpg");
  });

  it("başlıksız/çok kısa kaydı atar ve uydurma üretmez", () => {
    expect(parseCatalogItems(payload)).toHaveLength(1);
    expect(parseCatalogItems({ items: "bozuk" })).toEqual([]);
    expect(parseCatalogItems(null)).toEqual([]);
  });

  it("geçersiz fiyatı `null` yapar (0 uydurulmaz)", () => {
    const [record] = parseCatalogItems({
      items: [{ title: "Ürün A", lowest_recorded_price: "abc" }],
    });
    expect(record?.lowestUsd).toBeNull();
    expect(record?.highestUsd).toBeNull();
  });
});

describe("catalogSearchUrl", () => {
  it("nişi İngilizce ürün sorgusuna çevirir ve kodlar", () => {
    const url = catalogSearchUrl("hava fritözü");
    expect(url).toContain("api.upcitemdb.com/prod/trial/search");
    expect(url).toContain("s=hava%20frit%C3%B6z%C3%BC");
  });

  it("boş sorguda URL üretmez (boşa kota harcanmaz)", () => {
    expect(catalogSearchUrl("   ")).toBe("");
  });
});

describe("catalogMatchScore — KİMLİK ÇAPASI olmadan eşleşme sayılmaz", () => {
  it("model kodu başlıkta geçiyorsa kesin eşleşme", () => {
    expect(catalogMatchScore({ title: "Ninja AF101 Air Fryer 4 Qt Black" }, ninja)).toBe(1);
  });

  it("GTIN başlıkta geçiyorsa kesin eşleşme", () => {
    expect(catalogMatchScore({ title: "Air Fryer 4 Qt 0622356559775" }, ninja)).toBe(1);
  });

  it("kaydın markası başlıkta geçiyorsa güçlü eşleşme", () => {
    expect(catalogMatchScore({ title: "Ninja Air Fryer 5.5L" }, ninja)).toBeGreaterThanOrEqual(
      CATALOG_MIN_MATCH,
    );
  });

  it("markasız jenerik başlık eşleşmez (başka ürünün markası yazılmaz)", () => {
    // Ölçülen yanlış-pozitif: bu satır yalnız kelime örtüşmesiyle 1.0 alıyordu
    // ve katalogdan "Ninja" markası uydurulmuş gibi yazılıyordu.
    expect(catalogMatchScore({ title: "Air Fryer 5.5L" }, ninja)).toBeLessThan(CATALOG_MIN_MATCH);
  });

  it("FARKLI markalı ürün eşleşmez", () => {
    expect(catalogMatchScore({ title: "Cosori Air Fryer 5.5L" }, ninja)).toBeLessThan(
      CATALOG_MIN_MATCH,
    );
  });

  it("alakasız üründe 0 döner", () => {
    expect(catalogMatchScore({ title: "Robot Vacuum Cleaner" }, ninja)).toBe(0);
  });

  it("bozuk kayıt markası çapa SAYILMAZ (uydurma marka yazılmaz)", () => {
    // Ölçülen hata: kaydın markası "Air" idi, "Air" her başlıkta geçtiği için
    // 17 aday eşleşti ve marka olarak yazıldı.
    const broken = { ...ninja, brand: "Air", model: "", gtin: "" };
    expect(catalogMatchScore({ title: "Air Fryer 4 Qt Black" }, broken)).toBeLessThan(
      CATALOG_MIN_MATCH,
    );
    expect(bestCatalogMatch({ title: "Air Fryer 4 Qt Black" }, [broken])).toBeNull();
  });
});

describe("bestCatalogMatch", () => {
  it("eşiği geçen en iyi kaydı döndürür ve marka ölçümünü işaretler", () => {
    const match = bestCatalogMatch({ title: "Ninja Air Fryer 5.5L" }, [ninja]);
    expect(match?.brand).toBe("Ninja");
    expect(match?.brandMeasured).toBe(true);
    expect(match?.gtin).toBe("0622356559775");
  });

  it("eşiğin altında `null` döner — alanlar BOŞ kalır", () => {
    expect(bestCatalogMatch({ title: "Air Fryer 5.5L" }, [ninja])).toBeNull();
  });

  it("kaydın marka alanı boşsa marka ÖLÇÜLMÜŞ sayılmaz", () => {
    // Model kodu eşleşmesi eşiği geçirir (kimlik kanıtı), ama marka kaydın
    // kendi alanında yoktu → marka yuvası "ölçüldü" sayılmaz.
    const match = bestCatalogMatch({ title: "Air Fryer 4 Qt AF101 Black" }, [
      { ...ninja, brand: "", model: "AF101" },
    ]);
    expect(match?.brandMeasured).toBe(false);
    expect(match?.brand ?? "").toBe("");
  });
});

describe("catalogQueriesForRun — marka ağırlıklı sorgu (ölçülen verim farkı)", () => {
  it("markaları ürün cinsiyle birleştirir ve PATLAMA bütçesine kırpar", () => {
    // Ölçülen sınır: ücretsiz uç art arda 2 aramadan sonra 429 döndürüyor.
    expect(catalogQueriesForRun(["Ninja", "Cosori", "Power"], "air fryer")).toEqual([
      "Ninja air fryer",
      "Cosori air fryer",
    ]);
    expect(CATALOG_MAX_SEARCHES_PER_RUN).toBe(2);
  });

  it("marka yoksa niş sorgusuna düşer (eski davranış)", () => {
    expect(catalogQueriesForRun([], "air fryer")).toEqual(["air fryer"]);
  });

  it("aynı sorguyu iki kez üretmez (kota israfı olmaz)", () => {
    expect(catalogQueriesForRun(["Ninja", "Ninja"], "air fryer", 5)).toEqual(["Ninja air fryer"]);
  });
});

describe("confirmedBrandsFromRecords", () => {
  it("kayıtların markalarını bağımsız doğrulama kümesine çevirir", () => {
    const confirmed = confirmedBrandsFromRecords(parseCatalogItems(payload));
    expect(confirmed.has("ninja")).toBe(true);
  });

  it("çok kısa/bozuk marka adını kümeyealmaz", () => {
    expect(confirmedBrandsFromRecords([{ ...ninja, brand: "AB" }]).size).toBe(0);
    // Ölçülen bozuk alan: marka "Air" geldiğinde doğrulama kümesi şişiyordu.
    expect(confirmedBrandsFromRecords([{ ...ninja, brand: "Air" }]).size).toBe(0);
  });
});

describe("enrichRowsWithCatalog — yalnız BOŞ alanlar dolar", () => {
  const records = parseCatalogItems(payload);

  it("markası olmayan adaya katalog markasını yazar ve ölçüm diye işaretler", () => {
    const { rows, enriched, brands } = enrichRowsWithCatalog(
      [row({ title: "Ninja AF101 Air Fryer 4 Qt Black" })],
      records,
    );
    expect(enriched).toBe(1);
    expect(brands).toBe(1);
    expect(rows[0]!.brand).toBe("Ninja");
    expect(rows[0]!.brandMeasured).toBe(true);
    expect(rows[0]!.category).toContain("Kitchen");
    expect(rows[0]!.notes).toContain("GTIN 0622356559775");
  });

  it("kaynağın VERDİĞİ markayı ezmez (ölçülmüş veri korunur)", () => {
    const { rows } = enrichRowsWithCatalog(
      [row({ title: "Cosori AF101 Air Fryer 4 Qt", brand: "Cosori", brandMeasured: true })],
      records,
    );
    expect(rows[0]!.brand).toBe("Cosori");
  });

  it("perakende fiyatı EZMEZ; yalnız fiyatsız adaya KAYITLI fiyat yazar", () => {
    const priced = enrichRowsWithCatalog(
      [row({ title: "Ninja AF101 Air Fryer 4 Qt", priceUsd: 199 } )],
      records,
    ).rows[0]!;
    expect(priced.priceUsd).toBe(199);

    const unpriced = enrichRowsWithCatalog(
      [row({ title: "Ninja AF101 Air Fryer 4 Qt" })],
      records,
    ).rows[0]!;
    expect(unpriced.priceUsd).toBe(89.99);
    // "kayıtlı fiyat" olarak İŞARETLENİR: perakende fiyat sanılmasın.
    expect(unpriced.notes).toContain("katalog kayıtlı fiyat");
  });

  it("kayıt eşleşmese bile KATALOGLA DOĞRULANAN markayı ölçülmüş sayar", () => {
    // "Ninja …" sorgusu kayıt döndürdü → "Ninja" bu nişte GERÇEK bir markadır.
    // Başlıktan çıkarılan marka artık iki bağımsız kaynağın söylediği şeydir;
    // UYDURMA yok, yalnız DOĞRULAMA var. (Kayıtların başlıkları adayla
    // örtüşmüyor, yani eşleşme YOK — yalnız marka doğrulanıyor.)
    const differentProducts: CatalogRecord[] = [
      { ...ninja, title: "Ninja Something Else", model: "", gtin: "" },
    ];
    const { rows, confirmed, enriched } = enrichRowsWithCatalog(
      [row({ title: "Ninja Air Fryer XL 9L siyah" })],
      differentProducts,
    );
    expect(enriched).toBe(0);
    expect(confirmed).toBe(1);
    expect(rows[0]!.brand).toBe("Ninja");
    expect(rows[0]!.brandMeasured).toBe(true);
    expect(rows[0]!.notes).toContain("marka katalogda doğrulandı");
  });

  it("katalogda BULUNMAYAN markayı doğrulamaz (türev türev kalır)", () => {
    const differentProducts: CatalogRecord[] = [
      { ...ninja, title: "Ninja Something Else", model: "", gtin: "" },
    ];
    const { rows, confirmed } = enrichRowsWithCatalog(
      [row({ title: "Zorblex Air Fryer XL 9L" })],
      differentProducts,
    );
    expect(confirmed).toBe(0);
    expect(rows[0]!.brandMeasured ?? false).toBe(false);
  });

  it("eşleşmeyen satırı DEĞİŞTİRMEZ, kayıt yoksa hiç dokunmaz", () => {
    const original = row({ title: "Robot Vacuum Cleaner 4000Pa" });
    const { rows, enriched } = enrichRowsWithCatalog([original], records);
    expect(enriched).toBe(0);
    expect(rows[0]).toEqual(original);

    const empty = enrichRowsWithCatalog([original], []);
    expect(empty.rows[0]).toEqual(original);
    expect(empty.enriched).toBe(0);
  });
});
