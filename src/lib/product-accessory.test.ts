/**
 * AKSESUAR KAPISI — saf kural + entegrasyon testleri (ağ/AI YOK).
 *
 * NEDEN ÖNEMLİ: bu kapı iki yönlü hata yapabilir ve İKİSİ DE pahalıdır:
 *   • Fazla eleme → gerçek ürün (ör. "Air Fryer for 2 People") kaybolur,
 *   • eksik eleme → kılıf/filtre "kazanan ürün" olarak listeye girer.
 * Bu yüzden testler hem eleme hem de ELEMEME davranışını kilitler.
 *
 * Satırlar `normalizeRaw` ile üretilir (elle nesne yazmak yerine): böylece test
 * gerçek üretim yolunun ürettiği tipi kullanır ve şema değişince kırılmaz.
 */
import { describe, expect, it } from "vitest";

import { isAccessoryNiche, looksLikeAccessory, shouldRejectAccessory } from "./product-accessory";
import { applyHardFilter, filterAndPreRank, normalizeRaw } from "./product-discovery-filter.server";
import type { RawProduct } from "./product-discovery.types";

const raw = (title: string, i = 0): RawProduct => ({
  title,
  brand: "",
  seller: "Best Buy",
  priceUsd: 89.99,
  rating: 4.6,
  ratingCount: 320,
  inStock: true,
  source: "aliexpress-reader",
  url: `https://example.com/${i}`,
  imageUrl: `https://example.com/${i}.jpg`,
  notes: "",
});

describe("looksLikeAccessory — yalnız yapısal kalıplar", () => {
  it("gerçek aksesuar/yedek parça başlıklarını yakalar", () => {
    for (const title of [
      "Silicone Case for Ninja AF101 Air Fryer",
      "Replacement Filter for Roborock Q7 Max",
      "Screen Protector for iPhone 15 — 2 Pack",
      "Spare Parts Kit for Air Fryer",
      "Dust Cover for Robot Vacuum",
      "Stainless Steel Blade for Blender 1200W",
      "Compatible with Ninja Foodi 6.5 Qt",
      "User Manual for Air Fryer AF101",
      "Replacement Brush Roll for Vacuum",
    ]) {
      expect(looksLikeAccessory(title), title).toBe(true);
    }
  });

  it("gerçek ÜRÜNLERİ aksesuar sanmaz", () => {
    for (const title of [
      "Ninja AF101 Air Fryer 4 Qt",
      // "for" tek başına aksesuar işareti DEĞİLDİR.
      "Air Fryer for 2 People 5.5L",
      "Roborock Q7 Max Robot Vacuum with Mop",
      "Stainless Steel Air Fryer Basket 5.8L",
      "Cosori 9-in-1 Air Fryer Oven",
    ]) {
      expect(looksLikeAccessory(title), title).toBe(false);
    }
  });

  it("boş başlıkta patlamaz ve aksesuar demez", () => {
    expect(looksLikeAccessory("")).toBe(false);
    expect(looksLikeAccessory("   ")).toBe(false);
  });
});

describe("shouldRejectAccessory — üç koruma", () => {
  it("KORUMA 1: nişin kendisi aksesuar kategorisiyse kapı KAPANIR", () => {
    expect(isAccessoryNiche("phone case")).toBe(true);
    expect(isAccessoryNiche("vacuum filter")).toBe(true);
    expect(isAccessoryNiche("air fryer")).toBe(false);
    // Kullanıcı kılıf arıyorsa kılıf satırları onun ÜRÜNÜDÜR.
    expect(shouldRejectAccessory("Silicone Case for iPhone 15", "phone case", 50)).toBe(false);
  });

  it("KORUMA 2: aksesuar-dışı havuz küçükse eleme YAPILMAZ (fail-open)", () => {
    expect(shouldRejectAccessory("Case for Air Fryer", "air fryer", 2)).toBe(false);
    expect(shouldRejectAccessory("Case for Air Fryer", "air fryer", 6)).toBe(true);
  });

  it("KORUMA 3: yalnız yapısal kalıp elenir", () => {
    expect(shouldRejectAccessory("Air Fryer for 2 People 5.5L", "air fryer", 20)).toBe(false);
    expect(shouldRejectAccessory("Replacement Filter for Q7", "air fryer", 20)).toBe(true);
  });
});

describe("applyHardFilter — aksesuar kapısı entegrasyonu", () => {
  /** Yeterli aksesuar-dışı ticari havuz (7 gerçek ürün) + istenen ek satırlar. */
  const pool = (extra: string[] = []) =>
    [
      ...Array.from({ length: 7 }, (_, i) => raw(`Air Fryer Model ${i} 5.5L`, i)),
      ...extra.map((title, i) => raw(title, 100 + i)),
    ].map(normalizeRaw);

  it("aksesuar satırını ELER ve sayacı artırır; gerçek ürünler kalır", () => {
    const { survivors, stats } = applyHardFilter(
      pool(["Silicone Case for Ninja AF101 Air Fryer"]),
      [],
      "air fryer",
    );
    expect(stats.rejectedByAccessory).toBe(1);
    expect(survivors).toHaveLength(7);
    expect(survivors.some((p) => /case/i.test(p.name))).toBe(false);
  });

  it("niş aksesuar kategorisiyse HİÇBİR satır elenmez (boş vitrin yok)", () => {
    const { survivors, stats } = applyHardFilter(
      pool(["Case for iPhone 15 Pro", "Cover for iPhone 15 Pro"]),
      [],
      "phone case",
    );
    expect(stats.rejectedByAccessory).toBe(0);
    expect(survivors.length).toBeGreaterThanOrEqual(9);
  });

  it("havuz aksesuar-dışı satır açısından zayıfsa eleme YAPILMAZ", () => {
    const { survivors, stats } = applyHardFilter(
      [raw("Case for Air Fryer", 1), raw("Replacement Filter for Air Fryer", 2)].map(normalizeRaw),
      [],
      "air fryer",
    );
    expect(stats.rejectedByAccessory).toBe(0);
    expect(survivors).toHaveLength(2);
  });

  it("filterAndPreRank nişi bağlamdan geçirir (uçtan uca)", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => raw(`Air Fryer Model ${i} 5.5L`, i)),
      raw("Replacement Filter for Air Fryer AF101", 99),
    ];
    const { survivors, stats } = filterAndPreRank(
      rows,
      { nicheMomentumPct: null, nicheEngagement: 0, niche: "air fryer" },
      [],
      75,
    );
    expect(stats.rejectedByAccessory).toBe(1);
    expect(survivors.some((p) => /replacement/i.test(p.name))).toBe(false);
  });
});
