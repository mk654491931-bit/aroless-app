import { describe, it, expect } from "vitest";

import { cleanImageQuery } from "./product-image";
import { toWinningProducts } from "./discovery-result";

/**
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı: "fotoğraflar çok alakasız"):
 *   1. Kazıma görseli kayıtta taşınıyor, `DiscoveryWinner` şeması onu
 *      DÜŞÜRÜYORDU; kart da ürün adına web görsel araması yapıyordu.
 *   2. Arama sorgusu pazaryeri başlığı olduğu için ("... for $97.99 at
 *      Walmart") ürün fotoğrafı değil o cümlenin geçtiği sayfa dönüyordu.
 */
describe("cleanImageQuery", () => {
  it("fiyat ve mağaza kuyruğunu söker, ürün adını bırakır", () => {
    expect(
      cleanImageQuery("Brightech Libra LED desk lamp with USB-C port for $97.99 at Walmart"),
    ).toBe("Brightech Libra LED desk lamp with USB-C port");
  });

  it("sonda tek başına fiyatı söker", () => {
    expect(cleanImageQuery("Kodak Portra 400 Film $24.99")).toBe("Kodak Portra 400 Film");
  });

  it("sade ürün adına dokunmaz", () => {
    expect(cleanImageQuery("LED masa lambası")).toBe("LED masa lambası");
  });

  it("boş girdide boş döner", () => {
    expect(cleanImageQuery("   ")).toBe("");
  });
});

describe("toWinningProducts — ölçülen görsel karta taşınır", () => {
  const winner = {
    name: "Brightech Libra LED desk lamp",
    brand: "Brightech",
    seller: "Walmart",
    category: "Aydınlatma",
    priceUsd: 97.99,
    rating: 4.3,
    ratingCount: 120,
    inStock: null,
    sources: ["marketplace"],
    url: "https://walmart.com/x",
    imageUrl: "https://example.test/lamp.jpg",
    notes: "",
    preScore: 70,
    dataCompleteness: 4,
    fingerprint: "fp1",
    signals: { demand: 60, competition: 60, margin: 80, rating: 70, availability: 50 },
    councilScore: 78,
    confidenceScore: 60,
    votes: 14,
    agreement: 80,
    evidence: [],
  };

  it("kaynaktan gelen GERÇEK görsel `image_url` olarak geçer", () => {
    const [p] = toWinningProducts([winner as never]);
    expect(p.image_url).toBe("https://example.test/lamp.jpg");
  });

  it("görsel yoksa alakasız web araması devreye girsin diye boş bırakılır", () => {
    const [p] = toWinningProducts([{ ...winner, imageUrl: undefined } as never]);
    expect(p.image_url).toBeUndefined();
  });
});
