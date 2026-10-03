import { describe, it, expect } from "vitest";

import {
  DIGITAL_ONLY_SOURCES,
  isSellableProductRow,
  looksLikeMediaRelease,
  looksLikeProductRow,
} from "./product-discovery-query";
import { preferProductRows } from "./product-discovery-shortlist.server";

/**
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı: "film önerdi resmen, verdiğim nişte
 * o nişe uygun ürün vermiyor"): `itunes` kaynağı film/dizi/müzik kayıtlarını
 * ürün diye kabul ediyordu. Kullanıcı bir niş aradı, kartta film çıktı.
 *
 * Kapatılan iki kaçak yol:
 *   1. Dijital lisans kataloğu → hiçbir koşulda ürün sayılmaz.
 *   2. "Film" kelimesi geçen her niş medya nişi DEĞİLDİR ("analog film").
 */
describe("looksLikeMediaRelease", () => {
  it("medya çıkışlarını yakalar", () => {
    expect(looksLikeMediaRelease("Breaking Bad Season 3")).toBe(true);
    expect(looksLikeMediaRelease("Dune — 4K Blu-Ray")).toBe(true);
    expect(looksLikeMediaRelease("Yesterday, 4K UHD + Blu-ray Steelbook")).toBe(true);
    expect(looksLikeMediaRelease("The Expanse Vol. 4")).toBe(true);
  });

  it("gerçek fiziksel ürünleri YANLIŞLIKLA elmez", () => {
    // "film" kelimesi geçse bile bunlar satılabilir ürün adlarıdır.
    expect(looksLikeMediaRelease("Kodak Portra 400 Film 36mm 5 Adet")).toBe(false);
    expect(looksLikeMediaRelease("Film endüstriyel kamera tabanca")).toBe(false);
    expect(looksLikeMediaRelease("Analog Film developing kit")).toBe(false);
    expect(looksLikeMediaRelease("LED masa lambası")).toBe(false);
    // Belirsiz işaretler BİLEREK kapsam dışı: "4K TV" ve "kamera (2019)"
    // gerçek ürünlerdir; belirsiz başlıklar kaynak kapısına bırakılır.
    expect(looksLikeMediaRelease("Inception (2010)")).toBe(false);
    expect(looksLikeMediaRelease("Sony 4K UHD Smart TV (2019)")).toBe(false);
  });
});

describe("isSellableProductRow", () => {
  it("dijital lisans kataloğundaki satırı kaynağından dolayı eler", () => {
    // Başlık belirsiz olsa bile KAYNAK kapısı devrede: iTunes dijitaldir.
    expect(isSellableProductRow("Inception (2010)", "itunes", { priceUsd: 9.99, rating: 4.6 })).toBe(
      false,
    );
  });

  it("medya çıkışını hangi kaynaktan gelirse gelsin eler", () => {
    expect(
      isSellableProductRow("Interstellar (2014) 4K Blu-ray", "tr-marketplace", { priceUsd: 9.99 }),
    ).toBe(false);
  });

  it("gerçek ürünü bırakır", () => {
    expect(
      isSellableProductRow("Philips Hue E27 Akıllı Ampul", "tr-marketplace", {
        priceUsd: 12.5,
        rating: 4.4,
      }),
    ).toBe(true);
  });
});

describe("looksLikeProductRow — dijital lisans kataloğu", () => {
  it("fiyatı ve puanı olsa bile iTunes satırı ürün DEĞİLDİR", () => {
    expect(DIGITAL_ONLY_SOURCES.has("itunes")).toBe(true);
    expect(
      looksLikeProductRow("Inception (2010)", "itunes", { priceUsd: 9.99, rating: 4.6 }),
    ).toBe(false);
  });

  it("gerçek pazaryeri satırı üründür", () => {
    expect(
      looksLikeProductRow("Philips Hue E27 Akıllı Ampul", "tr-marketplace", {
        priceUsd: 12.5,
        rating: 4.4,
      }),
    ).toBe(true);
  });

  it("medya çıkışı başlığı hangi kaynaktan gelirse gelsin ürün değildir", () => {
    expect(
      looksLikeProductRow("Interstellar (2014) 4K Blu-ray", "tr-marketplace", { priceUsd: 9.99 }),
    ).toBe(false);
  });
});

describe("preferProductRows — gerçek ürün yokken film göstermez", () => {
  const film = {
    title: "Inception (2010)",
    source: "itunes",
    priceUsd: 9.99,
    rating: 4.6,
  } as never;
  const demandSignal = {
    title: "Light-emitting diode",
    source: "wikipedia-demand",
    priceUsd: null,
    rating: null,
  } as never;

  it("yalnız film varsa medya olmayan satırlara düşer", () => {
    const out = preferProductRows([film, demandSignal]);
    expect(out).toEqual([demandSignal]);
  });

  it("gerçek ürün varsa yalnız ürünler tutulur", () => {
    const product = {
      title: "Kodak Portra 400 Film 36mm",
      source: "tr-marketplace",
      priceUsd: 24.9,
      rating: 4.7,
    } as never;
    const out = preferProductRows([film, demandSignal, product]);
    expect(out).toEqual([product]);
  });

  it("hiçbir şey kalmıyorsa liste boşalmaz (ölçülmüş satırlar kanıttır)", () => {
    const out = preferProductRows([film]);
    expect(out).toHaveLength(1);
  });
});
