/**
 * runScrapeJob'ın GERÇEK süresi ölçülür (iç kaynaklar farklı URL kullanıyor).
 * Kullanım: VELORA_RADAR_TIMING=1 npx vitest run velora-radar-timing.live
 */
import { describe, expect, it } from "vitest";

import { runScrapeJob } from "./trend-radar.server";

const LIVE = process.env.VELORA_RADAR_TIMING === "1";
const SOURCES = ["Google", "Amazon", "TikTok", "Yandex", "RSS", "GitHub"] as const;

describe.skipIf(!LIVE)("Trend Radar süre profili", () => {
  for (const subset of [SOURCES, SOURCES.filter((s) => s !== "Amazon")]) {
    it(`ölçer: ${subset.join("+")}`, async () => {
      const t0 = Date.now();
      const job = await runScrapeJob({
        region: "US",
        category: "General",
        sources: [...subset],
        niche: "robot vacuum",
      });
      const ms = Date.now() - t0;
      /* eslint-disable no-console */
      console.log(`\n[RADAR] ${subset.length} kaynak → ${ms}ms · ${job.trends.length} trend`);
      for (const s of job.statuses) {
        console.log(
          `   ${s.source.padEnd(8)} ${s.status.padEnd(7)} ${String(s.items).padStart(3)}  ${s.detail}`,
        );
      }
      /* eslint-enable no-console */
      expect(ms).toBeLessThan(30_000);
    }, 30_000);
  }
});
