import { describe, expect, it } from "vitest";
import { buildDiscoveryCsv } from "./discovery-export";

describe("buildDiscoveryCsv", () => {
  it("ölçülen adayları ve kaynakları dışa aktarır", () => {
    const csv = buildDiscoveryCsv([
      {
        name: "Under sink organizer, 2 kat",
        brand: "Marka",
        seller: "Satıcı",
        category: "Kitchen",
        priceUsd: 24.9,
        rating: 4.5,
        salesVolume: 1200,
        viewed90d: null,
        councilScore: 82,
        sources: ["Amazon", "Etsy"],
        url: "https://ornek.com/u",
      },
    ]);
    expect(csv).toContain("Urun,Marka,Satici,Kategori");
    expect(csv).toContain('"Under sink organizer, 2 kat"');
    expect(csv).toContain("24.9,4.5,1200,,82,Amazon + Etsy,https://ornek.com/u");
  });

  it("ölçülmemiş alanları sıfır uydurmadan boş bırakır", () => {
    const csv = buildDiscoveryCsv([
      { name: "Ölçülmemiş ürün", priceUsd: null, rating: null, councilScore: null },
    ]);
    expect(csv).toContain("Ölçülmemiş ürün,,,,,,,,");
  });
});
