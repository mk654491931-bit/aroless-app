import { beforeEach, describe, expect, it } from "vitest";
import {
  buildToolHistoryCsv,
  buildToolReport,
  clearToolRuns,
  formatToolRunTime,
  latestToolRun,
  listToolRuns,
  removeToolRun,
  saveToolRun,
  tableToTsv,
  type ToolRunResult,
} from "./tool-report";

const RESULT: ToolRunResult = {
  headline: "Marj %31 ile girilir; kritik eşik $9.40 COGS.",
  verdict: "GİRİLİR — marj %31",
  score: 78,
  metrics: [
    { label: "Maks. COGS", value: "$9.40", tone: "profit" },
    { label: "Kanal kesintisi", value: "$17.99", tone: "warning" },
  ],
  bullets: ["Amazon US komisyonu %15.", "İade rezervi %5."],
  table: {
    columns: ["Kanal", "Net kâr"],
    rows: [
      ["Amazon US", "$12.00"],
      ["Etsy", "$10.50"],
    ],
  },
  document: "SAYIN TEDARİKÇİ,\nFiyat hedefi $2.40.",
  risks: ["Kur oynaklığı bakiye ödemesini büyütür."],
  actions: ["Numune siparişini 7 gün içinde ver."],
  assumptions: ["FBA ücreti 2026 tarifesine göre."],
  provider: "hibrit: gemini + groq → sentez",
  providers: ["gemini", "groq"],
  confidence: 84,
  sources: [{ label: "Canlı FX · open.er-api.com", url: "https://open.er-api.com" }],
};

const RUN_INPUT = {
  toolId: "reverse-cost",
  title: "Reverse Cost Engineer",
  input: { product: "Yoga bloğu", retail: "39.99" },
  result: RESULT,
  ranAt: "2026-11-25T10:00:00.000Z",
};

describe("tool-report", () => {
  beforeEach(() => clearToolRuns());

  it("Markdown raporu karar, metrik, tablo, belge ve kaynakları taşır", () => {
    const run = saveToolRun(RUN_INPUT);
    expect(run).not.toBeNull();
    const report = buildToolReport(run!);
    expect(report).toContain("# Reverse Cost Engineer");
    expect(report).toContain("GİRİLİR — marj %31");
    expect(report).toContain("| Maks. COGS | $9.40 |");
    expect(report).toContain("| Amazon US | $12.00 |");
    expect(report).toContain("SAYIN TEDARİKÇİ");
    expect(report).toContain("**product:** Yoga bloğu");
    expect(report).toContain("Canlı FX");
    // Tablo hücresindeki boru karakteri Markdown'u bozmamalı.
    expect(report).not.toContain("| Metrik | Değer |\n| --- | --- |\n| Maks. COGS | $9.40 | Kanal");
  });

  it("aynı araçte geçmişi korur, en son çalışmayı başa alır", () => {
    saveToolRun(RUN_INPUT);
    saveToolRun({ ...RUN_INPUT, ranAt: "2026-11-25T11:00:00.000Z", title: "İkinci çalışma" });
    expect(listToolRuns()).toHaveLength(2);
    expect(latestToolRun("reverse-cost")?.title).toBe("İkinci çalışma");
  });

  it("silme ve temizleme tüm defteri tutarlı bırakır", () => {
    const run = saveToolRun(RUN_INPUT)!;
    removeToolRun(run.id);
    expect(listToolRuns()).toHaveLength(0);
    saveToolRun(RUN_INPUT);
    clearToolRuns();
    expect(listToolRuns()).toHaveLength(0);
    expect(latestToolRun("reverse-cost")).toBeNull();
  });

  it("boş sonucu deftere yazmaz (boş kart geçmişi kirletmez)", () => {
    expect(
      saveToolRun({
        ...RUN_INPUT,
        result: { ...RESULT, headline: "", metrics: [], bullets: [], table: null, document: null },
      }),
    ).toBeNull();
  });

  it("tablo TSV ve geçmiş CSV çıktısını kaçışlayarak üretir", () => {
    expect(tableToTsv(RESULT.table!)).toBe("Kanal\tNet kâr\nAmazon US\t$12.00\nEtsy\t$10.50");
    const run = saveToolRun({ ...RUN_INPUT, result: { ...RESULT, headline: 'Marj "31", iyi' } })!;
    const csv = buildToolHistoryCsv([run]);
    expect(csv.split("\n")[0]).toContain("calisma,arac,baslik");
    expect(csv).toContain('"Marj ""31"", iyi"');
  });

  it("zaman etiketini insan diline çevirir", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    expect(formatToolRunTime("2026-11-25T11:59:30.000Z", now)).toBe("az önce");
    expect(formatToolRunTime("2026-11-25T11:30:00.000Z", now)).toBe("30 dk önce");
    expect(formatToolRunTime("2026-11-25T09:00:00.000Z", now)).toBe("3 sa önce");
  });
});
