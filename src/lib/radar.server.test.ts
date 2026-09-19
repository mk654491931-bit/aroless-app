// Kazanan Ürün Radarı — üretim/kalıcılık garantileri (saf fonksiyonlar, ağ yok).
//
// Bu testler kullanıcının bildirdiği "radar sürekli boş sonuç veriyor" hatasının
// kök nedenlerini kilitler:
//   • radar_items tablosunda (day, country, lower(title)) UNIQUE index var;
//     tekrar eden başlık TÜM toplu insert'i düşürüp radarı kalıcı boş bırakıyordu.
//   • AI motorları meşgulken yedek yol boş dönmemeli (canlı Google Trends listesi).
//   • Momentum/skor gerçek trend verisinden hesaplanmalı, uydurma olmamalı.
import { describe, expect, it } from "vitest";
import {
  RADAR_TREND_KEYWORDS,
  applyTrendEvidence,
  radarKeyword,
  radarPrompt,
  sanitizeRadar,
  trendFallbackSeeds,
  type RadarEvidence,
  type RadarSeed,
} from "./radar.server";

const seed = (over: Partial<RadarSeed> = {}): RadarSeed => ({
  title: "Test Ürün",
  niche: "Test",
  category: "Home",
  country: "US",
  platform: "Shopify",
  winner_score: 70,
  momentum: 5,
  price_min: 19,
  price_max: 39,
  est_margin_pct: 35,
  reason: "test",
  ...over,
});

const evidence = (over: Partial<RadarEvidence> = {}): RadarEvidence => ({
  keyword: "test urun",
  trend_source: "google-trends",
  trend_momentum_pct: 20,
  series: [10, 20, 30],
  generated_by: "ai",
  ...over,
});

describe("sanitizeRadar", () => {
  it("aynı başlığı (büyük/küçük harf ve boşluk farkını yok sayarak) bir kez alır", () => {
    const items = [
      { title: "Neck Fan Pro", momentum: 10 },
      { title: "neck fan pro", momentum: 12 },
      { title: "neck   fan   pro", momentum: 14 },
      { title: "Neck Fan Pro ", momentum: 16 },
    ];
    const out = sanitizeRadar(items, "US");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Neck Fan Pro");
  });

  it("farklı başlıkları korur ve tekrar üretmez", () => {
    const out = sanitizeRadar(
      [{ title: "A Ürün" }, { title: "B Ürün" }, { title: "C Ürün" }],
      "TR",
    );
    expect(out.map((s) => s.title)).toEqual(["A Ürün", "B Ürün", "C Ürün"]);
    expect(new Set(out.map((s) => s.title.toLowerCase())).size).toBe(3);
  });

  it("çok kısa başlıkları ve dizi olmayan girdiyi atar", () => {
    expect(sanitizeRadar(null, "US")).toEqual([]);
    expect(sanitizeRadar([{ title: "ab" }, { title: "" }, {}], "US")).toEqual([]);
  });

  it("sayıları güvenli aralıklara kırpar ve fiyat bandını bozmaz", () => {
    const [s] = sanitizeRadar(
      [
        {
          title: "Sınır Ürün",
          winner_score: 999,
          momentum: -999,
          price_min: -5,
          price_max: 3,
          est_margin_pct: 500,
          country: "US",
        },
      ],
      "DE",
    );
    expect(s!.winner_score).toBe(100);
    expect(s!.momentum).toBe(-50);
    expect(s!.price_min).toBe(1);
    expect(s!.price_max).toBeGreaterThan(s!.price_min);
    expect(s!.est_margin_pct).toBe(90);
    expect(s!.country).toBe("DE");
  });

  it("en fazla 12 ürün döner", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Ürün ${i}` }));
    expect(sanitizeRadar(many, "US")).toHaveLength(12);
  });
});

describe("applyTrendEvidence", () => {
  it("gerçek Google Trends momentumunu kullanır ve skoru karıştırır", () => {
    const merged = applyTrendEvidence(seed({ winner_score: 80, momentum: 3 }), evidence());
    // trendScore = 50 + 20*0.8 = 66 → 80*0.65 + 66*0.35 = 75.1 → 75
    expect(merged.momentum).toBe(20);
    expect(merged.winner_score).toBe(75);
    // Gerekçe ölçülmüş kanıtı taşımalı.
    expect(merged.reason).toContain('Google Trends "test urun": +20% / 30 gün');
    expect(merged.reason.length).toBeLessThanOrEqual(240 + 60);
  });

  it("negatif momentumda skoru düşürür (abartılı skor kalmaz)", () => {
    const merged = applyTrendEvidence(
      seed({ winner_score: 90 }),
      evidence({ trend_momentum_pct: -30 }),
    );
    // trendScore = 50 - 24 = 26 → 90*0.65 + 26*0.35 = 67.6 → 68
    expect(merged.momentum).toBe(-30);
    expect(merged.winner_score).toBe(68);
    expect(merged.winner_score).toBeLessThan(90);
  });

  it("tahmini veri geldiğinde skoru uydurmaz, yalnız momentumu tazeler", () => {
    const merged = applyTrendEvidence(
      seed({ winner_score: 77 }),
      evidence({ trend_source: "estimated", trend_momentum_pct: -4 }),
    );
    expect(merged.winner_score).toBe(77);
    expect(merged.momentum).toBe(-4);
    // Tahmini veride gerekçeye kanıt uydurulmaz.
    expect(merged.reason).not.toContain("Google Trends");
  });
});

describe("yedek yol (AI motorları düşerse)", () => {
  it("en az 10 ürün ve benzersiz başlık içerir — insert tekrar yüzünden düşmez", () => {
    expect(RADAR_TREND_KEYWORDS.length).toBeGreaterThanOrEqual(10);
    const keys = RADAR_TREND_KEYWORDS.map((k) => k.title.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of RADAR_TREND_KEYWORDS) {
      expect(k.keyword.trim().length).toBeGreaterThan(1);
      expect(k.price_max).toBeGreaterThan(k.price_min);
      expect(k.est_margin_pct).toBeGreaterThan(0);
    }
  });

  it("seeds'i ülkeye göre üretir ve sanitizeRadar'dan geçer", () => {
    const seeds = trendFallbackSeeds("TR");
    expect(seeds.length).toBeGreaterThanOrEqual(10);
    expect(seeds.every((s) => s.country === "TR")).toBe(true);
    expect(sanitizeRadar(seeds, "TR")).toHaveLength(seeds.length);
  });
});

describe("radarPrompt", () => {
  it("benzersiz ürün ve doğrulanabilir keyword ister", () => {
    const prompt = radarPrompt("US", 10);
    expect(prompt).toContain("UNIQUE");
    expect(prompt).toContain("keyword");
    expect(prompt).toContain("10 products");
    expect(prompt).toContain("US");
  });
});

describe("radarKeyword", () => {
  it("AI'nın verdiği doğrulama kelimesini, yoksa başlığı kullanır", () => {
    expect(radarKeyword({ keyword: "neck fan" }, "Portable Neck Fan")).toBe("neck fan");
    expect(radarKeyword({}, "Portable Neck Fan")).toBe("Portable Neck Fan");
    expect(radarKeyword(null, "Portable Neck Fan")).toBe("Portable Neck Fan");
  });
});
