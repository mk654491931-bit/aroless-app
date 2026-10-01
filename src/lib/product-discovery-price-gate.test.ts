// ============================================================================
// REGRESYON: fiyat kapısı talep-sinyali satırlarını kanıtsız eliyordu.
//
// CANLI HATA (2026-10-01, job 0f521fee-…, sorgu "LED masa lambası"):
//   13 kaynak koştu, 15 ham satır döndü (web-reviews 10 + github 5),
//   `discovery_stats.inputCount` = 15, `survivors` = 0, iş
//   "Hiç kaynak doğrulanabilir ürün döndürmedi." ile ÖDENDİ ve BAŞARISIZ oldu.
//
// NEDEN: `cleanRawRows` içindeki FİYAT KAPI, `priceUsd === null` olan her
// satırı eliyordu. Ama kaynakların ÇOĞU fiyat vermez ve BİLEREK vermez:
//
//   • `githubSource` → `priceUsd: null` DİMEK zorunda (repo satmaz; nişin
//     ekosistem büyüklüğünü ölçer, bkz. kaynak dosyasındaki yorum).
//   • `webReviewSource` → fiyatı arama sonucunun METNİNDEN çıkarır
//     (`priceFromText`); snippet'te `$` yoksa `null` döner — ki bu normaldir.
//
// Bu, aynı dosyanın "DÜRÜSTLÜK KURALI" ile ve ALT KATMANLA çelişiyor:
// `filterAndPreRank` (…-filter.server.ts) `null` fiyatı bilinçli olarak
// GEÇİRİR ("fiyatı olmayan aday talep sinyaliyse Gemini aşamasında fiyat
// araştırılabilir") ve yalnız GEÇERSİZ fiyatı (0/negatif/NaN) eler.
// Kısa liste bu sözleşmeyi ezdiği için fiyatsız adaylar Gemini'ye hiç
// ulaşamadan kayboluyordu.
//
// Beklenen davranış: fiyatsız ama KANIT taşıyan satır hayatta kalır ve
// `price: null` olarak kısa listeye girer (schema nullable olmalı); yalnız
// GEÇERSİZ fiyat (0/negatif/NaN) elenir.
// ============================================================================

import { describe, expect, it } from "vitest";

import { buildShortlist } from "./product-discovery-shortlist.server";
import type { RawProduct } from "./product-discovery.types";

/** `githubSource` ve `webReviewSource`'un ürettiği satırların sadeleştirilmiş hâli. */
function githubRow(overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    title: "awesome-led-desk-lamp — LED masa lambası kontrolörü",
    brand: "",
    seller: "",
    priceUsd: null,
    rating: null,
    ratingCount: null,
    inStock: null,
    source: "github",
    url: "https://github.com/example/awesome-led-desk-lamp",
    notes: "120 yıldız",
    ...overrides,
  };
}

describe("buildShortlist — fiyat kapısı", () => {
  it("fiyatı olmayan ama kanıt taşıyan github satırını eler (regresyon)", () => {
    const { products, stats } = buildShortlist([githubRow()], { requireImage: false });

    // Canlı hatta tam olarak bu oluyordu: satır şemaya uyuyor, talep sinyali
    // var, ama fiyatı null → elendi → boş liste → kullanıcı parasını ödedi.
    expect(stats.inputCount).toBe(1);
    expect(products).toHaveLength(1);
    expect(products[0]?.price).toBeNull();
    // Kanıt alanları korunur — model bunları görebilmeli.
    expect(products[0]?.title).toContain("awesome-led-desk-lamp");
    expect(stats.rejectedPrice).toBe(0);
  });

  it("snippet'te $ olmayan web-reviews satırını hayatta bırakır (regresyon)", () => {
    // `priceFromText` snippet'te `$` bulamaz → priceUsd null. Bu NORMAL yoldur.
    const { products, stats } = buildShortlist(
      [
        githubRow({
          title: "LED masa lambası en iyi 10 model 2026",
          source: "web-reviews",
          seller: "Example",
          url: "https://example.com/led-masa-lambasi",
          notes: "example.com · 4.8 puan",
          rating: 4.8,
          ratingCount: 312,
        }),
      ],
      { requireImage: false },
    );

    expect(products).toHaveLength(1);
    expect(products[0]?.price).toBeNull();
    expect(products[0]?.rating).toBe(4.8);
    expect(stats.rejectedPrice).toBe(0);
  });

  it("GEÇERSİZ fiyatı (0) yine de eler", () => {
    // Kapı gevşetilirken bu korunmalı: 0 fiyat ölçülen değer değil, bozuk veri.
    const { products, stats } = buildShortlist(
      [githubRow({ priceUsd: 0 })],
      { requireImage: false },
    );

    expect(products).toHaveLength(0);
    expect(stats.rejectedPrice).toBe(1);
  });

  it("fiyatı geçerli olan satırı olduğu gibi korur", () => {
    const { products } = buildShortlist(
      [githubRow({ priceUsd: 249.99, source: "marketplace-price" })],
      { requireImage: false },
    );

    expect(products).toHaveLength(1);
    expect(products[0]?.price).toBe(249.99);
  });
});
