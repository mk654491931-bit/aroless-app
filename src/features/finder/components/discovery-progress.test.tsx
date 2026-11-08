import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiscoveryStats } from "./discovery-progress";
import type { FilterStats } from "@/lib/product-discovery.types";

/**
 * ANAHTARSIZ KAYNAK, "ÇALIŞAN" ROZETİ ALMAZ.
 *
 * Sunucu anahtarsız kaynağı çağırmadan `ok:false` + "anahtar tanımlı değil"
 * döndürür. Panel bunu ayrı bir \"Anahtarsız (çağrılmadı)\" satırında
 * göstermeli; aksi hâlde kullanıcı kaynağın çalıştığını sanır.
 */
function stats(perSource: FilterStats["perSource"]): FilterStats {
  return {
    inputCount: 2,
    rejectedByRating: 0,
    rejectedByStock: 0,
    rejectedByPrice: 0,
    rejectedByDuplicate: 0,
    rejectedByCompleteness: 0,
    rejectedBySource: 0,
    rejectedByAccessory: 0,
    survivors: 2,
    perSource,
  };
}

describe("DiscoveryStats — kaynak sağlığı", () => {
  it("anahtarsız kaynağı \"Anahtarsız (çağrılmadı)\" olarak ayırır", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStats
        stats={stats([
          {
            name: "ebay-browse",
            ok: false,
            items: 0,
            ms: 0,
            error: "anahtar tanımlı değil: EBAY_CLIENT_ID + EBAY_CLIENT_SECRET",
          },
          { name: "tavily-search", ok: true, items: 4, ms: 120, error: "" },
        ])}
      />,
    );

    expect(html).toContain("Anahtarsız (çağrılmadı)");
    expect(html).toContain("eBay");
    expect(html).toContain("Tavily");
    expect(html).not.toContain("Çalışmayan:");
  });

  it("aksesuar elemesini toplamda ve ayrı satırda gösterir", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStats
        stats={{ ...stats([]), inputCount: 5, survivors: 1, rejectedByAccessory: 4 }}
      />,
    );

    expect(html).toContain("4 aksesuar/yedek parça");
    // Toplam "elendi" sayacı aksesuar elemesini de kapsar.
    expect(html).toContain(">4</div><div class=\"text-[10px] text-muted-foreground\">elendi</div>");
  });

  it("gerçek ağ hatasını anahtarsız kaynakla karıştırmaz", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStats
        stats={stats([
          { name: "ebay-browse", ok: false, items: 0, ms: 0, error: "anahtar tanımlı değil" },
          { name: "openfoodfacts", ok: false, items: 0, ms: 250, error: "HTTP 503" },
        ])}
      />,
    );

    expect(html).toContain("Anahtarsız (çağrılmadı): eBay");
    expect(html).toContain("Çalışmayan: Open Food Facts");
  });
});
