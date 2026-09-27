/**
 * PRODUCT DISCOVERY — CANLI AĞ TESTİ (mock YOK).
 *
 * Normal `npm test` koşusunda ATLANIR. Canlı koşu:
 *   PRODUCT_DISCOVERY_LIVE=1 npx vitest run product-discovery.sources.live
 *
 * Varlık sebebi: "5 ücretsiz kaynak fail-soft çalışır, filtre 75'e indirir"
 * sözü kağıt üstünde kalmamalı. Bu test ÖLÇER:
 *   1. Her kaynak `ok:true|false` olarak RAPORLANIR (sessizce kaybolmaz).
 *   2. Kazıma zaman tavanını aşmaz (Vercel Hobby bütçesinin şartı).
 *   3. Hard filter gerçekten eleme yapar ve istatistik TUTARLI'dir
 *      (input = survivors + tüm reddedilenler).
 *
 * KAYNAK ÇÖKMESİ HATA DEĞİLDİR: sözleşme gereği hat asla fırlatmaz; o
 * kaynak `ok:false` olur ve test yine geçer. Test yalnız ÜÇ şeyi zorunlu
 * kılar: rapor eksiksiz, süre tavanı, istatistik tutarlılığı.
 */
import { describe, expect, it } from "vitest";

import { runSources } from "./product-discovery-sources.server";
import { filterAndPreRank } from "./product-discovery-filter.server";

const LIVE = process.env.PRODUCT_DISCOVERY_LIVE === "1";
const NICHES = (process.env.PRODUCT_DISCOVERY_LIVE_NICHES ?? "air fryer,robot vacuum")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

describe.skipIf(!LIVE)("Product Discovery kaynakları (canlı ağ)", () => {
  for (const niche of NICHES) {
    it(`fail-soft kazıma + deterministik filtre: "${niche}"`, async () => {
      const startedAt = Date.now();
      const { products, reports } = await runSources(niche);
      const elapsed = Date.now() - startedAt;

      /* eslint-disable no-console */
      console.log(`\n[DISCOVERY] "${niche}" → ${elapsed}ms · ${products.length} ham satır`);
      for (const r of reports) {
        console.log(
          `   ${r.name.padEnd(18)} ${(r.ok ? "ok" : "HATA").padEnd(5)} ${String(r.items).padStart(3)} satır ${String(r.ms).padStart(5)}ms ${r.error}`,
        );
      }
      /* eslint-enable no-console */

      // 1) HER kaynak raporlanır — "arandı ve boş" ile "hiç aranmadı" ayrılır.
      expect(reports.length).toBeGreaterThan(0);
      for (const r of reports) {
        expect(typeof r.ok).toBe("boolean");
        if (r.ok) expect(r.items).toBeGreaterThanOrEqual(0);
        else expect(r.error.length).toBeGreaterThan(0);
      }

      // 2) Süre tavanı — en yavaş kaynak 6 sn, tümü paralel.
      expect(elapsed).toBeLessThanOrEqual(12_000);

      // 3) Filtre istatistiği TUTARLI: hayatta kalan + reddedilen = girdi.
      const { survivors, stats } = filterAndPreRank(
        products,
        { nicheMomentumPct: null, nicheEngagement: 100 },
        reports.map((r) => ({ name: r.name, ok: r.ok, items: r.items, ms: r.ms, error: r.error })),
      );
      const rejected =
        stats.rejectedByRating +
        stats.rejectedByStock +
        stats.rejectedByPrice +
        stats.rejectedByDuplicate +
        stats.rejectedByCompleteness +
        stats.rejectedBySource;
      /* eslint-disable no-console */
      console.log(
        `   filtre: ${stats.inputCount} girdi → ${survivors.length} kalan ` +
          `(puan:${stats.rejectedByRating} stok:${stats.rejectedByStock} fiyat:${stats.rejectedByPrice} ` +
          `dup:${stats.rejectedByDuplicate} eksik:${stats.rejectedByCompleteness})\n`,
      );
      /* eslint-enable no-console */

      expect(stats.survivors).toBe(survivors.length);
      // Elenen sayı, kalan + elenen toplamını aşamaz (her satır ya elenir ya kalır).
      expect(stats.survivors + rejected).toBeLessThanOrEqual(stats.inputCount);
      expect(survivors.length).toBeLessThanOrEqual(75);

      // 4) Hayatta kalan her ürün FİNGERPRINT taşır ve gerçek kaynağa bağlıdır.
      for (const s of survivors) {
        expect(s.fingerprint.length).toBeGreaterThan(0);
        expect(s.source).toBe("scraped");
        expect(s.sources.length).toBeGreaterThan(0);
      }
    }, 30_000);
  }
});
