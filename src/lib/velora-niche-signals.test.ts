import { describe, expect, it } from "vitest";
import {
  VELORA_MIN_EVIDENCE_COVERAGE,
  complaintCount,
  emptyNicheSignals,
  evidenceCoverage,
  evidenceWarning,
  medianPrice,
  NicheSignalsSchema,
  nicheSignalsBlock,
  platformCount,
  priceSpread,
  redditEngagement,
  type NicheSignals,
} from "./velora-niche-signals";

function signals(overrides: Partial<NicheSignals> = {}): NicheSignals {
  return NicheSignalsSchema.parse({
    niche: "mini ice maker",
    country: "US",
    platform: "Amazon",
    collectedAt: "2026-09-25T10:00:00.000Z",
    ...overrides,
  });
}

describe("saf türetmeler — sayı uydurmaz", () => {
  it("fiyat yoksa medyan 0 DEĞİL, null'dur", () => {
    expect(medianPrice([])).toBeNull();
    expect(medianPrice([{ platform: "Amazon", priceUsd: 0 }])).toBeNull();
  });

  it("medyan tek ve çift örnekte doğrudur", () => {
    expect(medianPrice([{ platform: "a", priceUsd: 10 }])).toBe(10);
    expect(
      medianPrice([
        { platform: "a", priceUsd: 10 },
        { platform: "b", priceUsd: 20 },
      ]),
    ).toBe(15);
    expect(
      medianPrice([
        { platform: "a", priceUsd: 10 },
        { platform: "b", priceUsd: 20 },
        { platform: "c", priceUsd: 90 },
      ]),
    ).toBe(20);
  });

  it("fiyat aralığı tek örnekte üretilmez (yayılım ölçülemez)", () => {
    expect(priceSpread([{ platform: "a", priceUsd: 10 }])).toBeNull();
    expect(priceSpread([])).toBeNull();
    const spread = priceSpread([
      { platform: "a", priceUsd: 10 },
      { platform: "b", priceUsd: 25 },
    ]);
    expect(spread).toEqual({ min: 10, max: 25, ratio: 2.5 });
  });

  it("kanal çeşitliliği sayılır", () => {
    expect(
      platformCount([
        { platform: "Amazon", priceUsd: 10 },
        { platform: "Amazon", priceUsd: 12 },
        { platform: "eBay", priceUsd: 11 },
      ]),
    ).toBe(2);
    expect(platformCount([])).toBe(0);
  });

  it("şikâyet ve etkileşim toplamları yalnız VAR olan başlıklardan gelir", () => {
    const reddit = signals({
      reddit: [
        { title: "broke", subreddit: "a", score: 10, comments: 5, url: "", complaint: true },
        { title: "love it", subreddit: "b", score: 100, comments: 20, url: "", complaint: false },
      ],
    }).reddit;
    expect(complaintCount(reddit)).toBe(1);
    expect(redditEngagement(reddit)).toBe(135);
    expect(complaintCount([])).toBe(0);
    expect(redditEngagement([])).toBe(0);
  });
});

describe("kanıt kapsamı", () => {
  it("kaynak yoksa kapsam 0'dır", () => {
    expect(evidenceCoverage(signals())).toBe(0);
  });

  it("aktif kaynak sayısıyla 0-1 arası ölçeklenir ve 1'de tavanlanır", () => {
    const two = signals({
      sources: [
        { name: "A", status: "active", items: 3, detail: "" },
        { name: "B", status: "active", items: 2, detail: "" },
      ],
    });
    expect(evidenceCoverage(two)).toBe(0.25);
    const many = signals({
      sources: Array.from({ length: 20 }, (_, i) => ({
        name: `S${i}`,
        status: "active" as const,
        items: 1,
        detail: "",
      })),
    });
    expect(evidenceCoverage(many)).toBe(1);
  });

  it("items=0 olan 'aktif' kaynak kapsamı saymaz (dürüstlük)", () => {
    const empty = signals({
      sources: [{ name: "A", status: "active", items: 0, detail: "" }],
    });
    expect(evidenceCoverage(empty)).toBe(0);
  });

  it("kanıt zayıfsa ajan istemine açık uyarı satırı girer", () => {
    expect(evidenceWarning(signals())).toContain("EVIDENCE THIN");
    const strong = signals({
      sources: Array.from({ length: 8 }, (_, i) => ({
        name: `S${i}`,
        status: "active" as const,
        items: 4,
        detail: "",
      })),
    });
    expect(evidenceWarning(strong)).toBe("");
    expect(VELORA_MIN_EVIDENCE_COVERAGE).toBeGreaterThan(0);
  });
});

