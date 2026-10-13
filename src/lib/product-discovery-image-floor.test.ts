/**
 * GÖRSEL KITLIĞI DOLDURUCUSU TESTLERİ (rapor P0-3).
 *
 * ÖLÇÜLEN SORUN: Hepsiburada sayfası 37 kart döndürüyor ama yalnız 12'sinde ürün
 * görseli var; görsel kapısı satırların ~%68'ini düşürüyordu ve bu kayıp
 * görünmüyordu. Doldurucu, fotoğraflı satır yetmediğinde listenin en çok %20'sini
 * görselsiz satırla doldurur; kart \"görsel doğrulanamadı\" der ve görsel ürünün
 * KENDİ sayfasından doğrulanmaya çalışılır (uydurma fotoğraf YOK).
 */
import { describe, expect, it } from "vitest";

import { cleanRawRows, imageFillCapFor } from "./product-discovery-shortlist.server";
import type { RawProduct } from "./product-discovery.types";

const row = (title: string, imageUrl: string): RawProduct => ({
  title,
  priceUsd: 29.99,
  url: `https://www.hepsiburada.com/${title.toLowerCase().replace(/\s+/g, "-")}-pm-HBC0000`,
  imageUrl,
  source: "tr-reader",
  seller: "Hepsiburada",
});

const freshStats = () => ({
  rejectedInvalid: 0,
  rejectedNotInStock: 0,
  rejectedPrice: 0,
  rejectedMissingImage: 0,
  admittedMissingImage: 0,
});

describe("imageFillCapFor — politika tavanı", () => {
  it("listenin en çok %20'si, en az 1 satır", () => {
    expect(imageFillCapFor(75)).toBe(15);
    expect(imageFillCapFor(25)).toBe(5);
    expect(imageFillCapFor(3)).toBe(1);
    expect(imageFillCapFor(0)).toBe(1);
  });
});

describe("cleanRawRows — görsel kapısı + doldurucu", () => {
  const pool = [
    row("Fotoğraflı Kupa", "https://productimages.hepsiburada.net/s/1/500-500/a.jpg"),
    row("Fotoğraflı Bardak", "https://productimages.hepsiburada.net/s/2/500-500/b.jpg"),
    row("Görselsiz Termos", ""),
    row("Görselsiz Sürahi", ""),
    row("Görselsiz Tencere", ""),
  ];

  it("doldurucu KAPALI (0) iken eski davranış korunur: görselsiz satır girmez", () => {
    const stats = freshStats();
    const clean = cleanRawRows(pool, true, stats, 0);
    expect(clean.map((r) => r.title)).toEqual(["Fotoğraflı Kupa", "Fotoğraflı Bardak"]);
    expect(stats.rejectedMissingImage).toBe(3);
    expect(stats.admittedMissingImage).toBe(0);
  });

  it("doldurucu AÇIK iken en çok tavan kadar görselsiz satır eklenir ve SAYILIR", () => {
    const stats = freshStats();
    const clean = cleanRawRows(pool, true, stats, 2);
    expect(clean).toHaveLength(4);
    expect(stats.admittedMissingImage).toBe(2);
    expect(stats.rejectedMissingImage).toBe(3); // elenen sayısı yine bildirilir
  });

  it("havuzda görsel hiç yoksa kapı kapalıyken hepsi geçer (liste boşalmaz)", () => {
    const stats = freshStats();
    const imagelessOnly = pool.filter((r) => !r.imageUrl);
    const clean = cleanRawRows(imagelessOnly, false, stats, 0);
    expect(clean).toHaveLength(3);
    expect(stats.rejectedMissingImage).toBe(0);
  });

  it("doldurucu geçersiz/satışta olmayan satırları YİNE eler (kapı gevşemez)", () => {
    const stats = freshStats();
    const clean = cleanRawRows(
      [{ ...pool[2]!, inStock: false }, pool[2]!],
      true,
      stats,
      5,
    );
    expect(clean).toHaveLength(1);
    expect(stats.rejectedNotInStock).toBe(1);
    expect(stats.admittedMissingImage).toBe(1);
  });
});
