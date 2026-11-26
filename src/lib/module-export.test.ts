import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportDate,
  markdownCell,
  markdownTable,
  rowsToCsv,
  safeFilename,
} from "./module-export";

describe("module-export", () => {
  it("CSV hücresinde virgül, tırnak ve satır sonunu kaçırır", () => {
    expect(csvCell("düz metin")).toBe("düz metin");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell("a\nb")).toBe("a b");
    expect(csvCell(null)).toBe("");
  });

  it("başlık ve satırları CSV'ye çevirir", () => {
    expect(
      rowsToCsv([
        ["Ürün", "Fiyat"],
        ["Kupa, büyük", 12.5],
      ]),
    ).toBe('Ürün,Fiyat\n"Kupa, büyük",12.5');
  });

  it("Markdown tablosunda boru ve satır sonunu temizler", () => {
    expect(markdownCell("a|b\nc")).toBe("a\\|b c");
    expect(
      markdownTable(
        ["Ürün", "Skor"],
        [
          ["Kupa", 88],
          ["Lamba", 72],
        ],
      ),
    ).toBe("| Ürün | Skor |\n| --- | --- |\n| Kupa | 88 |\n| Lamba | 72 |");
  });

  it("boş başlıkta tablo üretmez", () => {
    expect(markdownTable([], [])).toBe("");
  });

  it("dosya adını Türkçe karakterlerden arındırır", () => {
    expect(safeFilename("Konsey Raporu — Isıtmalı Boyun Yastığı")).toBe(
      "konsey-raporu-isitmali-boyun-yastigi",
    );
    expect(safeFilename("viral-ads-2026-11-26.csv")).toBe("viral-ads-2026-11-26.csv");
    expect(safeFilename("---")).toBe("aroless");
  });

  it("tarih damgasını ISO günü olarak verir", () => {
    expect(exportDate(new Date("2026-11-26T22:10:00Z"))).toBe("2026-11-26");
  });
});
