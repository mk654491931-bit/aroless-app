/**
 * İLK AŞAMA FİLTRELEME — sözleşme testi (AI YOK, ağ YOK, $0).
 *
 * Kapsam: `buildShortlist` ham kazıma çıktısını alır ve şunları garanti eder:
 *   1. En fazla 75 ürün (asla 76).
 *   2. Tam olarak 7 alan, tanımsız/NaN/eksik alan YOK.
 *   3. Kirli satırlar (stokta yok, fiyatsız, başlıksız, görselsiz) elenmiş.
 *   4. Çıktı ham bayt bütçesinin altında (LLM token tavanı).
 *   5. Aynı ham girdiden bit bit aynı çıktı (deterministik, $0, tekrarlanabilir).
 *
 * "Mock raw JSON" bilinçli olarak GERÇEK KAZIMA ÇIKTISI GİBİ KİRLİTTİR:
 * kaynaklar boş başlık, `NaN` fiyat, `null` puan ve görselsiz satır döndürür.
 * Filtre bu satırları süzmeden sonraki aşamaya aktarılan her ürün kanıtsızdır.
 */
import { describe, expect, it } from "vitest";

import {
  buildShortlist,
  LLM_SHORTLIST_LIMIT,
  LLM_SHORTLIST_MAX_BYTES,
  LlmShortlistSchema,
  SHORTLIST_FIELDS,
} from "./product-discovery-shortlist.server";
import type { RawProduct } from "./product-discovery.types";

/** Temiz, geçerli bir ham satır — kirletici alanlar testte eklenir. */
const cleanRow = (i: number): RawProduct => ({
  id: `sku-${String(i).padStart(3, "0")}`,
  title: `Air Fryer Model ${i} 5.5L`,
  brand: "Acme",
  seller: "shop",
  category: "Elektronik > Küçük Ev Aletleri",
  priceUsd: 39.9 + i,
  rating: 4.1,
  ratingCount: 120,
  salesVolume: 500 + i,
  inStock: true,
  source: "mock-scraper",
  url: `https://mock.test/p/${i}`,
  notes: "4.1 puan · 120 değerlendirme",
  imageUrl: `https://cdn.mock.test/${i}.jpg`,
});

/**
 * Ham kazıma çıktısı taklidi: 95 temiz satır + 6 çeşit kirli satır.
 * 95 > 75 olduğu için 75 sınırının GERÇEKTEN çalıştığı kanıtlanır.
 */
const mockRawScraperOutput = (): RawProduct[] => {
  const rows: RawProduct[] = Array.from({ length: 95 }, (_, i) => cleanRow(i));

  // K1) `in_stock: false` → elenmeli (en az 6 satır, hepsi listeye girmemeli).
  rows.push(...[0, 1, 2, 3, 4, 5].map((i) => ({ ...cleanRow(200 + i), inStock: false })));

  // K2) Fiyat GEÇERSİZ → elenmeli. `NaN` JSON'da temsil edilemez;
  //     kazıma bunu string olarak taşır ve `safeParse` eler — ikisini de test et.
  //     DİKKAT: `priceUsd: null` (sku-300) artık ELEMEZ — fiyat ÖLÇÜLMEMİŞTİR,
  //     bozuk değildir. Ölçülmemiş fiyat `null` olarak hayatta kalır ve kısa
  //     listede `price: null` döner (dürüstlük kuralı; alt katman
  //     `filterAndPreRank` da `null` fiyatı geçirir). Bkz. canlı hata:
  //     2026-10-01 "LED masa lambası" — 15 satırın 15'i de burada öldü.
  rows.push(
    { ...cleanRow(300), priceUsd: null },
    { ...cleanRow(301), priceUsd: 0 },
    { ...cleanRow(302), priceUsd: -19 },
    { ...cleanRow(303), priceUsd: Number.NaN },
  );

  // K3) Başlık eksik/tanımsız → elenmeli.
  rows.push({ ...cleanRow(400), title: "" }, { ...cleanRow(401), title: "   " });

  // K4) Görsel URL'si eksik → elenmeli.
  rows.push({ ...cleanRow(500), imageUrl: "" }, { ...cleanRow(501), imageUrl: "   " });

  // K5) Puan 5 üstü → şemaya uymaz, elenmeli.
  rows.push({ ...cleanRow(600), rating: 9.2 });

  // K6) Ölçülmemiş alanlar → ELEMEYİP `null` dönmeli (dürüstlük kuralı).
  rows.push({ ...cleanRow(700), rating: null, ratingCount: null, salesVolume: null });

  return rows;
};