describe("emptyNicheSignals", () => {
  it("kazıma hiç çalışmasa da GEÇERLİ bir kanıt döner (hat düşmez)", () => {
    const empty = emptyNicheSignals({ niche: "x", country: "US", platform: "Amazon" });
    expect(empty.niche).toBe("x");
    expect(empty.live).toBe(false);
    expect(empty.sources).toEqual([]);
    expect(empty.retailMedianUsd).toBeNull();
    expect(empty.supplier).toBeNull();
    // Şema doğrulamasından geçer.
    expect(NicheSignalsSchema.safeParse(empty).success).toBe(true);
  });
});

describe("nicheSignalsBlock (prompt metni)", () => {
  it("fiyat yoksa 'uydurma' talimatı açıkça yazılır", () => {
    const block = nicheSignalsBlock(signals());
    expect(block).toContain("OBSERVED RETAIL PRICES: none captured");
    expect(block).toContain("do NOT invent price data");
    expect(block).toContain("SOURCING: no supplier price captured");
  });

  it("momentum ölçülemediyse 'ÖLÇÜLEMEDİ' der, sayı uydurmaz", () => {
    expect(nicheSignalsBlock(signals())).toContain("Google Trends momentum: ÖLÇÜLEMEDİ");
    expect(nicheSignalsBlock(signals({ trendMomentumPct: -12, trendSeries: [1, 2, 3] }))).toContain(
      "Google Trends momentum: -12%",
    );
  });

  it("ölçülen fiyat, tedarik ve kaynak durumu bloğa yazılır", () => {
    const block = nicheSignalsBlock(
      signals({
        priceSamples: [
          { platform: "Amazon", priceUsd: 39.99 },
          { platform: "AliExpress", priceUsd: 21.5 },
        ],
        retailMedianUsd: 30.75,
        supplier: { priceUsd: 18, shippingUsd: 4, live: true, sampleTitle: "x" },
        sources: [
          { name: "Reddit", status: "active", items: 5, detail: "" },
          { name: "GitHub", status: "error", items: 0, detail: "403" },
        ],
      }),
    );
    expect(block).toContain("median $30.75");
    expect(block).toContain("2 channel(s)");
    expect(block).toContain("LIVE scraped");
    expect(block).toContain("1/2 sources active");
    expect(block).toContain("unavailable: GitHub");
  });

  it("tedarik fiyatı tahminse bunu 'ESTIMATE' diye açıklar", () => {
    const block = nicheSignalsBlock(
      signals({ supplier: { priceUsd: 11, shippingUsd: 2, live: false, sampleTitle: "" } }),
    );
    expect(block).toContain("ESTIMATE, not scraped");
  });

  it("şikâyet sayısı toplam başlıkla birlikte yazılır", () => {
    const block = nicheSignalsBlock(
      signals({
        reddit: [
          { title: "broke", subreddit: "a", score: 5, comments: 1, url: "", complaint: true },
          { title: "nice", subreddit: "a", score: 5, comments: 1, url: "", complaint: false },
        ],
      }),
    );
    expect(block).toContain("(1 complaint / 2 total)");
    expect(block).toContain("⚠ complaint");
  });
});
