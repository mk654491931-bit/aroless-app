/**
 * METİN ÇÖZÜMLEMESİ — "React güncelledi, katman eski metni geri yazdı" hatası.
 *
 * NEDEN VAR: katman bir düğümün ilk gördüğü metni kaynak sayıp saklıyordu.
 * React aynı düğümü farklı bir değerle güncellediğinde (skor, fiyat, durum)
 * çeviri ESKİ kaynağı yazıyor, güncel içerik ekranda kayboluyordu. Bu testler
 * "yeni içerik her zaman kazanır" kuralını kilitler.
 */
import { describe, expect, it } from "vitest";

import { resolveNodeText } from "./resolve";

/** Basit sözlük: "Hello" → "Merhaba". */
const translate = (source: string) => (source === "Hello" ? "Merhaba" : null);

describe("resolveNodeText", () => {
  it("ilk görülen metni kaynak sayar ve çevirir", () => {
    expect(
      resolveNodeText({ current: "Hello", storedSource: null, storedTarget: null, translate }),
    ).toEqual({ text: "Merhaba", source: "Hello" });
  });

  it("çeviri yoksa metne dokunmaz ve eşleme kurmaz", () => {
    const result = resolveNodeText({
      current: "Unmapped",
      storedSource: null,
      storedTarget: null,
      translate,
    });
    expect(result.text).toBe("Unmapped");
    expect(result.source).toBeNull();
  });

  it("düğüm hâlâ bizim çevirimizi taşıyorsa kaynak korunur", () => {
    expect(
      resolveNodeText({
        current: "Merhaba",
        storedSource: "Hello",
        storedTarget: "Merhaba",
        translate,
      }),
    ).toEqual({ text: "Merhaba", source: "Hello" });
  });

  it("React kaynağı yeniden yazdıysa yeniden çevirir", () => {
    expect(
      resolveNodeText({
        current: "Hello",
        storedSource: "Hello",
        storedTarget: "Merhaba",
        translate,
      }),
    ).toEqual({ text: "Merhaba", source: "Hello" });
  });

  it("React İÇERİĞİ DEĞİŞTİRDİYSE eski metin geri yazılmaz (asıl hata)", () => {
    const result = resolveNodeText({
      current: "Score: 42",
      storedSource: "Score: 39",
      storedTarget: "Puan: 39",
      translate: (s) => (s === "Score: 39" ? "Puan: 39" : null),
    });
    // Yeni içerik kaynaktır; çevirisi olmadığı için olduğu gibi kalır.
    expect(result.text).toBe("Score: 42");
    expect(result.source).toBeNull();
  });

  it("değişen içerik sözlükte varsa yeni kaynaktan çevrilir", () => {
    const result = resolveNodeText({
      current: "Hello",
      storedSource: "Old",
      storedTarget: "Eski",
      translate,
    });
    expect(result).toEqual({ text: "Merhaba", source: "Hello" });
  });
});
