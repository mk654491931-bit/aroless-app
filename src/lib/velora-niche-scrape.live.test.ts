/**
 * FAZ 0 CANLI AĞ TESTİ — gerçek kaynaklara karşı, mock YOK.
 *
 * Normal `npm test` koşusunda ATLANIR (ağ olmayan CI'da kırılmasın diye):
 * canlı koşu için  VELORA_LIVE_NETWORK=1 npx vitest run velora-niche-scrape.live
 *
 * Bu testin varlık sebebi: Faz 0'ın "8 ücretsiz kaynak paralel kazılır" sözü
 * kağıt üstünde kalmamalı. Aşağıdaki tablo, kaynakların gerçekten yanıt verip
 * vermediğini ve tavanın aşılmadığını ÖLÇER; ölçülen sonuç konsola yazılır.
 *
 * Bir kaynağın çevrimdışı olması bir HATA değildir — sözleşme gereği hat asla
 * fırlatmaz, o kaynak `error` olarak raporlanır. Test yalnız iki şeyi zorunlu
 * kılar: (1) süre tavanı aşılmaz, (2) kanıt bloğu ajanlara gösterilebilir
 * uzunluktadır.
 */
import { describe, expect, it } from "vitest";

import { harvestNicheSignals, VELORA_HARVEST_BUDGET_MS } from "./velora-niche-scrape.server";
import { nicheSignalsBlock } from "./velora-niche-signals";

const LIVE = process.env.VELORA_LIVE_NETWORK === "1";
const NICHES = (process.env.VELORA_LIVE_NICHES ?? "robot vacuum,air fryer,dog harness")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

describe.skipIf(!LIVE)("Faz 0 niş kazıması (canlı ağ)", () => {
  for (const niche of NICHES) {
    it(`kazıma tavanı aşmadan kanıt toplar: "${niche}"`, async () => {
      const startedAt = Date.now();
      const signals = await harvestNicheSignals({ niche, country: "US" });
      const elapsed = Date.now() - startedAt;

      /* eslint-disable no-console */
      console.log(`\n[FAZ 0] "${niche}" → ${elapsed}ms · canlı=${signals.live} · kaynak:`);
      for (const source of signals.sources) {
        console.log(
          `        ${source.name.padEnd(22)} ${source.status.padEnd(7)} ${String(source.items).padStart(3)} kayıt ${source.detail}`,
        );
      }
      console.log(
        `        kanıt: ${signals.reddit.length} reddit (${signals.reddit.filter((r) => r.complaint).length} şikâyet) · ` +
          `${signals.priceSamples.length} fiyat (medyan ${signals.retailMedianUsd ?? "YOK"}) · ` +
          `${signals.trendSeries.length} trend ayı (momentum ${signals.trendMomentumPct ?? "YOK"}) · ` +
          `${signals.news.length} haber · ${signals.radar.length} radar · ${signals.github.length} repo\n`,
      );
      /* eslint-enable no-console */

      // 1) Tavan aşılmaz — Vercel Hobby + QStash bütçesinin temel şartı.
      expect(elapsed).toBeLessThanOrEqual(VELORA_HARVEST_BUDGET_MS + 1_000);

      // 2) Ajanlara gösterilecek blok üretilebilir ve yeterince doludur.
      const block = nicheSignalsBlock(signals);
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain(niche);

      // 3) Zorunlu alan sözleşmesi: kaynak tablosu boş olamaz.
      expect(signals.sources.length).toBeGreaterThan(0);
    });
  }
});
