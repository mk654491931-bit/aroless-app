import { describe, expect, it } from "vitest";

import { marketplaceSearchLinks, productSearchQuery, sourcingSearchLinks } from "./sourcing-links";

describe("productSearchQuery", () => {
  it("pazarlama dolgularını ve bağlaçları ayıklar", () => {
    const query = productSearchQuery(
      "Empresso Pratik ve Şık Seyahat Makyaj Organizeri, Oval Çift Gözlü Seyahat Takı Organizeri, Kompakt ve Kullanışlı Tasarım",
    );

    expect(query).toBe("Empresso Seyahat Makyaj Organizeri");
  });

  it("ürün kimliğini taşıyan sözcükleri ve model numarasını korur", () => {
    expect(productSearchQuery("Portable Ice Maker XR-500 Premium Quality")).toBe(
      "Portable Ice Maker XR-500",
    );
  });

  it("çok uzun başlığı ilk 8 anlamlı kelimeye indirir", () => {
    const query = productSearchQuery(
      "ECARTEKS Premium Quality Car Accessories Ecarteks Düz Deri Oto Bagaj Organizeri Fermuarlı Sürgülü Kulplu",
    );

    expect(query.split(" ")).toHaveLength(8);
    expect(query.startsWith("ECARTEKS Car Accessories")).toBe(true);
    expect(query).not.toContain("Premium");
  });

  it("boş adda sorgu üretmez", () => {
    expect(productSearchQuery("")).toBe("");
    expect(productSearchQuery("   ")).toBe("");
  });
});

describe("sourcingSearchLinks", () => {
  it("Türkçe ürün adını üç toptan aramasına çevirir", () => {
    const links = sourcingSearchLinks("Makyaj & Takı Organizeri");

    expect(links.map((link) => link.label)).toEqual(["AliExpress", "Alibaba", "Made-in-China"]);
    expect(links[0]?.url).toContain("makyaj-taki-organizeri");
    expect(links.every((link) => link.url.startsWith("https://"))).toBe(true);
    expect(links.every((link) => !link.url.includes(" "))).toBe(true);
  });

  it("uzun pazaryeri başlığında sadeleştirilmiş sorguyu kullanır", () => {
    const links = sourcingSearchLinks(
      "Empresso Pratik ve Şık Seyahat Makyaj Organizeri, Oval Çift Gözlü Tasarım",
    );

    expect(links[0]?.url).toContain("empresso-seyahat-makyaj-organizeri");
    expect(links[0]?.url).not.toContain("pratik");
  });

  it("boş ürün adında bağlantı üretmez", () => {
    expect(sourcingSearchLinks("")).toEqual([]);
    expect(sourcingSearchLinks("   ")).toEqual([]);
  });
});

describe("marketplaceSearchLinks", () => {
  it("ölçülen tek ilanın yanında diğer pazaryerlerini aratır", () => {
    const links = marketplaceSearchLinks("Deri Cüzdan");

    expect(links.map((link) => link.label)).toEqual(["Amazon", "Trendyol", "Hepsiburada"]);
    expect(links.every((link) => link.url.includes("Deri%20C%C3%BCzdan"))).toBe(true);
  });
});
