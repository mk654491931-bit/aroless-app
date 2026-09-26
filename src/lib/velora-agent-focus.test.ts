import { describe, expect, it } from "vitest";
import { COUNCIL_AGENTS, type CouncilAgentKey } from "./council-chain.server";
import { agentFocusBlock, agentFocusLineCount } from "./velora-agent-focus";
import { NicheSignalsSchema, type NicheSignals } from "./velora-niche-signals";

const NAMES = ["Mini Ice Maker XR-500", "Silicone Ice Mold"];

function rich(): NicheSignals {
  return NicheSignalsSchema.parse({
    niche: "mini ice maker",
    country: "DE",
    platform: "Amazon",
    collectedAt: "2026-09-25T10:00:00.000Z",
    trendSeries: [40, 50, 60],
    trendMomentumPct: 18,
    googleRising: ["ice maker for small room"],
    tiktok: ["mini ice maker hack"],
    amazonMovers: ["portable ice maker"],
    reddit: [
      {
        title: "This mini ice maker broke in a week",
        subreddit: "BuyItForLife",
        score: 120,
        comments: 40,
        url: "",
        complaint: true,
      },
    ],
    hackerNews: [{ title: "Show HN: ice maker", points: 60, comments: 25, url: "" }],
    priceSamples: [
      { platform: "Amazon", priceUsd: 39.99 },
      { platform: "AliExpress", priceUsd: 21.5 },
    ],
    retailMedianUsd: 30.75,
    supplier: { priceUsd: 18, shippingUsd: 4, live: true, sampleTitle: "portable ice maker" },
    news: [{ title: "Ice maker demand grows", source: "Retail Dive", url: "" }],
    github: [{ fullName: "acme/ice", stars: 120, description: "scraper", topics: [] }],
    radar: ["TikTok: mini ice maker"],
    sources: [
      { name: "Reddit", status: "active", items: 5, detail: "" },
      { name: "GitHub", status: "error", items: 0, detail: "403" },
    ],
    live: true,
  });
}

const empty = (): NicheSignals =>
  NicheSignalsSchema.parse({
    niche: "mini ice maker",
    country: "GLOBAL",
    platform: "General",
  });

const blockFor = (key: CouncilAgentKey, s = rich()) => agentFocusBlock(key, s, NAMES) ?? "";

describe("agentFocusBlock — 14 ajanın HEPSİ kendi dilimini alır", () => {
  it("her ajan için tanımlı, boş olmayan bir dilim üretilir", () => {
    for (const agent of COUNCIL_AGENTS) {
      const block = blockFor(agent.key);
      expect(block, agent.key).toBeTruthy();
      expect(block).toContain("YOUR SPECIALIST EVIDENCE");
      expect(agentFocusLineCount(block)).toBeGreaterThanOrEqual(3);
    }
  });

  it("dilimler AYDIR: iki ajan aynı metni almaz", () => {
    const blocks = new Set(COUNCIL_AGENTS.map((agent) => blockFor(agent.key)));
    expect(blocks.size).toBe(COUNCIL_AGENTS.length);
  });

  it("bilinmeyen ajan anahtarı sessizce sahte dilim üretmez", () => {
    expect(agentFocusBlock("yok-boyle-bir-ajan" as CouncilAgentKey, rich(), NAMES)).toBeUndefined();
    expect(agentFocusLineCount(undefined)).toBe(0);
  });
});

