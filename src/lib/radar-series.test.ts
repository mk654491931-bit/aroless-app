import { describe, expect, it } from "vitest";

import {
  buildRadarSeries,
  radarDigestLines,
  radarMovers,
  RADAR_FLAG_LABEL,
  seriesKey,
  sparklinePath,
} from "./radar-series";

const row = (
  day: string,
  over: Partial<{ title: string; winner_score: number; momentum: number; price_min: number; price_max: number; est_margin_pct: number }> = {},
) => ({
  day,
  title: "Air Fryer 6 Qt Digital",
  winner_score: 70,
  momentum: 5,
  price_min: 40,
  price_max: 60,
  est_margin_pct: 30,
  ...over,
});

describe("seriesKey", () => {
  it("aynı ürünün farklı yazımlarını birleştirir (ilk 4 kelime)", () => {
    expect(seriesKey("Air Fryer 6 Qt Digital — Siyah")).toBe(seriesKey("air fryer 6 qt digital siyah"));
  });
});

describe("buildRadarSeries", () => {
  it("günleri eskiden yeniye dizer ve hareketi hesaplar", () => {
    const [s] = buildRadarSeries([
      row("2026-10-10", { winner_score: 60, momentum: 2, price_min: 50 }),
      row("2026-10-12", { winner_score: 74, momentum: 9, price_min: 45 }),
      row("2026-10-11", { winner_score: 66, momentum: 5, price_min: 48 }),
    ]);
    expect(s!.days).toBe(3);
    expect(s!.points.map((p) => p.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(s!.scoreDelta).toBe(14);
    expect(s!.momentumDelta).toBe(7);
    // 50 → 45 = -%10
    expect(s!.priceChangePct).toBe(-10);
    expect(s!.flags).toContain("yeniden-yukselis");
    expect(s!.flags).toContain("fiyat-dusuyor");
    expect(s!.spark).toEqual([60, 66, 74]);
  });

  it("tek günlük kaydı trend saymaz (minPoints)", () => {
    expect(buildRadarSeries([row("2026-10-12")])).toHaveLength(0);
    expect(buildRadarSeries([row("2026-10-12")], { minPoints: 1 })).toHaveLength(1);
  });

  it("fiyat ölçülmediyse (0) yüzde değişim NULL kalır — sıfır varsayılmaz", () => {
    const [s] = buildRadarSeries([
      row("2026-10-11", { price_min: 0, price_max: 0 }),
      row("2026-10-12", { price_min: 0, price_max: 0 }),
    ]);
    expect(s!.priceChangePct).toBeNull();
  });

  it("aynı gün tekrar üretiminde EN YÜKSEK skorlu kayıt alınır", () => {
    const [s] = buildRadarSeries([
      row("2026-10-11", { winner_score: 55 }),
      row("2026-10-12", { winner_score: 60 }),
      row("2026-10-12", { winner_score: 88 }),
    ]);
    expect(s!.days).toBe(2);
    expect(s!.spark[1]).toBe(88);
  });

  it("düşen seri momentum kırıldı bayrağı alır", () => {
    const [s] = buildRadarSeries([
      row("2026-10-11", { winner_score: 80, momentum: 12 }),
      row("2026-10-12", { winner_score: 62, momentum: 2 }),
    ]);
    expect(s!.flags).toContain("momentum-kirildi");
    expect(RADAR_FLAG_LABEL[s!.flags[0]!]).toBeTruthy();
  });
});

describe("radarMovers + digest", () => {
  // İki ürün, İKİ gün: yükselen skor ile düşen skor ayrı ayrı seri olur.
  const days = ["2026-10-11", "2026-10-12"];
  const rows = [
    ...days.map((d, i) =>
      row(d, { title: "Yükselen Ürün A", winner_score: 60 + i * 12, momentum: 3 + i * 4 }),
    ),
    ...days.map((d, i) =>
      row(d, { title: "Düşen Ürün B", winner_score: 80 - i * 15, momentum: 6 - i * 6 }),
    ),
  ];

  it("yükselenleri ve düşenleri ayırır", () => {
    const series = buildRadarSeries(rows, { minPoints: 2 });
    const { up, down } = radarMovers(series, 2);
    expect(up.every((s) => s.scoreDelta > 0)).toBe(true);
    expect(down.every((s) => s.scoreDelta < 0)).toBe(true);
  });

  it("özet satırları ürün başına TEK satır (kota koruması)", () => {
    const series = buildRadarSeries(rows, { minPoints: 2 });
    const lines = radarDigestLines(radarMovers(series, 3), { maxItems: 2 });
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0]).toContain("skor +");
  });
});

describe("sparklinePath", () => {
  it("2 noktadan azsa boş döner (arayüz düz nokta gösterir)", () => {
    expect(sparklinePath([5], 40, 12)).toBe("");
    expect(sparklinePath([], 40, 12)).toBe("");
  });

  it("M ile başlar, her ek nokta L üretir ve sınırların içinde kalır", () => {
    const path = sparklinePath([10, 20, 15], 60, 20, 2);
    expect(path.startsWith("M")).toBe(true);
    expect(path.match(/L/g)).toHaveLength(2);
    for (const [, , x, y] of path.matchAll(/([ML])([\d.]+),([\d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(60);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(20);
    }
  });

  it("düz seride sıfıra bölme yapmaz (NaN üretmez)", () => {
    const path = sparklinePath([5, 5, 5], 40, 12);
    expect(path).not.toContain("NaN");
  });
});
