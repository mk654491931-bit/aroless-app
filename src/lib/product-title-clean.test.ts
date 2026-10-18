/**
 * BAŞLIK TEMİZLİĞİ — saf testler (ağ YOK).
 *
 * İki yönlü hata riski var, ikisi de test edilir:
 *   • Eksik temizlik → aynı ürün iki kez listeye girer (fingerprint farklı).
 *   • Fazla temizlik → marka/model/ölçü silinir, FARKLI ürünler birleşir.
 */
import { describe, expect, it } from "vitest";

import { cleanListingTitle } from "./product-title-clean";
import { normalizeRaw } from "./product-discovery-filter.server";
import type { RawProduct } from "./product-discovery.types";

const raw = (title: string): RawProduct => ({
  title,
  brand: "",
  seller: "Acme",
  priceUsd: 49.9,
  rating: 4.4,
  ratingCount: 100,
  inStock: true,
  source: "aliexpress-reader",
  url: "https://example.com/p",
  imageUrl: "https://example.com/p.jpg",
  notes: "",
});

describe("cleanListingTitle", () => {
  it("kampanya/kargo gürültüsünü atar, ürün kimliğini KORUR", () => {
    expect(cleanListingTitle("Air Fryer 5.5L Free Shipping Hot Sale")).toBe("Air Fryer 5.5L");
    expect(cleanListingTitle("Ninja AF101 Air Fryer 4 Qt 2024 New Arrival")).toBe(
      "Ninja AF101 Air Fryer 4 Qt",
    );
    expect(cleanListingTitle("Robot Vacuum Q7 Wholesale Dropshipping")).toBe(
      "Robot Vacuum Q7",
    );
    expect(cleanListingTitle("Blender 1200W High Quality Factory Direct")).toBe("Blender 1200W");
  });

  it("ölçü, model kodu ve sayıları SİLMEZ", () => {
    // "5.5L", "4 Qt", "1200W", "AF101" ürün kimliğidir.
    expect(cleanListingTitle("Air Fryer 5.5L")).toBe("Air Fryer 5.5L");
    expect(cleanListingTitle("Ninja AF101 4 Qt")).toBe("Ninja AF101 4 Qt");
    expect(cleanListingTitle("Blender 1200W")).toBe("Blender 1200W");
  });

  it("anlam taşıyan bağlaçları silmez ('for', 'with', 'set')", () => {
    expect(cleanListingTitle("Air Fryer for 2 People")).toBe("Air Fryer for 2 People");
    expect(cleanListingTitle("Robot Vacuum with Mop")).toBe("Robot Vacuum with Mop");
  });

  it("aşırı kısalırsa özgün başlığı döndürür (yanlış birleştirme riski)", () => {
    // Temizlik sonrası "<8 karakter" kalıyorsa özgün metin korunur.
    expect(cleanListingTitle("Hot Sale")).toBe("Hot Sale");
    expect(cleanListingTitle("Free Shipping")).toBe("Free Shipping");
  });

  it("boş/boşluk girdide patlamaz", () => {
    expect(cleanListingTitle("")).toBe("");
    expect(cleanListingTitle("   ")).toBe("");
  });
});

describe("normalizeRaw — temizlik tekilleştirmeyi güçlendirir", () => {
  it("gürültülü ve temiz yazım AYNI parmak izini üretir", () => {
    const noisy = normalizeRaw(raw("Air Fryer 5.5L Free Shipping Hot Sale"));
    const clean = normalizeRaw(raw("Air Fryer 5.5L"));
    expect(noisy.name).toBe("Air Fryer 5.5L");
    expect(noisy.fingerprint).toBe(clean.fingerprint);
    expect(noisy.fingerprint.length).toBeGreaterThan(0);
  });

  it("FARKLI ürünleri birbirine karıştırmaz (ölçü/model korunur)", () => {
    const small = normalizeRaw(raw("Air Fryer 5.5L"))!;
    const large = normalizeRaw(raw("Air Fryer 8L"));
    expect(small.fingerprint).not.toBe(large.fingerprint);
    const other = normalizeRaw(raw("Ninja AF101 Air Fryer 4 Qt"));
    expect(other.fingerprint).not.toBe(small.fingerprint);
  });
});
