/**
 * ARAMA BRIEF'İ — ürün bulucunun gelişmiş alanları gerçekten hatta giriyor mu?
 *
 * Ölçülen boşluk: ana ekrandaki kategori/hedef kitle/bütçe alanları yalnız
 * klasik hatırda kullanılıyordu. Kanıtlı keşif hattı bu alanları hiç görmüyor,
 * `/discover` ise 8/10 sonuç istendiğinde 5'te kırpılıyordu. Bu testler o
 * kopukluğun geri gelmesini engeller.
 */
import { describe, expect, it } from "vitest";

import { ProductDiscoveryInputSchema, discoveryBriefLine } from "./product-discovery.types";
import {
  DISCOVERY_FINAL_N,
  DISCOVERY_MAX_FINAL_N,
  buildShortlistPrompt,
  buildTopProducts,
} from "./product-discovery-pipeline.server";
import { buildAgentPrompt } from "./product-discovery-council-ai.server";

describe("arama brief'i", () => {
  it("şema gelişmiş alanları kabul eder; eski istemci alanları göndermese de çalışır", () => {
    const parsed = ProductDiscoveryInputSchema.parse({
      niche: "air fryer",
      category: "Ev & Yaşam",
      audience: "küçük dairede yaşayanlar",
      budget: "$500 - $2,000",
    });
    expect(parsed.category).toBe("Ev & Yaşam");
    expect(parsed.audience).toBe("küçük dairede yaşayanlar");
    expect(parsed.budget).toBe("$500 - $2,000");

    const legacy = ProductDiscoveryInputSchema.parse({ niche: "air fryer" });
    expect(legacy.category).toBeUndefined();
    expect(legacy.audience).toBeUndefined();
    expect(legacy.budget).toBeUndefined();
  });

  it("brief hedef bağlamını taşır, 'Any' ve 'General' gibi boş değerleri yazmaz", () => {
    const line = discoveryBriefLine({
      country: "US",
      platform: "Amazon",
      category: "Ev & Yaşam",
      audience: "küçük dairede yaşayanlar",
      budget: "$500 - $2,000",
    });
    expect(line).toContain("pazar US");
    expect(line).toContain("kanal Amazon");
    expect(line).toContain("kategori Ev & Yaşam");
    expect(line).toContain("hedef kitle küçük dairede yaşayanlar");
    expect(line).toContain("başlangıç bütçesi");

    const empty = discoveryBriefLine({ country: "US", platform: "Genel", category: "Any" });
    expect(empty).toContain("pazar US");
    expect(empty).not.toContain("kategori");
    expect(empty).not.toContain("kanal");
    expect(empty).not.toContain("Genel");
  });

  it("kısa liste ve 14 ajan istemleri brief'i görür", () => {
    const brief = discoveryBriefLine({
      country: "US",
      platform: "Amazon",
      audience: "bebekli aileler",
    });
    const shortlist = buildShortlistPrompt([], "air fryer", "tr", brief);
    expect(shortlist).toContain(brief);
    expect(shortlist).toContain("bebekli aileler");

    const agent = buildAgentPrompt(
      { key: "cfo", name: "CFO Agent", task: "Unit economics" },
      [],
      "air fryer",
      "tr",
      brief,
    );
    expect(agent).toContain(brief);
    expect(agent).toContain("bebekli aileler");
  });
});

describe("istenen sonuç sayısı", () => {
  it("8/10 seçimi 5'te kırpılmaz; varsayılan 5 ve tavan 10'dur", () => {
    expect(DISCOVERY_FINAL_N).toBe(5);
    expect(DISCOVERY_MAX_FINAL_N).toBe(10);

    const rows = Array.from({ length: 8 }, (_, i) => ({
      fingerprint: `fp-${i}`,
      name: `Ürün ${i}`,
      councilScore: 90 - i,
      priceUsd: 20 + i,
      signals: { demand: 80, margin: 70, competition: 60 },
    }));
    expect(buildTopProducts(rows, 8).top_products).toHaveLength(8);
  });
});