const CONTEXT = { nicheMomentumPct: 12, nicheEngagement: 640 };

describe("buildShortlist — ilk aşama filtreleme", () => {
  it("en fazla 75 ürün döndürür (95 temiz satır girdiden)", () => {
    const { products, stats } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    expect(products.length).toBeLessThanOrEqual(LLM_SHORTLIST_LIMIT);
    expect(stats.survivors).toBe(products.length);
    // 95 temiz satır var, 75 sınırı yukarıda doğrulandı: liste DOLDU.
    expect(products).toHaveLength(LLM_SHORTLIST_LIMIT);
  });

  it("tam olarak 7 alan üretir — fazla veya eksik alan yok", () => {
    const { products } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    for (const p of products) {
      expect(Object.keys(p)).toEqual([...SHORTLIST_FIELDS]);
    }
  });

  it("eksik/tanımsız alan, NaN ve geçersiz değer içermez", () => {
    const { products } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    // Şema doğrulaması: `safeParse` yerine `parse` — tek bir bozuk satır
    // testi düşürür, yani çıktının TAMAMININ geçerli olduğunu kanıtlar.
    expect(() => LlmShortlistSchema.parse(products)).not.toThrow();

    for (const p of products) {
      expect(p.id).toBeTruthy();
      expect(p.title.trim()).not.toBe("");
      // Fiyat ya ölçülmüş ve GEÇERLİ olmalı, ya da hiç ölçülmemiş olmalı
      // (`null`). Asla 0/negatif/NaN ve asla `undefined` olamaz — 0 yazmak
      // "ölçtük ve sıfır bulduk" anlamına gelirdi (dürüstlük kuralı).
      if (p.price !== null) {
        expect(Number.isFinite(p.price)).toBe(true);
        expect(p.price).toBeGreaterThan(0);
      }
      if (p.rating !== null) expect(p.rating).toBeGreaterThanOrEqual(0);
      if (p.reviews_count !== null) expect(Number.isInteger(p.reviews_count)).toBe(true);
      if (p.sales_volume !== null) expect(Number.isInteger(p.sales_volume)).toBe(true);
      // `undefined` ASLA sızmaz (JSON'da anahtar kaybolur → model boşluğa
      // cevap uydurur). Her anahtar `null` ya da dolu değer olmalı.
      for (const key of SHORTLIST_FIELDS) {
        expect(p[key]).not.toBeUndefined();
      }
    }
  });

  it("stokta olmayan, fiyatsız, başlıksız ve görselsiz satırları eler", () => {
    const { products, stats } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    const ids = new Set(products.map((p) => p.id));

    // `in_stock: false` satırlarının KİMLİKLERİ listede olmamalı.
    for (let i = 0; i < 6; i++) expect(ids.has(`sku-${200 + i}`)).toBe(false);
    // GEÇERSİZ fiyatlı satırlar (0 / -19 / NaN) elenmeli.
    for (const i of [301, 302, 303]) expect(ids.has(`sku-${i}`)).toBe(false);
    // ÖLÇÜLMEMİŞ fiyat (null) KAPI tarafından elenmemeli. DİKKAT: bu büyük
    // taklitte 95 temiz satır + kirleticiler var ve 75'lik tavan devrede;
    // ölçülmemiş fiyat satırı daha düşük ön skor alıp sondan KIRPILIR. Bu
    // sıralama, eleme değildir — aşağıdaki ayrı test kapının kendisini
    // tavan olmadan ölçer.
    // Görseli olmayan satırlar.
    for (const i of [500, 501]) expect(ids.has(`sku-${i}`)).toBe(false);
    // Puanı 9.2 olan satır (şema dışı).
    expect(ids.has("sku-600")).toBe(false);

    // Gerekçe sayacı gerçekten sayıyor olmalı (sessiz eleme olmamalı).
    // Stok kapısı BU katmanda çalıştığı için sayacı `rejectedNotInStock`'tır;
    // alttaki ortak filtre o satırları hiç görmez (`rejectedByStock` 0 kalır).
    expect(stats.rejectedNotInStock).toBeGreaterThanOrEqual(6);
    expect(stats.rejectedByStock).toBe(0);
    // `NaN` fiyat ŞEMADA elenir (`z.number()` NaN'ı kabul etmez), fiyat
    // kapısına ULAŞMAZ; bu yüzden 2 (0/-19) + 1 şema elemesi beklenir.
    // `null` fiyat artık kapıdan GEÇER (ölçülmemiş ≠ geçersiz).
    expect(stats.rejectedPrice).toBeGreaterThanOrEqual(2);
    expect(stats.rejectedMissingImage).toBeGreaterThanOrEqual(2);
    // 2 boş başlık + 1 NaN fiyat + 1 şema dışı puan (9.2).
    expect(stats.rejectedInvalid).toBeGreaterThanOrEqual(4);
  });

  it("ölçülmemiş fiyatı KAPIdan geçirir (ölçülmemiş ≠ geçersiz)", () => {
    // 75'lik tavan YOK — tek satır, kapının kendisi ölçülüyor.
    // Ölçülmemiş fiyat kanıtı olan bir adayı elemek için gerekçe değildir;
    // 0 yazmak da dürüst değildir ("ölçtük ve sıfır bulduk" anlamına gelir).
    const { products, stats } = buildShortlist([{ ...cleanRow(300), priceUsd: null }], {
      context: CONTEXT,
    });
    expect(products).toHaveLength(1);
    expect(products[0]?.price).toBeNull();
    expect(stats.rejectedPrice).toBe(0);
  });

  it("ölçülmemiş alanları 0 değil null döndürür (dürüstlük kuralı)", () => {
    // BÜYÜK listede bu satır 75'lik tavanın ALTINDA kalır (ölçümsüz ürün
    // daha düşük ön skor alır) — bu doğru davranıştır. Dürüstlük kuralı
    // "ölçülmemişi at" değil, "ölçülmemişi null YAZ"dır; bu yüzden küçük bir
    // girdiyle, tavanın devreye girmediği durumda ölçülür.
    const only = buildShortlist(
      [{ ...cleanRow(700), rating: null, ratingCount: null, salesVolume: null }],
      { context: CONTEXT },
    );
    expect(only.products).toHaveLength(1);
    const [unmeasured] = only.products;
    expect(unmeasured!.rating).toBeNull();
    expect(unmeasured!.reviews_count).toBeNull();
    expect(unmeasured!.sales_volume).toBeNull();
    // Alanlar VAR ama null — `undefined` değil (anahtar kaybolmaz).
    expect(Object.keys(unmeasured!)).toEqual([...SHORTLIST_FIELDS]);
  });

  it("marj tabanının altındaki satırları eler", () => {
    // Marj tabanı 100'e çekilirse fiyat bandı nedeniyle eleme tetiklenmeli.
    const strict = buildShortlist(mockRawScraperOutput(), {
      context: CONTEXT,
      minMarginScore: 100,
    });
    const { products: loose, stats } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    expect(strict.products.length).toBeLessThan(loose.length);
    expect(stats.rejectedMargin).toBe(0);
  });

  it("LLM token tavanını aşmayan ham bayt bütçesinde kalır", () => {
    const { products, stats } = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    const bytes = Buffer.byteLength(JSON.stringify(products), "utf8");
    expect(bytes).toBe(stats.bytes);
    expect(bytes).toBeLessThanOrEqual(LLM_SHORTLIST_MAX_BYTES);
  });

  it("bütçe düşürülünce sondan kırpır, en güçlü ürünleri korur", () => {
    const full = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    const tight = buildShortlist(mockRawScraperOutput(), { context: CONTEXT, maxBytes: 3_000 });

    expect(tight.products.length).toBeLessThan(full.products.length);
    expect(tight.stats.truncatedForBudget).toBeGreaterThan(0);
    expect(tight.stats.bytes).toBeLessThanOrEqual(3_000);
    // Sıralama korunur: kırpma BAŞTAN değil SONDAN yapılır, yani en güçlü
    // ürünler (ilk satırlar) listede kalmaya devam eder.
    expect(tight.products[0]!.id).toBe(full.products[0]!.id);
  });

  it("deterministiktir — aynı girdiden bit bit aynı çıktı", () => {
    const a = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    const b = buildShortlist(mockRawScraperOutput(), { context: CONTEXT });
    expect(JSON.stringify(a.products)).toBe(JSON.stringify(b.products));
    expect(a.stats).toEqual(b.stats);
  });

  it("görsel kapısı kapatılabilir (görsel vermeyen kaynaklar için)", () => {
    const { products } = buildShortlist(mockRawScraperOutput(), {
      context: CONTEXT,
      requireImage: false,
    });
    expect(products.length).toBe(LLM_SHORTLIST_LIMIT);
  });
});

