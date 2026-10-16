/**
 * A/B ÖLÇÜMÜ — `deal-feed` kaynağının aday havuzuna GERÇEK katkısı.
 *
 * NEDEN: "ücretsiz kaynak ekledim" bir İDDİADIR; ölçüm olmadan kalite
 * arttı demek mümkün değil. Bu test AYNI ağ koşusunda kaynağı VAR ve YOK
 * çalıştırıp farkı yazdırır (yalnız okuma; hiçbir alan uydurulmaz).
 *
 * Kullanım (normal `npm test` koşusunda ATLANIR):
 *   PRODUCT_DISCOVERY_AB=1 npx vitest run src/lib/product-discovery-dealfeed-ab.live.test.ts
 *
 * ÖLÇÜLEN SONUÇ (2026-10-16, canlı ağ, ülke US, 9 sn dilim):
 *
 * | Niş | Aday (kaynak YOK → VAR) | Fiyatlı | Markalı | ≥4/5 kanıt |
 * | --- | --- | --- | --- | --- |
 * | air fryer | 22 → **34** | 22 → 34 | 5 → 8 | 21 → 33 |
 * | robot vacuum | 19 → **31** | 19 → 31 | 11 → 15 | 16 → 26 |
 *
 * Yani aynı dilimde aday havuzu %55-63 büyüdü ve her yeni satır GERÇEK
 * fiyat taşıyor; kaynak ~1,0-1,4 sn'de dönüyor (dilim tavanının altında).
 */
import { describe, expect, it } from "vitest";

import { PRODUCT_SOURCES, runSources } from "./product-discovery-sources.server";
import { filterAndPreRank } from "./product-discovery-filter.server";

const ON = process.env.PRODUCT_DISCOVERY_AB === "1";
const NICHES = (process.env.PRODUCT_DISCOVERY_AB_NICHES ?? "air fryer").split(",");

type Stats = {
  raw: number;
  survivors: number;
  price: number;
  brand: number;
  category: number;
  rated: number;
  ratingSum: number;
  rich: number;
  sources: string[];
};

function summarize(
  rows: readonly { source?: string }[],
  survivors: Record<string, unknown>[],
): Stats {
  const s = survivors as unknown as {
    priceUsd: number | null;
    brand: string;
    category: string;
    rating: number | null;
    ratingCount: number | null;
    dataCompleteness: number;
  }[];
  return {
    raw: rows.length,
    survivors: s.length,
    price: s.filter((p) => p.priceUsd !== null).length,
    brand: s.filter((p) => Boolean(p.brand)).length,
    category: s.filter((p) => Boolean(p.category)).length,
    rated: s.filter((p) => p.rating !== null).length,
    ratingSum: s.reduce((acc, p) => acc + (p.ratingCount ?? 0), 0),
    rich: s.filter((p) => p.dataCompleteness >= 4).length,
    sources: [...new Set(rows.map((r) => r.source ?? "?"))],
  };
}

describe.skipIf(!ON)("A/B: deal-feed katkısı (canlı ağ)", () => {
  for (const niche of NICHES) {
    it(`"${niche}" — kaynak VAR / YOK`, async () => {
      const withDeals = PRODUCT_SOURCES;
      const without = PRODUCT_SOURCES.filter((s) => s.name !== "deal-feed");

      const a = await runSources(niche, withDeals, { country: "US", capMs: 9_000 });
      const b = await runSources(niche, without, { country: "US", capMs: 9_000 });

      const sa = summarize(
        a.products,
        filterAndPreRank(a.products, { nicheMomentumPct: null, nicheEngagement: 100 }).survivors,
      );
      const sb = summarize(
        b.products,
        filterAndPreRank(b.products, { nicheMomentumPct: null, nicheEngagement: 100 }).survivors,
      );

      const dealReport = a.reports.find((r) => r.name === "deal-feed");
      const fmt = (s: Stats) =>
        `ham ${String(s.raw).padStart(3)} · aday ${String(s.survivors).padStart(3)} · fiyat ${s.price} · marka ${s.brand} · kategori ${s.category} · puanlı ${s.rated} · ¥değerlendirme ${s.ratingSum} · ≥4 kanıt ${s.rich}`;
      /* eslint-disable no-console */
      console.log(`\n[AB] "${niche}" / US`);
      console.log(
        `   deal-feed raporu: ${dealReport?.ok ? "ok" : "HATA"} ${dealReport?.items ?? 0} satır ${dealReport?.ms ?? 0}ms`,
      );
      console.log(`   VAR : ${fmt(sa)}`);
      console.log(`   YOK : ${fmt(sb)}`);
      console.log(
        `   FARK: aday ${sa.survivors - sb.survivors >= 0 ? "+" : ""}${sa.survivors - sb.survivors} · fiyat ${sa.price - sb.price >= 0 ? "+" : ""}${sa.price - sb.price} · marka ${sa.brand - sb.brand >= 0 ? "+" : ""}${sa.brand - sb.brand}\n`,
      );
      /* eslint-enable no-console */

      expect(a.reports.length).toBeGreaterThan(b.reports.length);
      expect(a.products.length).toBeGreaterThanOrEqual(b.products.length);
    }, 40_000);
  }
});
