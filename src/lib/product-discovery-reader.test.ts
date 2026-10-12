import { describe, expect, it } from "vitest";
import { dedupeRows, parseHepsiburada, parseN11, parseTry } from "./product-discovery-reader.server";

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
    const md = "[![Image 235: Stanley Quencher 1.18 L Pipetli Termos Bardak](https://n11scdn.akamaized.net/a1/200/x.jpg) ### Stanley Quencher 10 günün en düşük fiyatı! 1.489 TL **1.400 TL**](https://www.n11.com/urun/stanley-quencher-118?x=1)";
    const [r] = parseN11(md);
    expect(r.priceTry).toBe(1400);
  });
  it("aynı ürünü tek satıra indirir", () => {
    const a = { title: "Cam Bardak 6lı", url: "u1", imageUrl: "i", priceTry: 1, rating: null, ratingCount: null, site: "n11" as const };
    expect(dedupeRows([a, { ...a, url: "u2" }])).toHaveLength(1);
  });
});

import { applyHardFilter, MIN_COMMERCE_POOL } from "./product-discovery-filter.server";
describe("ticari kanıt kapısı", () => {
  const base = (name: string, extra: Record<string, unknown>) =>
    ({ name, source: "scraped", sources: [], brand: "", seller: "", priceUsd: null, rating: null, ratingCount: null,
       inStock: null, url: "", notes: "", imageUrl: "", category: "", viewed90d: null, salesVolume: null,
       dataCompleteness: 1, preScore: 50, signals: {}, ...extra }) as never;
  it("yeterli gerçek ürün varsa fiyatsız/puansız sinyal satırlarını eler", () => {
    const real = Array.from({ length: MIN_COMMERCE_POOL }, (_, i) => base(`Cam Bardak Model ${i}`, { priceUsd: 5 + i }));
    const junk = base("someuser/github-repo", { preScore: 99 });
    const { survivors } = applyHardFilter([...real, junk]);
    expect(survivors.map((p: { name: string }) => p.name)).not.toContain("someuser/github-repo");
    expect(survivors).toHaveLength(MIN_COMMERCE_POOL);
  });
});