/* ------------------------------------------------- Konsol canlı doğrulama */

describe("kısa liste konsol raporu", () => {
  it("ham girdi → temiz JSON: eleme dökümünü yazdırır", () => {
    const raw = mockRawScraperOutput();
    const { products, stats } = buildShortlist(raw, { context: CONTEXT });
    const json = JSON.stringify(products);
    const bytes = Buffer.byteLength(json, "utf8");

    console.log(
      [
        "",
        "=== AROLESS · İLK AŞAMA FİLTRELEME (deterministik, AI yok) ===",
        `ham satır            : ${stats.inputCount}`,
        `şemaya uymayan       : ${stats.rejectedInvalid}`,
        `fiyatsız/geçersiz    : ${stats.rejectedPrice}`,
        `görselsiz            : ${stats.rejectedMissingImage}`,
        `stokta yok          : ${stats.rejectedNotInStock}`,
        `düşük puan           : ${stats.rejectedByRating}`,
        `tekilleşen kopya    : ${stats.rejectedByDuplicate}`,
        `bütünlük düşük       : ${stats.rejectedByCompleteness}`,
        `marj tabanı altı    : ${stats.rejectedMargin}`,
        `bütçe için kırpılan : ${stats.truncatedForBudget}`,
        `─────────────────────────────────────────`,
        `kısa liste           : ${products.length} ürün (tavan ${LLM_SHORTLIST_LIMIT})`,
        `ham bayt             : ${bytes} B (bütçe ${LLM_SHORTLIST_MAX_BYTES} B)`,
        `tahmini token        : ~${Math.round(bytes / 3.5)} token`,
        `alanlar              : ${SHORTLIST_FIELDS.join(", ")}`,
        `ilk 3 kayıt          :`,
        ...products.slice(0, 3).map((p, i) => `  ${i + 1}. ${JSON.stringify(p)}`),
        "=========================================================",
        "",
      ].join("\n"),
    );

    // Raporun dayandığı iddialar: ≤75, geçerli şema, bütçe içinde.
    expect(products.length).toBeLessThanOrEqual(LLM_SHORTLIST_LIMIT);
    expect(() => LlmShortlistSchema.parse(products)).not.toThrow();
    expect(bytes).toBeLessThanOrEqual(LLM_SHORTLIST_MAX_BYTES);
  });
});