describe("uzmanlık alanına özel kanıt", () => {
  it("CFO gözlenen fiyatı ve brüt marjı görür", () => {
    const cfo = blockFor("cfo");
    expect(cfo).toContain("GÖZLENEN PERAKENDE FİYAT");
    expect(cfo).toContain("$30.75");
    expect(cfo).toContain("GÖZLENEN BRÜT MARJ");
    expect(cfo).toContain("TEDARİKÇİ MALİYETİ");
  });

  it("UX ajanı gerçek şikâyet cümlesini görür", () => {
    const ux = blockFor("ux_specialist");
    expect(ux).toContain("ŞİKÂYET SİNYALİ");
    expect(ux).toContain("broke in a week");
  });

  it("creative_director TikTok kanca fikirlerini görür", () => {
    expect(blockFor("creative_director")).toContain("mini ice maker hack");
  });

  it("trend_hunter momentum + topluluk hacmini görür", () => {
    const block = blockFor("trend_hunter");
    expect(block).toContain("+18%");
    expect(block).toContain("Show HN: ice maker");
  });

  it("ucompliance ajanı HEDEF ÜLKEYE özel bariyeri görür (DE + elektronik)", () => {
    // Ürün metni pil/elektronik kalıbı içermiyor; bariyer eşleşmesi ölçülebilir.
    const block = blockFor("compliance_officer");
    expect(block).toContain("HEDEF ÜLKE: DE");
    expect(block).toContain("TESPİT EDİLMİŞ BARIYER");
    const battery = blockFor("compliance_officer", {
      ...rich(),
    });
    expect(battery).toContain("izin anlamına gelmez");
  });

  it("denetçi KAYNAK DURUMU tablosunu görür, düşen kaynak açıkça listelenir", () => {
    const block = blockFor("independent_data_auditor");
    expect(block).toContain("KAYNAK DURUMU (1/2 aktif)");
    expect(block).toContain("ERİŞİLEMEYEN KAYNAKLAR");
    expect(block).toContain("GitHub (403)");
  });

  it("kanal ajanı komisyon verisi yokken bunu açıkça söyler", () => {
    const block = blockFor("channel_fit");
    expect(block).toContain("KOMİSYON SONRASI MARJ: VERİ YOK");
    expect(block).toContain("GÖZLENEN KANALLAR: Amazon, AliExpress");
  });

  it("lojistik ajanı navlun oranını hesaplar", () => {
    // (18 + 4) / 30.75 ≈ %71.6
    const block = blockFor("logistics_cost");
    expect(block).toContain("NAVLUN + MALİYET / PERAKENDE ORANI");
    // (18 + 4) / 30.75 = %71.5
    expect(block).toContain("71.5");
  });
});

describe("veri yokken dürüstlük", () => {
  it("boş kanıtta hiçbir ajan SAYI UYDURMAZ, hepsi 'VERİ YOK' der", () => {
    for (const agent of COUNCIL_AGENTS) {
      const block = blockFor(agent.key, empty());
      expect(block, agent.key).toContain("VERİ YOK");
      expect(block, agent.key).not.toMatch(/\$[\d]/);
    }
  });

  it("fiyat kanıtı yoksa CFO marj uydurmaz", () => {
    const cfo = blockFor("cfo", empty());
    expect(cfo).toContain("GÖZLENEN BRÜT MARJ: VERİ YOK");
    expect(cfo).toContain("unit_economics_valid=false");
  });

  it("şikâyet yoksa UX ajanı `common_complaint` alanında veri olmadığını söyler", () => {
    expect(blockFor("ux_specialist", empty())).toContain("ŞİKÂYET ÖRNEĞİ: VERİ YOK");
  });

  it("tedarikçi fiyatı tahminse canlıymış gibi sunulmaz", () => {
    const block = blockFor("supply_chain", {
      ...empty(),
      supplier: { priceUsd: 11, shippingUsd: 2, live: false, sampleTitle: "" },
    });
    expect(block).toContain("TAHMİN (kazıma dönmedi)");
    expect(block).not.toContain("canlı kazınmış fiyat");
  });

  it("denetçi az kanıtta düşük güveni kendisi hesaplar", () => {
    const block = blockFor("independent_data_auditor", empty());
    // Kapsam 0 → denetçi düşük güveni kendisi hesaplar, "yeterli veri" demez.
    expect(block).toContain("KAYNAK DURUMU (0/0 aktif)");
    expect(block).toContain("gözlenen perakende fiyat YOK");
  });
});
