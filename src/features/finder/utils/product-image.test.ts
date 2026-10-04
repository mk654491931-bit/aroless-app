import { describe, it, expect } from "vitest";

import { resolveProductImage } from "./product-image";
import { toWinningProducts } from "./discovery-result";

/**
 * ÖLÇÜLEN HATA (2026-10-03, kullanıcı: "fotoğraflar çok alakasız"):
 *   Kart, kaynaktan gelen görsel yoksa ürün ADINA web görsel araması yapıyor
 *   ve dönen İLK fotoğrafı ürünün fotoğrafı olarak gösteriyordu. Arama motoru
 *   ürünün varlığına kanıt değildir: logo, banner, kategori karosu ya da BAŞKA
 *   bir ürünün fotoğrafı dönüyordu.
 *
 *   Bu testler YENİ sözleşmeyi kilitler:
 *     • kaynaktan gelen gerçek görsel → kabul,
 *     • AI'ın verdiği stok/yer tutucu/logo adresi → red,
 *     • kaynak adresi ölçülmüşse karta taşınır (doğrulanmış görsel arayüzü).
 */
describe("resolveProductImage — ölçülmüş adresi kabul, uydurmayı reddet", () => {
  const base = {
    name: "Brightech Libra LED desk lamp",
    description: "",
    why_winning: "",
    target_audience: "",
    ad_angles: [],
    supplier_price_usd: "",
    selling_price_usd: "",
    profit_margin_pct: 0,
    startup_cost_usd: "",
    platform_fit: [],
    platform_strategy: "",
    competitor_examples: [],
    supplier_links: [],
    alibaba_links: [],
    cost_breakdown: {
      supplier_cost: "",
      shipping_cost: "",
      platform_fee: "",
      ad_spend: "",
      net_profit: "",
      net_margin_pct: 0,
    },
    competition_level: "Low" as const,
    trend_score: 50,
    emoji: "📦",
  };

  it("kaynaktan gelen GERÇEK ürün adresini kabul eder", () => {
    expect(
      resolveProductImage({
        ...base,
        image_url: "https://cdn.test/products/desk-lamp.jpg",
      } as never),
    ).toBe("https://cdn.test/products/desk-lamp.jpg");
  });

  it("STOK GÖRSEL SERVİSİNİ reddeder (yer tutucu fotoğraf ürün görseli değildir)", () => {
    for (const url of [
      "https://placehold.co/600x600",
      "https://picsum.photos/600",
      "https://loremflickr.com/600/600/lamp",
      "https://dummyimage.com/600x600",
    ]) {
      expect(resolveProductImage({ ...base, image_url: url } as never)).toBeNull();
    }
  });

  it("LOGO / ikon adresini reddeder", () => {
    expect(
      resolveProductImage({ ...base, image_url: "https://cdn.test/assets/logo.svg" } as never),
    ).toBeNull();
    expect(
      resolveProductImage({ ...base, image_url: "https://cdn.test/img/icons/cart.png" } as never),
    ).toBeNull();
  });

  it("adres yoksa null döner (arama motoruna düşmez)", () => {
    expect(resolveProductImage({ ...base } as never)).toBeNull();
    expect(resolveProductImage({ ...base, image_url: "   " } as never)).toBeNull();
    expect(resolveProductImage({ ...base, image_url: 42 } as never)).toBeNull();
  });
});

describe("toWinningProducts — ölçülen görsel ve kaynak adresi karta taşınır", () => {
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

  it("görsel yoksa `image_url` boş kalır (ALAKASIZ web araması yapılmaz)", () => {
    const [p] = toWinningProducts([{ ...winner, imageUrl: undefined } as never]);
    expect(p.image_url).toBeUndefined();
  });

  it("ölçülmüş kaynak adresi karta taşınır (doğrulanmış görsel oradan bulunur)", () => {
    const [p] = toWinningProducts([winner as never]);
    expect(p.source_url).toBe("https://walmart.com/x");
  });

  it("kaynak adresi yoksa boş string kalır (adres UYDURULMAZ)", () => {
    const [p] = toWinningProducts([{ ...winner, url: "" } as never]);
    expect(p.source_url).toBe("");
  });
});
