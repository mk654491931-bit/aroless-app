/**
 * AI SEÇİM ÇIKTISININ DOĞRULANMASI — saf birim testleri.
 *
 * Bu dosya "AI ürün verisi üretmez" ilkesinin KAPI testidir:
 *   • halüsinasyon ürün id → reddedilir
 *   • geçersiz puan      → reddedilir
 *   • bozuk JSON         → tamamen reddedilir, hat yedeğe düşer
 *   • mükerrer id        → ilki korunur
 *   • ajanın fiyatı      → kaynak veriyi EZMEZ
 *   • az aday            → liste UZATILMAZ
 */
import { describe, expect, it } from "vitest";

import {
  AiSelectionResponseSchema,
  deterministicSelection,
  mergeAgentAnalysis,
  resolveSelection,
  validateAiSelection,
} from "./discovery-ai-selection";

const candidates = [
  { productId: "p_air_fryer_1", name: "Air Fryer 5.5L", priceUsd: 59.9 },
  { productId: "p_vacuum_2", name: "Robot Vacuum L5", priceUsd: 249 },
  { productId: "p_lamp_3", name: "LED Masa Lambası", priceUsd: 24.99 },
];

describe("AiSelectionResponseSchema — şema kapısı", () => {
  it("geçerli yanıtı kabul eder", () => {
    const parsed = AiSelectionResponseSchema.safeParse({
      picks: [{ productId: "p_air_fryer_1", score: 91, reasoning: "ölçülmüş talep" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("puan 0-100 dışındaysa reddeder", () => {
    expect(
      AiSelectionResponseSchema.safeParse({
        picks: [{ productId: "p_air_fryer_1", score: 140 }],
      }).success,
    ).toBe(false);
    expect(
      AiSelectionResponseSchema.safeParse({
        picks: [{ productId: "p_air_fryer_1", score: -5 }],
      }).success,
    ).toBe(false);
  });

  it("kimliksiz seçimi reddeder", () => {
    expect(AiSelectionResponseSchema.safeParse({ picks: [{ score: 50 }] }).success).toBe(false);
  });

  it("boş picks dizisini reddeder (sıfır seçim geçerli değil)", () => {
    expect(AiSelectionResponseSchema.safeParse({ picks: [] }).success).toBe(false);
  });
});

describe("validateAiSelection — halüsinasyon kapısı", () => {
  it("gerçek kimlikleri kabul eder ve GERÇEK kaydı döner", () => {
    const result = validateAiSelection(
      {
        picks: [
          { productId: "p_vacuum_2", score: 88, reasoning: "yüksek puan" },
          { productId: "p_air_fryer_1", score: 74 },
        ],
      },
      candidates,
    );
    expect(result.schemaOk).toBe(true);
    expect(result.accepted).toHaveLength(2);
    // Dönen kayıt MODELİN DEĞİL, GİRDİDEKİ kayıttır.
    expect(result.accepted[0]!.record).toBe(candidates[1]);
    expect(result.accepted[0]!.record.priceUsd).toBe(249);
  });

  it("LİSTEDE OLMAYAN kimliği reddeder (halüsinasyon)", () => {
    const result = validateAiSelection(
      {
        picks: [
          { productId: "p_hallucinated_999", score: 99 },
          { productId: "p_air_fryer_1", score: 70 },
        ],
      },
      candidates,
    );
    expect(result.accepted.map((a) => a.selection.productId)).toEqual(["p_air_fryer_1"]);
    expect(result.rejected[0]!.productId).toBe("p_hallucinated_999");
    expect(result.rejected[0]!.reason).toContain("halüsinasyon");
  });

  it("TAMAMEN uydurma yanıt kabul edilmez (sıfır sahte ürün)", () => {
    const result = validateAiSelection(
      {
        picks: [
          { productId: "p_fake_1", score: 99 },
          { productId: "p_fake_2", score: 98 },
        ],
      },
      candidates,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.schemaOk).toBe(true); // şema geçerli ama kimlikler eşleşmedi
    expect(result.rejected).toHaveLength(2);
  });

  it("mükerrer kimliği NORMALLEŞTİRİR (ilk kazanır)", () => {
    const result = validateAiSelection(
      {
        picks: [
          { productId: "p_air_fryer_1", score: 90 },
          { productId: "p_air_fryer_1", score: 50 },
        ],
      },
      candidates,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("Mükerrer");
  });

  it("bozuk şemada HİÇBİR ŞEY kabul etmez", () => {
    for (const bad of [
      null,
      undefined,
      "çöp",
      {},
      { picks: "sayı değil" },
      { picks: [{ score: 5 }] },
    ]) {
      const result = validateAiSelection(bad, candidates);
      expect(result.schemaOk).toBe(false);
      expect(result.accepted).toHaveLength(0);
    }
  });

  it("üst sınırı aşan seçimleri eler", () => {
    const result = validateAiSelection(
      {
        picks: [
          { productId: "p_air_fryer_1", score: 90 },
          { productId: "p_vacuum_2", score: 80 },
        ],
      },
      candidates,
      { limit: 1 },
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("üst sınırı");
  });
});

describe("resolveSelection — AI seçer, KAYIT verir", () => {
  it("ürün verisini modelden ALMAZ", () => {
    const result = resolveSelection(
      {
        picks: [
          {
            productId: "p_air_fryer_1",
            score: 80,
            reasoning: "iyi",
            // Model ürün verisi DEĞİŞTİRMEYE çalışıyor:
            name: "Sahte Ürün",
            priceUsd: 1,
            imageUrl: "https://sahte.test/a.jpg",
          },
        ],
      },
      candidates,
    );
    // Modelin yazdığı alanlar YOK sayılır; dönen kayıt girdideki gerçek kayıttır.
    const product = result.products[0] as unknown as Record<string, unknown>;
    expect(product.name).toBe("Air Fryer 5.5L");
    expect(product.priceUsd).toBe(59.9);
    expect(product.imageUrl).toBeUndefined();
    // Puan ve gerekçe ayrı alanda taşınır — kaynak veri karışmaz.
    expect(result.analysis[0]).toEqual({
      productId: "p_air_fryer_1",
      score: 80,
      reasoning: "iyi",
    });
  });

  it("kimlik bulunamazsa boş liste döner (hat yedeğe düşer)", () => {
    const result = resolveSelection({ picks: [{ productId: "yok", score: 50 }] }, candidates);
    expect(result.products).toHaveLength(0);
    expect(result.schemaOk).toBe(true);
  });
});

describe("mergeAgentAnalysis — ajan ürün verisini değiştiremez", () => {
  it("ajanın uydurduğu fiyat kaynak fiyatı EZMEZ", () => {
    const source = { productId: "p1", priceUsd: 24.99, rating: 4.4 };
    const merged = mergeAgentAnalysis(source, {
      score: 91.4,
      reasoning: "marj iyi",
    });
    expect(merged.priceUsd).toBe(24.99);
    expect(merged.rating).toBe(4.4);
    // Ajan katkısı AYRI alandadır.
    expect(merged.analysis).toEqual({ score: 91, reasoning: "marj iyi" });
  });

  it("geçersiz ajan puanı null olur (uydurma puan yazılmaz)", () => {
    for (const score of [Number.NaN, -1, 101, Infinity, null]) {
      const merged = mergeAgentAnalysis({ productId: "p1" }, { score: score as never });
      expect(merged.analysis.score).toBeNull();
    }
  });

  it("boş gerekçe boş string kalır (undefined/NaN yazılmaz)", () => {
    const merged = mergeAgentAnalysis({ productId: "p1" }, { reasoning: null });
    expect(merged.analysis.reasoning).toBe("");
  });
});

describe("deterministicSelection — model yokken hat düşmez", () => {
  it("puana göre sıralayıp keser", () => {
    const pool = [
      { productId: "a", score: 10 },
      { productId: "b", score: 90 },
      { productId: "c", score: 50 },
    ];
    expect(deterministicSelection(pool, 2, (x) => x.score).map((x) => x.productId)).toEqual([
      "b",
      "c",
    ]);
  });

  it("havuz hedeften küçükse UZATMAZ (sayı doldurulmaz)", () => {
    expect(deterministicSelection([{ productId: "a", score: 1 }], 5, (x) => x.score)).toHaveLength(
      1,
    );
    expect(deterministicSelection([], 5)).toHaveLength(0);
  });
});
