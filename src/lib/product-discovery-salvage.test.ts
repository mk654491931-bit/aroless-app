// ============================================================================
// REGRESYON: İLK AŞAMA BOŞ KALDIĞINDA ÜRÜN BULUCU HATA DEĞİL, ÜRÜN DÖNDÜRÜR.
//
// CANLI HATA (2026-10-01, sorgu "LED masa lambası"): 13 kaynak koştu, 15 ham
// satır döndü, quality kapıları hepsini eledi ve iş "Hiç kaynak doğrulanabilir
// ürün döndürmedi." ile BAŞARISIZ oldu — kullanıcı parasını ödemişti.
//
// Beklenen davranış: kapılar sağlıklı havuzda aynen çalışır (kaynak azsa
// kurtarma DEVREYE GİRER, satır sayısı yeterliyse hiç dokunulmaz), liste boş
// kalırsa ÖLÇÜLMÜŞ satırlar kurtarılır ve hat `gemini_shortlist`e ilerler.
// Kurtarma uydurmaz: ölçülmemiş alan `null` kalır.
//
// Bu test AĞA ÇIKMAZ: kaynaklar mock'lanır, karar saf kodla verilir.
// ============================================================================
import { describe, expect, it, vi } from "vitest";

/** Kaynak katmanı mock'u: ağ yerine ölçülmüş/kirli satırları biz veriyoruz. */
const sourcesMock = vi.hoisted(() => ({ runSources: vi.fn() }));
vi.mock("./product-discovery-sources.server", () => sourcesMock);

import { runScrapeFilterStep } from "./product-discovery-pipeline.server";
import type { RawProduct } from "./product-discovery.types";

/** Canlı olaydaki gibi bir satır: kaynak kanıt taşır, ama puanı düşüktür. */
const lowRatedRow = (over: Partial<RawProduct> = {}): RawProduct => ({
  title: "LED Masa Lambası (düşük puanlı ama ölçülmüş)",
  brand: "Acme",
  seller: "",
  priceUsd: null,
  rating: 2,
  ratingCount: 40,
  source: "web-reviews",
  url: "https://example.test/led-masa-lambasi",
  notes: "example.com · 2.0 puan · 40 değerlendirme",
  ...over,
});

describe("runScrapeFilterStep — ilk aşama boş kalırsa kurtarma", () => {
  it("kapılar hepsini elediğinde ürünle DEVAM eder ve kurtarmayı dürüstçe yazar", async () => {
    sourcesMock.runSources.mockResolvedValue({
      products: [lowRatedRow()],
      reports: [{ name: "web-reviews", ok: true, items: 1, ms: 12, error: "" }],
    });

    const result = await runScrapeFilterStep("LED masa lambası", "US", "General", 5, {
      sourceCapMs: 2_000,
    });

    // Eski davranış: `products: []` → adım `failed`, kredi iade, kullanıcı boş.
    expect(result.ok).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.next).toBe("gemini_shortlist");
    expect(result.notes.join(" ")).toContain("kurtarıldı");
    // Dürüstlük kuralı: ölçülmemiş fiyat `null` kalır, uydurulmaz.
    expect(result.products[0]?.priceUsd).toBeNull();
  });

  it("kaynak hiç satır döndürmediyse kurtarma da boş kalır (uydurma yok)", async () => {
    sourcesMock.runSources.mockResolvedValue({
      products: [],
      reports: [{ name: "web-reviews", ok: false, items: 0, ms: 9, error: "fetch failed" }],
    });

    const result = await runScrapeFilterStep("LED masa lambası", "US", "General", 5, {
      sourceCapMs: 2_000,
    });

    expect(result.products).toHaveLength(0);
    expect(result.next).toBe("");
    // Bu yol adıma "boş" der; adım kullanıcıya SAYAÇLI hata mesajı yazar.
    expect(result.notes.join(" ")).toContain("Hiç kaynak ölçülmüş ürün döndürmedi");
  });
});
