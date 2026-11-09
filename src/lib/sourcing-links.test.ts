import { describe, expect, it } from "vitest";

import { marketplaceSearchLinks, sourcingSearchLinks } from "./sourcing-links";

describe("sourcingSearchLinks", () => {
  it("Türkçe ürün adını üç toptan aramasına çevirir", () => {
    const links = sourcingSearchLinks("Makyaj & Takı Organizeri");

    expect(links.map((link) => link.label)).toEqual(["AliExpress", "Alibaba", "Made-in-China"]);
    expect(links[0]?.url).toContain("makyaj-taki-organizeri");
    expect(links.every((link) => link.url.startsWith("https://"))).toBe(true);
    expect(links.every((link) => !link.url.includes(" "))).toBe(true);
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
